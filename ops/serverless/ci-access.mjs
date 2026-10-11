import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory } from './operator.mjs';
import { ciConfig, ciTrust, ciDeny, ciClosedTrust } from './ci-policy.mjs';
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

export async function disableCi(aws, config) {
  const c = ciConfig(config), roles = ['read', 'deploy'].map(n => `${c.deployment}-ci-${n}`);
  // Deny existing credentials first. If a later call fails, already disabled
  // identities stay disabled. No compensating step silently restores access.
  for (const role of roles) await aws('iam', 'put-role-policy', { 'role-name': role, 'policy-name': 'OpenSightEmergencyDeny', 'policy-document': JSON.stringify(ciDeny) });
  for (const role of roles) await aws('iam', 'update-assume-role-policy', { 'role-name': role, 'policy-document': JSON.stringify(ciClosedTrust) });
  for (const role of roles) {
    const deny = await aws('iam', 'get-role-policy', { 'role-name': role, 'policy-name': 'OpenSightEmergencyDeny' });
    const trust = await aws('iam', 'get-role', { 'role-name': role });
    if (canonical(deny.PolicyDocument) !== canonical(ciDeny) || canonical(trust.Role.AssumeRolePolicyDocument) !== canonical(ciClosedTrust)) throw Error('CI_DISABLE_CONFIGURATION_UNVERIFIED');
  }
  return { configured: true, activeSessionAndFreshFederationVerificationRequired: true };
}
export async function enableCi(aws, config) {
  const c = ciConfig(config), roles = ['read', 'deploy'].map(n => `${c.deployment}-ci-${n}`);
  for (const role of roles) await aws('iam', 'update-assume-role-policy', { 'role-name': role, 'policy-document': JSON.stringify(ciTrust(c)) });
  for (const role of roles) {
    const trust = await aws('iam', 'get-role', { 'role-name': role });
    if (canonical(trust.Role.AssumeRolePolicyDocument) !== canonical(ciTrust(c))) throw Error('CI_TRUST_UNVERIFIED');
  }
  for (const role of roles) await aws('iam', 'delete-role-policy', { 'role-name': role, 'policy-name': 'OpenSightEmergencyDeny' });
  return { configured: true, freshFederationVerificationRequired: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const operation = process.argv[2], directory = privateDirectory(process.env.OPENSIGHT_OPERATOR_DIR), path = join(directory, 'ci-config.json');
  const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid()) throw Error('PRIVATE_CONFIG_UNSAFE');
  const c = ciConfig(JSON.parse(readFileSync(path, 'utf8')));
  const aws = async (service, action, args) => {
    const parameters = Object.entries(args).flatMap(([k, v]) => [`--${k}`, String(v)]);
    try { return JSON.parse(execFileSync('aws', [service, action, '--region', c.region, '--output', 'json', '--no-cli-pager', ...parameters], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '{}'); }
    catch { throw Error('CI_AWS_COMMAND_FAILED'); }
  };
  const identity = await aws('sts', 'get-caller-identity', {});
  if (identity.Account !== c.account || /:assumed-role\/[^/]*-ci-(read|deploy)\//.test(identity.Arn)) throw Error('INDEPENDENT_OPERATOR_REQUIRED');
  if (!['disable-ci', 'enable-ci'].includes(operation)) throw Error('CI_ACCESS_COMMAND_INVALID');
  const result = await (operation === 'disable-ci' ? disableCi : enableCi)(aws, c);
  writeFileSync(join(directory, `ci-access-${operation}-${Date.now()}.json`), JSON.stringify({ at: new Date().toISOString(), operation, ...result }) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result));
}
