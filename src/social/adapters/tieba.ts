import type { ReadContext, ReadResult, SocialAdapter, SocialItem } from '../types.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, match => ENTITIES[match] ?? match);
}

/**
 * Thread titles live in `<a class="j_th_tit" href="/p/<id>">`. Keeping the
 * parser standalone means the HTML contract is pinned by a fixture test.
 */
export function parseTiebaThreads(html: string): SocialItem[] {
  const items: SocialItem[] = [];
  const seen = new Set<string>();
  // Scan anchors once so results keep the page's document order regardless of
  // which attribute comes first.
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = anchor[1];
    if (!/\bclass\s*=\s*["'][^"']*\bj_th_tit\b/i.test(attributes)) continue;
    const href = /\bhref\s*=\s*["']\/p\/(\d+)["']/i.exec(attributes);
    if (!href) continue;
    const id = href[1];
    const title = decode(anchor[2].replace(/<[^>]+>/g, '')).trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, platform: 'tieba', kind: 'thread', title, url: `https://tieba.baidu.com/p/${id}` });
  }
  return items;
}

function forumUrl(keyword: string): string {
  return `https://tieba.baidu.com/f?kw=${encodeURIComponent(keyword)}&ie=utf-8`;
}

export const tiebaAdapter: SocialAdapter = {
  id: 'tieba',
  label: '百度贴吧',
  note: '按兴趣关键词读取吧内新帖标题，只读公开页面。',
  reads: true,
  writes: false,
  requires: 'none',
  async read(context: ReadContext): Promise<ReadResult> {
    const keyword = context.interests[0]?.trim();
    if (!keyword) return { ok: false, items: [], note: '还没有设置兴趣关键词，贴吧无从读起' };
    try {
      const response = await context.fetcher(forumUrl(keyword), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        redirect: 'error',
        signal: AbortSignal.timeout(context.timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = parseTiebaThreads(await response.text());
      return { ok: items.length > 0, items, note: items.length ? `「${keyword}」吧读到 ${items.length} 个帖子` : `「${keyword}」吧没有读到帖子` };
    } catch (error) {
      return { ok: false, items: [], note: '读取贴吧失败', error: error instanceof Error ? error.message : String(error) };
    }
  },
};
