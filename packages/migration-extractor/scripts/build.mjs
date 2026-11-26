import { chmodSync } from 'node:fs';
// Match the headless CLI: preserve the executable bit as well as tsc's shebang.
chmodSync(new URL('../dist/cli.js', import.meta.url), 0o755);
