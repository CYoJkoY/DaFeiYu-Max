import {
  app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, screen, shell,
  type Display, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions,
} from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clampPetPosition } from './core/position.ts';
import { mergeCachedQuota } from './core/magpie-cache.ts';
import { magpieAppCandidates } from './core/platform.ts';
import { ActivityReader, readQuota } from './core/magpie.ts';
import { PET_SIZES, normalizeSettings, sanitizeHiddenQuotas, sanitizeInterests, type PetSize } from './core/settings.ts';
import { NativeCore, tsActivityState } from './core/native.ts';
import { PLATFORM_IDS } from './social/registry.ts';
import { CredentialVault } from './social/vault.ts';
import { SocialEngine } from './social/engine.ts';
import { PluginRegistry } from './plugins/registry.ts';
import { resolvePlugins } from './plugins/host.ts';
import type {
  Activity, Catalog, PetSettings, PluginSnapshot, Point, Quota, SocialReport, Theme,
} from './core/types.ts';

const smoke = process.argv.includes('--smoke-test');
app.setName('蓝色大肥鱼');
app.setPath('userData', smoke ? mkdtempSync(join(app.getPath('temp'), 'dafeiyu-smoke-')) :
  join(app.getPath('appData'), 'BlueDaFeiYu-Codex'));
if (process.platform === 'win32') app.setAppUserModelId('local.blue-dafeiyu.codex');

const appIcon = join(__dirname, '../assets/tray-icon.png');
const qaDirectory = process.env.DAFEIYU_QA_DIR || join(app.getPath('userData'), 'qa');
const baseCatalog = JSON.parse(readFileSync(join(__dirname, '../assets/catalog.json'), 'utf8')) as Catalog;
let catalog: Catalog = baseCatalog;

let settings: PetSettings = normalizeSettings(null, PLATFORM_IDS);
let petWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let reader: ActivityReader | null = null;
let native: NativeCore | null = null;
let vault: CredentialVault | null = null;
let social: SocialEngine | null = null;
let registry: PluginRegistry | null = null;
let theme: Theme = {};
let pluginView: PluginSnapshot = { appearance: null, festival: null, entries: [], issues: [] };

let quota: Quota = { ok: false, windows: [], error: '正在连接 Magpie…', observedAt: null };
let cachedQuota: Quota | null = null;
let activity: Activity = { state: 'unknown', label: '正在读取任务状态', available: false, activeCount: 0 };
let quotaQuery: Promise<Quota> | null = null;
let lastQuotaAttempt = 0;
let dragState: { offset: Point; last: Point; lastTime: number; lastMoved: number; velocity: Point } | null = null;
let momentum: { x: number; y: number; velocityX: number; velocityY: number; started: number; display: Display } | null = null;
let lastInteractive = false;
let contentHeight: number | null = null;
const timers: NodeJS.Timeout[] = [];

const BOOLEAN_KEYS = ['active', 'paused', 'locked', 'followTasks', 'showBulbs', 'showQuotas'] as const;
type BooleanSettingKey = (typeof BOOLEAN_KEYS)[number];

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json');

const send = (channel: string, payload: unknown): void => {
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

const emptySocial = (): SocialReport => ({
  enabled: false, allowWrites: false, generatedAt: null,
  summary: '社交模块尚未初始化。', bullet: '社交：未启用', highlights: [], platforms: [], drafts: [],
});

const snapshot = () => ({
  catalog, settings, activity, quota,
  social: social?.status() ?? emptySocial(),
  plugins: pluginView,
  theme,
});

/**
 * Recompute the merged catalog, palette and plug-in view from persisted
 * settings, then push the result to both renderer windows. External manifests
 * are only ever read as data here — never executed.
 */
function applyPlugins(notify = false): void {
  if (!registry) return;
  const resolved = resolvePlugins(baseCatalog, registry, settings, Date.now());
  catalog = resolved.catalog;
  theme = resolved.theme;
  pluginView = resolved.view;
  // A stale selection (removed or rejected plug-in) was cleared while
  // resolving; persist it so the invalid id does not come back next launch.
  if (resolved.settingsChanged) saveSettings();
  if (notify) {
    send('catalog', { catalog, theme, plugins: pluginView });
    updateTray();
  }
}

function saveSettings(): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  const temporary = settingsPath() + '.tmp';
  writeFileSync(temporary, JSON.stringify(settings, null, 2));
  renameSync(temporary, settingsPath());
}

function windowSize(): { width: number; height: number } {
  const base = Math.round(settings.size * 9 / 16) + 112;
  return {
    width: settings.size,
    height: Number.isInteger(contentHeight)
      ? Math.min(Math.max(contentHeight as number, base - 40), base + 200)
      : base,
  };
}

function clampPosition(position: Point, display?: Display): Point {
  const dimensions = windowSize();
  const target = display ?? screen.getDisplayNearestPoint({
    x: Math.round(position.x + dimensions.width / 2),
    y: Math.round(position.y + dimensions.height / 2),
  });
  return clampPetPosition(position, target.workArea, dimensions);
}

function persistPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [x, y] = petWindow.getPosition();
  settings.x = x;
  settings.y = y;
  saveSettings();
}

function recenter(): void {
  momentum = null;
  dragState = null;
  if (!petWindow) return;
  const area = screen.getPrimaryDisplay().workArea;
  const dimensions = windowSize();
  petWindow.setPosition(
    Math.round(area.x + (area.width - dimensions.width) / 2),
    Math.round(area.y + (area.height - dimensions.height) / 2),
  );
  persistPosition();
  showPet();
}

function guardWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function showPet(): void {
  petWindow?.showInactive();
  app.dock?.hide();
  send('settings', settings);
  updateTray();
}

function showPanel(): void {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return;
  }
  panelWindow = new BrowserWindow({
    width: 460, height: 680, minWidth: 400, minHeight: 540,
    title: '蓝色大肥鱼 · 陪伴面板', backgroundColor: '#f5f8ff', show: false, icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  guardWindow(panelWindow);
  void panelWindow.loadFile(join(__dirname, 'panel.html'));
  panelWindow.once('ready-to-show', () => panelWindow?.show());
  panelWindow.on('closed', () => { panelWindow = null; });
}

function play(name: string): void {
  if (!catalog.names.includes(name)) return;
  showPet();
  petWindow?.webContents.send('play', name);
}

function changeSetting(key: string, value: unknown): void {
  let pluginsChanged = false;
  if ((BOOLEAN_KEYS as readonly string[]).includes(key) && typeof value === 'boolean') {
    settings[key as BooleanSettingKey] = value;
  } else if (key === 'size' && PET_SIZES.includes(value as PetSize)) {
    settings.size = value as PetSize;
  } else if (key === 'hiddenQuotas' && value && typeof value === 'object' && !Array.isArray(value)) {
    settings.hiddenQuotas = sanitizeHiddenQuotas(value);
  } else if (key === 'interests') {
    settings.interests = sanitizeInterests(value);
  } else if (key === 'appearance') {
    const id = typeof value === 'string' ? value.trim() : '';
    if (value !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return;
    // Only accept an appearance that is actually loaded; an unknown id would
    // otherwise persist and silently fall back on the next launch.
    if (id && !registry?.hasAppearance(id)) return;
    settings.plugins.appearance = id ? id : null;
    pluginsChanged = true;
  } else if (key === 'pluginEnabled' && value && typeof value === 'object' && !Array.isArray(value)) {
    const { id, enabled } = value as { id?: unknown; enabled?: unknown };
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || typeof enabled !== 'boolean') return;
    // Toggles only apply to a loaded seasonal plug-in.
    if (!registry?.hasFestival(id)) return;
    settings.plugins.enabled[id] = enabled;
    pluginsChanged = true;
  } else {
    return;
  }
  momentum = null;
  dragState = null;
  if (petWindow) {
    const position = clampPosition({ x: petWindow.getBounds().x, y: petWindow.getBounds().y });
    petWindow.setBounds({ ...position, ...windowSize() });
  }
  saveSettings();
  if (pluginsChanged) applyPlugins(true);
  send('settings', settings);
  updateTray();
}

function menuItems(): MenuItemConstructorOptions[] {
  return [
    { label: '蓝色大肥鱼 · Magpie 伴侣', enabled: false },
    { label: activity.label, enabled: false },
    { type: 'separator' },
    {
      label: '点播全部动作',
      submenu: catalog.categories.map(category => ({
        label: category.id,
        submenu: category.actions.map(name => ({ label: name, click: () => play(name) })),
      })),
    },
    { type: 'separator' },
    { label: '额度与设置…', click: showPanel },
    { label: '打开 Magpie', click: () => void openMagpie() },
    { label: '跟随 Magpie 请求', type: 'checkbox', checked: settings.followTasks, click: item => changeSetting('followTasks', item.checked) },
    { label: '显示请求灯泡', type: 'checkbox', checked: settings.showBulbs, click: item => changeSetting('showBulbs', item.checked) },
    { label: '显示账号额度', type: 'checkbox', checked: settings.showQuotas, click: item => changeSetting('showQuotas', item.checked) },
    { label: '随机玩耍', type: 'checkbox', checked: settings.active, click: item => changeSetting('active', item.checked) },
    { label: '暂停动画', type: 'checkbox', checked: settings.paused, click: item => changeSetting('paused', item.checked) },
    { label: '锁定位置', type: 'checkbox', checked: settings.locked, click: item => changeSetting('locked', item.checked) },
    { label: '回到屏幕内', click: recenter },
    {
      label: '大小',
      submenu: ([[360, '小'], [460, '中'], [560, '大']] as const).map(([size, label]) => ({
        label, type: 'radio' as const, checked: settings.size === size, click: () => changeSetting('size', size),
      })),
    },
    {
      label: petWindow?.isVisible() ? '隐藏桌宠' : '显示桌宠',
      click: () => {
        if (petWindow?.isVisible()) {
          petWindow.hide();
          app.dock?.show();
          petWindow.webContents.send('settings', { ...settings, paused: true });
        } else {
          showPet();
        }
        updateTray();
      },
    },
    { type: 'separator' },
    { label: '退出蓝色大肥鱼', click: () => app.quit() },
  ];
}

function updateTray(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(menuItems()));
}

async function openMagpie(): Promise<void> {
  const target = magpieAppCandidates().find(existsSync);
  const error = target ? await shell.openPath(target) : '未在默认安装目录找到 Magpie，请从开始菜单或应用程序手动打开。';
  if (error) {
    await dialog.showMessageBox({
      type: 'info', title: '打开 Magpie', message: '请手动启动 Magpie', detail: error,
    });
  }
}

function refreshQuota(force = false): Promise<Quota> {
  if (quotaQuery) return quotaQuery;
  if (!force && Date.now() - lastQuotaAttempt < 30000) return Promise.resolve(quota);
  lastQuotaAttempt = Date.now();
  quotaQuery = readQuota().then(async result => {
    let next = result.ok ? result : mergeCachedQuota(cachedQuota, result);
    // Ask the Zig core whether the cached reading is still inside its TTL; when
    // the sidecar is absent the TypeScript fallback answers the same question.
    if (next.cachedAt && native?.active) {
      const fresh = await native.fresh(next.cachedAt, Date.now(), 240000);
      if (!fresh && !next.ok) next = { ...next, error: next.error || '缓存已过期' };
    }
    quota = next;
    if (next.ok) cachedQuota = next;
    send('quota', next);
    return next;
  }).finally(() => { quotaQuery = null; });
  return quotaQuery;
}

function moveTick(): void {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
  const cursor = screen.getCursorScreenPoint();
  if (dragState) {
    const now = Date.now();
    const elapsed = Math.max(1, now - dragState.lastTime);
    dragState.velocity = {
      x: (cursor.x - dragState.last.x) * 1000 / elapsed,
      y: (cursor.y - dragState.last.y) * 1000 / elapsed,
    };
    if (cursor.x !== dragState.last.x || cursor.y !== dragState.last.y) dragState.lastMoved = now;
    dragState.last = cursor;
    dragState.lastTime = now;
    const position = clampPosition(
      { x: cursor.x - dragState.offset.x, y: cursor.y - dragState.offset.y },
      screen.getDisplayNearestPoint(cursor),
    );
    petWindow.setPosition(position.x, position.y);
  } else if (momentum) {
    momentum.velocityY += 1400 * 0.016;
    momentum.x += momentum.velocityX * 0.016;
    momentum.y += momentum.velocityY * 0.016;
    const position = clampPosition(momentum, momentum.display);
    if (position.x !== Math.round(momentum.x)) momentum.velocityX *= -0.65;
    if (position.y !== Math.round(momentum.y)) {
      momentum.velocityY *= -0.55;
      momentum.velocityX *= 0.82;
    }
    momentum.x = position.x;
    momentum.y = position.y;
    petWindow.setPosition(position.x, position.y);
    if (Date.now() - momentum.started > 4500 ||
      (Math.abs(momentum.velocityY) < 24 && Math.abs(momentum.velocityX) < 15)) {
      momentum = null;
      persistPosition();
    }
  }
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return [petWindow, panelWindow].some(window =>
    Boolean(window) && !window!.isDestroyed() && event.sender === window!.webContents);
}

function setSocialEnabled(enabled: boolean): SocialReport {
  const report = social?.setEnabled(enabled) ?? emptySocial();
  saveSettings();
  send('settings', settings);
  send('social', report);
  return report;
}

function setSocialWrites(allowWrites: boolean): SocialReport {
  const report = social?.setAllowWrites(allowWrites) ?? emptySocial();
  saveSettings();
  send('settings', settings);
  send('social', report);
  return report;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (petWindow) showPet(); });
  app.on('activate', () => {
    if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) showPet();
  });
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();
    if (process.platform === 'win32') Menu.setApplicationMenu(null);

    try {
      settings = normalizeSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')), PLATFORM_IDS);
    } catch {}
    if (!smoke) saveSettings();

    registry = new PluginRegistry();
    registry.loadDirectory(join(app.getPath('userData'), 'plugins'));
    applyPlugins();
    for (const issue of pluginView.issues) console.log(`[plugins] ${issue}`);

    vault = new CredentialVault(app.getPath('userData'));
    social = new SocialEngine({
      directory: app.getPath('userData'),
      vault,
      getSettings: () => settings,
      patchSocial: mutate => {
        mutate(settings.social);
        saveSettings();
      },
      logger: message => console.log(`[social] ${message}`),
    });
    social.schedule();

    // IPC handlers must exist before any renderer loads: the pet and panel
    // windows call getSnapshot() on their first tick.
    ipcMain.handle('snapshot', event => trusted(event) ? snapshot() : null);
    ipcMain.handle('quota-refresh', event => trusted(event) ? refreshQuota() : null);
    ipcMain.on('panel', event => { if (trusted(event)) showPanel(); });
    ipcMain.on('menu', event => {
      if (trusted(event)) Menu.buildFromTemplate(menuItems()).popup({ window: petWindow ?? undefined });
    });
    ipcMain.on('play', (event, name) => { if (trusted(event) && typeof name === 'string') play(name); });
    ipcMain.on('setting', (event, key, value) => { if (trusted(event)) changeSetting(key, value); });
    ipcMain.on('open-magpie', event => { if (trusted(event)) void openMagpie(); });
    ipcMain.on('open-repository', event => {
      if (trusted(event)) void shell.openExternal('https://github.com/CYoJkoY/DaFeiYu-Max');
    });
    ipcMain.on('resize', (event, height) => {
      if (!petWindow || event.sender !== petWindow.webContents || !Number.isFinite(height) || dragState) return;
      const next = Math.round(height as number);
      if (next === contentHeight) return;
      contentHeight = next;
      const bounds = petWindow.getBounds();
      petWindow.setBounds({ ...clampPosition({ x: bounds.x, y: bounds.y }), ...windowSize() });
    });
    ipcMain.on('interactive', (event, value) => {
      if (!petWindow || event.sender !== petWindow.webContents || typeof value !== 'boolean' || dragState) return;
      if (value === lastInteractive) return;
      lastInteractive = value;
      petWindow.setIgnoreMouseEvents(!value, { forward: true });
    });
    ipcMain.on('drag', (event, phase) => {
      if (!petWindow || event.sender !== petWindow.webContents || settings.locked) return;
      if (phase === 'start') {
        const cursor = screen.getCursorScreenPoint();
        const bounds = petWindow.getBounds();
        momentum = null;
        dragState = {
          offset: { x: cursor.x - bounds.x, y: cursor.y - bounds.y },
          last: cursor, lastTime: Date.now(), lastMoved: Date.now(), velocity: { x: 0, y: 0 },
        };
        petWindow.setIgnoreMouseEvents(false);
      } else if (phase === 'end' && dragState) {
        const velocity = dragState.velocity;
        const bounds = petWindow.getBounds();
        if (Date.now() - dragState.lastMoved < 120 && Math.hypot(velocity.x, velocity.y) > 200) {
          momentum = {
            x: bounds.x, y: bounds.y,
            velocityX: Math.max(-2000, Math.min(2000, velocity.x)),
            velocityY: Math.max(-2000, Math.min(2000, velocity.y)),
            started: Date.now(), display: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
          };
        }
        dragState = null;
        petWindow.setIgnoreMouseEvents(!lastInteractive, { forward: true });
        persistPosition();
      }
    });

    ipcMain.handle('social-status', event => trusted(event) ? social?.status() ?? emptySocial() : null);
    ipcMain.handle('social-refresh', async event => {
      if (!trusted(event) || !social) return null;
      const report = await social.refresh(true);
      send('social', report);
      return report;
    });
    ipcMain.handle('social-toggle', (event, key, value) => {
      if (!trusted(event) || typeof value !== 'boolean') return null;
      if (key === 'enabled') return setSocialEnabled(value);
      if (key === 'allowWrites') return setSocialWrites(value);
      return null;
    });
    ipcMain.handle('social-configure', (event, platform, patch) => {
      if (!trusted(event) || !social || typeof platform !== 'string' || !PLATFORM_IDS.includes(platform)) return null;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
      const report = social.configurePlatform(platform, patch as Record<string, unknown>);
      saveSettings();
      send('settings', settings);
      send('social', report);
      return report;
    });
    ipcMain.handle('social-approve', async (event, id) => {
      if (!trusted(event) || !social || typeof id !== 'string') return null;
      const result = await social.approve(id);
      send('social', result.report);
      return result;
    });
    ipcMain.handle('social-reject', (event, id) => {
      if (!trusted(event) || !social || typeof id !== 'string') return null;
      const report = social.reject(id);
      send('social', report);
      return report;
    });

    const area = screen.getPrimaryDisplay().workArea;
    const position = clampPosition({
      x: settings.x ?? area.x + area.width - settings.size - 20,
      y: settings.y ?? area.y + area.height - windowSize().height - 12,
    });
    petWindow = new BrowserWindow({
      ...windowSize(), ...position, title: '蓝色大肥鱼', frame: false, transparent: true,
      resizable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, acceptFirstMouse: true,
      show: false, backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, backgroundThrottling: true,
      },
    });
    guardWindow(petWindow);
    petWindow.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    petWindow.setIgnoreMouseEvents(true, { forward: true });
    void petWindow.loadFile(join(__dirname, 'pet.html'));
    petWindow.once('ready-to-show', showPet);
    petWindow.on('closed', () => app.quit());

    tray = new Tray(process.platform === 'darwin' ? nativeImage.createEmpty() :
      nativeImage.createFromPath(appIcon).resize({ width: 32, height: 32 }));
    if (process.platform === 'darwin') tray.setTitle('🐋');
    else tray.on('click', showPanel);
    tray.setToolTip('蓝色大肥鱼 · Magpie 伴侣');
    updateTray();

    // The Zig sidecar classifies activity when present; otherwise the shared
    // TypeScript precedence answers the same question.
    reader = new ActivityReader();
    reader.classifier = (requests, waiting, tools) => native?.active
      ? native.activityState(requests, waiting, tools)
      : tsActivityState(requests, waiting, tools);
    native = await NativeCore.connect(__dirname);
    if (native) console.log(`[native] Zig core ready: ${native.binary}`);
    else console.log('[native] Zig core not found; using TypeScript fallbacks');

    let activityPending = false;
    const updateActivity = async (): Promise<void> => {
      if (activityPending || !reader) return;
      activityPending = true;
      try {
        activity = await reader.read();
        send('activity', activity);
        updateTray();
      } finally {
        activityPending = false;
      }
    };
    void updateActivity();
    timers.push(setInterval(() => { void updateActivity(); }, 2000));
    timers.push(setInterval(() => { void refreshQuota(); }, 30000));
    timers.push(setInterval(moveTick, 16));
    timers.push(setInterval(() => {
      if (!petWindow || !petWindow.isVisible()) return;
      const cursor = screen.getCursorScreenPoint();
      const bounds = petWindow.getBounds();
      petWindow.webContents.send('cursor', { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
    }, 100));
    void refreshQuota(true);
    if (settings.social.enabled) void social.refresh(true).then(report => send('social', report));
    screen.on('display-removed', recenter);

    if (smoke) runSmoke(updateActivity);
  }).catch(error => {
    console.error(error);
    app.exit(1);
  });
}

function runSmoke(updateActivity: () => Promise<void>): void {
  setTimeout(() => play('放烟花'), 3500);
  setTimeout(() => play('凭空生花'), 15000);
  setTimeout(showPanel, 23000);
  setTimeout(async () => {
    if (!petWindow) return;
    const window = petWindow;
    const controls = await window.webContents.executeJavaScript(`(async () => {
      const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
      const currentVideo = () => [...document.querySelectorAll('video')].find(video => video.style.opacity === '1');
      await delay(100);
      const before = window.petDiagnostics.played.at(-1);
      document.querySelector('#next-action').click();
      await delay(800);
      const switched = window.petDiagnostics.played.at(-1) !== before;
      document.querySelector('#pause').click();
      await delay(100);
      const frozenAt = currentVideo().currentTime;
      await delay(250);
      const paused = currentVideo().paused && currentVideo().currentTime === frozenAt;
      const pauseIcon = document.querySelector('#pause').getAttribute('aria-pressed') === 'true' && !document.querySelector('#play-icon').hasAttribute('hidden');
      document.querySelector('#next-action').click();
      await delay(800);
      const switchedWhilePaused = currentVideo().paused;
      document.querySelector('#pause').click();
      await delay(100);
      const resumedAt = currentVideo().currentTime;
      await delay(250);
      return { switched, paused, pauseIcon, switchedWhilePaused, resumed: !currentVideo().paused && currentVideo().currentTime > resumedAt,
        buttons: [...document.querySelectorAll('nav button')].map(button => button.id), noTopBubble: !document.querySelector('#bubble') };
    })()`);
    const bulbs: { requests: number; lit: number }[] = [];
    for (const count of [0, 1, 3, 7]) {
      window.webContents.send('activity', { ...activity, available: true, activeCount: count });
      await new Promise(resolve => setTimeout(resolve, 100));
      bulbs.push({ requests: count, lit: await window.webContents.executeJavaScript('document.querySelectorAll(".bulb.lit").length') });
    }
    const accountBadges: unknown[] = [];
    for (const count of [0, 1, quota.accounts?.length || 0]) {
      window.webContents.send('activity', {
        ...activity, available: true, observedAt: Date.now(), activeCount: count,
        activeAccountIds: (quota.accounts || []).slice(0, count).map(account => account.accountId),
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      accountBadges.push({
        expectedActive: count,
        badges: await window.webContents.executeJavaScript(
          '[...document.querySelectorAll(".account-quota")].map(badge => ({ text: badge.textContent, active: badge.classList.contains("active"), color: getComputedStyle(badge).color }))'),
      });
      if (count === 1) {
        mkdirSync(qaDirectory, { recursive: true });
        writeFileSync(join(qaDirectory, 'account-colors.png'), (await window.webContents.capturePage()).toPNG());
      }
    }
    const accountLayout = await window.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('#account-quotas');
      const sample = row.firstElementChild;
      if (!sample) return { available: false };
      while (row.children.length < 12) row.append(sample.cloneNode(true));
      const boxes = [...row.children].map(badge => badge.getBoundingClientRect());
      const aboveButtons = row.getBoundingClientRect().bottom < document.querySelector('nav').getBoundingClientRect().top;
      row.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
      return { available: true, sameRow: boxes.every(box => box.top === boxes[0].top), aboveButtons,
        scrollable: row.scrollWidth > row.clientWidth, wheelScrolls: row.scrollLeft > 0, count: boxes.length };
    })()`);
    window.webContents.send('quota', quota);
    window.webContents.send('activity', activity);
    const report = await window.webContents.executeJavaScript('window.petDiagnostics');
    const originalBounds = window.getBounds();
    const workArea = screen.getPrimaryDisplay().workArea;
    const requested = clampPosition({ x: workArea.x + workArea.width, y: originalBounds.y }, screen.getPrimaryDisplay());
    window.setPosition(requested.x, requested.y);
    await new Promise(resolve => setTimeout(resolve, 300));
    const edge = { requested, actual: window.getBounds(), workArea };
    window.setBounds(originalBounds);
    const ui = await window.webContents.executeJavaScript('({ filter: getComputedStyle(document.querySelector("video")).filter, status: document.querySelector("#request-lights").getAttribute("aria-label") })');
    mkdirSync(qaDirectory, { recursive: true });
    writeFileSync(join(qaDirectory, 'smoke.json'), JSON.stringify({
      report, activity, quota, edge, ui, controls, bulbs, accountBadges, accountLayout,
      social: social?.status() ?? null, native: native?.active ?? false,
    }, null, 2));
    const image = await window.webContents.capturePage();
    writeFileSync(join(qaDirectory, 'pet.png'), image.toPNG());
    if (panelWindow) {
      await panelWindow.webContents.executeJavaScript('window.scrollTo(0, 0)');
      await new Promise(resolve => setTimeout(resolve, 100));
      writeFileSync(join(qaDirectory, 'panel.png'), (await panelWindow.webContents.capturePage()).toPNG());
    }
    app.quit();
  }, 27000);
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  for (const timer of timers) clearInterval(timer);
  social?.stop();
  native?.close();
});
