import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkSource(entries) {
  const seen = new Set();
  for (const { path, text } of entries) {
    const parts = path.split('/'), folded = path.toLowerCase();
    if (seen.has(folded) || path.length > 240 || parts.some(p => !p || p.length > 120 || /[<>:"\\|?*\x00-\x1f]/.test(p)
      || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('NONPORTABLE_PATH');
    seen.add(folded);
    if (/(?:^|\/)(?:\.env(?:\..*)?|credentials|terraform\.tfstate(?:\..*)?|.*\.tfvars(?:\.json)?|.*\.tfplan(?:\.json)?)$/.test(path)
      && !path.endsWith('.env.example')) throw Error('PRIVATE_CONFIGURATION_IN_GIT');
    if (/(?:^|\/)\.terraform(?:\/|$)/.test(path)) throw Error('TERRAFORM_WORKDIR_IN_GIT');
    if (/(?:^|\/)crash(?:\.[^/]*)?\.log$/.test(path)) throw Error('CRASH_LOG_IN_GIT');
    if (/(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/.test(text)) throw Error('CREDENTIAL_PATTERN_IN_GIT');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  checkSource(paths.map(path => ({ path, text: readFileSync(path, 'utf8') })));
  console.log('Tracked source secret/path checks passed. Pattern checks are not a guarantee.');
}
