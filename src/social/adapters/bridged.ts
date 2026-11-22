import type { ReadContext, ReadResult, SocialAdapter, SocialItem, SocialPlatformId, WriteRequest, WriteResult } from '../types.js';

/**
 * Douyin and Xiaoheihe expose no public read API. Rather than scraping logins,
 * the pet talks to a bridge the user runs locally and configures explicitly.
 * Contract: GET /feed?limit=20, GET /status, optional POST /message.
 */
export interface BridgeFeedEntry {
  id?: unknown;
  title?: unknown;
  author?: unknown;
  url?: unknown;
  excerpt?: unknown;
  hot?: unknown;
  createdAt?: unknown;
  kind?: unknown;
}

const KINDS = new Set(['video', 'thread', 'post', 'message']);

export function parseBridgeFeed(payload: unknown, platform: SocialPlatformId): SocialItem[] {
  const list = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  const items: SocialItem[] = [];
  for (const entry of list as BridgeFeedEntry[]) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
    if (!id || !title) continue;
    const kind = typeof entry.kind === 'string' && KINDS.has(entry.kind) ? entry.kind as SocialItem['kind'] : 'post';
    items.push({
      id,
      platform,
      kind,
      title,
      ...(typeof entry.url === 'string' && /^https:\/\//.test(entry.url) ? { url: entry.url } : {}),
      ...(typeof entry.author === 'string' ? { author: entry.author.slice(0, 80) } : {}),
      ...(typeof entry.excerpt === 'string' ? { excerpt: entry.excerpt.slice(0, 160) } : {}),
      ...(typeof entry.hot === 'number' && Number.isFinite(entry.hot) ? { hot: entry.hot } : {}),
      ...(typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? { createdAt: entry.createdAt } : {}),
    });
  }
  return items;
}

function baseUrl(context: ReadContext): string {
  return (context.bridgeUrl || '').replace(/\/+$/, '');
}

export function createBridgeAdapter(id: 'douyin' | 'xiaoheihe', label: string): SocialAdapter {
  return {
    id,
    label,
    note: '通过你本机运行的桥接服务读取；桌宠不自行登录，也不抓取凭据。',
    reads: true,
    writes: true,
    requires: 'bridge',
    async read(context: ReadContext): Promise<ReadResult> {
      const base = baseUrl(context);
      if (!base) return { ok: false, items: [], note: '需要桥接：请填写本机桥接地址' };
      try {
        const response = await context.fetcher(`${base}/feed?limit=20`, {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(context.timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const items = parseBridgeFeed(await response.json(), id);
        return { ok: items.length > 0, items, note: items.length ? `桥接返回 ${items.length} 条动态` : '桥接没有返回动态' };
      } catch (error) {
        return { ok: false, items: [], note: '桥接读取失败', error: error instanceof Error ? error.message : String(error) };
      }
    },
    async write(context: ReadContext, request: WriteRequest): Promise<WriteResult> {
      const base = baseUrl(context);
      if (!base) return { ok: false, note: '需要桥接：请填写本机桥接地址' };
      try {
        const response = await context.fetcher(`${base}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: request.target, text: request.text }),
          redirect: 'error',
          signal: AbortSignal.timeout(context.timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { ok: true, note: '桥接已接收' };
      } catch (error) {
        return { ok: false, note: '桥接发送失败', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export const douyinAdapter = createBridgeAdapter('douyin', '抖音');
export const xiaoheiheAdapter = createBridgeAdapter('xiaoheihe', '小黑盒');
