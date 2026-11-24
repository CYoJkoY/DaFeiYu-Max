/**
 * Discovers authored-code plug-ins on disk.
 *
 * A script plug-in is a directory under `<userData>/plugins/<id>/` holding a
 * `plugin.json` manifest (kind `script`) and the WASM module it names. The
 * declarative loader only reads flat `*.plugin.json` files, so directories never
 * collide with it: both tiers can live side by side in the same folder.
 *
 * Nothing here executes code. The registry only reads, validates and measures;
 * the engine decides whether and when to instantiate a module.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parsePluginManifest, type PluginManifest } from '../manifest.ts';

/** Upper bound for a module we are willing to load; keeps a bad file from eating memory. */
export const MAX_WASM_BYTES = 4 * 1024 * 1024;

/** Build harness the market index records for plug-ins built with this ABI. */
export const SCRIPT_HARNESS = 'zig-wasm32-freestanding/abi1';

export interface ScriptPluginRecord {
  id: string;
  manifest: PluginManifest;
  /** Absolute plug-in directory. */
  directory: string;
  /** Absolute path to the compiled module. */
  wasmPath: string;
  wasmBytes: number;
  /** Declared settings merged with defaults, in manifest order. */
  spec: NonNullable<PluginManifest['script']>;
  /** Where the module came from: dropped in by the user, or fetched from the market. */
  origin: 'local' | 'market';
  /** Build harness label, kept equal to the market index convention. */
  harness: string;
}

export interface ScriptLoadIssue {
  file: string;
  error: string;
}

export interface ScriptLoadOptions {
  /** Classify an installed plug-in by its market provenance, if any. */
  originOf?: (id: string) => 'local' | 'market';
}

/** Resolve `entry` inside `directory`, refusing anything that escapes it. */
function resolveEntry(directory: string, entry: string): string | null {
  if (!/^[A-Za-z0-9._-]+\.wasm$/.test(entry) || entry.startsWith('.')) return null;
  return join(directory, entry);
}

export class ScriptPluginRegistry {
  private readonly records = new Map<string, ScriptPluginRecord>();
  private readonly problems: ScriptLoadIssue[] = [];
  private originOf: ((id: string) => 'local' | 'market') | null = null;

  /** Scan one level of sub-directories for `plugin.json`; returns every problem found. */
  load(directory: string, options: ScriptLoadOptions = {}): ScriptLoadIssue[] {
    this.records.clear();
    this.originOf = options.originOf ?? null;
    this.problems.length = 0;
    if (!existsSync(directory)) return [];
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch (error) {
      this.problems.push({ file: directory, error: String(error) });
      return this.issues();
    }
    for (const name of names.sort()) {
      const candidate = join(directory, name);
      let isDirectory = false;
      try {
        isDirectory = statSync(candidate).isDirectory();
      } catch {
        continue;
      }
      if (!isDirectory) continue;
      const manifestPath = join(candidate, 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      this.loadOne(candidate, manifestPath);
    }
    return this.issues();
  }

  private loadOne(directory: string, manifestPath: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      this.problems.push({ file: manifestPath, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const result = parsePluginManifest(parsed);
    if (!result.ok) {
      this.problems.push({ file: manifestPath, error: result.error });
      return;
    }
    const manifest = result.manifest;
    if (manifest.kind !== 'script' || !manifest.script) {
      this.problems.push({ file: manifestPath, error: '脚本插件目录中的 plugin.json 必须是 kind: "script"' });
      return;
    }
    if (manifest.id !== basename(directory)) {
      this.problems.push({ file: manifestPath, error: `插件 id「${manifest.id}」必须与目录名一致` });
      return;
    }
    if (this.records.has(manifest.id)) {
      this.problems.push({ file: manifestPath, error: `脚本插件 id 重复：${manifest.id}` });
      return;
    }
    const wasmPath = resolveEntry(directory, manifest.script.entry);
    if (!wasmPath) {
      this.problems.push({ file: manifestPath, error: `entry 必须是插件目录内的 .wasm 文件名：${manifest.script.entry}` });
      return;
    }
    if (!existsSync(wasmPath)) {
      this.problems.push({ file: manifestPath, error: `找不到模块文件：${manifest.script.entry}` });
      return;
    }
    let wasmBytes = 0;
    try {
      wasmBytes = statSync(wasmPath).size;
    } catch (error) {
      this.problems.push({ file: wasmPath, error: String(error) });
      return;
    }
    if (wasmBytes === 0) {
      this.problems.push({ file: wasmPath, error: '模块文件为空' });
      return;
    }
    if (wasmBytes > MAX_WASM_BYTES) {
      this.problems.push({ file: wasmPath, error: `模块超过 ${Math.round(MAX_WASM_BYTES / 1024)} KB 上限` });
      return;
    }
    this.records.set(manifest.id, {
      id: manifest.id,
      manifest,
      directory,
      wasmPath,
      wasmBytes,
      spec: manifest.script,
      origin: this.originOf?.(manifest.id) ?? 'local',
      harness: SCRIPT_HARNESS,
    });
  }

  issues(): ScriptLoadIssue[] {
    return [...this.problems];
  }

  all(): ScriptPluginRecord[] {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): ScriptPluginRecord | undefined {
    return this.records.get(id);
  }
}
