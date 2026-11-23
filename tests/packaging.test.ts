import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, iconPathFor, isDebugSymbol, isVendorPath, resolveTarget } from '../scripts/package.ts';
import { crc32, readZip, writeZipFromDirectory } from '../scripts/lib/zip.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('packaging selects native targets and icons without changing Mac defaults', () => {
  assert.deepEqual(resolveTarget({ platform: 'darwin' }), { platform: 'darwin', arch: 'arm64' });
  assert.deepEqual(resolveTarget({ platform: 'win32' }), { platform: 'win32', arch: 'x64' });
  assert.equal(iconPathFor('darwin'), join(root, 'assets', 'app-icon.icns'));
  assert.equal(iconPathFor('win32'), join(root, 'assets', 'app-icon.ico'));
  assert.throws(() => resolveTarget({ platform: 'linux' }));
  assert.throws(() => resolveTarget({ platform: 'win32', arch: 'arm64' }));
  assert.throws(() => resolveTarget({ platform: 'darwin', arch: 'x64' }));
});

test('development sources are excluded with either path separator', () => {
  for (const source of ['src/vendor', 'src\\vendor', 'vendor']) assert.equal(isVendorPath(source), true);
  for (const source of ['src/renderer/pet.ts', 'src\\main.ts']) assert.equal(isVendorPath(source), false);
});

test('debug symbols are excluded from release bundles', () => {
  for (const source of ['dist/native/petkit.pdb', 'native\\PETKIT.PDB']) assert.equal(isDebugSymbol(source), true);
  for (const source of ['dist/native/petkit.exe', 'dist/main.cjs']) assert.equal(isDebugSymbol(source), false);
});

test('Windows ZIP preserves Unicode names and binary contents and ships no installer', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'dafeiyu-zip-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const app = join(fixture, `${APP_NAME}-win32-x64`);
  const archive = join(fixture, 'release.zip');
  mkdirSync(join(app, 'resources'), { recursive: true });
  writeFileSync(join(app, 'BlueDaFeiYu.exe'), Buffer.from([0, 1, 128, 255]));
  writeFileSync(join(app, 'resources', '\u52a8\u753b.webm'), 'fixture');
  mkdirSync(join(app, 'resources', 'app', 'assets'), { recursive: true });
  writeFileSync(join(app, 'resources', 'app', 'assets', 'tray-icon.png'), 'icon');
  const entryNames = writeZipFromDirectory(app, archive);
  const entries = readZip(readFileSync(archive));
  const exe = entries.find(entry => entry.name === `${APP_NAME}-win32-x64/BlueDaFeiYu.exe`);
  assert.ok(exe, 'BlueDaFeiYu.exe must be present in the archive');
  assert.deepEqual([...exe.data], [0, 1, 128, 255]);
  assert.equal(crc32(exe.data), crc32(Buffer.from([0, 1, 128, 255])));
  assert.deepEqual(entryNames.sort(), [
    `${APP_NAME}-win32-x64/BlueDaFeiYu.exe`,
    `${APP_NAME}-win32-x64/resources/app/assets/tray-icon.png`,
    `${APP_NAME}-win32-x64/resources/\u52a8\u753b.webm`,
  ].sort());
  assert.ok(!entryNames.includes('install.ps1'));
  for (const name of entryNames) {
    assert.ok(name.startsWith(`${APP_NAME}-win32-x64/`), `Unrooted archive entry: ${name}`);
  }
});

test('the installer script is gone and packaging uses the shared TypeScript ZIP writer', () => {
  assert.equal(existsSync(join(root, 'scripts/windows/install.ps1')), false);
  const zipSource = readFileSync(join(root, 'scripts/lib/zip.ts'), 'utf8');
  assert.ok(zipSource.includes('writeZipFromDirectory'));
  assert.ok(!/install\.ps1/i.test(zipSource));
});
