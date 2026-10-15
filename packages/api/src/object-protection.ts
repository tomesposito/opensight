import { MetadataError, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';

const scoped = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const number = (value: SqlValue | undefined): number => {
  const n = Number(value); if (value === undefined || !Number.isSafeInteger(n) || n < 0) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503); return n;
};
export type StorageProtection = 'pin' | 'operation' | 'source' | 'manifest' | 'result';
/** Shared with the collector. Null means an indefinite live reference; time alone cannot release it. */
export async function objectProtection(c: SqlConnection, values: SqlValue[], entry: SqlRow, now: number): Promise<{ until: number | null; reasons: StorageProtection[] }> {
    const reasons = new Set<StorageProtection>();
    let until = Math.max(number(entry.retention_until), number(entry.created_at) + 86400000, number(entry.signature_until) + 600000);
    for (const pin of await c.query(`SELECT expires_at FROM sr_object_pin WHERE ${scoped} AND object_id = ? AND expires_at > ?`, [...values, entry.object_id!, now])) { until = Math.max(until, number(pin.expires_at)); reasons.add('pin'); }
    if (entry.purpose === 'raw-upload' || entry.purpose === 'source') {
      const uploads = await c.query(`SELECT operation_id FROM sr_upload WHERE ${scoped} AND (raw_object_id = ? OR output_object_id = ?) AND state = 'accepted'`, [...values, entry.object_id!, entry.object_id!]);
      for (const upload of uploads) {
        const op = (await c.query(`SELECT expires_at FROM sr_operation WHERE ${scoped} AND operation_id = ? AND state IN ('queued','running')`, [...values, upload.operation_id!]))[0];
        if (op) { until = Math.max(until, number(op.expires_at)); if (number(op.expires_at) > now) reasons.add('operation'); }
      }
    }
    if (entry.purpose === 'source') for (const source of await c.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = 'source'", values.slice(1))) {
      const body = JSON.parse(String(source.body)) as { binding?: { version?: number; objectId?: string; state?: string; expiresAt?: string } }, b = body.binding;
      if (b?.version === 4 && b.objectId === entry.object_id && b.state === 'active') {
        const expires = Date.parse(b.expiresAt ?? ''); if (!Number.isSafeInteger(expires)) throw new MetadataError('OBJECT_REFERENCE_INVALID', 503);
        until = Math.max(until, expires); if (expires > now) reasons.add('source');
      }
    }
    if (entry.purpose === 'cache') for (const manifest of await c.query(`SELECT body FROM sr_manifest WHERE ${scoped} AND state = 'ready'`, values)) {
      const doc = JSON.parse(String(manifest.body)) as { reference?: { key?: string; version?: string }; definitions?: { kind: string; id: string }[] };
      if (doc.reference?.key !== entry.object_key || doc.reference?.version !== entry.object_version) continue;
      let expires = Infinity;
      if (!Array.isArray(doc.definitions)) throw new MetadataError('OBJECT_REFERENCE_INVALID', 503);
      for (const d of doc.definitions.filter(d => d.kind === 'source')) {
        const source = (await c.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = 'source' AND resource_id = ?", [...values.slice(1), d.id]))[0];
        if (!source) { expires = now; break; }
        const binding = (JSON.parse(String(source.body)) as { binding?: { state?: string; expiresAt?: string } }).binding;
        if (!binding || binding.state !== 'active') { expires = now; break; }
        if (binding.expiresAt) { const value = Date.parse(binding.expiresAt); if (!Number.isSafeInteger(value)) throw new MetadataError('OBJECT_REFERENCE_INVALID', 503); expires = Math.min(expires, value); }
      }
      if (expires === Infinity) return { until: null, reasons: [...reasons, 'manifest'] };
      until = Math.max(until, expires); if (expires > now) reasons.add('manifest');
    }
    if (entry.purpose === 'result') for (const op of await c.query(`SELECT o.expires_at FROM sr_result_chunk r JOIN sr_operation o ON o.deployment = r.deployment AND o.tenant_id = r.tenant_id AND o.namespace_id = r.namespace_id AND o.owner_id = r.owner_id AND o.operation_id = r.operation_id
      WHERE r.deployment = ? AND r.tenant_id = ? AND r.namespace_id = ? AND r.owner_id = ? AND r.object_id = ? AND o.state = 'completed'`, [...values, entry.object_id!])) { until = Math.max(until, number(op.expires_at)); if (number(op.expires_at) > now) reasons.add('result'); }
    return { until, reasons: [...reasons] };
}
