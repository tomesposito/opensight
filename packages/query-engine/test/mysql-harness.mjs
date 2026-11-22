import { createServer } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

// Minimal prepared-query companion to packages/api/test/mysql-harness.mjs.
// Real v10 authentication, prepare/bind and binary rows, not a MySQL SQL engine.
const capabilities = 1 | 4 | 8 | 512 | 8192 | 32768 | 131072 | 524288;
const scramble = Buffer.from('0123456789abcdefghij');
const sha1 = value => createHash('sha1').update(value).digest();
const zero = value => Buffer.from(`${value}\0`);
const uint = (value, bytes) => { const b = Buffer.alloc(bytes); b.writeUIntLE(value, 0, bytes); return b; };
const encoded = value => {
  const b = Buffer.from(String(value));
  return Buffer.concat([b.length < 251 ? Buffer.from([b.length]) : Buffer.concat([Buffer.from([252]), uint(b.length, 2)]), b]);
};
const ok = Buffer.from([0, 0, 0, 2, 0, 0, 0]), eof = Buffer.from([254, 0, 0, 2, 0]);
const errorPacket = message => Buffer.concat([Buffer.from([255]), uint(1105, 2), Buffer.from('#HY000'), Buffer.from(message)]);
const field = ({ name, type }) => Buffer.concat([
  ...['def', 'public', 'sales', 'sales', name, name].map(encoded),
  Buffer.from([12]), uint(45, 2), uint(65535, 4), Buffer.from([type]), uint(0, 2), Buffer.from([0, 0, 0]),
]);
function binaryRow(fields, row) {
  const nulls = Buffer.alloc(Math.ceil((fields.length + 2) / 8));
  const values = row.map((value, i) => {
    if (value === null) { nulls[(i + 2) >> 3] |= 1 << ((i + 2) % 8); return Buffer.alloc(0); }
    const type = fields[i].type;
    if (type === 8) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(value)); return b; }
    if (type === 5) { const b = Buffer.alloc(8); b.writeDoubleLE(Number(value)); return b; }
    if (type === 3) { const b = Buffer.alloc(4); b.writeInt32LE(Number(value)); return b; }
    if (type === 12) {
      const date = new Date(value), b = Buffer.alloc(12); b[0] = 11;
      b.writeUInt16LE(date.getUTCFullYear(), 1); b[3] = date.getUTCMonth() + 1; b[4] = date.getUTCDate();
      b[5] = date.getUTCHours(); b[6] = date.getUTCMinutes(); b[7] = date.getUTCSeconds(); b.writeUInt32LE(date.getUTCMilliseconds() * 1000, 8); return b;
    }
    if (![0, 246, 253, 254].includes(type)) throw new Error(`Unsupported harness result type ${type}`);
    return encoded(value);
  });
  return Buffer.concat([Buffer.from([0]), nulls, ...values]);
}
function bindings(packet, count) {
  const nulls = packet.subarray(10, 10 + Math.ceil(count / 8));
  let offset = 10 + nulls.length;
  if (!count) return [];
  if (packet[offset++] !== 1) throw new Error('Expected fresh parameter types');
  const types = packet.subarray(offset, offset + 2 * count); offset += 2 * count;
  return Array.from({ length: count }, (_, i) => {
    if (nulls[i >> 3] & (1 << (i % 8))) return null;
    const type = types[i * 2];
    if (type === 5) { const n = packet.readDoubleLE(offset); offset += 8; return n; }
    if (type === 1) return packet[offset++] !== 0;
    if (type !== 253) throw new Error(`Unsupported harness parameter type ${type}`);
    let length = packet[offset++];
    if (length === 252) { length = packet.readUInt16LE(offset); offset += 2; }
    const value = packet.toString('utf8', offset, offset + length); offset += length; return value;
  });
}
export async function mysqlHarness(t, { evaluate, holdOpen = false, password = 'synthetic-password' }) {
  const state = { sessions: [], queries: [], bindings: [], errors: [], sockets: new Set(), mode: 'normal' };
  const server = createServer(socket => {
    state.sockets.add(socket); socket.on('close', () => state.sockets.delete(socket)); socket.on('error', () => {});
    let authenticated = false, pending = Buffer.alloc(0), sequence = 0, sql = '', count = 0;
    const send = payload => { if (!socket.destroyed) socket.write(Buffer.concat([uint(payload.length, 3), Buffer.from([sequence++ % 256]), payload])); };
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
            const first = sha1(password), mask = sha1(Buffer.concat([scramble, sha1(first)]));
            if (user !== 'synthetic' || !auth.equals(Buffer.from(first.map((v, i) => v ^ mask[i])))) { send(errorPacket('Synthetic authentication failed')); socket.end(); continue; }
            authenticated = true; send(ok); continue;
          }
          if (packet[0] === 1) { socket.end(); continue; }
          if (packet[0] === 3) {
            const session = packet.toString('utf8', 1);
            if (!session.startsWith('SET SESSION ')) throw new Error('Expected session setup');
            state.sessions.push(session); send(ok); continue;
          }
          if (packet[0] === 22) { // COM_STMT_PREPARE
            sql = packet.toString('utf8', 1); state.queries.push(sql);
            if (state.mode === 'prepare-error') { send(errorPacket(`private-host ${password}`)); continue; }
            count = [...sql.matchAll(/`(?:``|[^`])*`|'(?:''|[^'])*'|\?/g)].filter(m => m[0] === '?').length;
            send(Buffer.concat([Buffer.from([0]), uint(1, 4), uint(0, 2), uint(count, 2), Buffer.alloc(3)]));
            for (let i = 0; i < count; i++) send(field({ name: '?', type: 253 }));
            if (count) send(eof); continue;
          }
          if (packet[0] !== 23) throw new Error(`Unexpected command ${packet[0]}`);
          const values = bindings(packet, count); state.bindings.push(values);
          if (state.mode === 'drop') { socket.destroy(); continue; }
          if (state.mode === 'error') { send(errorPacket(`private-host 127.0.0.1 ${password}`)); continue; }
          if (state.mode === 'stall') continue;
          const result = evaluate(sql, values);
          send(Buffer.from([result.fields.length])); result.fields.forEach(f => send(field(f))); send(eof);
          for (const row of result.rows) send(binaryRow(result.fields, row));
          if (!holdOpen) send(eof);
        } catch (error) { state.errors.push(error); send(errorPacket('Harness failure')); }
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of state.sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return Object.assign(state, { port: server.address().port });
}
