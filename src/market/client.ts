/**
 * Downloads plug-ins from the cloud market - and nothing else.
 *
 * The market is an ordinary GitHub repository, so "publishing" is a commit and
 * "browsing" is one `index.json` fetch. Installation is the only moment the app
 * writes plug-in files, and it happens after three independent checks: the
 * manifest must parse and agree with the index, the module size must match, and
 * the module's SHA-256 must match byte for byte.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { MarketEntry, MarketIndex, MarketSettings } from '../core/types.ts';
import { parsePluginManifest } from '../plugins/manifest.ts';
import { MAX_MARKET_WASM_BYTES, parseMarketIndexText, sha256Hex } from './index.ts';

export interface MarketFetcher {
  /** Fetch a text document (bounded by the caller). */
  text(url: string): Promise<string>;
  /** Fetch raw bytes. */
  bytes(url: string): Promise<Uint8Array>;
}

export interface MarketProvenanceEntry {
  version: string;
  sha256: string;
  installedAt: number;
}

export interface MarketProvenance {
  schemaVersion: 1;
  installed: Record<string, MarketProvenanceEntry>;
}

export interface MarketRecordInfo {
  version: string;
  updateAvailable: boolean;
}

export type InstallResult =
  | { ok: true; id: string; version: string }
  | { ok: false; error: string };

export interface MarketClientOptions {
  /** `<userData>/plugins` - where installed plug-ins live. */
  directory: string;
  /** `<userData>/plugin-market.json` - provenance of market installs. */
  provenancePath: string;
  getMarket: () => MarketSettings;
  fetcher?: MarketFetcher;
  now?: () => number;
  logger?: (message: string) => void;
}

const INDEX_LIMIT = 512 * 1024;
const MANIFEST_LIMIT = 64 * 1024;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Minimal `fetch` surface the market needs; both Node and Electron `net` satisfy it. */
export type MarketFetch = (url: string, init: { redirect: 'follow' }) => Promise<Response>;

/**
 * Fetcher with hard size limits.
 *
 * The default is the runtime `fetch`. The app injects Electron's `net.fetch`
 * instead, because that one goes through Chromium's network stack and therefore
 * honours the system proxy (`raw.githubusercontent.com` is unreachable on many
 * networks without it).
 */
export function createHttpFetcher(fetchImpl: MarketFetch = (url, init) => fetch(url, init)): MarketFetcher {
  return {
    async text(url: string): Promise<string> {
      const response = await fetchImpl(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > INDEX_LIMIT) throw new Error('响应过大');
      return body;
    },
    async bytes(url: string): Promise<Uint8Array> {
      const response = await fetchImpl(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > MAX_MARKET_WASM_BYTES) throw new Error('模块超过大小上限');
      return buffer;
    },
  };
}

const rawUrl = (repo: string, ref: string, path: string): string =>
  `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;

export class MarketClient {
  private readonly options: MarketClientOptions;
  private readonly fetcher: MarketFetcher;
  private cached: MarketIndex | null = null;
  private lastError: string | null = null;

  constructor(options: MarketClientOptions) {
    this.options = options;
    this.fetcher = options.fetcher ?? createHttpFetcher();
  }

  get index(): MarketIndex | null {
    return this.cached;
  }

  get error(): string | null {
    return this.lastError;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(message: string): void {
    this.options.logger?.(message);
  }

  /** Fetch and validate `index.json`; returns the parsed index or an error. */
  async refresh(): Promise<{ ok: true; index: MarketIndex } | { ok: false; error: string }> {
    const { repo, ref } = this.options.getMarket();
    try {
      const body = await this.fetcher.text(rawUrl(repo, ref, 'index.json'));
      const parsed = parseMarketIndexText(body);
      if (!parsed.ok) {
        this.lastError = parsed.error;
        return { ok: false, error: parsed.error };
      }
      this.cached = parsed.index;
      this.lastError = null;
      return { ok: true, index: parsed.index };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `无法连接插件市场：${message}`;
      this.log(this.lastError);
      return { ok: false, error: this.lastError };
    }
  }

  provenance(): MarketProvenance {
    try {
      const parsed = JSON.parse(readFileSync(this.options.provenancePath, 'utf8'));
      const source = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
      const installedRaw = source.installed && typeof source.installed === 'object' && !Array.isArray(source.installed)
        ? source.installed as Record<string, unknown> : {};
      const installed: Record<string, MarketProvenanceEntry> = {};
      for (const [id, raw] of Object.entries(installedRaw)) {
        if (!ID_PATTERN.test(id)) continue;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const record = raw as Record<string, unknown>;
        if (typeof record.version !== 'string' || typeof record.sha256 !== 'string') continue;
        installed[id] = {
          version: record.version.slice(0, 40),
          sha256: record.sha256.slice(0, 64),
          installedAt: typeof record.installedAt === 'number' ? record.installedAt : 0,
        };
      }
      return { schemaVersion: 1, installed };
    } catch {
      return { schemaVersion: 1, installed: {} };
    }
  }

  private saveProvenance(provenance: MarketProvenance): void {
    mkdirSync(dirname(this.options.provenancePath), { recursive: true });
    const temporary = `${this.options.provenancePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(provenance, null, 2));
    renameSync(temporary, this.options.provenancePath);
  }

  /** Classify an installed directory: fetched from the market, or authored locally. */
  originOf(id: string): 'local' | 'market' {
    return this.provenance().installed[id] ? 'market' : 'local';
  }

  /** The market's record of an installed plug-in, plus whether a newer build exists. */
  marketInfo(id: string): MarketRecordInfo | null {
    const provenance = this.provenance().installed[id];
    if (!provenance) return null;
    const entry = this.cached?.plugins.find(item => item.id === id) ?? null;
    return {
      version: provenance.version,
      updateAvailable: Boolean(entry && entry.version !== provenance.version),
    };
  }

  /** Install one entry from the current index, verifying the module it receives. */
  async install(entry: MarketEntry): Promise<InstallResult> {
    if (!this.cached) return { ok: false, error: '请先刷新插件市场' };
    if (!this.cached.plugins.some(item => item.id === entry.id)) {
      return { ok: false, error: '该插件不在当前市场索引中' };
    }
    if (!ID_PATTERN.test(entry.id)) return { ok: false, error: '插件 id 不合法' };
    const { repo, ref } = this.options.getMarket();
    try {
      const manifestText = await this.fetcher.text(rawUrl(repo, ref, entry.manifest));
      if (manifestText.length > MANIFEST_LIMIT) return { ok: false, error: '插件清单过大' };
      const parsed = parsePluginManifest(JSON.parse(manifestText));
      if (!parsed.ok) return { ok: false, error: `插件清单无效：${parsed.error}` };
      if (parsed.manifest.id !== entry.id) return { ok: false, error: '插件清单 id 与索引不一致' };
      if (parsed.manifest.version !== entry.version) return { ok: false, error: '插件清单版本与索引不一致' };
      if (parsed.manifest.kind !== 'script' || !parsed.manifest.script) {
        return { ok: false, error: '插件清单必须是 kind: "script"' };
      }
      const bytes = await this.fetcher.bytes(rawUrl(repo, ref, entry.wasm));
      if (bytes.byteLength !== entry.size) return { ok: false, error: '模块大小与索引不一致' };
      if (sha256Hex(bytes) !== entry.sha256) return { ok: false, error: '模块校验失败（SHA-256 不匹配）' };
      this.writePlugin(entry, manifestText, bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`安装 ${entry.id} 失败：${message}`);
      return { ok: false, error: `安装失败：${message}` };
    }
    const provenance = this.provenance();
    provenance.installed[entry.id] = {
      version: entry.version,
      sha256: entry.sha256,
      installedAt: this.now(),
    };
    this.saveProvenance(provenance);
    return { ok: true, id: entry.id, version: entry.version };
  }

  /** Stage the manifest and module in a temp directory, then swap it into place. */
  private writePlugin(entry: MarketEntry, manifestText: string, bytes: Uint8Array): void {
    const root = resolve(this.options.directory);
    const target = resolve(root, entry.id);
    if (dirname(target) !== root) throw new Error('插件路径越界');
    const staging = resolve(root, `.staging-${entry.id}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'plugin.json'), manifestText);
    const spec = JSON.parse(manifestText) as { script: { entry: string } };
    writeFileSync(join(staging, spec.script.entry), bytes);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  }

  /** Remove an installed market plug-in: directory first, provenance second. */
  uninstall(id: string): { ok: boolean; error?: string } {
    if (!ID_PATTERN.test(id)) return { ok: false, error: '插件 id 不合法' };
    const root = resolve(this.options.directory);
    const target = resolve(root, id);
    if (dirname(target) !== root) return { ok: false, error: '插件路径越界' };
    try {
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const provenance = this.provenance();
    if (provenance.installed[id]) {
      delete provenance.installed[id];
      this.saveProvenance(provenance);
    }
    return { ok: true };
  }
}
