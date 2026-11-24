/**
 * Runs authored-code plug-ins and brokers everything they can touch.
 *
 * The engine is the only place that knows about both settings and WASM. A
 * plug-in never reaches the network, the pet or the disk by itself: it returns
 * a JSON response describing intents, and this module decides whether each
 * intent is permitted, performs it, and persists the plug-in's state.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  InstalledScriptPlugin, PluginViewEntry, ScriptPluginSelection, ScriptRuntimeStatus,
  ScriptSettingField,
} from '../../core/types.ts';
import {
  LIMITS, buildHostInput, parseScriptResponse,
  type HostConfig, type HostEffectResult, type HostEvent, type HostHttpEffect, type HostPetEffect,
  type ScriptResponse,
} from './abi.ts';
import type { InvokerFactory, ScriptInvoker } from './invoker.ts';
import { ScriptPluginRegistry, type ScriptPluginRecord } from './registry.ts';

const MAX_EFFECT_ROUNDS = 4;

interface LoadedScript {
  record: ScriptPluginRecord;
  invoker: ScriptInvoker | null;
  state: Record<string, unknown>;
  status: ScriptRuntimeStatus;
  timer: NodeJS.Timeout | null;
  installedThisSession: boolean;
}

export interface ScriptMarketInfo {
  version: string;
  updateAvailable: boolean;
}

export interface ScriptEngineOptions {
  /** `<userData>/plugins` — one directory per plug-in. */
  directory: string;
  /** `<userData>/plugin-state` — one JSON file per plug-in. */
  stateDirectory: string;
  locale: string;
  getInterests: () => string[];
  /** The social bridge URL, when one is configured; handed to plug-ins as `config.bridgeUrl`. */
  getBridgeUrl?: () => string | undefined;
  getScripts: () => Record<string, ScriptPluginSelection>;
  /** Persist a mutation of `settings.plugins.scripts` (the engine never writes settings itself). */
  patchScripts?: (mutate: (scripts: Record<string, ScriptPluginSelection>) => void) => void;
  invokerFactory: InvokerFactory;
  onPet?: (effect: HostPetEffect) => void;
  onStatus?: () => void;
  logger?: (message: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  marketInfo?: (id: string) => ScriptMarketInfo | null;
  /** Classify a plug-in directory as locally authored or market-installed. */
  originOf?: (id: string) => 'local' | 'market';
}

function emptyStatus(id: string, commands: string[]): ScriptRuntimeStatus {
  return {
    id, running: false, message: '未运行', progress: null, counter: null,
    lastRunAt: null, lastError: null, invocations: 0, commands: [...commands],
  };
}

/** Coerce a stored option to the type its field declares; drop anything else. */
function coerceOption(field: ScriptSettingField, value: unknown): string | number | boolean | undefined {
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const low = field.min ?? Number.NEGATIVE_INFINITY;
    const high = field.max ?? Number.POSITIVE_INFINITY;
    return Math.min(high, Math.max(low, value));
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length > 300) return undefined;
  if (field.type === 'url' && text && !/^https?:\/\//i.test(text)) return undefined;
  return text;
}

export class ScriptEngine {
  private readonly options: ScriptEngineOptions;
  private readonly registry = new ScriptPluginRegistry();
  private readonly loaded = new Map<string, LoadedScript>();
  private readonly issues: string[] = [];

  constructor(options: ScriptEngineOptions) {
    this.options = options;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(message: string): void {
    this.options.logger?.(message);
  }

  /** Rescan the plug-in directory and reconcile in-memory state with disk. */
  reload(): void {
    const problems = this.registry.load(this.options.directory, { originOf: this.options.originOf });
    this.issues.length = 0;
    for (const issue of problems) {
      const text = `${issue.file}：${issue.error}`;
      this.issues.push(text);
      this.log(text);
    }
    const present = new Set<string>();
    for (const record of this.registry.all()) {
      present.add(record.id);
      const existing = this.loaded.get(record.id);
      if (existing) {
        existing.record = record;
        continue;
      }
      this.loaded.set(record.id, {
        record,
        invoker: null,
        state: this.readState(record.id),
        status: emptyStatus(record.id, record.spec.commands ?? []),
        timer: null,
        installedThisSession: false,
      });
    }
    for (const [id, script] of [...this.loaded]) {
      if (present.has(id)) continue;
      this.stopScript(script);
      this.loaded.delete(id);
    }
  }

  issuesReport(): string[] {
    return [...this.issues];
  }

  /**
   * Forget a plug-in that has been removed from disk: stop it, delete its state
   * file and drop its stored options, so a reinstall starts from defaults.
   */
  forget(id: string): void {
    const script = this.loaded.get(id);
    if (script) {
      this.stopScript(script);
      this.loaded.delete(id);
    }
    try {
      const path = this.statePath(id);
      if (existsSync(path)) rmSync(path, { force: true });
    } catch (error) {
      this.log(`[${id}] 状态删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
    this.options.patchScripts?.(scripts => {
      if (id in scripts) delete scripts[id];
    });
    this.emitStatus();
  }

  /** Install (once) and activate every enabled plug-in. */
  async start(): Promise<void> {
    for (const script of this.loaded.values()) {
      if (!this.isEnabled(script.record.id)) continue;
      await this.bringUp(script);
    }
  }

  stop(): void {
    for (const script of this.loaded.values()) this.stopScript(script);
  }

  private stopScript(script: LoadedScript): void {
    if (script.timer) {
      clearTimeout(script.timer);
      script.timer = null;
    }
    if (script.status.running && this.isEnabled(script.record.id)) {
      void this.invokeQuietly(script, { type: 'deactivate' });
    }
    script.invoker?.close();
    script.invoker = null;
    script.status.running = false;
    script.installedThisSession = false;
  }

  private isEnabled(id: string): boolean {
    return this.options.getScripts()[id]?.enabled === true;
  }

  private async bringUp(script: LoadedScript): Promise<void> {
    if (!script.installedThisSession) {
      const ok = await this.invokeQuietly(script, { type: 'install' });
      if (!ok) return;
      script.installedThisSession = true;
    }
    await this.invokeQuietly(script, { type: 'activate' });
  }

  /** Turn a plug-in on or off, persisting the choice through the settings hook. */
  setEnabled(id: string, enabled: boolean): boolean {
    const script = this.loaded.get(id);
    if (!script) return false;
    this.options.patchScripts?.(scripts => {
      const current = scripts[id] ?? { enabled: false, options: {} };
      scripts[id] = { enabled, options: current.options };
    });
    if (enabled) {
      void this.bringUp(script);
    } else {
      if (script.timer) {
        clearTimeout(script.timer);
        script.timer = null;
      }
      void this.invokeQuietly(script, { type: 'deactivate' }).then(() => {
        script.status.running = false;
        this.emitStatus();
      });
    }
    this.emitStatus();
    return true;
  }

  setOption(id: string, key: string, value: unknown): boolean {
    const script = this.loaded.get(id);
    if (!script) return false;
    const field = (script.record.spec.settings ?? []).find(item => item.id === key);
    if (!field) return false;
    const coerced = coerceOption(field, value);
    if (coerced === undefined) return false;
    this.options.patchScripts?.(scripts => {
      const current = scripts[id] ?? { enabled: false, options: {} };
      scripts[id] = { enabled: current.enabled, options: { ...current.options, [key]: coerced } };
    });
    this.emitStatus();
    return true;
  }

  /** Deliver a user-initiated command to a running plug-in. */
  command(id: string, name: string): boolean {
    const script = this.loaded.get(id);
    if (!script) return false;
    // A disabled plug-in must stay quiet: a command would otherwise restart it
    // and re-arm its timer behind the panel's back.
    if (!this.isEnabled(id)) return false;
    if (!(script.record.spec.commands ?? []).includes(name)) return false;
    void this.dispatch(id, { type: 'command', name, args: {} });
    return true;
  }

  private resolveOptions(record: ScriptPluginRecord): Record<string, string | number | boolean> {
    const saved = this.options.getScripts()[record.id]?.options ?? {};
    const resolved: Record<string, string | number | boolean> = {};
    for (const field of record.spec.settings ?? []) {
      const value = coerceOption(field, saved[field.id] ?? field.default);
      if (value !== undefined) resolved[field.id] = value;
      else if (field.default !== undefined) resolved[field.id] = field.default;
    }
    return resolved;
  }

  private buildConfig(record: ScriptPluginRecord): HostConfig {
    const bridgeUrl = this.options.getBridgeUrl?.();
    return {
      ...(bridgeUrl ? { bridgeUrl } : {}),
      interests: this.options.getInterests(),
      options: this.resolveOptions(record),
      locale: this.options.locale,
    };
  }

  private ensureInvoker(script: LoadedScript): ScriptInvoker {
    if (!script.invoker) script.invoker = this.options.invokerFactory(script.record.wasmPath);
    return script.invoker;
  }

  private async invokeQuietly(script: LoadedScript, event: HostEvent): Promise<boolean> {
    try {
      await this.dispatch(script.record.id, event);
      return true;
    } catch {
      return false;
    }
  }

  /** One event round-trip: build input, invoke, validate, then apply the response. */
  private async dispatch(id: string, event: HostEvent, round = 0): Promise<void> {
    const script = this.loaded.get(id);
    if (!script) return;
    // Ticks and stray effect results can still arrive right after a disable.
    if (event.type !== 'deactivate' && !this.isEnabled(id)) return;
    const input = buildHostInput(
      { id, version: script.record.manifest.version },
      event,
      this.buildConfig(script.record),
      script.state,
      this.now(),
    );
    let output: string;
    let logs: string[];
    try {
      const result = await this.ensureInvoker(script).invoke(JSON.stringify(input));
      output = result.output;
      logs = result.logs;
    } catch (error) {
      script.invoker?.close();
      script.invoker = null;
      this.markFailure(script, error);
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      this.markFailure(script, new Error('插件返回的不是合法 JSON'));
      throw new Error('插件返回的不是合法 JSON');
    }
    const result = parseScriptResponse(parsed);
    if (!result.ok) {
      this.markFailure(script, new Error(result.error));
      throw new Error(result.error);
    }
    for (const line of logs) this.log(`[${id}] ${line}`);
    await this.apply(script, result.response, round);
  }

  private markFailure(script: LoadedScript, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    script.status.running = false;
    script.status.lastError = message.slice(0, 240);
    script.status.message = '已停止';
    this.log(`[${script.record.id}] ${message}`);
    this.emitStatus();
  }

  private async apply(script: LoadedScript, response: ScriptResponse, round: number): Promise<void> {
    const record = script.record;
    const enabled = this.isEnabled(record.id);
    script.status.invocations += 1;
    script.status.lastRunAt = this.now();
    script.status.lastError = null;
    script.status.running = enabled;
    script.state = response.state;
    this.writeState(record.id, response.state);
    if (response.status) {
      script.status.message = response.status.message || script.status.message;
      script.status.progress = response.status.progress;
      script.status.counter = response.status.counter;
    }
    if (response.log) this.log(`[${record.id}] ${response.log}`);

    const permissions = new Set(record.spec.permissions);
    if (enabled && response.pet.length) {
      if (!permissions.has('pet')) {
        this.log(`[${record.id}] 未声明 pet 权限，已忽略 ${response.pet.length} 条桌宠指令`);
      } else {
        for (const effect of response.pet) this.options.onPet?.(effect);
      }
    }

    if (enabled && response.effects.length) {
      const results = await this.performEffects(script, response.effects, round);
      if (results.length) {
        await this.dispatchSafely(record.id, { type: 'effect-result', effects: results }, round + 1);
      }
    }

    if (response.schedule && enabled) {
      if (script.timer) clearTimeout(script.timer);
      const delay = Math.min(Math.max(response.schedule.afterMs, LIMITS.minAfterMs), LIMITS.maxAfterMs);
      script.timer = setTimeout(() => {
        script.timer = null;
        void this.dispatchSafely(record.id, { type: 'tick' }, 0);
      }, delay);
      script.timer.unref?.();
    }

    if (response.disable) {
      if (script.timer) {
        clearTimeout(script.timer);
        script.timer = null;
      }
      script.status.running = false;
      script.status.message = script.status.message || '已自动停用';
      this.options.patchScripts?.(scripts => {
        const current = scripts[record.id] ?? { enabled: false, options: {} };
        scripts[record.id] = { enabled: false, options: current.options };
      });
    }
    this.emitStatus();
  }

  private async dispatchSafely(id: string, event: HostEvent, round: number): Promise<void> {
    try {
      await this.dispatch(id, event, round);
    } catch {
      /* failures are already recorded on the plug-in status */
    }
  }

  /** Perform HTTP effects the plug-in asked for, subject to its permissions. */
  private async performEffects(
    script: LoadedScript, effects: HostHttpEffect[], round: number,
  ): Promise<HostEffectResult[]> {
    if (round >= MAX_EFFECT_ROUNDS) {
      this.log(`[${script.record.id}] 事件链超过 ${MAX_EFFECT_ROUNDS} 轮，已丢弃后续请求`);
      return [];
    }
    const allowed = this.allowedOrigins(script.record);
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const results: HostEffectResult[] = [];
    for (const effect of effects) {
      const refusal = this.checkUrl(script.record, effect.url, allowed);
      if (refusal) {
        results.push({ id: effect.id, ok: false, status: null, body: null, error: refusal });
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), effect.timeoutMs);
        let response: Response;
        try {
          response = await fetchImpl(effect.url, {
            method: effect.method,
            headers: effect.headers,
            signal: controller.signal,
            ...(effect.body === null ? {} : { body: effect.body }),
          });
        } finally {
          clearTimeout(timer);
        }
        const text = (await response.text()).slice(0, LIMITS.body);
        results.push({ id: effect.id, ok: response.ok, status: response.status, body: text, error: null });
      } catch (error) {
        results.push({
          id: effect.id, ok: false, status: null, body: null,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        });
      }
    }
    return results;
  }

  /** Origins reachable via the `bridge` permission: the plugin's own URL options. */
  private allowedOrigins(record: ScriptPluginRecord): Set<string> {
    const origins = new Set<string>();
    if (!record.spec.permissions.includes('bridge')) return origins;
    const values = this.resolveOptions(record);
    for (const field of record.spec.settings ?? []) {
      if (field.type !== 'url') continue;
      const value = values[field.id];
      if (typeof value !== 'string' || !value) continue;
      try {
        origins.add(new URL(value).origin);
      } catch {
        /* invalid saved URL: ignore */
      }
    }
    return origins;
  }

  private checkUrl(record: ScriptPluginRecord, raw: string, allowed: Set<string>): string | null {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return '请求地址不合法';
    }
    if (allowed.has(url.origin)) return null;
    if (!record.spec.permissions.includes('net')) return '未授权访问该地址（缺少 bridge 或 net 权限）';
    if (url.protocol !== 'https:') return 'net 权限只允许 https';
    const host = url.hostname.toLowerCase();
    const hosts = record.spec.allowHosts ?? [];
    const covered = hosts.some(pattern => {
      const rule = pattern.toLowerCase();
      if (rule.startsWith('*.')) return host === rule.slice(2) || host.endsWith(rule.slice(1));
      return host === rule;
    });
    return covered ? null : `未授权访问 ${host}（不在 allowHosts 内）`;
  }

  private statePath(id: string): string {
    return join(this.options.stateDirectory, `${id}.json`);
  }

  private readState(id: string): Record<string, unknown> {
    try {
      const path = this.statePath(id);
      if (!existsSync(path)) return {};
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  private writeState(id: string, state: Record<string, unknown>): void {
    try {
      mkdirSync(this.options.stateDirectory, { recursive: true });
      const path = this.statePath(id);
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, JSON.stringify(state));
      renameSync(temporary, path);
    } catch (error) {
      this.log(`[${id}] 状态写入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private emitStatus(): void {
    this.options.onStatus?.();
  }

  installed(): InstalledScriptPlugin[] {
    const scripts = this.options.getScripts();
    const result: InstalledScriptPlugin[] = [];
    for (const [id, script] of this.loaded) {
      const selection = scripts[id];
      const market = this.options.marketInfo?.(id) ?? null;
      result.push({
        id,
        name: script.record.manifest.name,
        version: script.record.manifest.version,
        description: script.record.manifest.description,
        permissions: [...script.record.spec.permissions],
        settings: [...(script.record.spec.settings ?? [])],
        enabled: selection?.enabled === true,
        options: this.resolveOptions(script.record),
        origin: script.record.origin,
        marketVersion: market?.version ?? null,
        updateAvailable: market?.updateAvailable === true,
        status: { ...script.status, commands: [...script.status.commands] },
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  viewEntries(): PluginViewEntry[] {
    const scripts = this.options.getScripts();
    return this.installed().map(item => {
      const script = this.loaded.get(item.id)!;
      const entry: PluginViewEntry = {
        id: item.id,
        kind: 'script',
        label: item.name,
        description: item.description,
        source: 'external',
        active: item.enabled && item.status.running,
        enabled: item.enabled,
        requiresTrust: script.record.manifest.requiresTrust === true,
        script: {
          abi: script.record.spec.abi,
          permissions: [...script.record.spec.permissions],
          ...(script.record.spec.allowHosts ? { allowHosts: [...script.record.spec.allowHosts] } : {}),
          wasmBytes: script.record.wasmBytes,
          source: script.record.origin,
          harness: script.record.harness,
          settings: [...(script.record.spec.settings ?? [])],
        },
        status: { ...item.status },
      };
      return entry;
    });
  }

  /** The plug-in's last-run status, for the renderer's activity line. */
  status(id: string): ScriptRuntimeStatus | null {
    const script = this.loaded.get(id);
    return script ? { ...script.status } : null;
  }

  setState(id: string, state: Record<string, unknown>): void {
    const script = this.loaded.get(id);
    if (!script) return;
    script.state = state;
    this.writeState(id, state);
  }

  scripts(): { id: string; enabled: boolean }[] {
    return [...this.loaded.values()].map(script => ({
      id: script.record.id,
      enabled: this.isEnabled(script.record.id),
    }));
  }
}
