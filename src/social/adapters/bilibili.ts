import type { ReadContext, ReadResult, SocialAdapter, SocialItem } from '../types.ts';

const POPULAR = 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface PopularEntry {
  bvid?: unknown;
  title?: unknown;
  desc?: unknown;
  pubdate?: unknown;
  owner?: { name?: unknown };
  stat?: { view?: unknown };
}

/** Pure parser so the network shape is testable without hitting bilibili. */
export function parseBilibiliPopular(payload: unknown): SocialItem[] {
  const data = (payload as { data?: { list?: unknown } } | null)?.data;
  const list = Array.isArray(data?.list) ? data.list as PopularEntry[] : [];
  const items: SocialItem[] = [];
  for (const entry of list) {
    const bvid = typeof entry?.bvid === 'string' ? entry.bvid : '';
    const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
    if (!bvid || !title) continue;
    const view = typeof entry.stat?.view === 'number' ? entry.stat.view : undefined;
    const pubdate = typeof entry.pubdate === 'number' ? entry.pubdate * 1000 : undefined;
    items.push({
      id: bvid,
      platform: 'bilibili',
      kind: 'video',
      title,
      url: `https://www.bilibili.com/video/${bvid}`,
      ...(typeof entry.owner?.name === 'string' ? { author: entry.owner.name } : {}),
      ...(typeof entry.desc === 'string' && entry.desc.trim() ? { excerpt: entry.desc.trim().slice(0, 160) } : {}),
      ...(view !== undefined ? { hot: view } : {}),
      ...(pubdate !== undefined ? { createdAt: pubdate } : {}),
    });
  }
  return items;
}

async function getJson(context: ReadContext, url: string): Promise<unknown> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  const cookie = context.credentials.cookie;
  if (cookie) headers.Cookie = cookie;
  const response = await context.fetcher(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(context.timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

export const bilibiliAdapter: SocialAdapter = {
  id: 'bilibili',
  label: '哔哩哔哩',
  note: '公开热门接口，只读；不需要登录。',
  reads: true,
  writes: false,
  requires: 'none',
  async read(context: ReadContext): Promise<ReadResult> {
    try {
      const payload = await getJson(context, POPULAR);
      const code = (payload as { code?: unknown } | null)?.code;
      if (code !== undefined && code !== 0) return { ok: false, items: [], note: '哔哩哔哩返回了非零状态', error: `code ${String(code)}` };
      const items = parseBilibiliPopular(payload);
      return { ok: items.length > 0, items, note: items.length ? `读到 ${items.length} 条热门视频` : '没有读到热门视频' };
    } catch (error) {
      return { ok: false, items: [], note: '读取哔哩哔哩失败', error: error instanceof Error ? error.message : String(error) };
    }
  },
};
