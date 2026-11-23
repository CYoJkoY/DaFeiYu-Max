import type { SocialPlatformId } from './types.ts';

/** Hard ceiling on automatic writes, regardless of what the UI asks for. */
export const WRITE_LIMITS = { perMinute: 1, perDay: 20, maxLength: 280 } as const;

const TARGET_PATTERNS: Record<SocialPlatformId, RegExp[]> = {
  bilibili: [/^BV[0-9A-Za-z]{10}$/, /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}/],
  tieba: [/^https:\/\/tieba\.baidu\.com\/p\/\d+/, /^https:\/\/tieba\.baidu\.com\/f\?kw=/],
  douyin: [/^https:\/\/(www\.)?douyin\.com\/(video|user)\/[^\s]+$/, /^bridge:\/message$/],
  xiaoheihe: [/^https:\/\/(www\.)?xiaoheihe\.cn\/[^\s]*$/, /^bridge:\/message$/],
};

/** Strip control characters, collapse whitespace and trim to the length limit. */
export function sanitizeText(raw: unknown, max: number = WRITE_LIMITS.maxLength): string {
  if (typeof raw !== 'string') return '';
  const clean = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/@(everyone|all)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...clean].slice(0, max).join('');
}

/** Quiet hours may wrap midnight (23 → 7). */
export function inQuietHours(hour: number, quiet: { start: number; end: number } | undefined): boolean {
  if (!quiet) return false;
  if (quiet.start === quiet.end) return false;
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

export function isAllowedTarget(platform: string, target: unknown): boolean {
  if (typeof target !== 'string' || !target || target.length > 300) return false;
  const patterns = TARGET_PATTERNS[platform as SocialPlatformId];
  if (!patterns) return false;
  return patterns.some(pattern => pattern.test(target));
}

export interface PolicyInput {
  platform: string;
  target: unknown;
  text: unknown;
  now: number;
  allowWrites: boolean;
  quietHours?: { start: number; end: number } | undefined;
  /** Timestamps (ms) of writes already sent in the last 24h. */
  recentWrites?: readonly number[];
  /** Dedupe keys already used. */
  recentKeys?: readonly string[];
}

export interface PolicyVerdict {
  allowed: boolean;
  reason: string;
  text: string;
  key: string;
}

export function dedupeKey(platform: string, target: string, text: string): string {
  return `${platform}\u0000${target}\u0000${text}`;
}

/** Single gate every outbound write passes through. Pure and fully testable. */
export function evaluateWrite(input: PolicyInput): PolicyVerdict {
  const text = sanitizeText(input.text);
  const target = typeof input.target === 'string' ? input.target : '';
  const key = dedupeKey(input.platform, target, text);
  const deny = (reason: string): PolicyVerdict => ({ allowed: false, reason, text, key });
  if (!input.allowWrites) return deny('写入未开启：请在面板里手动打开“允许写入”');
  if (!text) return deny('草稿内容为空');
  if (!isAllowedTarget(input.platform, target)) return deny('目标地址不在该平台白名单内');
  if (inQuietHours(new Date(input.now).getHours(), input.quietHours)) return deny('当前处于安静时段');
  const recent = input.recentWrites || [];
  const dayAgo = input.now - 24 * 3600 * 1000;
  const lastDay = recent.filter(at => at > dayAgo && at <= input.now);
  if (lastDay.length >= WRITE_LIMITS.perDay) return deny(`24 小时内已达 ${WRITE_LIMITS.perDay} 条上限`);
  const lastMinute = recent.filter(at => at > input.now - 60 * 1000 && at <= input.now);
  if (lastMinute.length >= WRITE_LIMITS.perMinute) return deny('每分钟最多 1 条，请稍后再试');
  if ((input.recentKeys || []).includes(key)) return deny('这条草稿已经发送过');
  return { allowed: true, reason: '通过策略检查', text, key };
}
