import { digest } from './release-manifest.mjs';
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))) : v);
export function configurationFingerprint(c) {
  const keys = ['Role','Handler','Runtime','Timeout','MemorySize','Environment','KMSKeyArn','Layers','Architectures','EphemeralStorage','ImageConfigResponse','TracingConfig'];
  return digest(canonical({ ...Object.fromEntries(keys.filter(k => c[k] !== undefined).map(k => [k,c[k]])),
    VpcConfig: c.VpcConfig ? { SubnetIds: [...c.VpcConfig.SubnetIds].sort(), SecurityGroupIds: [...c.VpcConfig.SecurityGroupIds].sort() } : null }));
}
export function approveRelease(approval, manifest, selected, configuration, current, now = Date.now()) {
  if (approval?.version !== 1 || approval.manifest !== selected || approval.source !== manifest.source || approval.configuration !== configuration
    || approval.current !== current.id || !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= now
    || approval.expiresAt > now + 86400000 || manifest.compatibility !== current.compatibility) throw Error('RELEASE_APPROVAL_REQUIRED');
}
export function frontendFiles(front) {
  if (front?.version !== 1 || front.kind !== 'frontend' || !front.files?.['index.html']) throw Error('FRONTEND_MANIFEST_INVALID');
  const paths = Object.keys(front.files);
  if (paths.length < 1 || paths.length > 2048) throw Error('FRONTEND_MANIFEST_INVALID');
  for (const path of paths) if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')
    || !/^[a-f0-9]{64}$/.test(front.files[path])) throw Error('FRONTEND_MANIFEST_INVALID');
  return front.files;
}
