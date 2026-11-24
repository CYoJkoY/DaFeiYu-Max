/**
 * Versioned, validated plugin manifests for the DaFeiYu pet.
 *
 * A manifest is *declarative data*. Third-party plugins shipped as files are
 * never executed as code: they describe capabilities (a social source, an
 * appearance patch, a seasonal skin) that the shared runtime already knows how
 * to honour. This keeps one `src/` tree serving Windows and macOS without a
 * platform branch, and it keeps social writes behind the existing policy gate.
 */

import type { ScriptSettingField } from '../core/types.ts';

export const PLUGIN_SCHEMA_VERSION = 1;

export type PluginKind = 'social' | 'appearance' | 'festival' | 'script';

/** The ABI version this runtime implements for authored-code (WASM) plug-ins. */
export const SCRIPT_ABI_VERSION = 1;

export type ScriptPermission = 'pet' | 'bridge' | 'net';

/**
 * Authored-code plug-in descriptor. Unlike the declarative kinds, a script
 * plug-in ships a Zig-compiled WASM module the runtime feeds events. The host
 * enforces `permissions` strictly: `pet` may ask the pet to speak/play/notify,
 * `bridge` may reach only the origins of the user's configured URL options, and
 * `net` may reach only the listed HTTPS hosts.
 */
export interface ScriptPluginSpec {
  abi: number;
  /** WASM file name inside the plug-in directory, e.g. `plugin.wasm`. */
  entry: string;
  permissions: ScriptPermission[];
  /** HTTPS hostnames reachable with the `net` permission (may include `*.` wildcards). */
  allowHosts?: string[];
  /** Generic settings the panel renders; validated against each field type. */
  settings?: ScriptSettingField[];
  /** Commands the plug-in handles, surfaced as buttons in the panel. */
  commands?: string[];
}

/** A social source implementation the runtime already contains compiled code for. */
export type SocialImplementation = 'bilibili' | 'tieba' | 'bridge';

export interface SocialPluginSpec {
  /** Which compiled adapter powers this source. */
  implementation: SocialImplementation;
  /** Compiled social platform this plugin maps onto (e.g. `bilibili`). */
  platform: string;
  /** Whether reads need nothing, a local bridge URL, or stored credentials. */
  requires: 'none' | 'bridge' | 'credentials';
  /** Public read path is available in this build. */
  reads: boolean;
  /** A write path exists. Sending is *always* additionally gated by user consent. */
  writes: boolean;
  /** Bridge implementations may rename the default endpoints. */
  feedPath?: string;
  messagePath?: string;
}

export interface AppearanceCategory {
  id: string;
  weight: number;
  noMirror?: boolean;
  actions: string[];
}

/**
 * Declarative animation/palette patch. Values must be clip names that already
 * exist in the shipped catalog; unknown names are dropped at apply time so a
 * plugin can never ask for footage the app does not own.
 */
export interface AppearancePluginSpec {
  /** Hex accent colour, e.g. `#2f6fe0`. Applied to renderer CSS variables. */
  accent?: string;
  /** Replacement idle pool (subset of the catalog). */
  idle?: string[];
  /** Per-state clip pools merged over the catalog states. */
  states?: Record<string, string[]>;
  /** Extra categories appended to the "play an action" menu. */
  categories?: AppearanceCategory[];
}

export interface FestivalWindow {
  /** Inclusive start as `MM-DD`, may wrap past new year (e.g. `12-28` → `01-03`). */
  start: string;
  /** Inclusive end as `MM-DD`. */
  end: string;
  /** Greeting shown in the panel and as the pet tooltip while active. */
  greeting?: string;
  /** Accent colour for the themed window. */
  accent?: string;
  /** Short decorative glyphs rendered beside the pet (emoji or symbols). */
  accessories?: string[];
}

export interface FestivalPluginSpec {
  window: FestivalWindow;
}

export interface PluginLabels {
  zh?: string;
  en?: string;
}

export interface PluginManifest {
  schemaVersion: number;
  id: string;
  version: string;
  kind: PluginKind;
  name: string;
  description: string;
  labels?: PluginLabels;
  /**
   * True when loading this plugin widens what the pet may do (e.g. enables a
   * write path). The runtime surfaces this and never auto-applies it.
   */
  requiresTrust?: boolean;
  social?: SocialPluginSpec;
  appearance?: AppearancePluginSpec;
  festival?: FestivalPluginSpec;
  script?: ScriptPluginSpec;
}

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const KINDS: readonly PluginKind[] = ['social', 'appearance', 'festival', 'script'];
const SCRIPT_PERMISSIONS: readonly ScriptPermission[] = ['pet', 'bridge', 'net'];
const SETTING_TYPES: readonly ScriptSettingField['type'][] = ['url', 'number', 'text', 'boolean'];
const REQUIRES: readonly SocialPluginSpec['requires'][] = ['none', 'bridge', 'credentials'];
const IMPLEMENTATIONS: readonly SocialImplementation[] = ['bilibili', 'tieba', 'bridge'];

/**
 * Declarative social manifests may only select an adapter that already ships
 * in this build. The mapping also pins the declared capabilities to the
 * compiled adapter, so a file dropped into `<userData>/plugins` cannot claim a
 * new platform, widen reads, or unlock a write path that does not exist.
 */
export const SOCIAL_PLATFORM_MAPPING = {
  bilibili: { implementation: 'bilibili', requires: 'none', reads: true, writes: false },
  tieba: { implementation: 'tieba', requires: 'none', reads: true, writes: false },
  douyin: { implementation: 'bridge', requires: 'bridge', reads: true, writes: true },
  xiaoheihe: { implementation: 'bridge', requires: 'bridge', reads: true, writes: true },
} as const satisfies Record<string, {
  implementation: SocialImplementation;
  requires: SocialPluginSpec['requires'];
  reads: boolean;
  writes: boolean;
}>;

function fail(error: string): ManifestResult {
  return { ok: false, error };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function stringList(value: unknown, max: number, limit: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = boundedString(entry, max);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function parseSocial(value: unknown, requiresTrust: boolean): SocialPluginSpec | string {
  const record = asRecord(value);
  if (!record) return '社交插件缺少 social 段';
  const implementation = record.implementation as SocialImplementation;
  if (!IMPLEMENTATIONS.includes(implementation)) return `未知的社交实现：${String(record.implementation)}`;
  const requires = record.requires as SocialPluginSpec['requires'];
  if (!REQUIRES.includes(requires)) return `未知的依赖类型：${String(record.requires)}`;
  if (typeof record.reads !== 'boolean' || typeof record.writes !== 'boolean') {
    return '社交插件的 reads / writes 必须是布尔值';
  }
  const platform = boundedString(record.platform, 40);
  if (!platform || !ID_PATTERN.test(platform)) return 'platform 必须是 kebab-case 标识';
  const compiled = SOCIAL_PLATFORM_MAPPING[platform as keyof typeof SOCIAL_PLATFORM_MAPPING];
  if (!compiled) return `平台 ${platform} 没有随应用编译的社交适配器`;
  if (implementation !== compiled.implementation) {
    return `平台 ${platform} 只能使用 ${compiled.implementation} 实现`;
  }
  if (requires !== compiled.requires) {
    return `平台 ${platform} 必须声明 requires: "${compiled.requires}"`;
  }
  if (record.reads && !compiled.reads) return `平台 ${platform} 没有编译读取能力`;
  if (record.writes && !compiled.writes) return `平台 ${platform} 没有编译写入能力`;
  if (record.writes && !requiresTrust) {
    return '允许写入的社交插件必须声明 requiresTrust: true（发送仍需用户逐条确认）';
  }
  const spec: SocialPluginSpec = {
    implementation,
    platform,
    requires,
    reads: record.reads,
    writes: record.writes,
  };
  if (record.feedPath !== undefined) {
    if (implementation !== 'bridge') return '只有 bridge 实现可以声明 feedPath';
    const feed = boundedPath(record.feedPath);
    if (!feed) return 'feedPath 必须是相对路径';
    spec.feedPath = feed;
  }
  if (record.messagePath !== undefined) {
    if (implementation !== 'bridge') return '只有 bridge 实现可以声明 messagePath';
    const message = boundedPath(record.messagePath);
    if (!message) return 'messagePath 必须是相对路径';
    spec.messagePath = message;
  }
  return spec;
}

function boundedPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 120) return null;
  if (!text.startsWith('/')) return null;
  if (text.includes('..') || /[?#\s]/.test(text)) return null;
  return text;
}

function parseAppearance(value: unknown): AppearancePluginSpec | string {
  const record = asRecord(value);
  if (!record) return '外观插件缺少 appearance 段';
  const spec: AppearancePluginSpec = {};
  if (record.accent !== undefined) {
    if (typeof record.accent !== 'string' || !HEX_COLOR.test(record.accent)) return 'accent 必须是 #RGB 或 #RRGGBB';
    spec.accent = record.accent;
  }
  if (record.idle !== undefined) {
    const idle = stringList(record.idle, 80, 40);
    if (!idle || !idle.length) return 'idle 必须是非空的字符串数组';
    spec.idle = idle;
  }
  if (record.states !== undefined) {
    const states = asRecord(record.states);
    if (!states) return 'states 必须是对象';
    const parsed: Record<string, string[]> = {};
    for (const [key, pool] of Object.entries(states)) {
      const name = boundedString(key, 40);
      const clips = stringList(pool, 80, 40);
      if (!name || !clips || !clips.length) return `states.${key} 必须是非空的字符串数组`;
      parsed[name] = clips;
    }
    spec.states = parsed;
  }
  if (record.categories !== undefined) {
    if (!Array.isArray(record.categories)) return 'categories 必须是数组';
    const categories: AppearanceCategory[] = [];
    for (const entry of record.categories) {
      const category = asRecord(entry);
      if (!category) return 'categories 的每一项必须是对象';
      const id = boundedString(category.id, 40);
      const weight = category.weight;
      const actions = stringList(category.actions, 80, 60);
      if (!id || typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || !actions || !actions.length) {
        return '每个分类需要 id、正的 weight 与非空 actions';
      }
      categories.push({
        id,
        weight,
        ...(category.noMirror === true ? { noMirror: true } : {}),
        actions,
      });
    }
    spec.categories = categories;
  }
  if (spec.accent === undefined && spec.idle === undefined && spec.states === undefined && spec.categories === undefined) {
    return '外观插件至少要声明 accent、idle、states 或 categories 之一';
  }
  return spec;
}

function parseFestival(value: unknown): FestivalPluginSpec | string {
  const record = asRecord(value);
  if (!record) return '节日插件缺少 festival 段';
  const window = asRecord(record.window);
  if (!window) return '节日插件缺少 window 段';
  if (typeof window.start !== 'string' || !MONTH_DAY.test(window.start)) return 'window.start 必须是 MM-DD';
  if (typeof window.end !== 'string' || !MONTH_DAY.test(window.end)) return 'window.end 必须是 MM-DD';
  const parsed: FestivalWindow = { start: window.start, end: window.end };
  if (window.greeting !== undefined) {
    const greeting = boundedString(window.greeting, 80);
    if (!greeting) return 'greeting 必须是 80 字以内的非空字符串';
    parsed.greeting = greeting;
  }
  if (window.accent !== undefined) {
    if (typeof window.accent !== 'string' || !HEX_COLOR.test(window.accent)) return 'window.accent 必须是 #RGB 或 #RRGGBB';
    parsed.accent = window.accent;
  }
  if (window.accessories !== undefined) {
    const accessories = stringList(window.accessories, 8, 8);
    if (!accessories || !accessories.length) return 'accessories 必须是非空字符串数组';
    parsed.accessories = accessories;
  }
  return { window: parsed };
}

const HOSTNAME = /^(\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const WASM_ENTRY = /^[A-Za-z0-9._-]+\.wasm$/;

function parseScriptSettings(value: unknown): ScriptSettingField[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return 'settings 必须是数组';
  const fields: ScriptSettingField[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) return 'settings 的每一项必须是对象';
    const id = boundedString(record.id, 48);
    if (!id || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) || seen.has(id)) return `无效或重复的 settings.id：${String(record.id)}`;
    seen.add(id);
    const type = record.type as ScriptSettingField['type'];
    if (!SETTING_TYPES.includes(type)) return `settings.${id}.type 必须是 url/number/text/boolean`;
    const label = boundedString(record.label, 60);
    if (!label) return `settings.${id}.label 必须是非空字符串`;
    const field: ScriptSettingField = { id, type, label };
    if (record.placeholder !== undefined) {
      const placeholder = boundedString(record.placeholder, 120);
      if (!placeholder) return `settings.${id}.placeholder 必须是 120 字以内`;
      field.placeholder = placeholder;
    }
    if (type === 'url') {
      const fallback = record.default === undefined ? undefined : sanitizeScriptUrl(record.default);
      if (record.default !== undefined && fallback === undefined) return `settings.${id}.default 必须是 http(s) 地址`;
      if (fallback) field.default = fallback;
    } else if (type === 'number') {
      if (record.default !== undefined && (typeof record.default !== 'number' || !Number.isFinite(record.default))) {
        return `settings.${id}.default 必须是数字`;
      }
      if (typeof record.default === 'number') field.default = record.default;
      if (record.min !== undefined && (typeof record.min !== 'number' || !Number.isFinite(record.min))) return `settings.${id}.min 必须是数字`;
      if (record.max !== undefined && (typeof record.max !== 'number' || !Number.isFinite(record.max))) return `settings.${id}.max 必须是数字`;
      if (typeof record.min === 'number') field.min = record.min;
      if (typeof record.max === 'number') field.max = record.max;
    } else if (type === 'boolean') {
      if (record.default !== undefined && typeof record.default !== 'boolean') return `settings.${id}.default 必须是布尔值`;
      if (typeof record.default === 'boolean') field.default = record.default;
    } else {
      const fallback = record.default === undefined ? undefined : boundedString(record.default, 200);
      if (record.default !== undefined && !fallback) return `settings.${id}.default 必须是 200 字以内`;
      if (fallback) field.default = fallback;
    }
    fields.push(field);
    if (fields.length >= 24) break;
  }
  return fields;
}

/** Normalise an http(s) origin URL for a plug-in setting (no credentials, no query). */
export function sanitizeScriptUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 300) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
}

function parseScript(value: unknown): ScriptPluginSpec | string {
  const record = asRecord(value);
  if (!record) return '脚本插件缺少 script 段';
  if (record.abi !== SCRIPT_ABI_VERSION) {
    return `脚本 ABI 必须是 ${SCRIPT_ABI_VERSION}（收到 ${String(record.abi)}）`;
  }
  const entry = typeof record.entry === 'string' ? record.entry.trim() : '';
  if (!WASM_ENTRY.test(entry)) return 'entry 必须是插件目录内的 .wasm 文件名';
  if (!Array.isArray(record.permissions)) return 'permissions 必须是数组';
  const permissions: ScriptPermission[] = [];
  for (const raw of record.permissions) {
    const permission = raw as ScriptPermission;
    if (!SCRIPT_PERMISSIONS.includes(permission)) return `未知的权限：${String(raw)}`;
    if (!permissions.includes(permission)) permissions.push(permission);
  }
  if (!permissions.length) return '脚本插件必须至少声明一个权限（pet/bridge/net）';
  const spec: ScriptPluginSpec = { abi: SCRIPT_ABI_VERSION, entry, permissions };
  if (record.allowHosts !== undefined) {
    const hosts = stringList(record.allowHosts, 200, 32);
    if (!hosts || !hosts.length) return 'allowHosts 必须是非空字符串数组';
    for (const host of hosts) if (!HOSTNAME.test(host)) return `allowHosts 中的主机名无效：${host}`;
    spec.allowHosts = hosts;
  }
  if (permissions.includes('net') && !spec.allowHosts?.length) {
    return 'net 权限必须同时声明 allowHosts';
  }
  const settings = parseScriptSettings(record.settings);
  if (typeof settings === 'string') return settings;
  if (settings.length) spec.settings = settings;
  if (record.commands !== undefined) {
    const commands = stringList(record.commands, 40, 12);
    if (!commands || !commands.length) return 'commands 必须是非空字符串数组';
    for (const command of commands) if (!/^[a-z][a-z0-9_-]{0,24}$/.test(command)) return `无效的命令名：${command}`;
    spec.commands = commands;
  }
  return spec;
}

/** Validate a raw value (e.g. a parsed JSON file) into a plugin manifest. */
export function parsePluginManifest(raw: unknown): ManifestResult {
  const record = asRecord(raw);
  if (!record) return fail('插件清单必须是 JSON 对象');
  if (record.schemaVersion !== PLUGIN_SCHEMA_VERSION) {
    return fail(`不支持的 schemaVersion：${String(record.schemaVersion)}（需要 ${PLUGIN_SCHEMA_VERSION}）`);
  }
  const id = boundedString(record.id, 64);
  if (!id || !ID_PATTERN.test(id)) return fail('id 必须是 kebab-case（小写字母、数字、连字符）');
  const version = boundedString(record.version, 40);
  if (!version || !VERSION_PATTERN.test(version)) return fail('version 必须是 x.y.z 形式');
  const kind = record.kind as PluginKind;
  if (!KINDS.includes(kind)) return fail(`未知的 kind：${String(record.kind)}`);
  const name = boundedString(record.name, 80);
  if (!name) return fail('name 必须是 80 字以内的非空字符串');
  const description = boundedString(record.description, 240);
  if (!description) return fail('description 必须是 240 字以内的非空字符串');

  const manifest: PluginManifest = {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id,
    version,
    kind,
    name,
    description,
  };

  const labels = asRecord(record.labels);
  if (labels) {
    const parsedLabels: PluginLabels = {};
    const zh = labels.zh === undefined ? undefined : boundedString(labels.zh, 80);
    const en = labels.en === undefined ? undefined : boundedString(labels.en, 80);
    if (labels.zh !== undefined && !zh) return fail('labels.zh 必须是 80 字以内的字符串');
    if (labels.en !== undefined && !en) return fail('labels.en 必须是 80 字以内的字符串');
    if (zh) parsedLabels.zh = zh;
    if (en) parsedLabels.en = en;
    if (parsedLabels.zh || parsedLabels.en) manifest.labels = parsedLabels;
  }
  if (typeof record.requiresTrust === 'boolean') manifest.requiresTrust = record.requiresTrust;

  if (kind === 'social') {
    const social = parseSocial(record.social, record.requiresTrust === true);
    if (typeof social === 'string') return fail(social);
    manifest.social = social;
  } else if (kind === 'appearance') {
    const appearance = parseAppearance(record.appearance);
    if (typeof appearance === 'string') return fail(appearance);
    manifest.appearance = appearance;
  } else if (kind === 'festival') {
    const festival = parseFestival(record.festival);
    if (typeof festival === 'string') return fail(festival);
    manifest.festival = festival;
  } else {
    const script = parseScript(record.script);
    if (typeof script === 'string') return fail(script);
    manifest.script = script;
  }
  return { ok: true, manifest };
}

/** Display label for a manifest, preferring Chinese then the plain name. */
export function manifestLabel(manifest: PluginManifest): string {
  return manifest.labels?.zh || manifest.name;
}
