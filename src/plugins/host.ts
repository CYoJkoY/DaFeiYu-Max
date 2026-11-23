import type {
  Catalog, FestivalView, PetSettings, PluginSnapshot, PluginViewEntry, Theme,
} from '../core/types.ts';
import { applyAppearance } from './appearance.ts';
import { festivalActive } from './calendar.ts';
import { manifestLabel } from './manifest.ts';
import type { PluginRegistry } from './registry.ts';

export interface ResolvedPlugins {
  /** Catalog with the selected appearance patch already merged in. */
  catalog: Catalog;
  /** Active theme derived from the appearance and festival skins. */
  theme: Theme;
  /** The seasonal skin active today, if any. */
  festival: FestivalView | null;
  /** Everything the renderer needs to list plug-ins and their state. */
  view: PluginSnapshot;
  /** Human-readable load problems from external manifests. */
  issues: string[];
  /** True when persisted selections were pruned and should be saved. */
  settingsChanged: boolean;
}

function appearanceIdOf(settings: PetSettings): string | null {
  const id = settings.plugins.appearance;
  return id && id.length <= 64 ? id : null;
}

/**
 * Drop persisted plug-in selections that no longer name a loaded plug-in. A
 * removed, renamed or rejected external manifest must not leave a dangling id
 * in settings, and a toggle may only target an actual seasonal skin.
 */
export function prunePluginSelections(settings: PetSettings, registry: PluginRegistry): boolean {
  let changed = false;
  const appearance = settings.plugins.appearance;
  if (appearance && !registry.hasAppearance(appearance)) {
    settings.plugins.appearance = null;
    changed = true;
  }
  for (const id of Object.keys(settings.plugins.enabled)) {
    if (!registry.hasFestival(id)) {
      delete settings.plugins.enabled[id];
      changed = true;
    }
  }
  return changed;
}

/**
 * Merge the persisted plug-in selection over the base catalog. This is the one
 * place that turns declarative plug-in data into the runtime catalog, theme and
 * seasonal greeting. External manifests can only widen the social sources that
 * already ship compiled, and can never introduce footage or code the app does
 * not own.
 */
export function resolvePlugins(
  baseCatalog: Catalog,
  registry: PluginRegistry,
  settings: PetSettings,
  now: number | Date = Date.now(),
): ResolvedPlugins {
  const settingsChanged = prunePluginSelections(settings, registry);
  const selectedAppearance = appearanceIdOf(settings);
  const appearance = registry.appearance(selectedAppearance ?? undefined);
  const catalog = appearance ? applyAppearance(baseCatalog, appearance.spec) : baseCatalog;

  // Pick the first seasonal skin that is in date range and not switched off.
  const enabled = settings.plugins.enabled;
  const activeFestival = registry.festivalPlugins()
    .filter(manifest => manifest.festival && enabled[manifest.id] !== false
      && festivalActive(manifest.festival.window, now))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  const festival: FestivalView | null = activeFestival?.festival
    ? {
      id: activeFestival.id,
      label: manifestLabel(activeFestival),
      ...(activeFestival.festival.window.greeting ? { greeting: activeFestival.festival.window.greeting } : {}),
      ...(activeFestival.festival.window.accent ? { accent: activeFestival.festival.window.accent } : {}),
      accessories: [...(activeFestival.festival.window.accessories ?? [])],
    }
    : null;

  const accent = festival?.accent ?? appearance?.accent;
  const theme: Theme = accent ? { accent } : {};

  const entries: PluginViewEntry[] = registry.records_().map(({ manifest, source }) => {
    const base = {
      id: manifest.id,
      kind: manifest.kind,
      label: manifestLabel(manifest),
      description: manifest.description,
      source,
      requiresTrust: manifest.requiresTrust === true,
    };
    if (manifest.kind === 'social' && manifest.social) {
      const platform = manifest.social.platform;
      const active = settings.social.platforms[platform]?.enabled === true;
      return {
        ...base,
        active,
        platform,
        reads: manifest.social.reads,
        writes: manifest.social.writes,
      };
    }
    if (manifest.kind === 'appearance') {
      const active = selectedAppearance ? manifest.id === selectedAppearance : manifest.id === 'classic-finish';
      return { ...base, active };
    }
    return {
      ...base,
      active: festival?.id === manifest.id,
      enabled: enabled[manifest.id] !== false,
    };
  });

  return {
    catalog,
    theme,
    festival,
    view: {
      appearance: appearance?.id ?? null,
      festival,
      entries,
      issues: registry.loadIssues().map(issue => `${issue.file}：${issue.error}`),
    },
    issues: registry.loadIssues().map(issue => issue.error),
    settingsChanged,
  };
}
