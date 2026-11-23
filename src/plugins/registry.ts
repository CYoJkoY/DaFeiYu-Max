import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  manifestLabel,
  parsePluginManifest,
  type PluginKind,
  type PluginManifest,
} from './manifest.ts';
import { builtinPlugins } from './builtin.ts';
import { festivalActive } from './calendar.ts';

export interface PluginRecord {
  manifest: PluginManifest;
  source: 'builtin' | 'external';
}

export interface PluginLoadIssue {
  file: string;
  error: string;
}

export interface AppearanceSelection {
  id: string;
  label: string;
  accent?: string;
  spec: NonNullable<PluginManifest['appearance']>;
}

export interface FestivalSelection {
  id: string;
  label: string;
  greeting?: string;
  accent?: string;
  accessories: string[];
}

/**
 * Holds every known plugin. Built-ins are always present; external plugins are
 * declarative JSON manifests dropped into `<userData>/plugins`. Nothing here
 * executes third-party code — the registry only validates data.
 */
export class PluginRegistry {
  private readonly records = new Map<string, PluginRecord>();
  private readonly issues: PluginLoadIssue[] = [];

  constructor(builtins: readonly PluginManifest[] = builtinPlugins()) {
    for (const manifest of builtins) this.register({ manifest, source: 'builtin' });
  }

  /** Register one manifest; rejects duplicates and id collisions across kinds. */
  register(record: PluginRecord): boolean {
    if (this.records.has(record.manifest.id)) return false;
    this.records.set(record.manifest.id, record);
    return true;
  }

  /** Load `<dir>/*.plugin.json` as data. Invalid files are skipped. */
  loadDirectory(directory: string): PluginLoadIssue[] {
    this.issues.length = 0;
    if (!existsSync(directory)) return [];
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch (error) {
      this.issues.push({ file: directory, error: String(error) });
      return [...this.issues];
    }
    for (const name of names.sort()) {
      if (!name.endsWith('.plugin.json')) continue;
      const file = join(directory, name);
      try {
        const result = parsePluginManifest(JSON.parse(readFileSync(file, 'utf8')));
        if (!result.ok) {
          this.issues.push({ file, error: result.error });
          continue;
        }
        if (!this.register({ manifest: result.manifest, source: 'external' })) {
          this.issues.push({ file, error: `插件 id 重复：${result.manifest.id}` });
        }
      } catch (error) {
        this.issues.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return [...this.issues];
  }

  loadIssues(): PluginLoadIssue[] {
    return [...this.issues];
  }

  all(): PluginManifest[] {
    return [...this.records.values()].map(record => record.manifest);
  }

  records_(): PluginRecord[] {
    return [...this.records.values()];
  }

  get(id: string): PluginRecord | undefined {
    return this.records.get(id);
  }

  byKind(kind: PluginKind): PluginManifest[] {
    return this.all().filter(manifest => manifest.kind === kind);
  }

  socialPlugins(): PluginManifest[] {
    return this.byKind('social');
  }

  appearancePlugins(): PluginManifest[] {
    return this.byKind('appearance');
  }

  festivalPlugins(): PluginManifest[] {
    return this.byKind('festival');
  }

  appearance(id?: string): AppearanceSelection | null {
    const chosen = id ? this.records.get(id) : undefined;
    const manifest = chosen?.manifest.kind === 'appearance' ? chosen.manifest
      : this.appearancePlugins().find(entry => entry.id === 'classic-finish') ?? this.appearancePlugins()[0];
    if (!manifest?.appearance) return null;
    return {
      id: manifest.id,
      label: manifestLabel(manifest),
      ...(manifest.appearance.accent ? { accent: manifest.appearance.accent } : {}),
      spec: manifest.appearance,
    };
  }

  /** A selection is usable only when it names a loaded appearance plug-in. */
  hasAppearance(id: string): boolean {
    const record = this.records.get(id);
    return record?.manifest.kind === 'appearance' && Boolean(record.manifest.appearance);
  }

  /** Seasonal toggles only apply to loaded festival plug-ins. */
  hasFestival(id: string): boolean {
    const record = this.records.get(id);
    return record?.manifest.kind === 'festival' && Boolean(record.manifest.festival);
  }

  /** The active festival, if one is in date range. */
  festival(now: number | Date = Date.now()): FestivalSelection | null {
    const manifest = this.festivalPlugins()
      .filter(entry => entry.festival && festivalActive(entry.festival.window, now))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!manifest?.festival) return null;
    return {
      id: manifest.id,
      label: manifestLabel(manifest),
      ...(manifest.festival.window.greeting ? { greeting: manifest.festival.window.greeting } : {}),
      ...(manifest.festival.window.accent ? { accent: manifest.festival.window.accent } : {}),
      accessories: [...(manifest.festival.window.accessories ?? [])],
    };
  }
}
