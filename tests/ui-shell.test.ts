import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const panelHtml = read('src/panel.html');
const panelCss = read('src/panel.css');
const panelRenderer = read('src/renderer/panel.ts');
const mainProcess = read('src/main.ts');
const preload = read('src/preload.ts');

test('the panel draws its own caption strip instead of the OS title bar', () => {
  for (const id of ['titlebar', 'win-minimize', 'win-maximize', 'win-close', 'win-restore-icon']) {
    assert.match(panelHtml, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const label of ['最小化', '最大化', '关闭面板']) {
    assert.ok(panelHtml.includes(`aria-label="${label}"`), `missing aria-label ${label}`);
  }
  // The strip is the drag handle; the buttons must opt out of it or they
  // would drag the window instead of clicking.
  assert.match(panelCss, /#titlebar[^}]*webkit-app-region:\s*drag/);
  assert.match(panelCss, /\.window-controls[^}]*webkit-app-region:\s*no-drag/);
  // `hidden` does not hide SVG children by itself, so the two glyphs need a rule.
  assert.match(panelCss, /\.win-control svg\[hidden\]\s*\{\s*display:\s*none/);
  // macOS keeps its own traffic lights, so our buttons step aside.
  assert.match(panelCss, /\[data-platform="darwin"\]\s+\.window-controls\s*\{\s*display:\s*none/);
});

test('the window chrome is wired through main, preload and renderer', () => {
  assert.match(mainProcess, /titleBarStyle:\s*process\.platform === 'darwin' \? 'hiddenInset' : 'hidden'/);
  assert.match(mainProcess, /ipcMain\.on\('window-control'/);
  assert.match(mainProcess, /event\.sender !== panelWindow\.webContents/);
  assert.match(preload, /windowControl:\s*\(action/);
  assert.match(preload, /windowState:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('window-state'\)/);
  assert.match(panelRenderer, /api\.windowControl\('minimize'\)/);
  assert.match(panelRenderer, /api\.windowControl\('maximize'\)/);
  assert.match(panelRenderer, /api\.windowControl\('close'\)/);
  assert.match(panelRenderer, /#win-restore-icon/);
});

test('the drag loop does not poll the cursor while the pet is still', () => {
  assert.match(mainProcess, /let moveTimer: NodeJS\.Timeout \| null = null;/);
  assert.match(mainProcess, /function startMoveLoop\(\): void \{/);
  assert.match(mainProcess, /function stopMoveLoop\(\): void \{/);
  assert.doesNotMatch(mainProcess, /timers\.push\(setInterval\(moveTick, 16\)\)/);
  assert.match(mainProcess, /startMoveLoop\(\)/);
});

test('the platform attribute gates the caption strip', () => {
  assert.match(preload, /platform:\s*process\.platform/);
  assert.match(panelRenderer, /dataset\.platform = api\.platform/);
});
