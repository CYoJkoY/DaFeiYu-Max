import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { APP_NAME, iconPathFor, isVendorPath, resolveTarget } from '../scripts/package.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = process.platform === 'win32' ? 'python' : 'python3';

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
  execFileSync(python, [join(root, 'scripts/windows/archive.py'), app, archive]);
  const inspection = JSON.parse(execFileSync(python, ['-c',
    'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"names":z.namelist(),"invalid":z.testzip(),"exe":list(z.read(sys.argv[2]))}))',
    archive, `${APP_NAME}-win32-x64/BlueDaFeiYu.exe`], { encoding: 'utf8' }));
  assert.equal(inspection.invalid, null);
  assert.deepEqual(inspection.exe, [0, 1, 128, 255]);
  assert.deepEqual(inspection.names.sort(), [
    `${APP_NAME}-win32-x64/BlueDaFeiYu.exe`,
    `${APP_NAME}-win32-x64/resources/app/assets/tray-icon.png`,
    `${APP_NAME}-win32-x64/resources/\u52a8\u753b.webm`,
  ].sort());
  assert.ok(!inspection.names.includes('install.ps1'));
  for (const name of inspection.names) {
    assert.ok(name.startsWith(`${APP_NAME}-win32-x64/`), `Unrooted archive entry: ${name}`);
  }
});

test('the installer script is gone and packaging archives only the app directory', () => {
  assert.equal(existsSync(join(root, 'scripts/windows/install.ps1')), false);
  const archiveScript = readFileSync(join(root, 'scripts/windows/archive.py'), 'utf8');
  assert.ok(!/install\.ps1/i.test(archiveScript));
});
