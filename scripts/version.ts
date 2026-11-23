/**
 * Print the packaged version from package.json.
 *
 * Replaces `node -p "require('./package.json').version"` in CI so the release
 * workflow does not need CommonJS `require` in an ESM project.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readVersion(base = root): string {
  const metadata = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { version: string };
  return metadata.version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${readVersion()}\n`);
}
