import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME } from '../scripts/package.ts';
import { parseArchiveArgs, platformForArchive, verifyArchive } from '../scripts/verify-archives.ts';
import { missingBuildInputs } from '../scripts/verify-build.ts';
import { writeZipFromDirectory } from '../scripts/lib/zip.ts';
import { decodePng } from '../scripts/lib/png.ts';
import { buildIcons } from '../scripts/icons.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function fixture(t: { after: (fn: () => void) => void }, prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(base: string, relative: string, contents: string | Buffer): void {
  const target = join(base, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}

const WINDOWS_ENTRIES = [
  'BlueDaFeiYu.exe',
  'resources/app/assets/tray-icon.png',
  'resources/app/dist/main.cjs',
  'resources/app/dist/preload.cjs',
  'resources/app/dist/pet.js',
  'resources/app/dist/panel.js',
  'resources/app/dist/native/petkit.exe',
];

test('Windows archives must keep the portable layout and drop installers and debug symbols', t => {
  const base = fixture(t, 'dafeiyu-archive-win-');
  const app = join(base, `${APP_NAME}-win32-x64`);
  for (const entry of WINDOWS_ENTRIES) write(app, entry, 'fixture');
  const archive = join(base, 'release.zip');
  writeZipFromDirectory(app, archive);
  assert.equal(verifyArchive(archive, 'win32', base).platform, 'win32');

  const withInstaller = join(base, 'installer.zip');
  write(app, 'install.ps1', 'Write-Host "nope"');
  writeZipFromDirectory(app, withInstaller);
  assert.throws(() => verifyArchive(withInstaller, 'win32', base), /installer/);
  rmSync(join(app, 'install.ps1'));

  const withSymbols = join(base, 'symbols.zip');
  write(app, 'resources/app/dist/native/petkit.pdb', 'symbols');
  writeZipFromDirectory(app, withSymbols);
  assert.throws(() => verifyArchive(withSymbols, 'win32', base), /debug symbols/);
});

test('missing runtime entries fail Windows archive verification', t => {
  const base = fixture(t, 'dafeiyu-archive-gap-');
  const app = join(base, `${APP_NAME}-win32-x64`);
  for (const entry of WINDOWS_ENTRIES.filter(entry => entry !== 'resources/app/dist/panel.js')) {
    write(app, entry, 'fixture');
  }
  const archive = join(base, 'release.zip');
  writeZipFromDirectory(app, archive);
  assert.throws(() => verifyArchive(archive, 'win32', base), /panel\.js/);
});

test('macOS archives carry one tray icon that matches the generated source icon', t => {
  const base = fixture(t, 'dafeiyu-archive-mac-');
  write(base, 'assets/tray-icon.png', 'tray-icon-bytes');
  const app = join(base, `${APP_NAME}.app`);
  write(app, 'Contents/Resources/app/assets/tray-icon.png', 'tray-icon-bytes');
  write(app, 'Contents/Resources/app/dist/main.cjs', 'fixture');
  write(app, 'Contents/Resources/app/dist/native/petkit', 'fixture');
  const archive = join(base, 'release.zip');
  writeZipFromDirectory(app, archive);
  assert.equal(verifyArchive(archive, 'darwin', base).platform, 'darwin');

  const drifted = join(base, `drift-${APP_NAME}.app`);
  write(drifted, 'Contents/Resources/app/assets/tray-icon.png', 'stale-icon');
  write(drifted, 'Contents/Resources/app/dist/main.cjs', 'fixture');
  write(drifted, 'Contents/Resources/app/dist/native/petkit', 'fixture');
  const driftedArchive = join(base, 'drift.zip');
  writeZipFromDirectory(drifted, driftedArchive);
  assert.throws(() => verifyArchive(driftedArchive, 'darwin', base), /differs from the source/);
});

test('the archive CLI keeps every positional archive when no platform flag is given', () => {
  const mac = 'dist/magpie-DaFeiYu-v0.1.5-macOS-arm64.zip';
  const win = 'dist/magpie-DaFeiYu-v0.1.5-Windows-x64.zip';
  assert.deepEqual(parseArchiveArgs([mac, win]), { archives: [mac, win] });
  assert.deepEqual(parseArchiveArgs(['--platform', 'darwin', mac]), { requested: 'darwin', archives: [mac] });
  assert.deepEqual(parseArchiveArgs([mac, '--platform', 'win32', win]), { requested: 'win32', archives: [mac, win] });
  assert.equal(platformForArchive(mac), 'darwin');
  assert.equal(platformForArchive(win), 'win32');
  assert.throws(() => platformForArchive('release.zip'));
});

test('build inputs are reported as missing until the build produces them', t => {
  const base = fixture(t, 'dafeiyu-build-');
  const missing = missingBuildInputs(base, 'win32');
  assert.ok(missing.includes('dist/main.cjs'));
  assert.ok(missing.includes('dist/native/petkit.exe'));
  assert.ok(!missing.includes('dist/native/petkit'));
  for (const path of missing) write(base, path, 'fixture');
  assert.deepEqual(missingBuildInputs(base, 'win32'), []);
});

test('the TypeScript icon pipeline renders a valid ico, icns and Magpie icon', t => {
  const base = fixture(t, 'dafeiyu-icons-');
  for (const master of ['app-icon.png', 'tray-icon.png']) {
    mkdirSync(join(base, 'assets', 'brand'), { recursive: true });
    copyFileSync(join(root, 'assets', 'brand', master), join(base, 'assets', 'brand', master));
  }
  const outputs = buildIcons(base).map(path => path.slice(base.length + 1).replaceAll('\\', '/'));
  assert.deepEqual(outputs, [
    'assets/app-icon.png',
    'assets/app-icon.ico',
    'assets/app-icon.icns',
    'magpie/icon.png',
    'assets/tray-icon.png',
    'assets/tray-icon@2x.png',
  ]);

  const ico = readFileSync(join(base, 'assets', 'app-icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);

  const icns = readFileSync(join(base, 'assets', 'app-icon.icns'));
  assert.equal(icns.toString('latin1', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  const magpieIcon = decodePng(readFileSync(join(base, 'magpie', 'icon.png')));
  assert.equal(magpieIcon.width, 256);
  assert.equal(magpieIcon.height, 256);
  const tray = decodePng(readFileSync(join(base, 'assets', 'tray-icon@2x.png')));
  assert.equal(tray.width, 64);
  assert.ok(existsSync(join(base, 'assets', 'app-icon.png')));
});
