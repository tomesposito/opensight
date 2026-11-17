import { DatabaseSync } from 'node:sqlite';
import { redshiftHarness as wireHarness } from '../../query-engine/test/redshift-harness.mjs';

/** SQLite evaluates the emitted projection, predicates and bounds; only the narrow date
 * formatting/cast syntax is translated. This proves wire/security flow, not Redshift semantics. */
export async function redshiftHarness(t, { columns, rows, password, username = 'synthetic' }) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quote = s => `"${s.replaceAll('"', '""')}"`;
  db.exec("ATTACH DATABASE ':memory:' AS opensight");
  db.exec(`CREATE TABLE opensight.sales (${columns.map(c => `${quote(c.name)} ${['INTEGER', 'BOOLEAN'].includes(c.type) ? 'INTEGER' : c.type === 'DECIMAL' ? 'REAL' : 'TEXT'}`).join(', ')})`);
  const insert = db.prepare(`INSERT INTO opensight.sales VALUES (${columns.map(() => '?').join(', ')})`);
  rows.forEach(row => insert.run(...row));
  db.function('TO_CHAR', (value, format) => {
    if (format !== 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') throw new Error('Unrecognized harness format');
    return value === null ? null : new Date(value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`).toISOString();
  });
  return wireHarness(t, { password, username, database: 'opensight', evaluate(sql, values, state) {
    const translated = sql.replace(/"(?:""|[^"])*"|'(?:''|[^'])*'|CAST\((\$\d+) AS TIMESTAMP\)/g, (token, parameter) => parameter ?? token);
    const statement = db.prepare(translated); statement.setReadBigInts(true);
    const result = statement.all(Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v]))), names = statement.columns().map(c => c.name);
    const projected = [...sql.matchAll(/ELSE "((?:""|[^"])*)" END AS "v\d+"/g)].map(m => columns.find(c => c.name === m[1].replaceAll('""', '"')));
    if (projected.length + 1 !== names.length || projected.some(c => !c)) throw new Error('Unexpected bounded projection');
    const oids = projected.map(c => ({ INTEGER: 20, DECIMAL: 1700, BOOLEAN: 16, STRING: 1043, DATETIME: 1043 })[c.type]).concat(16);
    const output = state.mode === 'extra-rows' ? Array.from({ length: 4 }, () => result[0]) : result;
    return { fields: names.map((name, i) => ({ name, oid: oids[i] })), rows: output.map(row => names.map((name, i) => {
      const value = state.mode === 'oversized' ? name === 'oversized' ? 1 : null : row[name];
      return value === null ? null : oids[i] === 16 ? Number(value) ? 't' : 'f' : String(value);
    })) };
  } });
}
