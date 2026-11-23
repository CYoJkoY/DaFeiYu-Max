/**
 * Verify the release archives with the same ZIP code that writes them.
 *
 * Checks performed, per platform:
 *   win32  – portable layout, no installer, required runtime entries present
 *   darwin – one tray icon identical to the source, app bundle entries present
 *
 * Usage: node scripts/verify-archives.ts [--platform darwin|win32] <archive...>
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, type ZipEntry } from './lib/zip.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type ArchivePlatform = 'darwin' | 'win32';

export interface ArchiveReport {
  path: string;
  platform: ArchivePlatform;
  entries: number;
}

function topLevelDirectories(entries: ZipEntry[]): string[] {
  const roots = new Set<string>();
  for (const entry of entries) {
    const [first] = entry.name.split('/');
    if (first) roots.add(first);
  }
  return [...roots];
}

export function verifyArchive(path: string, platform: ArchivePlatform, base = root): ArchiveReport {
  const entries = readZip(readFileSync(path));
  const names = new Set(entries.map(entry => entry.name));
  const roots = topLevelDirectories(entries);
  if (roots.length !== 1) throw new Error(`Archive entries outside one root folder: ${roots.join(', ')}`);
  if (names.has('install.ps1') || [...names].some(name => name.endsWith('/install.ps1'))) {
    throw new Error('Portable archive must not contain an installer.');
  }

  if (platform === 'win32') {
    for (const entry of [
      'BlueDaFeiYu.exe',
      'resources/app/assets/tray-icon.png',
      'resources/app/dist/main.cjs',
      'resources/app/dist/preload.cjs',
      'resources/app/dist/pet.js',
      'resources/app/dist/panel.js',
      'resources/app/dist/native/petkit.exe',
    ]) {
      if (!names.has(`${roots[0]}/${entry}`)) throw new Error(`Missing archive entry: ${entry}`);
    }
    const debugSymbols = [...names].filter(name => name.toLowerCase().endsWith('.pdb'));
    if (debugSymbols.length) throw new Error(`Archive must not ship debug symbols: ${debugSymbols.join(', ')}`);
    return { path, platform, entries: entries.length };
  }

  const icons = entries.filter(entry => entry.name.endsWith('.app/Contents/Resources/app/assets/tray-icon.png'));
  if (icons.length !== 1) throw new Error(`Expected one tray icon, found ${icons.length}`);
  // The publish job checks out sources without running `npm run icons`, so only
  // compare against the source icon when it is actually present.
  const sourceIcon = resolve(base, 'assets/tray-icon.png');
  if (existsSync(sourceIcon) && !icons[0].data.equals(readFileSync(sourceIcon))) {
    throw new Error('Archived tray icon differs from the source.');
  }
  for (const entry of ['dist/main.cjs', 'dist/native/petkit']) {
    if (![...names].some(name => name.endsWith(`.app/Contents/Resources/app/${entry}`))) {
      throw new Error(`Missing macOS runtime entry: ${entry}`);
    }
  }
  return { path, platform, entries: entries.length };
}

export function platformForArchive(path: string, requested?: ArchivePlatform): ArchivePlatform {
  if (requested) return requested;
  if (path.includes('Windows')) return 'win32';
  if (path.includes('macOS')) return 'darwin';
  throw new Error(`Cannot infer the platform of ${path}; pass --platform darwin|win32`);
}

export function parseArchiveArgs(argv: string[]): { requested?: ArchivePlatform; archives: string[] } {
  const platformIndex = argv.indexOf('--platform');
  const requested = platformIndex >= 0 ? (argv[platformIndex + 1] as ArchivePlatform | undefined) : undefined;
  const archives = platformIndex >= 0
    ? argv.filter((_, index) => index !== platformIndex && index !== platformIndex + 1)
    : argv;
  return requested ? { requested, archives } : { archives };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { requested, archives } = parseArchiveArgs(process.argv.slice(2));
  if (!archives.length) {
    console.error('Usage: node scripts/verify-archives.ts [--platform darwin|win32] <archive...>');
    process.exitCode = 1;
  } else {
    for (const archive of archives) {
      const report = verifyArchive(archive, platformForArchive(archive, requested));
      console.log(`Verified ${report.path}: ${report.entries} entries (${report.platform}).`);
    }
  }
}
