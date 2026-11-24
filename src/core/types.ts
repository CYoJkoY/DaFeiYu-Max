/** Shared, platform-neutral types for the DaFeiYu pet core. */

declare global {
  /** Injected by the build from package.json (see scripts/build.mjs). */
  const __APP_VERSION__: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface CatalogCategory {
  id: string;
  weight: number;
  noMirror?: boolean;
  actions: string[];
}

export interface Catalog {
  names: string[];
  idle: string[];
  clicks: string[];
  categories: CatalogCategory[];
  states: Record<string, string[]>;
}

export type ActivityState = 'idle' | 'thinking' | 'waiting' | 'working' | 'success' | 'unknown';

export interface Activity {
  state: ActivityState | string;
  label: string;
  available: boolean;
  activeCount: number;
  waitingCount?: number;
  toolCount?: number;
  observedAt?: number;
  scope?: string;
  activeAccountIds?: string[];
  accountStatusAvailable?: boolean;
  eventId?: string;
}

export interface QuotaWindow {
  accountId: string;
  key: string;
  provider: string;
  icon: string;
  name: string;
  plan: string;
  windowName: string;
  label: string;
  used: number;
  remaining: number;
  resetsAt: number | null;
  readAt: number | null;
  stale: boolean;
  cached?: boolean;
}

export interface QuotaAccount {
  accountId: string;
  key: string;
  provider: string;
  icon: string;
  name: string;
  plan: string;
  label: string;
  kind: 'subscription' | 'balance';
  balance?: string | null;
  readAt?: number | null;
  cached?: boolean;
}

export interface Quota {
  ok: boolean;
  windows: QuotaWindow[];
  accounts?: QuotaAccount[];
  observedAt?: number | null;
  cachedAt?: number;
  error?: string | null;
  usage?: { calls: number; errors: number };
}

export interface QuotaEntry extends Partial<QuotaWindow> {
  key: string;
  accountId: string;
  kind: 'subscription' | 'balance';
  text: string;
  available: boolean;
  active: boolean;
  icon: string;
  label: string;
  windowName?: string;
  remaining?: number;
  resetsAt?: number | null;
  readAt?: number | null;
  cached?: boolean;
  balance?: string | null;
}

export interface SocialDraft {
  id: string;
  platform: string;
  target: string;
  text: string;
  createdAt: number;
  reason: string;
}

export interface SocialPlatformStatus {
  id: string;
  label: string;
  configured: boolean;
  reads: boolean;
  writes: boolean;
  bridged: boolean;
  note: string;
  lastReadAt?: number | null;
  error?: string | null;
}

export interface SocialReport {
  enabled: boolean;
  allowWrites: boolean;
  generatedAt: number | null;
  summary: string;
  bullet: string;
  highlights: string[];
  platforms: SocialPlatformStatus[];
  drafts: SocialDraft[];
}

export interface PlatformSettings {
  enabled: boolean;
  bridgeUrl?: string;
  hasCredentials?: boolean;
}

export interface SocialSettings {
  enabled: boolean;
  intervalMinutes: number;
  allowWrites: boolean;
  quietHours?: { start: number; end: number };
  platforms: Record<string, PlatformSettings>;
}

/**
 * Plug-in selections persisted in settings.json: `appearance` selects an
 * appearance manifest by id (null keeps the built-in default) and `enabled`
 * toggles individual declarative plug-ins on or off (currently seasonal skins).
 */
/**
 * One authored-code plug-in selection. Script plug-ins are WindHawk-style: the
 * user (or the market) drops a Zig-compiled WASM module under the app data
 * directory, and the runtime feeds it events. `options` are the plug-in's own
 * free-form settings, validated against the manifest's declared field list.
 */
export interface ScriptPluginSelection {
  enabled: boolean;
  options: Record<string, string | number | boolean>;
}

/** Where the cloud market index is fetched from; both fields are user-overridable. */
export interface MarketSettings {
  repo: string;
  ref: string;
  lastSync: number | null;
}

/** Plug-in selections persisted in settings.json. */
export interface PluginSettings {
  appearance: string | null;
  enabled: Record<string, boolean>;
  scripts: Record<string, ScriptPluginSelection>;
  market: MarketSettings;
}

export type PluginKindName = 'social' | 'appearance' | 'festival' | 'script';

/** A declared setting for an authored-code plug-in (rendered generically by the panel). */
export interface ScriptSettingField {
  id: string;
  type: 'url' | 'number' | 'text' | 'boolean';
  label: string;
  placeholder?: string;
  default?: string | number | boolean;
  min?: number;
  max?: number;
}

/** Author/source metadata and current runtime state for a script plug-in. */
export interface ScriptPluginMeta {
  abi: number;
  permissions: string[];
  allowHosts?: string[];
  wasmBytes?: number;
  source?: 'local' | 'market';
  harness?: string;
  settings?: ScriptSettingField[];
}

/** Live status reported by an authored-code plug-in's last invocation. */
export interface ScriptRuntimeStatus {
  id: string;
  running: boolean;
  message: string;
  progress: number | null;
  counter: number | null;
  lastRunAt: number | null;
  lastError: string | null;
  invocations: number;
  commands: string[];
}

/** One validated entry in the cloud market index. */
export interface MarketEntry {
  id: string;
  version: string;
  kind: 'script';
  name: string;
  labels?: { zh?: string; en?: string };
  description: string;
  author: string;
  homepage?: string;
  tags: string[];
  permissions: string[];
  harness: string;
  size: number;
  sha256: string;
  manifest: string;
  wasm: string;
  source?: string;
}

export interface MarketIndex {
  schemaVersion: 1;
  generatedAt: string;
  plugins: MarketEntry[];
}

/** A script plug-in already installed locally, with market provenance when known. */
export interface InstalledScriptPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  settings: ScriptSettingField[];
  enabled: boolean;
  options: Record<string, string | number | boolean>;
  origin: 'local' | 'market';
  marketVersion: string | null;
  updateAvailable: boolean;
  status: ScriptRuntimeStatus;
}

/** One plug-in as surfaced to the renderer's plugin list. */
export interface PluginViewEntry {
  id: string;
  kind: PluginKindName;
  label: string;
  description: string;
  source: 'builtin' | 'external';
  /** Currently applied: the selected appearance, an in-window skin, or a live social source. */
  active: boolean;
  /** Toggle state for seasonal plug-ins; social sources use their own switches. */
  enabled?: boolean;
  requiresTrust: boolean;
  /** Social plug-ins only: the compiled adapter and its capabilities. */
  platform?: string;
  reads?: boolean;
  writes?: boolean;
  /** Authored-code plug-ins only: declared ABI, permissions and settings. */
  script?: ScriptPluginMeta;
  /** Authored-code plug-ins only: last-run status from the runtime. */
  status?: ScriptRuntimeStatus;
}

export interface FestivalView {
  id: string;
  label: string;
  greeting?: string;
  accent?: string;
  accessories: string[];
}

export interface PluginSnapshot {
  appearance: string | null;
  festival: FestivalView | null;
  entries: PluginViewEntry[];
  issues: string[];
}

/** Dynamic palette derived from the active appearance/festival plug-ins. */
export interface Theme {
  accent?: string;
}

/** One catalog refresh caused by an appearance or seasonal plug-in change. */
export interface CatalogUpdate {
  catalog: Catalog;
  theme: Theme;
  plugins: PluginSnapshot;
}

export interface PetSettings {
  size: 360 | 460 | 560;
  active: boolean;
  paused: boolean;
  locked: boolean;
  followTasks: boolean;
  showBulbs: boolean;
  showQuotas: boolean;
  hiddenQuotas: Record<string, boolean>;
  x: number | null;
  y: number | null;
  interests: string[];
  social: SocialSettings;
  plugins: PluginSettings;
}

export interface Snapshot {
  catalog: Catalog;
  settings: PetSettings;
  activity: Activity;
  quota: Quota;
  social: SocialReport;
  plugins: PluginSnapshot;
  theme: Theme;
}
