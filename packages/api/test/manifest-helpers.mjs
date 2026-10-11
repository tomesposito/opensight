import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { coordinationFixture } from './coordination-helpers.mjs';
import { migrateManifests } from '../dist/manifest-schema.js';
import { DurableCoordinator } from '../dist/coordination.js';
import { ManifestStore } from '../dist/manifests.js';
import { ArtifactTransfer } from '../dist/artifact-transfer.js';

export async function manifestFixture(t, options = {}) {
  const f = await coordinationFixture(t, options);
  if (options.manifests !== false) await migrateManifests(f.db, 'test', 'frozen', 'sqlite');
  const coordinator = new DurableCoordinator(f.db, f.metadata, 'test', 'sqlite'), manifests = new ManifestStore(coordinator, 'sqlite');
  return { ...f, coordinator, manifests,
    target: (i = 0) => ({ kind: 'source', id: f.uploaded[i].id, version: 1 }),
    rows: table => f.db.transaction(c => c.query(`SELECT * FROM ${table}`)),
    async admit(target, definitions = [], index = 0) {
      const input = await f.input(index, !!target);
      if (target) input.claim = { kind: target.kind, id: target.id, expectedVersion: target.version };
      return manifests.admit(f.contexts[index], input, definitions);
    },
  };
}
export function syntheticReference(f, target, index = 0) {
  const ctx = f.contexts[index], identity = { tenant: ctx.tenantId, namespace: ctx.namespaceId, owner: ctx.userId, kind: target.kind, resource: target.id };
  const hash = createHash('sha256').update(JSON.stringify(Object.values(identity))).digest('hex');
  return { identity, key: `artifacts/v1/${hash}/${randomUUID()}.parquet`, version: randomUUID(), descriptor: {
    format: 'opensight-parquet-v1', columns: [{ name: 'amount', type: 'INTEGER' }], rowCount: 1, encodedBytes: 128, decodedBytes: 428, sha256: 'a'.repeat(64), cachedInputs: [],
  } };
}
export async function ready(f, target = f.target(), reads = [], definitions = []) {
  const attempt = await f.admit(target, definitions);
  await f.manifests.publish(attempt, syntheticReference(f, target), reads); await f.coordinator.release(attempt); return attempt;
}
export function objectStorage() {
  const objects = new Map(), calls = [], storage = { beforeGet: undefined };
  storage.transfer = invocation => new ArtifactTransfer({ scope: invocation,
    call: work => invocation.stage(() => work(invocation.signal), 6000, () => invocation.controller.abort()),
    s3: { send: async command => {
      calls.push(command); const p = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        const chunks = []; for await (const chunk of p.Body) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), version = `version-${objects.size + 1}`;
        assert.equal(p.IfNoneMatch, '*'); assert.equal(p.ContentLength, bytes.length);
        assert.equal(p.ChecksumSHA256, createHash('sha256').update(bytes).digest('base64'));
        objects.set(p.Key, { bytes, VersionId: version, ContentLength: bytes.length, ContentType: p.ContentType, ChecksumSHA256: p.ChecksumSHA256 });
        return { VersionId: version, ChecksumSHA256: p.ChecksumSHA256 };
      }
      const value = objects.get(p.Key); assert.ok(value); assert.equal(p.VersionId, value.VersionId);
      if (command.constructor.name === 'GetObjectCommand') { await storage.beforeGet?.(); return { ...value, Body: Readable.from([value.bytes]) }; }
      return { ...value };
    } },
  }, { bucket: 'synthetic-artifacts', prefix: 'artifacts/v1' });
  return Object.assign(storage, { objects, calls });
}
