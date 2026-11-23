/**
 * The companion panel: quota detail, animation browser, pet settings, interest
 * keywords and the social window (read digest, bridge configuration, drafts).
 */
import { quotaEntries } from '../core/quota-display.js';
import { providerIconSource, providerInitial } from '../core/provider-icons.js';
import type {
  Activity, Catalog, CatalogUpdate, PetSettings, PluginSnapshot, Quota, SocialReport, Theme,
} from '../core/types.js';

const api = window.pet;
let catalog: Catalog;
let lastQuota: Quota | null = null;
let settings: PetSettings | null = null;
let hiddenQuotas: Record<string, boolean> = {};

function renderActivity(activity: Activity): void {
  const count = activity.activeCount > 1 ? ` · ${activity.activeCount} 个请求` : '';
  document.querySelector('#activity')!.textContent = activity.label + count;
  document.querySelector('#scope')!.textContent = activity.available ? '本机 Magpie' : '状态未知';
}

function renderQuota(quota: Quota): void {
  lastQuota = quota;
  const container = document.querySelector<HTMLElement>('#quota')!;
  container.replaceChildren();
  const entries = quotaEntries(quota, null);
  const allVisible = entries.every(entry => hiddenQuotas[entry.key] !== true);
  const master = document.querySelector<HTMLButtonElement>('#quota-all')!;
  master.disabled = entries.length === 0;
  master.setAttribute('aria-checked', String(allVisible));
  master.setAttribute('aria-label', allVisible ? '隐藏全部额度' : '显示全部额度');
  master.title = allVisible ? '全部显示中，点击全部隐藏' : '点击全部显示在桌宠上';
  master.onclick = () => {
    hiddenQuotas = allVisible ? Object.fromEntries(entries.map(entry => [entry.key, true])) : {};
    api.setting('hiddenQuotas', hiddenQuotas);
    renderQuota(quota);
  };
  if (!quota.ok) {
    const error = document.createElement('div');
    error.className = 'error';
    error.textContent = quota.error || '额度暂不可用';
    container.append(error);
  }
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'quota-row';
    const head = document.createElement('div');
    head.className = 'quota-head';
    const icon = document.createElement('span');
    icon.className = 'quota-icon';
    const source = providerIconSource(entry.icon);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      icon.append(image);
    } else {
      icon.textContent = providerInitial(entry);
    }
    const name = document.createElement('span');
    name.className = 'quota-name';
    name.textContent = entry.kind === 'balance' ? entry.label : entry.windowName ?? entry.label;
    name.title = entry.label;
    const remaining = document.createElement('strong');
    remaining.className = 'quota-value';
    remaining.textContent = entry.text;
    const toggle = document.createElement('button');
    const visible = hiddenQuotas[entry.key] !== true;
    toggle.className = 'quota-switch';
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(visible));
    toggle.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}「${entry.label}」在桌宠右侧`);
    toggle.title = visible ? '当前显示在桌宠上，点击隐藏' : '当前已隐藏，点击显示在桌宠上';
    toggle.onclick = () => {
      const next = { ...hiddenQuotas };
      if (visible) next[entry.key] = true;
      else delete next[entry.key];
      hiddenQuotas = next;
      api.setting('hiddenQuotas', next);
      renderQuota(quota);
    };
    head.append(icon, name, remaining, toggle);
    row.append(head);
    if (entry.kind === 'subscription') {
      const meter = document.createElement('div');
      meter.className = 'meter';
      const fill = document.createElement('span');
      fill.style.width = `${entry.available ? entry.remaining ?? 0 : 0}%`;
      if ((entry.remaining ?? 100) < 20) fill.style.background = '#db9f78';
      meter.append(fill);
      const reset = document.createElement('div');
      reset.className = 'reset';
      reset.textContent = entry.resetsAt
        ? `重置：${new Date(entry.resetsAt * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}（北京时间）`
        : '重置时间暂不可用';
      reset.textContent += entry.readAt
        ? ` · 数据 ${new Date(entry.readAt).toLocaleTimeString('zh-CN')}${entry.cached ? ' · 本地缓存' : ''}`
        : ' · 数据时间未知';
      row.append(meter, reset);
    } else if (entry.readAt || entry.cached) {
      const note = document.createElement('div');
      note.className = 'reset';
      note.textContent = `${entry.readAt ? `数据 ${new Date(entry.readAt).toLocaleTimeString('zh-CN')}` : '数据时间未知'}${entry.cached ? ' · 本地缓存' : ''}`;
      row.append(note);
    }
    container.append(row);
  }
  const stale = Boolean(quota.observedAt) && Date.now() - (quota.observedAt as number) > 240000;
  document.querySelector('#quota-time')!.textContent = quota.observedAt
    ? `${quota.ok ? (quota.cachedAt ? '显示最近成功缓存' : 'Magpie 缓存 · 订阅额度 / API 余额') : '查询未成功'} · ${new Date(quota.observedAt).toLocaleTimeString('zh-CN')}${stale ? ' · 请刷新' : ''}。每 30 秒同步；右侧开关控制桌面徽章。`
    : '正在读取 Magpie 额度…';
  document.querySelector('#usage')!.textContent = quota.usage
    ? `Magpie 今日：${quota.usage.calls} 次请求 · ${quota.usage.errors} 次错误（按 Magpie 统计口径）`
    : '';
}

function renderSettings(value: PetSettings): void {
  settings = value;
  hiddenQuotas = { ...(value.hiddenQuotas || {}) };
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-setting]')) {
    const key = input.dataset.setting as keyof PetSettings;
    input.checked = value[key] === true;
  }
  document.querySelector<HTMLSelectElement>('#size')!.value = String(value.size);
  document.querySelector<HTMLTextAreaElement>('#interests')!.value = (value.interests || []).join('，');
}

function renderPlugins(value: PluginSnapshot, theme: Theme): void {
  document.documentElement.style.setProperty('--accent', theme.accent || '#2f6fe0');
  const state = document.querySelector<HTMLElement>('#plugin-state')!;
  const appearance = document.querySelector<HTMLSelectElement>('#appearance')!;
  const festivalNote = document.querySelector<HTMLElement>('#festival-note')!;
  const list = document.querySelector<HTMLElement>('#plugin-list')!;
  const issues = document.querySelector<HTMLElement>('#plugin-issues')!;

  const appearances = value.entries.filter(entry => entry.kind === 'appearance');
  appearance.replaceChildren();
  for (const entry of appearances) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label;
    appearance.append(option);
  }
  if (value.appearance && appearances.some(entry => entry.id === value.appearance)) {
    appearance.value = value.appearance;
  }
  appearance.disabled = appearances.length <= 1;
  appearance.onchange = () => api.setting('appearance', appearance.value);

  const externals = value.entries.filter(entry => entry.source === 'external').length;
  state.textContent = externals ? `内置 + ${externals} 个外部` : '全部内置';
  festivalNote.textContent = value.festival
    ? `${value.festival.label}装扮进行中${value.festival.greeting ? `：${value.festival.greeting}` : '。'}${value.festival.accessories.length ? ` ${value.festival.accessories.join(' ')}` : ''}`
    : '今天没有节日装扮。';

  list.replaceChildren();
  for (const entry of value.entries.filter(item => item.kind !== 'appearance')) {
    const row = document.createElement('div');
    row.className = 'plugin-row';
    const main = document.createElement('div');
    main.className = 'plugin-main';
    const name = document.createElement('strong');
    name.textContent = entry.label;
    const badges = document.createElement('span');
    badges.className = 'plugin-badges';
    const kind = document.createElement('span');
    kind.className = 'badge';
    kind.textContent = entry.kind === 'social' ? '社交' : '节日';
    badges.append(kind);
    if (entry.source === 'external') {
      const source = document.createElement('span');
      source.className = 'badge';
      source.textContent = '外部';
      badges.append(source);
    }
    if (entry.active) {
      const active = document.createElement('span');
      active.className = 'badge active-badge';
      active.textContent = '生效中';
      badges.append(active);
    }
    name.append(' ', badges);
    const description = document.createElement('p');
    description.className = 'note plugin-description';
    description.textContent = entry.description;
    if (entry.kind === 'social') {
      description.textContent += ` 能力：${entry.reads ? '读取' : '不读取'}${entry.writes ? '，写入需确认' : '，只读'}。`;
    }
    if (entry.requiresTrust) {
      description.textContent += ' 此插件声明了更高权限，启用写入后仍需逐条确认。';
    }
    main.append(name, description);
    row.append(main);
    if (entry.kind === 'festival') {
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = entry.enabled !== false;
      toggle.setAttribute('aria-label', `${toggle.checked ? '停用' : '启用'}${entry.label}`);
      toggle.onchange = () => api.setting('pluginEnabled', { id: entry.id, enabled: toggle.checked });
      row.append(toggle);
    }
    list.append(row);
  }

  issues.hidden = value.issues.length === 0;
  issues.className = value.issues.length ? 'error plugin-issues' : 'note plugin-issues';
  issues.textContent = value.issues.length
    ? `有 ${value.issues.length} 个外部插件未加载：${value.issues.join('；')}`
    : '';
}

function parseInterests(text: string): string[] {
  const seen = new Set<string>();
  const interests: string[] = [];
  for (const raw of text.split(/[\n,，、;；]+/)) {
    const entry = raw.trim().slice(0, 40);
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    interests.push(entry);
    if (interests.length >= 20) break;
  }
  return interests;
}

function renderSocial(report: SocialReport | null): void {
  const state = document.querySelector<HTMLElement>('#social-state')!;
  const summary = document.querySelector<HTMLElement>('#social-summary')!;
  const enabled = document.querySelector<HTMLInputElement>('#social-enabled')!;
  const writes = document.querySelector<HTMLInputElement>('#social-writes')!;
  const platforms = document.querySelector<HTMLElement>('#social-platforms')!;
  const drafts = document.querySelector<HTMLElement>('#social-drafts')!;
  const highlights = document.querySelector<HTMLElement>('#social-highlights')!;
  if (!report) {
    state.textContent = '不可用';
    summary.textContent = '社交模块暂不可用。';
    platforms.replaceChildren();
    drafts.replaceChildren();
    highlights.textContent = '';
    return;
  }
  enabled.checked = report.enabled;
  writes.checked = report.allowWrites;
  state.textContent = report.enabled ? '运行中' : '未启用';
  summary.textContent = report.summary;
  highlights.textContent = report.highlights.join(' · ');

  platforms.replaceChildren();
  for (const platform of report.platforms) {
    const row = document.createElement('div');
    row.className = 'social-row';
    const head = document.createElement('div');
    head.className = 'social-head';
    const name = document.createElement('strong');
    name.textContent = platform.label;
    const flag = document.createElement('span');
    flag.className = 'badge';
    flag.textContent = platform.reads ? '读取中' : platform.configured
      ? '已配置' : platform.bridged ? '需要桥接' : '未配置';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = settings?.social?.platforms?.[platform.id]?.enabled === true;
    toggle.setAttribute('aria-label', `启用${platform.label}`);
    toggle.onchange = () => {
      void api.socialConfigure(platform.id, { enabled: toggle.checked }).then(renderSocial);
    };
    head.append(name, flag, toggle);
    row.append(head);
    if (platform.bridged) {
      const input = document.createElement('input');
      input.type = 'url';
      input.placeholder = 'http://127.0.0.1:端口/feed';
      input.value = settings?.social?.platforms?.[platform.id]?.bridgeUrl || '';
      input.setAttribute('aria-label', `${platform.label}桥接地址`);
      const save = document.createElement('button');
      save.className = 'text-button';
      save.textContent = '保存桥接';
      save.onclick = () => {
        void api.socialConfigure(platform.id, { bridgeUrl: input.value.trim() }).then(renderSocial);
      };
      row.append(input, save);
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = platform.error ? `${platform.note}（${platform.error}）` : platform.note;
    row.append(note);
    platforms.append(row);
  }

  drafts.replaceChildren();
  if (!report.drafts.length) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = report.allowWrites ? '暂无待确认草稿。' : '发送功能关闭时不会生成草稿。';
    drafts.append(empty);
  }
  for (const draft of report.drafts) {
    const card = document.createElement('div');
    card.className = 'draft';
    const text = document.createElement('p');
    text.className = 'draft-text';
    text.textContent = draft.text;
    const reason = document.createElement('p');
    reason.className = 'note';
    reason.textContent = draft.reason;
    const actions = document.createElement('div');
    actions.className = 'draft-actions';
    const approve = document.createElement('button');
    approve.textContent = '确认发送';
    approve.onclick = () => {
      void api.socialApprove(draft.id).then(result => {
        setNote(result?.ok ? `已发送：${result.note}` : `未发送：${result?.note ?? '未知原因'}`);
        renderSocial(result?.report ?? null);
      });
    };
    const reject = document.createElement('button');
    reject.className = 'secondary';
    reject.textContent = '丢弃';
    reject.onclick = () => { void api.socialReject(draft.id).then(renderSocial); };
    actions.append(approve, reject);
    card.append(text, reason, actions);
    drafts.append(card);
  }
}

function setNote(message: string): void {
  document.querySelector('#social-note')!.textContent = message;
}

function filterActions(): void {
  const query = document.querySelector<HTMLInputElement>('#search')!.value.trim().toLowerCase();
  const container = document.querySelector<HTMLElement>('#actions')!;
  container.replaceChildren();
  for (const name of catalog.names.filter(name => name.toLowerCase().includes(query))) {
    const button = document.createElement('button');
    button.textContent = name;
    button.onclick = () => api.play(name);
    container.append(button);
  }
}

document.querySelector<HTMLButtonElement>('#refresh')!.onclick = async () => {
  const button = document.querySelector<HTMLButtonElement>('#refresh')!;
  button.disabled = true;
  button.textContent = '查询中…';
  try {
    renderQuota(await api.refreshQuota());
  } finally {
    button.disabled = false;
    button.textContent = '刷新';
  }
};
document.querySelector<HTMLButtonElement>('#open-magpie')!.onclick = () => api.openMagpie();
document.querySelector<HTMLAnchorElement>('#repository')!.onclick = event => {
  event.preventDefault();
  api.openRepository();
};
document.querySelector<HTMLInputElement>('#search')!.oninput = filterActions;
document.querySelector<HTMLSelectElement>('#size')!.onchange = event => {
  api.setting('size', Number((event.target as HTMLSelectElement).value));
};
for (const input of document.querySelectorAll<HTMLInputElement>('[data-setting]')) {
  input.onchange = () => api.setting(input.dataset.setting as string, input.checked);
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-play]')) {
  button.onclick = () => api.play(button.dataset.play as string);
}

document.querySelector<HTMLInputElement>('#social-enabled')!.onchange = event => {
  void api.socialToggle('enabled', (event.target as HTMLInputElement).checked).then(renderSocial);
};
document.querySelector<HTMLInputElement>('#social-writes')!.onchange = event => {
  void api.socialToggle('allowWrites', (event.target as HTMLInputElement).checked).then(renderSocial);
};
document.querySelector<HTMLButtonElement>('#social-refresh')!.onclick = () => {
  setNote('正在读取公开动态…');
  void api.socialRefresh().then(report => {
    setNote(report ? '已刷新。' : '社交模块不可用。');
    renderSocial(report);
  });
};
document.querySelector<HTMLButtonElement>('#interests-save')!.onclick = () => {
  const interests = parseInterests(document.querySelector<HTMLTextAreaElement>('#interests')!.value);
  api.setting('interests', interests);
  setNote(`已保存 ${interests.length} 个兴趣关键词。`);
};

api.on('activity', value => renderActivity(value as Activity));
api.on('quota', value => renderQuota(value as Quota));
api.on('settings', value => {
  renderSettings(value as PetSettings);
  if (lastQuota) renderQuota(lastQuota);
});
api.on('social', value => renderSocial(value as SocialReport));
api.on('catalog', value => {
  const update = value as CatalogUpdate;
  catalog = update.catalog;
  renderPlugins(update.plugins, update.theme);
  filterActions();
});

void api.getSnapshot().then(snapshot => {
  catalog = snapshot.catalog;
  renderActivity(snapshot.activity);
  renderSettings(snapshot.settings);
  renderQuota(snapshot.quota);
  renderSocial(snapshot.social ?? null);
  renderPlugins(snapshot.plugins, snapshot.theme);
  filterActions();
});

setInterval(() => { if (lastQuota) renderQuota(lastQuota); }, 30000);
