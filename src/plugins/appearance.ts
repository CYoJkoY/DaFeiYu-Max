import type { Catalog } from '../core/types.ts';
import type { AppearancePluginSpec } from './manifest.ts';

/**
 * Merge a declarative appearance patch over a catalog, keeping only clip names
 * that already exist in the shipped catalog. A plugin can never introduce
 * footage the app does not own, so the renderer's "only play known clips"
 * invariant survives.
 */
export function applyAppearance(catalog: Catalog, spec: AppearancePluginSpec): Catalog {
  const known = new Set(catalog.names);
  const keep = (names: readonly string[] | undefined): string[] | undefined => {
    if (!names) return undefined;
    const filtered = names.filter(name => known.has(name));
    return filtered.length ? filtered : undefined;
  };

  const idle = keep(spec.idle) ?? catalog.idle;
  const states: Record<string, string[]> = { ...catalog.states };
  if (spec.states) {
    for (const [state, pool] of Object.entries(spec.states)) {
      const filtered = keep(pool);
      if (filtered) states[state] = filtered;
    }
  }

  const categories = [...catalog.categories];
  if (spec.categories) {
    const existing = new Set(categories.map(category => category.id));
    for (const category of spec.categories) {
      const actions = keep(category.actions);
      if (!actions || existing.has(category.id)) continue;
      existing.add(category.id);
      categories.push({
        id: category.id,
        weight: category.weight,
        ...(category.noMirror ? { noMirror: true } : {}),
        actions,
      });
    }
  }

  return { ...catalog, idle, states, categories };
}
