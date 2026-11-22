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
 * Declarative plugin selections. Plugins are data, never code: `appearance`
 * selects an appearance manifest by id (null keeps the built-in default) and
 * `enabled` toggles individual plug-ins on or off (currently seasonal skins).
 */
export interface PluginSettings {
  appearance: string | null;
  enabled: Record<string, boolean>;
}

export type PluginKindName = 'social' | 'appearance' | 'festival';

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
