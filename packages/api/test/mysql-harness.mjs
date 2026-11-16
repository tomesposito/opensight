import { createServer } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const capabilities = 1 | 4 | 8 | 512 | 8192 | 32768 | 131072 | 524288;
const scramble = Buffer.from('0123456789abcdefghij');
const sha1 = value => createHash('sha1').update(value).digest();
const zero = value => Buffer.from(`${value}\0`);
const uint = (value, bytes) => { const b = Buffer.alloc(bytes); b.writeUIntLE(value, 0, bytes); return b; };
const encoded = value => {
  if (value === null) return Buffer.from([251]);
  const b = Buffer.from(String(value));
  return Buffer.concat([b.length < 251 ? Buffer.from([b.length]) : Buffer.concat([Buffer.from([252]), uint(b.length, 2)]), b]);
};
const ok = Buffer.from([0, 0, 0, 2, 0, 0, 0]), eof = Buffer.from([254, 0, 0, 2, 0]);
const errorPacket = message => Buffer.concat([Buffer.from([255]), uint(1105, 2), Buffer.from('#HY000'), Buffer.from(message)]);
const field = (name, type) => Buffer.concat([
  ...['def', 'opensight', 'sales', 'sales', name, name].map(encoded),
  Buffer.from([12]), uint(45, 2), uint(65535, 4), Buffer.from([type]), uint(0, 2), Buffer.from([0, 0, 0]),
]);

/** Real MySQL v10/auth/text packets; SQLite evaluates the narrow generated source SELECT
 * subset so missing predicates actually leak fixture rows and fail assertions. This is a
 * protocol/security harness, not a simulation of live MySQL/MariaDB SQL semantics. */
export async function mysqlHarness(t, { columns, rows, password, username = 'synthetic' }) {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS opensight");
  const quote = s => `"${s.replaceAll('"', '""')}"`;
  db.exec(`CREATE TABLE opensight.sales (${columns.map(c => `${quote(c.name)} ${['INTEGER', 'BOOLEAN'].includes(c.type) ? 'INTEGER' : c.type === 'DECIMAL' ? 'REAL' : 'TEXT'}`).join(', ')})`);
  const insert = db.prepare(`INSERT INTO opensight.sales VALUES (${columns.map(() => '?').join(', ')})`);
  rows.forEach(row => insert.run(...row));
  db.function('CHAR_LENGTH', value => value === null ? null : [...String(value)].length);
  db.function('CONCAT', { varargs: true }, (...values) => values.some(v => v === null) ? null : values.join(''));
  db.function('mysql_left', (value, count) => value === null ? null : value.slice(0, count));
  db.function('DATE_FORMAT', (value, format) => {
    if (value === null) return null;
    const iso = new Date(value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`).toISOString();
    if (format === '%f') return `${iso.slice(20, 23)}000`;
    if (format === '%Y-%m-%dT%H:%i:%s.') return `${iso.slice(0, 19)}.`;
    throw new Error('Unsupported harness date format');
  });
  const state = { password, username, queries: [], sessions: [], authentications: [], errors: [], sockets: new Set(), mode: 'normal' };
  const server = createServer(socket => {
    state.sockets.add(socket); socket.on('close', () => state.sockets.delete(socket)); socket.on('error', () => {});
    let authenticated = false, pending = Buffer.alloc(0), sequence = 0;
    const send = payload => { if (!socket.destroyed) socket.write(Buffer.concat([uint(payload.length, 3), Buffer.from([sequence++]), payload])); };
    send(Buffer.concat([Buffer.from([10]), zero('8.0.36-loopback'), uint(1, 4), scramble.subarray(0, 8), Buffer.from([0]),
      uint(capabilities & 65535, 2), Buffer.from([45]), uint(2, 2), uint(capabilities >>> 16, 2), Buffer.from([21]), Buffer.alloc(10),
      scramble.subarray(8), Buffer.from([0]), zero('mysql_native_password')]));
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= pending.readUIntLE(0, 3) + 4) {
        const size = pending.readUIntLE(0, 3), packet = pending.subarray(4, size + 4);
        sequence = pending[3] + 1; pending = pending.subarray(size + 4);
        try {
          if (!authenticated) {
            const end = packet.indexOf(0, 32), user = packet.toString('utf8', 32, end), auth = packet.subarray(end + 2, end + 2 + packet[end + 1]);
            const first = sha1(state.password), mask = sha1(Buffer.concat([scramble, sha1(first)]));
            const expected = Buffer.from(first.map((v, i) => v ^ mask[i]));
            const accepted = user === state.username && auth.equals(expected);
            state.authentications.push({ user, accepted });
            if (!accepted) { send(errorPacket('Synthetic authentication failed')); socket.end(); continue; }
            authenticated = true; send(ok); continue;
          }
          if (packet[0] === 1) { socket.end(); continue; } // COM_QUIT
          if (packet[0] === 14) { send(ok); continue; } // COM_PING
          if (packet[0] !== 3) throw new Error(`Unexpected command ${packet[0]}`);
          const sql = packet.toString('utf8', 1); state.queries.push(sql);
          if (sql.startsWith('SET SESSION ')) { state.sessions.push(sql); send(ok); continue; }
          if (!sql.startsWith('SELECT ')) throw new Error('Expected a generated SELECT');
          if (state.mode === 'drop') { socket.destroy(); continue; }
          if (state.mode === 'error') { send(errorPacket(`private-host 127.0.0.1 ${state.username} ${state.password}`)); continue; }
          if (state.mode === 'stall') continue;
          // Translate only known MySQL tokens. Preserve quoted contents and evaluate the
          // emitted WHERE, projection and LIMIT, rather than returning canned safe rows.
          const translated = sql.replace(/`(?:``|[^`])*`|'(?:''|[^'])*'|CONVERT\(X'([0-9a-f]*)' USING utf8mb4\)|\bCOLLATE utf8mb4_(?:0900_)?bin\b|\bLEFT\(|\bDATETIME\(3\)/g, (token, hex) => {
            if (hex !== undefined) return `'${Buffer.from(hex, 'hex').toString('utf8').replaceAll("'", "''")}'`;
            if (token.startsWith('`')) return quote(token.slice(1, -1).replaceAll('``', '`'));
            if (token.startsWith('COLLATE ')) return 'COLLATE BINARY';
            if (token === 'LEFT(') return 'mysql_left(';
            if (token === 'DATETIME(3)') return 'TEXT';
            return token;
          });
          const statement = db.prepare(translated); statement.setReadBigInts(true);
          const result = statement.all(), names = statement.columns().map(c => c.name);
          const projected = [...sql.matchAll(/ELSE `((?:``|[^`])*)` END AS `v\d+`/g)].map(m => columns.find(c => c.name === m[1].replaceAll('``', '`')));
          if (projected.length + 1 !== names.length || projected.some(c => !c)) throw new Error('Unexpected bounded projection');
          const types = projected.map(c => ({ INTEGER: 8, DECIMAL: 246, BOOLEAN: 1, STRING: 253, DATETIME: 253 })[c.type]).concat(1);
          send(Buffer.from([names.length])); names.forEach((name, i) => send(field(name, types[i]))); send(eof);
          const output = state.mode === 'extra-rows' ? Array.from({ length: 4 }, () => result[0]) : result;
          for (const row of output) send(Buffer.concat(names.map(name => encoded(state.mode === 'oversized' ? name === 'oversized' ? 1 : null : row[name]))));
          send(eof);
        } catch (error) { state.errors.push(error); send(errorPacket('Harness could not evaluate query')); }
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of state.sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); db.close(); });
  return Object.assign(state, { port: server.address().port, connection: { host: '127.0.0.1', port: server.address().port, database: 'opensight', user: username, password, ssl: false } });
}
