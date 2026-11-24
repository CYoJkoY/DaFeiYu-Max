import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_SCHEMA_VERSION, parsePluginManifest } from '../src/plugins/manifest.ts';
import { buildHostInput, parseScriptResponse } from '../src/plugins/script/abi.ts';
import { ScriptPluginRegistry } from '../src/plugins/script/registry.ts';
import { ScriptSandbox } from '../src/plugins/script/sandbox.ts';
import { buildLocalManifest, localId } from '../src/plugins/script/local.ts';
import { compileZigPlugin, findZig, verifyWasm } from '../src/plugins/script/build.ts';
import { ScriptEngine } from '../src/plugins/script/runtime.ts';

const scriptManifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: PLUGIN_SCHEMA_VERSION,
  id: 'douyin-scroll',
  version: '0.1.0',
  kind: 'script',
  name: '刷抖音',
  description: '按兴趣挑一条抖音内容念给桌宠听。',
  requiresTrust: true,
  script: {
    abi: 1,
    entry: 'plugin.wasm',
    permissions: ['pet', 'bridge'],
    settings: [{ id: 'bridgeUrl', type: 'url', label: '桥接地址' }],
    commands: ['next'],
  },
  ...overrides,
});

test('script manifests require ABI 1, a local wasm entry and declared permissions', () => {
  const ok = parsePluginManifest(scriptManifest());
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.manifest.script?.abi, 1);
  assert.deepEqual(ok.ok && ok.manifest.script?.commands, ['next']);

  const wrongAbi = parsePluginManifest(scriptManifest({ script: { abi: 2, entry: 'plugin.wasm', permissions: ['pet'] } }));
  assert.equal(wrongAbi.ok, false);

  const escapingEntry = parsePluginManifest(scriptManifest({ script: { abi: 1, entry: '../plugin.wasm', permissions: ['pet'] } }));
  assert.equal(escapingEntry.ok, false);

  const noPermissions = parsePluginManifest(scriptManifest({ script: { abi: 1, entry: 'plugin.wasm', permissions: [] } }));
  assert.equal(noPermissions.ok, false);
});

test('net permission without allowHosts is rejected, and a bad setting default is too', () => {
  const noHosts = parsePluginManifest(scriptManifest({
    script: { abi: 1, entry: 'plugin.wasm', permissions: ['net'] },
  }));
  assert.equal(noHosts.ok, false);

  const withHosts = parsePluginManifest(scriptManifest({
    script: { abi: 1, entry: 'plugin.wasm', permissions: ['net'], allowHosts: ['api.example.com'] },
  }));
  assert.equal(withHosts.ok, true);

  const badDefault = parsePluginManifest(scriptManifest({
    script: {
      abi: 1, entry: 'plugin.wasm', permissions: ['pet'],
      settings: [{ id: 'bridgeUrl', type: 'url', label: '桥接地址', default: 'file:///etc/passwd' }],
    },
  }));
  assert.equal(badDefault.ok, false);
});

test('a malformed plug-in response is rejected whole', () => {
  const good = parseScriptResponse({
    state: { counter: 2 },
    pet: [{ type: 'say', text: '刷到一条新的。' }],
    status: { message: '运行中', progress: 0.5, counter: 2 },
    schedule: { afterMs: 20_000 },
  });
  assert.equal(good.ok, true);
  assert.equal(good.ok && good.response.pet[0].type, 'say');
  assert.equal(good.ok && good.response.schedule?.afterMs, 20_000);

  const unknownPet = parseScriptResponse({ pet: [{ type: 'dance' }] });
  assert.equal(unknownPet.ok, false);

  const badState = parseScriptResponse({ state: [1, 2, 3] });
  assert.equal(badState.ok, false);

  const badSchedule = parseScriptResponse({ schedule: { afterMs: 'soon' } });
  assert.equal(badSchedule.ok, false);
});

test('the registry loads a script plug-in directory and ignores the declarative loader', () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-scripts-'));
  try {
    const directory = join(root, 'douyin-scroll');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'plugin.json'), JSON.stringify(scriptManifest()));
    writeFileSync(join(directory, 'plugin.wasm'), Buffer.from([0, 97, 115, 109]));
    const registry = new ScriptPluginRegistry();
    const issues = registry.load(root, { originOf: () => 'local' });
    assert.deepEqual(issues, []);
    const record = registry.get('douyin-scroll');
    assert.ok(record);
    assert.equal(record?.origin, 'local');
    assert.equal(record?.spec.entry, 'plugin.wasm');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a directory named after the plug-in with a mismatched id is reported', () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-scripts-'));
  try {
    const directory = join(root, 'other-name');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'plugin.json'), JSON.stringify(scriptManifest()));
    writeFileSync(join(directory, 'plugin.wasm'), Buffer.from([0, 97, 115, 109]));
    const registry = new ScriptPluginRegistry();
    const issues = registry.load(root);
    assert.equal(registry.get('douyin-scroll') ?? null, null);
    assert.ok(issues.some(issue => issue.error.includes('目录名')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const zig = findZig();

test('a real Zig plug-in compiles, exports the ABI and answers install', { skip: zig ? false : '未安装 Zig 编译器' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-zig-'));
  try {
    const source = join(root, 'main.zig');
    writeFileSync(source, [
      'const std = @import("std");',
      'const dfy = @import("dfy.zig");',
      '',
      'fn onEvent(ctx: *dfy.Context) anyerror!void {',
      '    const kind = dfy.getStr(ctx.event, "type") orelse "tick";',
      '    if (dfy.eql(kind, "install")) {',
      '        ctx.reply.status("已就绪", null, null);',
      '    } else if (dfy.eql(kind, "activate")) {',
      '        ctx.reply.status("运行中", 0.25, 1);',
      '    } else if (dfy.eql(kind, "tick")) {',
      '        try ctx.reply.say("刷到一条新的。");',
      '        ctx.reply.schedule(20_000);',
      '    }',
      '}',
      '',
      'comptime {',
      '    dfy.install(onEvent);',
      '}',
      '',
    ].join('\n'));
    const compiled = await compileZigPlugin({
      sourcePath: source,
      sdkPath: join(process.cwd(), 'sdk', 'dfy.zig'),
    });
    assert.equal(compiled.ok, true, compiled.ok ? '' : `${compiled.error} ${compiled.detail ?? ''}`);
    if (!compiled.ok) return;
    assert.ok(compiled.wasm.byteLength > 0);
    assert.equal((await verifyWasm(compiled.wasm)).ok, true);

    const sandbox = await ScriptSandbox.create(compiled.wasm);
    try {
      assert.equal(sandbox.abiVersion, 1);
      const input = buildHostInput(
        { id: 'verify', version: '0.0.0' },
        { type: 'tick' },
        { interests: ['编程'], options: {}, locale: 'zh-CN' },
        {},
        1_700_000_000_000,
      );
      const { output } = sandbox.invoke(JSON.stringify(input));
      const parsed = parseScriptResponse(JSON.parse(output));
      assert.equal(parsed.ok, true);
      assert.equal(parsed.ok && parsed.response.pet[0].type, 'say');
      assert.equal(parsed.ok && parsed.response.schedule?.afterMs, 20_000);
    } finally {
      sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the shipped SDK stays importable by a plug-in build', () => {
  const sdk = readFileSync(join(process.cwd(), 'sdk', 'dfy.zig'), 'utf8');
  assert.match(sdk, /pub fn install\(comptime handler: Handler\) void/);
  assert.match(sdk, /ABI_VERSION: i32 = 1/);
});

test('reply state merges over the persisted state and stateRemove deletes a key', { skip: zig ? false : '未安装 Zig 编译器' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-state-'));
  try {
    const source = join(root, 'main.zig');
    writeFileSync(source, [
      'const std = @import("std");',
      'const dfy = @import("dfy.zig");',
      '',
      'fn onEvent(ctx: *dfy.Context) anyerror!void {',
      '    const kind = dfy.getStr(ctx.event, "type") orelse "noop";',
      '    const n = dfy.getInt(ctx.state, "n") orelse 0;',
      '    if (dfy.eql(kind, "bump")) {',
      '        try ctx.reply.stateInt("n", n + 1);',
      '    } else if (dfy.eql(kind, "forget")) {',
      '        try ctx.reply.stateRemove("n");',
      '    }',
      '}',
      '',
      'comptime {',
      '    dfy.install(onEvent);',
      '}',
      '',
    ].join('\n'));
    const compiled = await compileZigPlugin({
      sourcePath: source,
      sdkPath: join(process.cwd(), 'sdk', 'dfy.zig'),
    });
    assert.equal(compiled.ok, true, compiled.ok ? '' : `${compiled.error} ${compiled.detail ?? ''}`);
    if (!compiled.ok) return;

    const sandbox = await ScriptSandbox.create(compiled.wasm);
    try {
      const run = (event: Record<string, unknown>, state: Record<string, unknown>) => {
        const input = buildHostInput(
          { id: 'state-demo', version: '0.0.0' },
          event as never,
          { interests: [], options: {}, locale: 'zh-CN' },
          state,
          1_700_000_000_000,
        );
        const parsed = parseScriptResponse(JSON.parse(sandbox.invoke(JSON.stringify(input)).output));
        assert.equal(parsed.ok, true);
        return parsed.ok ? parsed.response.state : {};
      };
      // A write touches only its own key; the rest survives.
      assert.deepEqual(run({ type: 'bump' }, { n: 5, keep: 'x' }), { keep: 'x', n: 6 });
      // An event that writes nothing must not erase anything.
      assert.deepEqual(run({ type: 'noop' }, { n: 6, keep: 'x' }), { n: 6, keep: 'x' });
      // stateRemove deletes exactly one key.
      assert.deepEqual(run({ type: 'forget' }, { n: 9, keep: 'x' }), { keep: 'x' });
    } finally {
      sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local installs honor a sibling manifest and fall back to the folder id', () => {
  const bare = buildLocalManifest({ directoryName: 'My-Scroll' });
  assert.equal(bare.ok, true);
  assert.equal(bare.ok && bare.manifest.id, 'my-scroll');
  assert.equal(bare.ok && bare.manifest.name, 'my-scroll');
  assert.equal(bare.ok && bare.manifest.script?.permissions.join(','), 'pet');
  assert.equal(bare.ok && bare.manifest.script?.entry, 'plugin.wasm');

  const authored = buildLocalManifest({
    directoryName: 'whatever',
    existing: scriptManifest({ id: 'douyin-scroll' }) as unknown as Record<string, unknown>,
  });
  assert.equal(authored.ok, true);
  assert.equal(authored.ok && authored.manifest.id, 'douyin-scroll');
  assert.equal(authored.ok && authored.manifest.name, '刷抖音');
  assert.equal(authored.ok && authored.manifest.script?.permissions.join(','), 'pet,bridge');
  assert.equal(localId('whatever', { id: 'not valid!' }), 'whatever');
  assert.equal(localId('??', null), 'local-plugin');

  const bad = buildLocalManifest({ directoryName: 'ok', existing: { script: { abi: 1, entry: 'plugin.wasm', permissions: ['net'] } } });
  assert.equal(bad.ok, false);
});

test('a disabled plug-in ignores commands instead of rearming itself', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-toggle-'));
  const plugins = join(root, 'plugins');
  const state = join(root, 'state');
  mkdirSync(join(plugins, 'douyin-scroll'), { recursive: true });
  writeFileSync(join(plugins, 'douyin-scroll', 'plugin.json'), JSON.stringify(scriptManifest()));
  writeFileSync(join(plugins, 'douyin-scroll', 'plugin.wasm'), Buffer.from([0, 97, 115, 109]));
  const scripts: Record<string, { enabled: boolean; options: Record<string, unknown> }> = {
    'douyin-scroll': { enabled: false, options: { bridgeUrl: 'http://127.0.0.1:8787' } },
  };
  let calls = 0;
  const engine = new ScriptEngine({
    directory: plugins,
    stateDirectory: state,
    locale: 'zh-CN',
    getInterests: () => [],
    getScripts: () => scripts,
    patchScripts: mutate => mutate(scripts),
    invokerFactory: () => ({
      invoke: async () => {
        calls += 1;
        return {
          output: JSON.stringify({ state: { n: calls }, status: { message: `第 ${calls} 次` }, schedule: { afterMs: 20_000 } }),
          logs: [],
        };
      },
      close: () => {},
    }),
  });
  try {
    engine.reload();
    await engine.start();
    assert.equal(calls, 0, '未启用的插件不该在启动时被调用');

    assert.equal(engine.command('douyin-scroll', 'next'), false);
    assert.equal(calls, 0, '停用状态下命令必须被丢弃');

    engine.setEnabled('douyin-scroll', true);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(engine.status('douyin-scroll')?.running, true);

    engine.setEnabled('douyin-scroll', false);
    await new Promise(resolve => setTimeout(resolve, 50));
    const afterDisable = calls;
    assert.equal(engine.status('douyin-scroll')?.running, false);
    assert.equal(engine.command('douyin-scroll', 'next'), false);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls, afterDisable, '停用后不该再有任何调度');
  } finally {
    engine.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('forgetting an uninstalled plug-in drops its state file and stored options', () => {
  const root = mkdtempSync(join(tmpdir(), 'dfy-engine-'));
  try {
    const plugins = join(root, 'plugins');
    const state = join(root, 'state');
    const directory = join(plugins, 'demo-plugin');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'plugin.json'), JSON.stringify(scriptManifest({
      id: 'demo-plugin',
      name: '演示',
      description: '演示用脚本插件。',
    })));
    writeFileSync(join(directory, 'plugin.wasm'), new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'demo-plugin.json'), JSON.stringify({ counter: 7 }));

    const scripts: Record<string, { enabled: boolean; options: Record<string, unknown> }> = {
      'demo-plugin': { enabled: true, options: { bridgeUrl: 'http://127.0.0.1:8787' } },
    };
    const engine = new ScriptEngine({
      directory: plugins,
      stateDirectory: state,
      locale: 'zh-CN',
      getInterests: () => [],
      getScripts: () => scripts,
      patchScripts: mutate => mutate(scripts),
      invokerFactory: () => { throw new Error('本测试不会真正调用模块'); },
    });
    engine.reload();
    assert.equal(engine.viewEntries().length, 1);
    assert.equal(engine.viewEntries()[0].id, 'demo-plugin');

    engine.forget('demo-plugin');
    assert.deepEqual(engine.viewEntries(), []);
    assert.equal('demo-plugin' in scripts, false);
    assert.equal(existsSync(join(state, 'demo-plugin.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
