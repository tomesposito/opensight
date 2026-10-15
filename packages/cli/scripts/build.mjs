import { chmodSync } from 'node:fs';

// tsc preserves the shebang, but not executable permissions.
chmodSync(new URL('../dist/opensight.js', import.meta.url), 0o755);
