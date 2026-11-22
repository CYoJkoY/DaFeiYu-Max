import type { SocialItem } from './types.js';
import { platformLabel } from './registry.js';

const MAX_SUMMARY = 600;

function matchesInterest(item: SocialItem, interests: readonly string[]): number {
  if (!interests.length) return 0;
  const haystack = `${item.title} ${item.excerpt || ''}`.toLowerCase();
  let hits = 0;
  for (const interest of interests) {
    const needle = interest.trim().toLowerCase();
    if (needle && haystack.includes(needle)) hits++;
  }
  return hits;
}

/** Interest matches dominate, then popularity, then recency. */
export function scoreItem(item: SocialItem, interests: readonly string[], now: number): number {
  const interestScore = matchesInterest(item, interests) * 1000;
  const hot = Number.isFinite(item.hot) ? Math.log10(Math.max(1, item.hot as number)) * 20 : 0;
  const ageHours = item.createdAt && item.createdAt <= now ? (now - item.createdAt) / 3_600_000 : 0;
  const recency = Math.max(0, 24 - ageHours) * 0.5;
  return interestScore + hot + recency;
}

export function rankItems(items: readonly SocialItem[], interests: readonly string[], now: number): SocialItem[] {
  return [...items].sort((a, b) => scoreItem(b, interests, now) - scoreItem(a, interests, now));
}

export interface Digest {
  summary: string;
  bullet: string;
  highlights: string[];
}

function clip(text: string, limit: number): string {
  const chars = [...text];
  return chars.length <= limit ? text : chars.slice(0, limit - 1).join('') + '…';
}

/**
 * Turn a pile of platform items into one short, human-readable report.
 * `bullet` is what the pet shows as a single line; `summary` is the panel text.
 */
export function buildDigest(items: readonly SocialItem[], interests: readonly string[], now: number): Digest {
  const ranked = rankItems(items, interests, now);
  if (!ranked.length) {
    return { summary: '暂时没有读到新的社交动态。', bullet: '社交：暂无新动态', highlights: [] };
  }
  const platforms = [...new Set(ranked.map(item => item.platform))];
  const names = platforms.map(platformLabel).join('、');
  const top = ranked.slice(0, 3).map(item => clip(item.title, 40));
  const summary = clip(`此刻 ${names} 共 ${ranked.length} 条新动态：` +
    top.map((title, index) => `${index + 1}. ${title}`).join('；') +
    (ranked.length > top.length ? ` 等 ${ranked.length} 条。` : '。'), MAX_SUMMARY);
  const bullet = clip(`社交：${ranked.length} 条新动态 · ${clip(ranked[0].title, 24)}`, 60);
  const highlights = ranked.slice(0, 5).map(item => clip(`${platformLabel(item.platform)} · ${item.title}`, 60));
  return { summary, bullet, highlights };
}
