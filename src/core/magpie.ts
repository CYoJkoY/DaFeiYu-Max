import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import type { Activity, Quota, QuotaAccount, QuotaWindow } from './types.js';

const identitySalt = randomBytes(32);
const accountKey = (provider: string, user: string): string =>
  createHmac('sha256', identitySalt).update(JSON.stringify([provider, user])).digest('hex');
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export interface MagpieOptions {
  env?: Record<string, string | undefined>;
  home?: string;
}

export function resolvePort({ env = process.env, home = homedir() }: MagpieOptions = {}): number {
  try {
    const settings = JSON.parse(readFileSync(join(env.XDG_CONFIG_HOME || join(home, '.config'), 'magpie', 'settings.json'), 'utf8'));
    if (Number.isInteger(settings.port) && settings.port > 0 && settings.port <= 65535) return settings.port;
  } catch {}
  return 3425;
}

export function resolveKey({ env = process.env }: MagpieOptions = {}): string {
  const key = typeof env.MAGPIE_API_KEY === 'string' ? env.MAGPIE_API_KEY.trim() : '';
  return /^[\x21-\x7e]{8,256}$/.test(key) ? key : 'magpie-dafeiyu';
}

export interface ReadLocalOptions {
  port?: number;
  key?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function readLocal(route: string, options: ReadLocalOptions = {}): Promise<any> {
  const {
    port = resolvePort(),
    key = resolveKey(),
    fetcher = fetch,
    timeoutMs = 5000,
    maxBytes = 2000000,
  } = options;
  const response = await fetcher(`http://127.0.0.1:${port}${route}`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': `Magpie-DaFeiYu/${version}`, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        length += value.length;
        if (length > maxBytes) throw new Error('Response too large');
        chunks.push(value);
      }
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const unknown = (): Activity => ({ state: 'unknown', label: 'Magpie 未连接或状态暂不可读', available: false, activeCount: 0, observedAt: Date.now() });
const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export function chooseActivity(data: any, now = Date.now()): Activity {
  if (data?.object !== 'concurrency' || !['requests', 'waiting', 'tools'].every(key => count(data[key]))) return unknown();
  let state = 'idle';
  let label = 'Magpie 当前没有进行中的请求';
  if (data.requests > data.waiting) { state = 'thinking'; label = 'Magpie 正在处理模型请求'; }
  else if (data.waiting > 0) { state = 'waiting'; label = 'Magpie 请求排队中'; }
  else if (data.tools > 0) { state = 'working'; label = 'Magpie 正在等待客户端工具结果'; }
  return { state, label, available: true, activeCount: data.requests, waitingCount: data.waiting,
    toolCount: data.tools, observedAt: now, scope: '本机 Magpie 网关' };
}

export interface RouteAccount { id: string; provider: string; who: string }

export class ActivityReader {
  options: ReadLocalOptions;
  traceSequence: number;
  routes: Map<number, string[]>;

  constructor(options: ReadLocalOptions = {}) {
    this.options = options;
    this.traceSequence = 0;
    this.routes = new Map();
  }

  async read(): Promise<Activity> {
    try {
      const concurrency = await readLocal('/v1/magpie/concurrency', this.options);
      const activity = chooseActivity(concurrency);
      const activeRoutes: number[] = (Array.isArray(concurrency.active) ? concurrency.active : [])
        .filter((request: any) => request.phase === 'upstream' && Number.isSafeInteger(request.route))
        .map((request: any) => request.route);
      if (!activity.available || !activeRoutes.length) return { ...activity, activeAccountIds: [] };
      try {
        const trace = await readLocal(`/v1/magpie/trace?after=${this.traceSequence}`, { ...this.options, maxBytes: 8000000 });
        if (trace.object !== 'trace' || !Array.isArray(trace.routes) || !Array.isArray(trace.ids) || !Number.isSafeInteger(trace.seq)) throw new Error('Incompatible trace');
        if (trace.seq < this.traceSequence) this.routes.clear();
        this.traceSequence = trace.seq;
        for (const route of trace.routes) this.routes.set(route.id, activeAccountsForRoute(route));
        const retained = new Set(trace.ids);
        for (const id of this.routes.keys()) if (!retained.has(id)) this.routes.delete(id);
        return { ...activity, activeAccountIds: [...new Set(activeRoutes.flatMap(id => this.routes.get(id) || []))] };
      } catch {
        this.traceSequence = 0;
        this.routes.clear();
        return { ...activity, activeAccountIds: [], accountStatusAvailable: false };
      }
    } catch {
      return unknown();
    }
  }
}

export function activeAccountsForRoute(route: any): string[] {
  if (route.done !== false || !Array.isArray(route.tries)) return [];
  const candidates: RouteAccount[] = [...(route.order || []), ...(route.left || [])];
  return route.tries.filter((attempt: any) => attempt.done === false).flatMap((attempt: any) => {
    const account = candidates.find(candidate => candidate.id === attempt.id);
    return account && typeof account.provider === 'string' && typeof account.who === 'string' && account.who
      ? [accountKey(account.provider, account.who)] : [];
  });
}

const BALANCE_PATTERN = /^(?:[¥￥$€£]\s*-?\d+(?:,\d{3})*(?:\.\d+)?|(?:CNY|USD|EUR|GBP)\s*-?\d+(?:\.\d+)?|-?\d+(?:\.\d+)?\s*(?:CNY|USD|EUR|GBP))$/;

export function normalizeCards(data: any, now = Date.now()): Quota {
  const windows: QuotaWindow[] = [];
  const accounts: QuotaAccount[] = [];
  for (const [index, card] of (Array.isArray(data?.data) ? data.data : []).entries()) {
    if (!card || typeof card !== 'object') continue;
    const accountId = accountKey(card.provider || '', card.user || `unknown-${index}`);
    const name = card.name || '订阅';
    const plan = card.plan || '账户';
    const provider = typeof card.provider === 'string' ? card.provider : '';
    const icon = typeof card.icon === 'string' ? card.icon : '';
    const stableKey = [provider, name, plan, index + 1].join('|');
    const kind: 'balance' | 'subscription' = card.kind === 'balance' ? 'balance' : 'subscription';
    const balance = typeof card.balance === 'string' && BALANCE_PATTERN.test(card.balance.trim())
      ? card.balance.trim() : null;
    const readAt = Date.parse(card.readAt);
    accounts.push({ accountId, key: `${stableKey}|balance`, provider, icon, name, plan,
      label: `${name} · ${plan} #${index + 1}`, kind,
      ...(kind === 'balance' ? { balance, readAt: Number.isFinite(readAt) ? readAt : null } : {}) });
    if (kind === 'balance') continue;
    for (const [windowIndex, window] of (Array.isArray(card.windows) ? card.windows : []).entries()) {
      if (!window || typeof window !== 'object') continue;
      if (typeof window.used !== 'number' || !Number.isFinite(window.used)) continue;
      const used = Math.max(0, Math.min(100, window.used));
      const windowReadAt = Date.parse(card.readAt);
      const reset = Date.parse(window.resetsAt);
      const windowName = window.name || '额度';
      windows.push({ accountId, key: `${stableKey}|window|${windowIndex}|${windowName}`,
        provider, icon, name, plan, windowName,
        label: `${name} · ${plan} #${index + 1} · ${windowName}`,
        used, remaining: 100 - used, resetsAt: Number.isFinite(reset) ? reset / 1000 : null,
        readAt: Number.isFinite(windowReadAt) ? windowReadAt : null,
        stale: !Number.isFinite(windowReadAt) || now - windowReadAt > 600000 });
    }
  }
  const ok = windows.length > 0 || accounts.some(account => account.kind === 'balance' && account.balance !== null);
  return { ok, windows, accounts, observedAt: now,
    error: ok ? null : 'Magpie 尚无可显示的额度或余额；请在 Magpie 中检查账户' };
}

export async function readQuota(options: ReadLocalOptions = {}): Promise<Quota> {
  try {
    const cards = await readLocal('/v1/magpie/quotas/cards', options);
    const quota = normalizeCards(cards);
    try {
      const usage = await readLocal('/v1/magpie/usage?period=today', options);
      if (count(usage.calls) && count(usage.errors)) quota.usage = { calls: usage.calls, errors: usage.errors };
    } catch {}
    return quota;
  } catch {
    return { ok: false, windows: [], observedAt: Date.now(), error: '无法读取 Magpie 额度，请确认本机 Magpie 已启动' };
  }
}
