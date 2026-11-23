import type { PetSettings, PlatformSettings, PluginSettings, SocialSettings } from './types.ts';

export const PET_SIZES = [360, 460, 560] as const;
export type PetSize = (typeof PET_SIZES)[number];

export const DEFAULT_SOCIAL: SocialSettings = {
  enabled: false,
  intervalMinutes: 15,
  allowWrites: false,
  quietHours: { start: 23, end: 7 },
  platforms: {},
};

export const DEFAULT_PLUGINS: PluginSettings = {
  appearance: null,
  enabled: {},
};

export const DEFAULT_SETTINGS: PetSettings = {
  size: 460,
  active: true,
  paused: false,
  locked: false,
  followTasks: true,
  showBulbs: true,
  showQuotas: true,
  hiddenQuotas: {},
  x: null,
  y: null,
  interests: ['DeepSeek', 'Magpie', '编程'],
  social: DEFAULT_SOCIAL,
  plugins: DEFAULT_PLUGINS,
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BOOLEAN_KEYS = ['active', 'paused', 'locked', 'followTasks', 'showBulbs', 'showQuotas'] as const;

export function sanitizeHiddenQuotas(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [id, hidden] of Object.entries(value as Record<string, unknown>)) {
    if (id.length === 0 || id.length > 240 || hidden !== true) continue;
    result[id] = true;
    if (Object.keys(result).length >= 500) break;
  }
  return result;
}

export function sanitizeInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.interests];
  const seen = new Set<string>();
  const interests: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const text = entry.trim().slice(0, 40);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    interests.push(text);
    if (interests.length >= 20) break;
  }
  return interests;
}

export function sanitizeBridgeUrl(value: unknown): string | undefined {
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
  if (parsed.username || parsed.password) return undefined;
  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
}

export function sanitizeQuietHours(value: unknown): { start: number; end: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { start, end } = value as { start?: unknown; end?: unknown };
  const valid = (hour: unknown): hour is number => Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23;
  if (!valid(start) || !valid(end)) return undefined;
  return { start, end };
}

export function sanitizeSocial(value: unknown, knownPlatforms: readonly string[]): SocialSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const platforms: Record<string, PlatformSettings> = {};
  const rawPlatforms = source.platforms && typeof source.platforms === 'object' && !Array.isArray(source.platforms)
    ? source.platforms as Record<string, unknown>
    : {};
  for (const id of knownPlatforms) {
    const entry = rawPlatforms[id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const settings: PlatformSettings = { enabled: record.enabled === true };
    const bridgeUrl = sanitizeBridgeUrl(record.bridgeUrl);
    if (bridgeUrl) settings.bridgeUrl = bridgeUrl;
    platforms[id] = settings;
  }
  const interval = Number.isFinite(source.intervalMinutes) ? Math.round(source.intervalMinutes as number) : DEFAULT_SOCIAL.intervalMinutes;
  return {
    enabled: source.enabled === true,
    allowWrites: source.allowWrites === true,
    intervalMinutes: Math.min(180, Math.max(5, interval)),
    ...(sanitizeQuietHours(source.quietHours) ? { quietHours: sanitizeQuietHours(source.quietHours) } : {}),
    platforms,
  };
}

/** Keep only declarative, well-formed plugin selections; never trusted as code. */
export function sanitizePlugins(value: unknown): PluginSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const appearance = typeof source.appearance === 'string' && source.appearance.length <= 64
    && SLUG_PATTERN.test(source.appearance) ? source.appearance : null;
  const enabled: Record<string, boolean> = {};
  const rawEnabled = source.enabled && typeof source.enabled === 'object' && !Array.isArray(source.enabled)
    ? source.enabled as Record<string, unknown>
    : {};
  for (const [id, flag] of Object.entries(rawEnabled)) {
    if (id.length > 64 || !SLUG_PATTERN.test(id)) continue;
    enabled[id] = flag === true;
    if (Object.keys(enabled).length >= 200) break;
  }
  return { appearance, enabled };
}

/** Merge a persisted settings file into the defaults, discarding anything invalid. */
export function normalizeSettings(saved: unknown, knownPlatforms: readonly string[] = []): PetSettings {
  const settings: PetSettings = {
    ...DEFAULT_SETTINGS,
    hiddenQuotas: {},
    interests: [...DEFAULT_SETTINGS.interests],
    social: { ...DEFAULT_SOCIAL, platforms: {} },
    plugins: { appearance: null, enabled: {} },
  };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return settings;
  const record = saved as Record<string, unknown>;
  for (const key of BOOLEAN_KEYS) if (typeof record[key] === 'boolean') settings[key] = record[key] as boolean;
  if (PET_SIZES.includes(record.size as PetSize)) settings.size = record.size as PetSize;
  settings.hiddenQuotas = sanitizeHiddenQuotas(record.hiddenQuotas);
  if (Number.isFinite(record.x) && Number.isFinite(record.y)) {
    settings.x = Math.round(record.x as number);
    settings.y = Math.round(record.y as number);
  }
  settings.interests = sanitizeInterests(record.interests);
  settings.social = sanitizeSocial(record.social, knownPlatforms);
  settings.plugins = sanitizePlugins(record.plugins);
  return settings;
}
