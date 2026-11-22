import { createServer } from 'node:net';
import { once } from 'node:events';
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const i16 = n => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const z = s => Buffer.from(`${s}\0`);
const packet = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from(type), i32(body.length + 4), body]); };
const ready = packet('Z', Buffer.from('I'));
const error = message => packet('E', z('SERROR'), z('CXX000'), z(`M${message}`), Buffer.from([0]));
const fieldsPacket = fields => packet('T', i16(fields.length), ...fields.map(f => Buffer.concat([z(f.name), i32(0), i16(0), i32(f.oid), i16(-1), i32(-1), i16(0)])));
const rowPacket = row => packet('D', i16(row.length), ...row.map(v => v === null ? i32(-1) : Buffer.concat([i32(Buffer.byteLength(String(v))), Buffer.from(String(v))])));

/** A PostgreSQL v3 wire harness for the Redshift connector, NOT a Redshift SQL engine.
 * The caller evaluates/records SQL. No cluster or external socket is involved. */
export async function redshiftHarness(t, { evaluate = () => ({ fields: [], rows: [] }), password = 'synthetic-password', username = 'synthetic', database = 'synthetic_sales', holdOpen = false } = {}) {
  const state = { password, username, database, sessions: [], queries: [], bindings: [], authentications: [], startups: [], errors: [], sockets: new Set(), sslRequests: 0, mode: 'normal' };
  const server = createServer(socket => {
    state.sockets.add(socket); socket.on('close', () => state.sockets.delete(socket)); socket.on('error', () => {});
    let pending = Buffer.alloc(0), startup = false, user, sql = '', values = [], result, failed = false;
    const send = data => { if (!socket.destroyed) socket.write(data); };
    const execute = () => {
      state.queries.push(sql); state.bindings.push([...values]);
      if (sql.startsWith('SET ')) { state.sessions.push(sql); return { fields: [], rows: [] }; }
      if (state.mode === 'drop') { socket.destroy(); return; }
      if (state.mode === 'error') { send(error(`private-host 127.0.0.1 ${state.username} ${state.password}`)); failed = true; return; }
      if (state.mode === 'stall') return;
      return evaluate(sql, values, state);
    };
    const finish = data => {
      for (const row of data.rows) send(rowPacket(row));
      if (holdOpen && !sql.startsWith('SET ')) return;
      send(packet('C', z(sql.startsWith('SET ') ? 'SET' : `SELECT ${data.rows.length}`)));
    };
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      try {
        for (;;) {
          if (!startup) {
            if (pending.length < 4 || pending.length < pending.readInt32BE(0)) return;
            const size = pending.readInt32BE(0), body = pending.subarray(4, size); pending = pending.subarray(size);
            if (body.readInt32BE(0) === 80877103) { state.sslRequests++; send(Buffer.from('N')); continue; }
            if (body.readInt32BE(0) !== 196608) throw new Error('Unexpected startup protocol');
            const entries = body.subarray(4).toString().split('\0'), params = {};
            for (let i = 0; i < entries.length - 1 && entries[i]; i += 2) params[entries[i]] = entries[i + 1];
            state.startups.push(params); user = params.user; startup = true;
            send(packet('R', i32(3))); // Cleartext challenge on the explicitly allowed test loopback only.
            continue;
          }
          if (pending.length < 5 || pending.length < pending.readInt32BE(1) + 1) return;
          const size = pending.readInt32BE(1), type = String.fromCharCode(pending[0]), body = pending.subarray(5, size + 1); pending = pending.subarray(size + 1);
          if (type === 'X') { socket.end(); return; }
          if (type === 'p') {
            const accepted = user === state.username && body.toString().slice(0, -1) === state.password;
            state.authentications.push({ user, accepted });
            if (!accepted) { send(error('Synthetic authentication failed')); socket.end(); return; }
            if (state.mode === 'stall-auth') continue;
            send(Buffer.concat([packet('R', i32(0)), packet('S', z('server_version'), z('8.0.2')), packet('S', z('client_encoding'), z('UTF8')), ready]));
          } else if (type === 'Q') {
            sql = body.toString().slice(0, -1); values = []; failed = false;
            const data = execute();
            if (data) { if (data.fields.length) send(fieldsPacket(data.fields)); finish(data); if (!holdOpen || sql.startsWith('SET ')) send(ready); }
            else if (failed) send(ready);
          } else if (type === 'P') {
            sql = body.toString('utf8', body.indexOf(0) + 1, body.indexOf(0, body.indexOf(0) + 1)); failed = false; result = undefined;
            send(packet('1'));
          } else if (type === 'B') {
            let offset = body.indexOf(0) + 1; offset = body.indexOf(0, offset) + 1;
            const formats = body.readInt16BE(offset); offset += 2 + formats * 2;
            const count = body.readInt16BE(offset); offset += 2; values = [];
            for (let i = 0; i < count; i++) { const length = body.readInt32BE(offset); offset += 4; values.push(length === -1 ? null : body.toString('utf8', offset, offset + length)); if (length !== -1) offset += length; }
            send(packet('2'));
          } else if (type === 'D') {
            result = execute(); if (result) send(fieldsPacket(result.fields));
          } else if (type === 'E') {
            if (result) finish(result);
          } else if (type === 'S') {
            if (result && !holdOpen || failed) send(ready);
          } else if (type !== 'H') throw new Error(`Unexpected frontend message ${type}`);
        }
      } catch (e) { state.errors.push(e); send(error('Harness failure')); send(ready); }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of state.sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return Object.assign(state, { port: server.address().port, connection: { host: '127.0.0.1', port: server.address().port, database, user: username, password, ssl: false } });
}
