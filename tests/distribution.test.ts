import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileMagpiePage } from '../scripts/lib/magpie-page.ts';

const root = new URL('../', import.meta.url);
const metadata = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('Magpie discovers a committed page rather than loading Electron in its plugin host', () => {
  assert.equal(metadata.main, undefined);
  assert.equal(metadata.exports, undefined);
  assert.deepEqual(metadata.magpie.permissions, []);
  for (const name of [metadata.magpie.page.file, metadata.magpie.page.icon]) {
    assert.ok(existsSync(fileURLToPath(new URL(name, root))));
  }
  const page = readFileSync(new URL(metadata.magpie.page.file, root), 'utf8');
  assert.ok(page.includes('_magpie/bridge.js'));
  assert.ok(page.includes('does not install, download or start the app'));
  assert.ok(page.includes('dsh-pet') && page.includes('non-commercial'));
  const script = readFileSync(new URL('magpie/page.js', root), 'utf8');
  assert.ok(script.includes('安装这个插件不会安装、下载或启动它'));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(script));
  assert.ok(page.includes('https://github.com/wolfvoid/magpie-DaFeiYu/releases/latest'));
});

test('the committed Magpie page script is generated output, not edited by hand', async () => {
  const source = readFileSync(new URL('src/magpie/page.ts', root), 'utf8');
  const expected = await compileMagpiePage(source);
  const actual = readFileSync(new URL('magpie/page.js', root), 'utf8');
  assert.equal(actual, expected, 'run `npm run build` to regenerate magpie/page.js');
  assert.match(actual.split('\n')[0], /^\/\/ Generated from src\/magpie\/page\.ts/);
});

