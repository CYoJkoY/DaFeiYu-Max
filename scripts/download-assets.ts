/**
 * Fetch the animation set named by `assets/upstream.json` from the upstream
 * dsh-pet commit and verify every file's SHA-1 before it is kept.
 *
 * Runs identically on Windows, macOS and Linux: `npm run assets`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface UpstreamFile {
  name: string;
  path: string;
  sha: string;
  size: number;
}

interface UpstreamManifest {
  commit: string;
  files: UpstreamFile[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/';
const workers = 6;
const attempts = 3;

function digest(data: Buffer): string {
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

export function manifestUrl(commit: string, path: string): string {
  return `${base}${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function fetchAnimation(commit: string, entry: UpstreamFile, destination: string): Promise<void> {
  const target = join(destination, entry.name);
  if (existsSync(target) && digest(readFileSync(target)) === entry.sha) return;
  const url = manifestUrl(commit, entry.path);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Follow redirects like the old urllib script did; the size and SHA-1
      // check below is what actually guarantees we kept the upstream bytes.
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${entry.name}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length !== entry.size || digest(data) !== entry.sha) throw new Error(`Checksum mismatch: ${entry.name}`);
      const temporary = `${target}.download`;
      writeFileSync(temporary, data);
      await rename(temporary, target);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to download ${entry.name}`);
}

export async function downloadAssets(base = root): Promise<number> {
  const manifest = JSON.parse(readFileSync(join(base, 'assets/upstream.json'), 'utf8')) as UpstreamManifest;
  const destination = join(base, 'assets/webm');
  mkdirSync(destination, { recursive: true });
  let next = 0;
  let completed = 0;
  const work = async (): Promise<void> => {
    while (next < manifest.files.length) {
      const entry = manifest.files[next];
      next += 1;
      await fetchAnimation(manifest.commit, entry, destination);
      completed += 1;
      if (completed % 20 === 0) console.log(`Verified ${completed}/${manifest.files.length} animations`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, manifest.files.length) }, work));
  return manifest.files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const total = await downloadAssets();
  console.log(`All ${total} animations downloaded and hash-verified.`);
}
