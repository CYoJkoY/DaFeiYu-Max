/**
 * The cloud market index: a small, fully validated JSON document.
 *
 * The market is a separate repository (`DaFeiYu-Max-Plugins`) served straight
 * from `raw.githubusercontent.com`. We never trust it: every field is bounded,
 * every path must stay inside the repository, and the module itself is checked
 * against a recorded SHA-256 before it is allowed on disk.
 */
import { createHash } from 'node:crypto';
import type { MarketEntry, MarketIndex } from '../core/types.ts';

export const MARKET_SCHEMA_VERSION = 1;
const PERMISSIONS = new Set(['pet', 'bridge', 'net']);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PLUGINS = 500;
export const MAX_MARKET_WASM_BYTES = 4 * 1024 * 1024;

export type IndexResult =
  | { ok: true; index: MarketIndex }
  | { ok: false; error: string };

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  return text(value, max) ?? undefined;
}

/** Repository-relative path: no absolute paths, no `..`, no scheme, forward slashes only. */
export function sanitizeRelativePath(value: unknown): string | null {
  const raw = text(value, 200);
  if (!raw) return null;
  if (raw.includes('\\') || raw.startsWith('/') || raw.includes('..')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
  const segments = raw.split('/');
  if (segments.some(segment => !segment || !/^[A-Za-z0-9._-]+$/.test(segment))) return null;
  return raw;
}

function parseEntry(value: unknown, index: number): MarketEntry | string {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  if (!record) return `plugins[${index}] 必须是对象`;
  const where = `plugins[${index}]`;
  const id = text(record.id, 64);
  if (!id || !ID_PATTERN.test(id)) return `${where}.id 必须是小写 kebab-case`;
  if (record.kind !== 'script') return `${where}.kind 目前只支持 "script"`;
  const version = text(record.version, 40);
  if (!version || !VERSION_PATTERN.test(version)) return `${where}.version 必须是 x.y.z`;
  const name = text(record.name, 80);
  if (!name) return `${where}.name 无效`;
  const description = text(record.description, 240);
  if (!description) return `${where}.description 无效`;
  const author = text(record.author, 80);
  if (!author) return `${where}.author 无效`;
  const harness = text(record.harness, 64);
  if (!harness) return `${where}.harness 无效`;
  const sha256 = text(record.sha256, 64);
  if (!sha256 || !SHA256_PATTERN.test(sha256)) return `${where}.sha256 必须是 64 位小写十六进制`;
  if (typeof record.size !== 'number' || !Number.isFinite(record.size)
    || record.size <= 0 || record.size > MAX_MARKET_WASM_BYTES) {
    return `${where}.size 超出范围`;
  }
  const manifest = sanitizeRelativePath(record.manifest);
  if (!manifest) return `${where}.manifest 必须指向仓库内的文件`;
  const wasm = sanitizeRelativePath(record.wasm);
  if (!wasm) return `${where}.wasm 必须指向仓库内的文件`;

  if (!Array.isArray(record.permissions) || record.permissions.length === 0) {
    return `${where}.permissions 不能为空`;
  }
  const permissions: string[] = [];
  for (const raw of record.permissions) {
    if (typeof raw !== 'string' || !PERMISSIONS.has(raw)) return `${where}.permissions 含未知权限`;
    if (!permissions.includes(raw)) permissions.push(raw);
  }

  const tags: string[] = [];
  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags)) return `${where}.tags 必须是数组`;
    for (const tag of record.tags) {
      const value = text(tag, 32);
      if (value && !tags.includes(value) && tags.length < 12) tags.push(value);
    }
  }

  const labels: { zh?: string; en?: string } = {};
  if (record.labels && typeof record.labels === 'object' && !Array.isArray(record.labels)) {
    const source = record.labels as Record<string, unknown>;
    const zh = optionalText(source.zh, 80);
    const en = optionalText(source.en, 80);
    if (zh) labels.zh = zh;
    if (en) labels.en = en;
  }

  const entry: MarketEntry = {
    id, version, kind: 'script', name, description, author, tags, permissions, harness,
    size: Math.round(record.size), sha256, manifest, wasm,
  };
  if (Object.keys(labels).length) entry.labels = labels;
  const homepage = optionalText(record.homepage, 300);
  if (homepage && /^https:\/\//i.test(homepage)) entry.homepage = homepage;
  const source = optionalText(record.source, 200);
  if (source) entry.source = source;
  return entry;
}

/** Validate a whole `index.json`; a single bad entry rejects the index. */
export function parseMarketIndex(raw: unknown): IndexResult {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
  if (!record) return { ok: false, error: '市场索引不是 JSON 对象' };
  if (record.schemaVersion !== MARKET_SCHEMA_VERSION) {
    return { ok: false, error: `市场索引版本必须是 ${MARKET_SCHEMA_VERSION}` };
  }
  const generatedAt = text(record.generatedAt, 40);
  if (!generatedAt) return { ok: false, error: '市场索引缺少 generatedAt' };
  if (!Array.isArray(record.plugins)) return { ok: false, error: '市场索引缺少 plugins 数组' };
  if (record.plugins.length > MAX_PLUGINS) return { ok: false, error: '市场索引条目过多' };
  const plugins: MarketEntry[] = [];
  const seen = new Set<string>();
  for (const [index, item] of record.plugins.entries()) {
    const entry = parseEntry(item, index);
    if (typeof entry === 'string') return { ok: false, error: entry };
    if (seen.has(entry.id)) return { ok: false, error: `市场索引中 id 重复：${entry.id}` };
    seen.add(entry.id);
    plugins.push(entry);
  }
  return { ok: true, index: { schemaVersion: MARKET_SCHEMA_VERSION, generatedAt, plugins } };
}

/** Lowercase hex SHA-256 of a byte buffer. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Parse an index document from raw text, mapping JSON errors to a message. */
export function parseMarketIndexText(raw: string): IndexResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `市场索引不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
  }
  return parseMarketIndex(parsed);
}
