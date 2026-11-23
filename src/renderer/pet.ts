/**
 * The transparent pet window: plays catalogue clips, renders request bulbs and
 * quota badges, and forwards drag/interaction intents to the main process.
 */
import { AnimationDirector } from '../core/animation.ts';
import { quotaEntries } from '../core/quota-display.ts';
import { providerIconSource, providerInitial } from '../core/provider-icons.ts';
import type { Activity, CatalogUpdate, PetSettings, PluginSnapshot, Quota, Theme } from '../core/types.ts';

const api = window.pet;
const videos = [...document.querySelectorAll('video')];
const lights = document.querySelector<HTMLElement>('#request-lights')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const festivalBanner = document.querySelector<HTMLElement>('#festival-banner')!;
const hitCanvas = document.createElement('canvas');
hitCanvas.width = 256;
hitCanvas.height = 144;
const hitContext = hitCanvas.getContext('2d', { willReadFrequently: true })!;

let visible = 0;
let generation = 0;
let director: AnimationDirector;
let settings!: PetSettings;
let activity!: Activity;
let quota!: Quota;
let pointerStart: { x: number; y: number } | null = null;
let dragging = false;
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let lastInteractive: boolean | undefined;
let failureCount = 0;

window.petDiagnostics = { loaded: false, errors: [], played: [], transparent: false };

function renderPlugins(value: PluginSnapshot, theme: Theme): void {
  document.documentElement.style.setProperty('--accent', theme.accent || '#2f6fe0');
  const festival = value.festival;
  if (!festival) {
    festivalBanner.hidden = true;
    festivalBanner.replaceChildren();
    stage.removeAttribute('title');
    document.title = '蓝色大肥鱼';
    return;
  }
  festivalBanner.replaceChildren();
  const accessories = document.createElement('span');
  accessories.className = 'festival-accessories';
  accessories.textContent = festival.accessories.join(' ');
  const label = document.createElement('span');
  label.textContent = festival.greeting || `${festival.label}装扮`;
  festivalBanner.append(accessories, label);
  festivalBanner.hidden = false;
  festivalBanner.title = `${festival.label} · ${festival.greeting || '节日装扮'}`;
  stage.title = festival.greeting || festival.label;
  document.title = `${festival.label} · 蓝色大肥鱼`;
}

function describe(): void {
  lights.dataset.visible = String(settings?.showBulbs !== false);
  renderQuota();
  const requests = activity.available && Number.isInteger(activity.activeCount)
    ? Math.max(0, activity.activeCount) : 0;
  const description = activity.available
    ? requests ? `Magpie：${requests} 个进行中的请求（含排队）` : activity.label
    : 'Magpie 未连接，状态未知';
  lights.title = description;
  lights.setAttribute('aria-label', description);
  lights.classList.toggle('unavailable', !activity.available);
  if (lights.dataset.count !== String(requests)) {
    lights.replaceChildren();
    for (let index = 0; index < Math.min(8, Math.max(1, requests)); index++) {
      const template = document.querySelector<HTMLTemplateElement>('#bulb-template')!;
      const bulb = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      bulb.classList.toggle('lit', requests > 0);
      lights.append(bulb);
    }
    if (requests > 8) {
      const more = document.createElement('span');
      more.className = 'bulb-more';
      more.textContent = `+${requests - 8}`;
      lights.append(more);
    }
    lights.dataset.count = String(requests);
  }
  const label = settings.paused ? '继续动画' : '暂停动画';
  const button = document.querySelector<HTMLButtonElement>('#pause')!;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(settings.paused));
  document.querySelector('#pause-icon')!.toggleAttribute('hidden', settings.paused);
  document.querySelector('#play-icon')!.toggleAttribute('hidden', !settings.paused);
}

function renderQuota(): void {
  const container = document.querySelector<HTMLElement>('#account-quotas')!;
  if (settings?.showQuotas === false) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const scrollOffset = container.scrollLeft;
  container.replaceChildren();
  for (const account of quotaEntries(quota, activity).filter(entry => settings.hiddenQuotas?.[entry.key] !== true)) {
    const badge = document.createElement('span');
    badge.className = 'account-quota';
    badge.classList.toggle('active', account.active);
    badge.classList.toggle('unavailable', !account.available);
    const source = providerIconSource(account.icon);
    if (source) {
      const logo = document.createElement('img');
      logo.className = 'account-logo';
      logo.src = source;
      logo.alt = '';
      badge.append(logo);
    } else {
      const logo = document.createElement('span');
      logo.className = 'account-logo fallback';
      logo.textContent = providerInitial(account);
      badge.append(logo);
    }
    const value = document.createElement('span');
    value.className = 'account-value';
    value.textContent = account.kind === 'balance' && !account.available ? '?' : account.text;
    badge.append(value);
    const detail = account.available
      ? '剩余 ' + account.text + (account.kind === 'balance' ? '（Magpie 缓存余额）' : '')
      : account.kind === 'balance' ? '余额待刷新' : '额度待刷新';
    badge.title = `${account.label} · ${account.active ? '正在使用' : '当前未确认有请求使用'} · ${detail}`;
    badge.setAttribute('aria-label', badge.title);
    container.append(badge);
  }
  container.scrollLeft = scrollOffset;
}

async function play(name: string | null | undefined): Promise<void> {
  if (!name) return;
  const request = ++generation;
  clearTimeout(animationTimer);
  const previous = videos[visible];
  const nextIndex = 1 - visible;
  const next = videos[nextIndex];
  next.pause();
  next.onended = null;
  next.src = new URL(`../assets/webm/${encodeURIComponent(name)}.webm`, import.meta.url).href;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      next.onloadeddata = () => resolve();
      next.onerror = () => reject(new Error(`无法播放：${name}`));
      timeout = setTimeout(() => reject(new Error(`动画加载超时：${name}`)), 10000);
      next.load();
    });
    clearTimeout(timeout);
    if (request !== generation) return;
    await next.play();
    if (request !== generation) {
      next.pause();
      return;
    }
    next.style.opacity = '1';
    previous.style.opacity = '0';
    previous.pause();
    visible = nextIndex;
    if (settings.paused) next.pause();
    next.onended = () => { if (request === generation && !dragging) void play(director.next()); };
    failureCount = 0;
    window.petDiagnostics.loaded = true;
    window.petDiagnostics.played.push(name);
    window.petDiagnostics.played = window.petDiagnostics.played.slice(-20);
    window.petDiagnostics.video = { width: next.videoWidth, height: next.videoHeight, duration: next.duration };
  } catch (error) {
    clearTimeout(timeout);
    if (request !== generation) return;
    window.petDiagnostics.errors.push(error instanceof Error ? error.message : String(error));
    document.querySelector('#next-action')!.setAttribute('title', '动画暂不可用，点击换一个动作');
    if (++failureCount < 3) {
      animationTimer = setTimeout(() => void play(director.select(director.catalog.idle[0])), 1000);
    }
  }
}

function applySettings(value: PetSettings): void {
  const wasPaused = settings?.paused;
  settings = value;
  director.paused = value.paused;
  director.active = value.active;
  director.activity = value.followTasks ? activity : { state: 'idle', label: '', available: false, activeCount: 0 };
  if (value.paused) videos[visible].pause();
  else if (wasPaused) {
    if (videos[visible].ended) void play(director.next());
    else void videos[visible].play().catch(() => {});
  }
  describe();
}

api.on('activity', value => {
  activity = value as Activity;
  if (!director) return;
  if (settings.followTasks) void play(director.update(activity));
  describe();
});
api.on('settings', value => { if (director) applySettings(value as PetSettings); });
api.on('quota', value => { quota = value as Quota; renderQuota(); });
api.on('catalog', value => {
  if (!director) return;
  const update = value as CatalogUpdate;
  director.setCatalog(update.catalog);
  renderPlugins(update.plugins, update.theme);
  if (!update.catalog.names.includes(director.current)) {
    void play(director.select(update.catalog.idle[0]));
  }
});
api.on('play', name => {
  if (!director) return;
  if (settings.paused) api.setting('paused', false);
  void play(director.select(name as string, true));
});
api.on('cursor', value => {
  if (!director) return;
  const point = value as { x: number; y: number };
  let interactive = dragging;
  if (!interactive) {
    interactive = [...document.querySelectorAll<HTMLElement>('.interactive')].some(element => {
      const bounds = element.getBoundingClientRect();
      return point.x >= bounds.left && point.x < bounds.right && point.y >= bounds.top && point.y < bounds.bottom;
    });
  }
  const bounds = stage.getBoundingClientRect();
  if (!interactive && point.x >= bounds.left && point.x < bounds.right
    && point.y >= bounds.top && point.y < bounds.bottom && videos[visible].readyState >= 2) {
    try {
      hitContext.clearRect(0, 0, 256, 144);
      hitContext.drawImage(videos[visible], 0, 0, 256, 144);
      const pixel = hitContext.getImageData(
        Math.floor((point.x - bounds.left) / bounds.width * 256),
        Math.floor((point.y - bounds.top) / bounds.height * 144),
        1, 1,
      ).data;
      interactive = pixel[3] > 20;
    } catch {
      interactive = true;
    }
  }
  if (interactive !== lastInteractive) {
    api.interactive(interactive);
    lastInteractive = interactive;
  }
});

stage.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerStart = { x: event.screenX, y: event.screenY };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove', event => {
  if (!pointerStart || settings.locked || dragging) return;
  if (Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) > 5) {
    dragging = true;
    api.drag('start');
    void play(director.select('被鼠标拖拽悬空反馈', true));
  }
});
stage.addEventListener('pointerup', () => {
  if (!pointerStart) return;
  if (dragging) {
    api.drag('end');
    dragging = false;
    void play(director.next());
  } else {
    const options = director.catalog.clicks.filter(name => name !== director.current);
    void play(director.select(options[Math.floor(Math.random() * options.length)] ?? director.catalog.idle[0], true));
  }
  pointerStart = null;
});
stage.addEventListener('lostpointercapture', () => {
  if (dragging) {
    api.drag('end');
    dragging = false;
  }
  pointerStart = null;
});
document.addEventListener('contextmenu', event => {
  event.preventDefault();
  api.menu();
});
document.querySelector<HTMLButtonElement>('#next-action')!.onclick = () => void play(director.select(director.program(), true, true));
document.querySelector<HTMLButtonElement>('#pause')!.onclick = () => api.setting('paused', !settings.paused);
document.querySelector<HTMLButtonElement>('#menu')!.onclick = () => api.menu();

const dock = document.querySelector<HTMLElement>('#dock')!;
new ResizeObserver(() => api.resize(dock.offsetTop + dock.offsetHeight + 8)).observe(dock);

const initial = await api.getSnapshot();
settings = initial.settings;
activity = initial.activity;
quota = initial.quota;
director = new AnimationDirector(initial.catalog);
renderPlugins(initial.plugins, initial.theme);
applySettings(settings);
await play(director.next());

setInterval(() => {
  renderQuota();
  if (videos[visible].readyState >= 2) {
    hitContext.clearRect(0, 0, 256, 144);
    hitContext.drawImage(videos[visible], 0, 0, 256, 144);
    const pixels = hitContext.getImageData(0, 0, 256, 144).data;
    let clear = 0;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 16) clear++;
      if (pixels[index] > 200) opaque++;
    }
    window.petDiagnostics.transparent = clear > 5000 && opaque > 100;
    window.petDiagnostics.alpha = { clear, opaque };
  }
}, 2000);
