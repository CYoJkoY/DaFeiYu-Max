import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, rankItems } from '../dist/core/social-digest.js';
import { dedupeKey, evaluateWrite, inQuietHours, isAllowedTarget, sanitizeText, WRITE_LIMITS } from '../dist/core/social-policy.js';
import { parseBridgeFeed } from '../dist/core/social-bridged.js';
import { parseTiebaThreads } from '../dist/core/social-tieba.js';
import { parseBilibiliPopular } from '../dist/core/social-bilibili.js';
import { PLATFORM_IDS, platformLabel } from '../dist/core/social-registry.js';

// Quiet hours are local wall-clock hours, so the fixture must be a local time.
const now = new Date(2026, 10, 23, 12).getTime();
const at = (title, extra = {}) => ({ id: title, platform: 'bilibili', kind: 'video', title, ...extra });
const base = {
  platform: 'bilibili',
  target: 'BV1xx411c7mD',
  text: '  这期讲得清楚，收藏了。 ',
  now,
  allowWrites: true,
};

test('every platform has a label and the set stays stable', () => {
  assert.deepEqual(PLATFORM_IDS, ['bilibili', 'tieba', 'douyin', 'xiaoheihe']);
  for (const id of PLATFORM_IDS) assert.ok(platformLabel(id).length > 1);
});

test('sanitizeText strips control characters, mentions and extra spaces', () => {
  const cleaned = sanitizeText(' @everyone  hello\u0007\n\tworld ');
  assert.equal(cleaned, 'hello world');
  assert.equal([...sanitizeText('x'.repeat(400))].length, WRITE_LIMITS.maxLength);
});

test('quiet hours wrap midnight and collapse when start equals end', () => {
  assert.equal(inQuietHours(23, { start: 23, end: 7 }), true);
  assert.equal(inQuietHours(6, { start: 23, end: 7 }), true);
  assert.equal(inQuietHours(12, { start: 23, end: 7 }), false);
  assert.equal(inQuietHours(12, { start: 12, end: 12 }), false);
  assert.equal(inQuietHours(12, undefined), false);
});

test('allowed targets are anchored per platform', () => {
  assert.equal(isAllowedTarget('bilibili', 'BV1xx411c7mD'), true);
  assert.equal(isAllowedTarget('bilibili', 'https://www.bilibili.com/video/BV1xx411c7mD'), true);
  assert.equal(isAllowedTarget('bilibili', 'https://evil.example/?x=BV1xx411c7mD'), false);
  assert.equal(isAllowedTarget('tieba', 'https://tieba.baidu.com/p/123456'), true);
  assert.equal(isAllowedTarget('douyin', 'bridge:/message'), true);
  assert.equal(isAllowedTarget('xiaoheihe', 'https://xiaoheihe.cn/app/x'), true);
  assert.equal(isAllowedTarget('xiaoheihe', 'https://www.xiaoheihe.cn/app/x'), true);
  assert.equal(isAllowedTarget('mastodon', 'https://xiaoheihe.cn'), false);
  assert.equal(isAllowedTarget('tieba', 'x'.repeat(301)), false);
});

test('write gate refuses each blocked condition', () => {
  assert.equal(evaluateWrite({ ...base, text: '   ' }).reason, '草稿内容为空');
  assert.match(evaluateWrite({ ...base, platform: 'douyin' }).reason, /白名单/);
  assert.match(evaluateWrite({ ...base, allowWrites: false }).reason, /写入未开启/);
  assert.match(evaluateWrite({ ...base, recentWrites: [now - 1_000] }).reason, /每分钟/);
  assert.match(evaluateWrite({ ...base, recentWrites: [now, now - 2_000] }).reason, /每分钟/);
  assert.match(evaluateWrite({ ...base, recentKeys: [dedupeKey('bilibili', base.target, base.text.trim())] }).reason, /发送过/);
});

test('write gate honors the daily ceiling and quiet hours', () => {
  const busy = Array.from({ length: WRITE_LIMITS.perDay }, (_, index) => now - (index + 2) * 1_000);
  assert.equal(evaluateWrite({ ...base, recentWrites: busy }).allowed, false);
  const quiet = { start: 12, end: 13 };
  assert.match(evaluateWrite({ ...base, quietHours: quiet }).reason, /安静时段/);
  const outside = { start: 1, end: 2 };
  assert.equal(evaluateWrite({ ...base, quietHours: outside }).allowed, true);
});

test('a clean write passes and is normalized', () => {
  const verdict = evaluateWrite(base);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.text, '这期讲得清楚，收藏了。');
  assert.equal(verdict.key, dedupeKey('bilibili', base.target, verdict.text));
  const old = evaluateWrite({ ...base, recentWrites: [now - 25 * 3600_000] });
  assert.equal(old.allowed, true);
});

test('digests rank by interest before popularity and stay bounded', () => {
  const items = [
    at('无关的热门视频', { hot: 9_000_000 }),
    at('DeepSeek 新模型上手', { createdAt: now - 3_600_000 }),
    at('Zig 0.17 迁移笔记', { createdAt: now - 10 * 3_600_000 }),
  ];
  const ranked = rankItems(items, ['deepseek', 'zig'], now);
  assert.deepEqual(ranked.map(item => item.id), ['DeepSeek 新模型上手', 'Zig 0.17 迁移笔记', '无关的热门视频']);
  const digest = buildDigest(items, ['DeepSeek'], now);
  assert.match(digest.summary, /哔哩哔哩/);
  assert.match(digest.summary, /DeepSeek/);
  assert.equal(digest.highlights.length, 3);
  assert.ok([...digest.bullet].length <= 60);
  assert.equal(buildDigest([], [], now).summary, '暂时没有读到新的社交动态。');
});

test('tieba parser reads both attribute orders, decodes and dedupes', () => {
  const html = `
    <a class="j_th_tit " href="/p/1001">DeepSeek &amp; Zig</a>
    <a href="/p/1002" class="j_th_tit">第二帖</a>
    <a href="/p/1001" class="j_th_tit">重复</a>
    <a class="j_th_tit" href="/p/1003"><em>带</em>标签</a>
    <a class="other" href="/p/1004">忽略</a>`;
  const threads = parseTiebaThreads(html);
  assert.deepEqual(threads.map(item => item.id), ['1001', '1002', '1003']);
  assert.equal(threads[0].title, 'DeepSeek & Zig');
  assert.equal(threads[2].title, '带标签');
  assert.equal(threads[1].url, 'https://tieba.baidu.com/p/1002');
});

test('bilibili parser keeps only usable entries', () => {
  const items = parseBilibiliPopular({ data: { list: [
    { bvid: 'BV1xx411c7mD', title: ' 有效的视频 ', pubdate: 1_700_000_000, owner: { name: 'UP' }, stat: { view: 12 } },
    { bvid: '', title: '没有 id' },
    { bvid: 'BV1yy411c7mE', title: '   ' },
  ] } });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '有效的视频');
  assert.equal(items[0].url, 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(items[0].createdAt, 1_700_000_000_000);
  assert.deepEqual(parseBilibiliPopular(null), []);
});

test('bridge feed parser keeps valid entries and rejects unsafe urls', () => {
  const items = parseBridgeFeed({ items: [
    { id: 'a', title: '正常', url: 'https://www.douyin.com/video/1', kind: 'video' },
    { id: 'b', title: '坏链接', url: 'http://insecure', kind: 'nope' },
    { id: 3, title: '数字 id' },
    { id: 'c', title: '' },
  ] }, 'douyin');
  assert.deepEqual(items.map(item => item.id), ['a', 'b']);
  assert.equal(items[0].kind, 'video');
  assert.equal(items[1].kind, 'post');
  assert.equal(items[1].url, undefined);
  assert.deepEqual(parseBridgeFeed({}, 'xiaoheihe'), []);
});
