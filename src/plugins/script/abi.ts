/**
 * The authored-code plug-in ABI (v1).
 *
 * A script plug-in is a Zig-compiled WASM *reactor* module. The host owns all
 * I/O: it passes one JSON envelope in, the plug-in returns one JSON envelope
 * out, and the host performs every network request, pet reaction and state
 * write on the plug-in's behalf. Inside the module the plug-in declares four
 * exports — `dfy_abi_version`, `dfy_alloc`, `dfy_free`, `dfy_invoke` — and may
 * import a single logging hook, `env.dfy_log`.
 *
 * This module is deliberately free of Node/Electron APIs: it is shared by the
 * worker-thread host, the compiler's post-build check and the unit tests.
 */

export const SCRIPT_ABI_VERSION = 1;

/** Exported symbol names the loader requires and the compiler verifies. */
export const REQUIRED_EXPORTS = ['dfy_abi_version', 'dfy_alloc', 'dfy_free', 'dfy_invoke'] as const;
export const LOG_IMPORT_MODULE = 'env';
export const LOG_IMPORT_NAME = 'dfy_log';

/** A finished HTTP effect the host reports back to the plug-in. */
export interface HostEffectResult {
  id: string;
  ok: boolean;
  status: number | null;
  body: string | null;
  error: string | null;
}

export type HostEvent =
  | { type: 'install' }
  | { type: 'activate' }
  | { type: 'deactivate' }
  | { type: 'tick' }
  | { type: 'command'; name: string; args: Record<string, unknown> }
  | { type: 'effect-result'; effects: HostEffectResult[] };

export interface HostConfig {
  bridgeUrl?: string;
  interests: string[];
  options: Record<string, string | number | boolean>;
  locale: string;
}

/** The single JSON document handed to `dfy_invoke`. */
export interface HostInput {
  abi: number;
  plugin: { id: string; version: string };
  event: HostEvent;
  config: HostConfig;
  state: Record<string, unknown>;
  now: number;
}

export interface HostHttpEffect {
  id: string;
  type: 'http';
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
}

export type HostPetEffect =
  | { type: 'say'; text: string }
  | { type: 'play'; clip: string }
  | { type: 'notify'; title: string; body: string };

export interface HostSchedule {
  afterMs: number;
}

export interface ScriptResponse {
  state: Record<string, unknown>;
  effects: HostHttpEffect[];
  pet: HostPetEffect[];
  status: { message: string; progress: number | null; counter: number | null } | null;
  log: string | null;
  schedule: HostSchedule | null;
  disable: boolean;
}

export const LIMITS = {
  effects: 8,
  pet: 6,
  headers: 16,
  stateBytes: 48_000,
  body: 32_000,
  log: 2_000,
  url: 2_048,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 15_000,
  minAfterMs: 500,
  maxAfterMs: 3_600_000,
  maxText: 400,
  maxTitle: 80,
  maxNotifyBody: 400,
  maxStatus: 160,
} as const;

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD']);

export type ResponseResult =
  | { ok: true; response: ScriptResponse }
  | { ok: false; error: string };

const empty = (): ScriptResponse => ({
  state: {}, effects: [], pet: [], status: null, log: null, schedule: null, disable: false,
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function parseHeaders(value: unknown): Record<string, string> | string {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) return 'headers 必须是对象';
  const headers: Record<string, string> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(record)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) return `非法的请求头名称：${key}`;
    if (typeof raw !== 'string' || raw.length > 512) return `请求头 ${key} 的值无效`;
    headers[key] = raw;
    if (++count >= LIMITS.headers) break;
  }
  return headers;
}

function parseEffect(value: unknown, index: number): HostHttpEffect | string {
  const record = asRecord(value);
  if (!record) return `effects[${index}] 必须是对象`;
  if (record.type !== 'http') return `effects[${index}].type 目前只支持 "http"`;
  const id = boundedText(record.id, 64) ?? `fx-${index}`;
  const method = typeof record.method === 'string' ? record.method.toUpperCase() : 'GET';
  if (!METHODS.has(method)) return `effects[${index}].method 无效：${String(record.method)}`;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url || url.length > LIMITS.url) return `effects[${index}].url 缺失或过长`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `effects[${index}].url 不是合法地址`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `effects[${index}].url 必须是 http(s)`;
  if (parsed.username || parsed.password) return `effects[${index}].url 不能包含凭据`;
  const headers = parseHeaders(record.headers);
  if (typeof headers === 'string') return headers;
  if (record.body !== undefined && record.body !== null) {
    if (typeof record.body !== 'string' || record.body.length > LIMITS.body) return `effects[${index}].body 过长`;
  }
  const timeout = typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs)
    ? clamp(Math.round(record.timeoutMs), LIMITS.minTimeoutMs, LIMITS.maxTimeoutMs) : 8_000;
  return {
    id,
    type: 'http',
    method,
    url,
    headers,
    body: typeof record.body === 'string' ? record.body : null,
    timeoutMs: timeout,
  };
}

function parsePet(value: unknown, index: number): HostPetEffect | string {
  const record = asRecord(value);
  if (!record) return `pet[${index}] 必须是对象`;
  if (record.type === 'say') {
    const text = boundedText(record.text, LIMITS.maxText);
    if (!text) return `pet[${index}].text 必须是非空文本`;
    return { type: 'say', text };
  }
  if (record.type === 'play') {
    const clip = boundedText(record.clip, 80);
    if (!clip) return `pet[${index}].clip 必须是非空文本`;
    return { type: 'play', clip };
  }
  if (record.type === 'notify') {
    const title = boundedText(record.title, LIMITS.maxTitle);
    const body = typeof record.body === 'string' ? record.body.slice(0, LIMITS.maxNotifyBody) : '';
    if (!title) return `pet[${index}].title 必须是非空文本`;
    return { type: 'notify', title, body };
  }
  return `pet[${index}].type 必须是 say/play/notify`;
}

/**
 * Validate and normalise a plug-in response. Anything malformed rejects the
 * whole response so a buggy plug-in cannot half-apply; the caller treats a
 * rejected response like an error and leaves state untouched.
 */
export function parseScriptResponse(raw: unknown): ResponseResult {
  const record = asRecord(raw);
  if (!record) return { ok: false, error: '插件返回的不是 JSON 对象' };
  const response = empty();

  if (record.state !== undefined) {
    const state = asRecord(record.state);
    if (!state) return { ok: false, error: 'state 必须是对象' };
    if (JSON.stringify(state).length > LIMITS.stateBytes) return { ok: false, error: 'state 过大' };
    response.state = state;
  }

  if (record.effects !== undefined) {
    if (!Array.isArray(record.effects)) return { ok: false, error: 'effects 必须是数组' };
    for (const [index, entry] of record.effects.entries()) {
      if (index >= LIMITS.effects) return { ok: false, error: `effects 最多 ${LIMITS.effects} 条` };
      const effect = parseEffect(entry, index);
      if (typeof effect === 'string') return { ok: false, error: effect };
      response.effects.push(effect);
    }
  }

  if (record.pet !== undefined) {
    if (!Array.isArray(record.pet)) return { ok: false, error: 'pet 必须是数组' };
    for (const [index, entry] of record.pet.entries()) {
      if (index >= LIMITS.pet) return { ok: false, error: `pet 最多 ${LIMITS.pet} 条` };
      const effect = parsePet(entry, index);
      if (typeof effect === 'string') return { ok: false, error: effect };
      response.pet.push(effect);
    }
  }

  if (record.status !== undefined && record.status !== null) {
    const status = asRecord(record.status);
    if (!status) return { ok: false, error: 'status 必须是对象' };
    const message = typeof status.message === 'string' ? status.message.slice(0, LIMITS.maxStatus) : '';
    const progress = typeof status.progress === 'number' && Number.isFinite(status.progress)
      ? clamp(status.progress, 0, 1) : null;
    const counter = typeof status.counter === 'number' && Number.isFinite(status.counter) ? Math.round(status.counter) : null;
    response.status = { message, progress, counter };
  }

  if (record.log !== undefined && record.log !== null) {
    if (typeof record.log !== 'string') return { ok: false, error: 'log 必须是字符串' };
    response.log = record.log.slice(0, LIMITS.log);
  }

  if (record.schedule !== undefined && record.schedule !== null) {
    const schedule = asRecord(record.schedule);
    if (!schedule) return { ok: false, error: 'schedule 必须是对象' };
    const afterMs = schedule.afterMs;
    if (typeof afterMs !== 'number' || !Number.isFinite(afterMs)) return { ok: false, error: 'schedule.afterMs 必须是数字' };
    response.schedule = { afterMs: clamp(Math.round(afterMs), LIMITS.minAfterMs, LIMITS.maxAfterMs) };
  }

  if (record.disable !== undefined) {
    if (typeof record.disable !== 'boolean') return { ok: false, error: 'disable 必须是布尔值' };
    response.disable = record.disable;
  }

  return { ok: true, response };
}

/** Build the input envelope for one invocation. */
export function buildHostInput(
  plugin: { id: string; version: string },
  event: HostEvent,
  config: HostConfig,
  state: Record<string, unknown>,
  now: number,
): HostInput {
  return { abi: SCRIPT_ABI_VERSION, plugin, event, config, state, now };
}
