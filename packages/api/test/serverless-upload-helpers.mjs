import { createHash, randomUUID } from 'node:crypto';
import { manifestFixture } from './manifest-helpers.mjs';
import { migrateDispatch } from '../dist/dispatch-schema.js';
import { migrateObjects } from '../dist/object-schema.js';
import { migrateOperations } from '../dist/operation-schema.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { ObjectLedger } from '../dist/object-ledger.js';
import { DurableUploads } from '../dist/durable-uploads.js';
import { MetadataError } from '../dist/metadata-db.js';
const bytes = Buffer.from('name,value\none,1\n');
export const directRequest = () => ({ config: { format: 'csv' }, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('base64'), mediaType: 'text/csv',
  expiresAt: new Date(Date.now() + 3600000).toISOString(), policy: { rowLevel: false, rowRules: [] } });
export async function uploadFixture(t, options = {}) {
  const f = await manifestFixture(t, options);
  const entitlements = { defaults: { ...f.entitlements.defaults, storageBytes: 128 * 1024 * 1024 }, tenants: {} };
  await f.db.transaction(c => c.query('UPDATE sr_limits SET entitlements = ?', [JSON.stringify(entitlements)]));
  await migrateDispatch(f.db, 'test', 'frozen', 'sqlite'); await migrateObjects(f.db, 'test', 'frozen', 'sqlite'); await migrateOperations(f.db, 'test', 'frozen', 'sqlite');
  const events = [], transport = { recover: async e => { events.push(['recover', e]); }, dispatch: async (e, payload) => { events.push(['dispatch', e, payload]); } };
  const dispatch = new DurableDispatch(f.db, f.metadata, 'test', transport, 'sqlite'), ledger = new ObjectLedger(f.metadata, 'test');
  const objects = { capability: async (entry, until) => ({ url: `https://synthetic.example/${entry.id}`, method: 'PUT', headers: {}, expiresAt: new Date(until).toISOString() }),
    head: async (entry, version) => ({ version, bytes: entry.capacityBytes, checksum: entry.checksum }) };
  const uploads = new DurableUploads(f.metadata, dispatch, ledger, objects); await f.open();
  return { ...f, dispatch, ledger, objects, uploads, transport, events };
}
