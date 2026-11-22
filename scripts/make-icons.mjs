import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const python = process.platform === 'win32' ? 'python' : 'python3';
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'icons.py');
const result = spawnSync(python, [script], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
