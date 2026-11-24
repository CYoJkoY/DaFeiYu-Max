/**
 * Render the quota panel with synthetic data and save `qa/panel.png`. Run with
 * `electron` (compiled to `dist/tools/capture-panel-demo.cjs` by
 * `scripts/build.ts`).
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

// Compiled output lives in dist/tools/, so the repository root is two levels up.
const root = path.join(__dirname, '..', '..');
const profile = mkdtempSync(path.join(tmpdir(), 'dafeiyu-'));
app.setPath('userData', profile);
const catalog = JSON.parse(readFileSync(path.join(root, 'assets/catalog.json'), 'utf8'));
const now = Date.now();
const accountIds = ['demo-cursor', 'demo-codex', 'demo-volcengine', 'demo-deepseek'];
const snapshot = {
  catalog,
  settings: { size: 460, active: true, paused: false, locked: false, followTasks: true,
    showBulbs: true, showQuotas: true, hiddenQuotas: { 'cursor|Cursor|Team|1|window|1|Other Models': true } },
  activity: { state: 'thinking', label: 'Magpie 正在处理模型请求', available: true, activeCount: 2, observedAt: now },
  social: { enabled: false, allowWrites: false, generatedAt: null, summary: '还没有生成动态摘要。',
    bullet: '', highlights: [], platforms: [], drafts: [] },
  theme: { accent: '#2f6fe0' },
  plugins: {
    appearance: 'default',
    festival: null,
    entries: [
      { id: 'default', kind: 'appearance', label: '默认蓝', description: '内置配色。', source: 'builtin', active: true, requiresTrust: false },
      { id: 'festival-lantern', kind: 'festival', label: '灯笼节', description: '节日装扮插件示例。', source: 'external', active: false, enabled: true, requiresTrust: false },
    ],
    issues: [],
  },
  quota: { ok: true, observedAt: now, accounts: [
    { accountId: accountIds[0], provider: 'cursor', icon: 'cursor', name: 'Cursor', plan: 'Team', kind: 'subscription', label: 'Cursor · Team #1' },
    { accountId: accountIds[1], provider: 'codex', icon: 'codex-color', name: 'Codex', plan: 'Plus', kind: 'subscription', label: 'Codex · Plus #2' },
    { accountId: accountIds[2], provider: 'volcengine', icon: 'volcengine-color', name: 'Volcengine Ark', plan: 'Coding Plan', kind: 'subscription', label: 'Volcengine Ark · Coding Plan #3' },
    { accountId: accountIds[3], provider: 'deepseek', icon: 'deepseek-color', name: 'DeepSeek', plan: 'API', kind: 'balance', balance: '¥19.98', readAt: now, label: 'DeepSeek · API #4' },
  ], windows: [
    { accountId: accountIds[0], key: 'cursor|Cursor|Team|1|window|0|Cursor Models', provider: 'cursor', icon: 'cursor', name: 'Cursor', windowName: 'Cursor Models', label: 'Cursor · Team #1 · Cursor Models', remaining: 100, readAt: now, resetsAt: now / 1000 + 3600 },
    { accountId: accountIds[0], key: 'cursor|Cursor|Team|1|window|1|Other Models', provider: 'cursor', icon: 'cursor', name: 'Cursor', windowName: 'Other Models', label: 'Cursor · Team #1 · Other Models', remaining: 82, readAt: now, resetsAt: now / 1000 + 3600 },
    { accountId: accountIds[1], key: 'codex|Codex|Plus|2|window|0|7 days', provider: 'codex', icon: 'codex-color', name: 'Codex', windowName: '7 days', label: 'Codex · Plus #2 · 7 days', remaining: 24, readAt: now, resetsAt: now / 1000 + 3600 },
    { accountId: accountIds[2], key: 'volcengine|Volcengine Ark|Coding Plan|3|window|0|Month', provider: 'volcengine', icon: 'volcengine-color', name: 'Volcengine Ark', windowName: 'Month', label: 'Volcengine Ark · Coding Plan #3 · Month', remaining: 87, readAt: now, resetsAt: now / 1000 + 3600 },
  ] },
};

app.whenReady().then(async () => {
  ipcMain.handle('snapshot', () => snapshot);
  const marketStatus = {
    market: {
      repo: 'CYoJkoY/DaFeiYu-Max-Plugins',
      ref: 'main',
      lastSync: now,
      error: null,
      index: {
        schemaVersion: 1 as const,
        generatedAt: new Date(now).toISOString(),
        plugins: [{
          id: 'douyin-scroll', version: '0.1.0', kind: 'script' as const, name: '刷抖音',
          description: '通过本机桥接读取抖音推荐流，按兴趣挑一条念给桌宠听。', author: 'CYoJkoY',
          tags: ['抖音', '推荐流', '桥接'], permissions: ['pet', 'bridge'], harness: 'zig-wasm32-freestanding/abi1',
          size: 70798, sha256: '0'.repeat(64), manifest: 'plugins/douyin-scroll/plugin.json',
          wasm: 'plugins/douyin-scroll/plugin.wasm', source: 'plugins/douyin-scroll/src/main.zig',
        }],
      },
      installed: {
        'douyin-scroll': { version: '0.1.0', sha256: '0'.repeat(64), installedAt: now },
      },
    },
    installed: [{
      id: 'douyin-scroll',
      name: '刷抖音',
      version: '0.1.0',
      description: '通过本机桥接读取抖音推荐流，按兴趣挑一条念给桌宠听。',
      permissions: ['pet', 'bridge'],
      settings: [
        { id: 'bridgeUrl', type: 'url' as const, label: '抖音桥接地址', placeholder: 'http://127.0.0.1:8787' },
        { id: 'intervalSeconds', type: 'number' as const, label: '刷新间隔（秒）', default: 20, min: 5, max: 300 },
        { id: 'interestBoost', type: 'boolean' as const, label: '优先推送兴趣关键词', default: true },
      ],
      enabled: true,
      options: { bridgeUrl: 'http://127.0.0.1:8787', intervalSeconds: 20, interestBoost: true },
      origin: 'market' as const,
      marketVersion: '0.1.0',
      updateAvailable: false,
      status: {
        id: 'douyin-scroll', running: true, message: '刷到：Zig 写插件真香 @某鱼', progress: null,
        counter: 3, lastRunAt: now, lastError: null, invocations: 6, commands: ['reset', 'stats', 'next'],
      },
    }],
    issues: [],
  };
  ipcMain.handle('plugins-runtime-status', () => marketStatus);
  const window = new BrowserWindow({ width: 460, height: 760, show: false,
    webPreferences: { preload: path.join(root, 'dist/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on('console-message', (_event, level, message) => {
    console.log(`[panel:${level}] ${message}`);
  });
  await window.loadFile(path.join(root, 'dist/panel.html'));
  await new Promise(resolve => setTimeout(resolve, 500));
  const seen = await window.webContents.executeJavaScript(`({
    market: document.querySelector('#market-state')?.textContent,
    rows: document.querySelectorAll('#market-list .plugin-row').length,
    scripts: document.querySelectorAll('#script-list .plugin-row').length,
    scriptState: document.querySelector('#script-list')?.textContent?.trim().slice(0, 60),
    issues: document.querySelector('#plugin-issues')?.textContent,
  })`);
  console.log('panel state:', JSON.stringify(seen));
  const output = path.join(root, 'qa');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'panel.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(
    'document.querySelector("#market-state")?.scrollIntoView({ block: "start" })');
  await new Promise(resolve => setTimeout(resolve, 300));
  writeFileSync(path.join(output, 'panel-market.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(
    'document.querySelector("#script-list")?.scrollIntoView({ block: "start" })');
  await new Promise(resolve => setTimeout(resolve, 300));
  writeFileSync(path.join(output, 'panel-scripts.png'), (await window.webContents.capturePage()).toPNG());
  console.log('Saved qa/panel.png, qa/panel-market.png and qa/panel-scripts.png using synthetic data.');
  app.quit();
}).catch((error: unknown) => { console.error(error); app.exit(1); });

app.on('will-quit', () => rmSync(profile, { recursive: true, force: true }));
