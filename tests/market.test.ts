import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMarketIndex, sanitizeRelativePath } from '../src/market/index.ts';
import { MarketClient } from '../src/market/client.ts';
import { ScriptPluginRegistry } from '../src/plugins/script/registry.ts';

const wasmBytes = Buffer.from('wasm-module-bytes');
const sha256 = createHash('sha256').update(wasmBytes).digest('hex');

const marketEntry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'douyin-scroll',
  version: '0.1.0',
  kind: 'script',
  name: '刷抖音',
  description: '按兴趣挑一条抖音内容念给桌宠听。',
  author: 'CYoJkoY',
  permissions: ['pet', 'bridge'],
  harness: 'zig-wasm32/abi1',
  size: wasmBytes.byteLength,
  sha256,
  manifest: 'plugins/douyin-scroll/plugin.json',
  wasm: 'plugins/douyin-scroll/plugin.wasm',
  ...overrides,
});

const marketIndex = (plugins: unknown = [marketEntry()]): string => JSON.stringify({
  schemaVersion: 1,
  generatedAt: '2026-11-24T00:00:00Z',
  plugins,
});

const parsedMarketIndex = (plugins: unknown = [marketEntry()]) => JSON.parse(marketIndex(plugins));

test('market index entries are validated and paths stay inside the repository', () => {
  const ok = parseMarketIndex(parsedMarketIndex());
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.index.plugins[0].sha256, sha256);

  const escaping = parseMarketIndex(parsedMarketIndex([marketEntry({ wasm: '../escape.wasm' })]));
  assert.equal(escaping.ok, false);

  const duplicate = parseMarketIndex(parsedMarketIndex([marketEntry(), marketEntry()]));
  assert.equal(duplicate.ok, false);

  const badHash = parseMarketIndex(parsedMarketIndex([marketEntry({ sha256: 'not-a-hash' })]));
  assert.equal(badHash.ok, false);
});

test('sanitizeRelativePath rejects traversal, absolute paths and schemes', () => {
  assert.equal(sanitizeRelativePath('plugins/x/plugin.wasm'), 'plugins/x/plugin.wasm');
  assert.equal(sanitizeRelativePath('../escape.wasm'), null);
  assert.equal(sanitizeRelativePath('/absolute.wasm'), null);
  assert.equal(sanitizeRelativePath('https://example.com/a.wasm'), null);
  assert.equal(sanitizeRelativePath('plugins\\x\\plugin.wasm'), null);
});

test('install verifies the module hash and lands the files in the registry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-market-'));
  try {
    const client = new MarketClient({
      directory: root,
      provenancePath: join(root, 'plugin-market.json'),
      getMarket: () => ({ repo: 'example/plugins', ref: 'main', lastSync: null }),
      fetcher: {
        text: async () => '',
        bytes: async () => new Uint8Array(wasmBytes),
      },
    });
    const manifest = JSON.stringify({
      schemaVersion: 1, id: 'douyin-scroll', version: '0.1.0', kind: 'script',
      name: '刷抖音', description: '测试', requiresTrust: true,
      script: { abi: 1, entry: 'plugin.wasm', permissions: ['pet', 'bridge'] },
    });
    const entry = parseMarketIndex(parsedMarketIndex());
    assert.ok(entry.ok);
    if (!entry.ok) return;
    client.cached = entry.index;
    client.fetcher = {
      text: async (url: string) => url.includes('plugin.json') ? manifest : marketIndex(),
      bytes: async () => new Uint8Array(wasmBytes),
    };
    const result = await client.install(entry.index.plugins[0]);
    assert.equal(result.ok, true);
    const registry = new ScriptPluginRegistry();
    assert.equal(registry.load(root).length, 0);
    assert.ok(registry.get('douyin-scroll'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install rejects a module whose bytes do not match the recorded hash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-market-'));
  const client = new MarketClient({
    directory: root,
    provenancePath: join(root, 'plugin-market.json'),
    getMarket: () => ({ repo: 'example/plugins', ref: 'main', lastSync: null }),
    fetcher: { text: async () => '', bytes: async () => new Uint8Array(0) },
  });
  const parsed = parseMarketIndex(parsedMarketIndex());
  client.cached = parsed.ok ? parsed.index : null;
  const manifest = JSON.stringify({
    schemaVersion: 1, id: 'douyin-scroll', version: '0.1.0', kind: 'script',
    name: '刷抖音', description: '测试', requiresTrust: true,
    script: { abi: 1, entry: 'plugin.wasm', permissions: ['pet', 'bridge'] },
  });
  client.fetcher = {
    text: async (url: string) => url.includes('plugin.json') ? manifest : marketIndex(),
    bytes: async () => new Uint8Array(Buffer.from('tampered')),
  };
  const entry = parseMarketIndex(parsedMarketIndex());
  assert.ok(entry.ok);
  if (!entry.ok) return;
  const result = await client.install(entry.index.plugins[0]);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /大小与索引不一致|校验失败|sha256/i);
  rmSync(root, { recursive: true, force: true });
});
