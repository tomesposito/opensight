import { DuckDBInstance, DOUBLE, INTEGER, VARCHAR, BOOLEAN, type DuckDBConnection } from '@duckdb/node-api';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import type { PrepScalar, PrepSink } from './prep-stream.js';

export class ArtifactFormatError extends Error {
  readonly code = 'ARTIFACT_INVALID';
  constructor() { super('ARTIFACT_INVALID'); }
}
function invalid(): never { throw new ArtifactFormatError(); }
export function artifactColumns(raw: unknown): PrepColumn[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 256) invalid();
  const names = new Set<string>();
  return raw.map((column: unknown) => {
    if (!column || typeof column !== 'object' || Array.isArray(column)) return invalid();
    const c = column as Record<string, unknown>;
    if (Object.keys(c).sort().join() !== 'name,type' || typeof c.name !== 'string' || !c.name.length || c.name.length > 512 || c.name.includes('\0')
      || !['INTEGER', 'DECIMAL', 'STRING', 'DATETIME', 'BOOLEAN'].includes(String(c.type)) || names.has(c.name)) invalid();
    names.add(c.name); return { name: c.name, type: c.type as PrepColumn['type'] };
  });
}
export function artifactScalar(value: unknown, column: PrepColumn): PrepScalar {
  if (value === null) return null;
  if (column.type === 'BOOLEAN') return typeof value === 'boolean' ? value : invalid();
  if (column.type === 'STRING' || column.type === 'DATETIME') return typeof value === 'string' ? value : invalid();
  if (typeof value === 'number' && Number.isFinite(value) && (column.type !== 'INTEGER' || Number.isInteger(value))) return value;
  // Existing PostgreSQL/DuckDB normalization preserves large integers as text.
  if (typeof value === 'string' && /^(?:0|-?[1-9]\d*)$/.test(value)) return value;
  return invalid();
}
const numeric = (column: PrepColumn): boolean => column.type === 'INTEGER' || column.type === 'DECIMAL';
const physical = (columns: readonly PrepColumn[]) => [
  { name: 'ordinal', type: 'BIGINT' },
  ...columns.flatMap((c, i) => numeric(c) ? [{ name: `c${i}n`, type: 'DOUBLE' }, { name: `c${i}s`, type: 'VARCHAR' }]
    : [{ name: `c${i}`, type: c.type === 'BOOLEAN' ? 'BOOLEAN' : 'VARCHAR' }]),
];

/** Internal worker primitive. Only its parent-generated file is accessible. */
export async function withArtifactFile<T>(path: string, memoryMb: number, run: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
  if (!path.startsWith('/') || path.includes('\0') || !Number.isSafeInteger(memoryMb) || memoryMb < 1) invalid();
  const instance = await DuckDBInstance.create(':memory:', { autoinstall_known_extensions: 'false', autoload_known_extensions: 'false',
    threads: '1', memory_limit: `${memoryMb}MB`, max_temp_directory_size: '0B' });
  try {
    const connection = await instance.connect();
    try {
      // DuckDB does not accept allowed_paths as an instance creation option.
      await connection.run('SET allowed_paths = [$1]', [path]);
      await connection.run('SET enable_external_access = false');
      await connection.run('SET lock_configuration = true');
      return await run(connection);
    } finally { connection.closeSync(); }
  } finally { instance.closeSync(); }
}

export async function writeArtifactParquet(path: string, columns: PrepColumn[], rows: readonly PrepScalar[][], memoryMb: number): Promise<void> {
  const checked = artifactColumns(columns), fields = physical(checked);
  await withArtifactFile(path, memoryMb, async c => {
    await c.run(`CREATE TABLE materialized (${fields.map(f => `${f.name} ${f.type}`).join(',')})`);
    for (let offset = 0; offset < rows.length; offset += 32) {
      const values: PrepScalar[] = [], count = Math.min(32, rows.length - offset);
      const slots = Array.from({ length: count }, (_, r) => {
        const row = rows[offset + r]!; if (row.length !== checked.length) invalid();
        values.push(offset + r);
        checked.forEach((column, i) => {
          const value = artifactScalar(row[i], column);
          if (numeric(column)) values.push(typeof value === 'number' ? value : null, typeof value === 'string' ? value : null);
          else values.push(value);
        });
        return `(${fields.map(() => '?').join(',')})`;
      });
      // Inferred integer binding turns -0 into +0 and can overflow large doubles.
      const bindings = fields.map(f => f.type === 'DOUBLE' ? DOUBLE : f.type === 'VARCHAR' ? VARCHAR : f.type === 'BOOLEAN' ? BOOLEAN : INTEGER);
      await c.run(`INSERT INTO materialized VALUES ${slots.join(',')}`, values, Array.from({ length: count }, () => bindings).flat());
    }
    await c.run('COPY materialized TO $1 (FORMAT PARQUET, COMPRESSION ZSTD)', [path]);
  });
}

export async function readArtifactParquet(path: string, columns: PrepColumn[], rowCount: number, cellChars: number, sink: PrepSink, memoryMb: number): Promise<void> {
  const checked = artifactColumns(columns), fields = physical(checked);
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || rowCount >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(cellChars) || cellChars < 1) invalid();
  await withArtifactFile(path, memoryMb, async c => {
    const schema = (await c.runAndReadAll('DESCRIBE SELECT * FROM read_parquet($1)', [path])).getRowObjects();
    if (schema.length !== fields.length || schema.some((f, i) => f.column_name !== fields[i]!.name || f.column_type !== fields[i]!.type)) invalid();
    const textSize = fields.filter(f => f.type === 'VARCHAR').map(f => `COALESCE(LENGTH(${f.name}),0)`).join('+') || '0';
    const oversized = `(${textSize}) > ${cellChars}`;
    const selected = fields.map(f => f.type === 'VARCHAR' ? `CASE WHEN ${oversized} THEN NULL ELSE ${f.name} END` : f.name);
    const result = await c.stream(`SELECT ${selected.join(',')}, ${oversized} FROM read_parquet($1) ORDER BY ordinal LIMIT ${rowCount + 1}`, [path]);
    sink.start(checked); let count = 0;
    for (;;) {
      const chunk = await result.fetchChunk(); if (!chunk || !chunk.rowCount) break;
      for (let r = 0; r < chunk.rowCount; r++) {
        const raw = chunk.getRowValues(r);
        if (raw[fields.length] !== false) sink.oversized();
        if (raw[0] !== BigInt(count) || count >= rowCount) invalid();
        let index = 1;
        const values = checked.map(column => {
          if (!numeric(column)) return artifactScalar(raw[index++], column);
          const number = raw[index++], string = raw[index++];
          if (number !== null && string !== null) invalid();
          if (number !== null && typeof number !== 'number' || string !== null && typeof string !== 'string') invalid();
          return artifactScalar(number ?? string, column);
        });
        sink.row(values); count++;
      }
    }
    if (count !== rowCount) invalid();
  });
}
