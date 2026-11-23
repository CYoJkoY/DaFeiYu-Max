import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ActivityReader, readQuota } from '../src/core/magpie.ts';

interface UpstreamManifest {
  files: Array<{ name: string; sha: string }>;
}

const manifest = JSON.parse(readFileSync(new URL('../assets/upstream.json', import.meta.url), 'utf8')) as UpstreamManifest;
for (const entry of manifest.files) {
  const data = readFileSync(new URL('../assets/webm/' + encodeURIComponent(entry.name), import.meta.url));
  const hash = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  if (hash !== entry.sha) throw new Error('Animation checksum mismatch: ' + entry.name);
}
console.log(`Verified ${manifest.files.length} animation checksums.`);
const reader = new ActivityReader();
console.log('Activity:', await reader.read());
if (process.argv.includes('--quota')) console.log('Quota:', await readQuota());
