import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLUGIN_SCHEMA_VERSION,
  SOCIAL_PLATFORM_MAPPING,
  manifestLabel,
  parsePluginManifest,
} from '../dist/core/plugin-manifest.js';
import { festivalActive, inMonthDayWindow, monthDay } from '../dist/core/plugin-calendar.js';
import { applyAppearance } from '../dist/core/plugin-appearance.js';
import { PluginRegistry } from '../dist/core/plugin-registry.js';
import { prunePluginSelections, resolvePlugins } from '../dist/core/plugin-host.js';
import { builtinPlugins } from '../dist/core/plugin-builtin.js';
import { DEFAULT_SETTINGS } from '../dist/core/settings.js';

const socialBase = {
  schemaVersion: PLUGIN_SCHEMA_VERSION,
  id: 'bilibili-popular',
  version: '1.0.0',
  kind: 'social',
  name: 'Bilibili popular',
  description: 'Read the public bilibili popular feed.',
  social: { implementation: 'bilibili', platform: 'bilibili', requires: 'none', reads: true, writes: false },
};

const appearanceBase = {
  schemaVersion: PLUGIN_SCHEMA_VERSION,
  id: 'night-skin',
  version: '2.3.7-beta.1',
  kind: 'appearance',
  name: 'Night skin',
  description: 'A small accent and animation patch.',
  appearance: { accent: '#123', idle: ['idle-a'] },
};

const festivalBase = {
  schemaVersion: PLUGIN_SCHEMA_VERSION,
  id: 'new-year',
  version: '1.0.0',
  kind: 'festival',
  name: 'New year',
  description: 'A seasonal greeting around the new year.',
  festival: {
    window: { start: '12-28', end: '01-03', greeting: '新年快乐', accent: '#4287f5', accessories: ['✨'] },
  },
};

function validManifest(base = socialBase, changes = {}) {
  return structuredClone({ ...base, ...changes });
}

function settings(plugins = {}) {
  const result = structuredClone(DEFAULT_SETTINGS);
  result.plugins = { appearance: null, enabled: {}, ...plugins };
  return result;
}

test('accepts valid declarative social, appearance and festival manifests', () => {
  for (const base of [socialBase, appearanceBase, festivalBase]) {
    const result = parsePluginManifest(validManifest(base));
    assert.equal(result.ok, true);
    assert.equal(result.manifest.schemaVersion, PLUGIN_SCHEMA_VERSION);
  }

  const social = parsePluginManifest(validManifest(socialBase, {
    id: 'douyin-bridge',
    requiresTrust: true,
    social: {
      implementation: 'bridge',
      platform: 'douyin',
      requires: 'bridge',
      reads: true,
      writes: true,
      feedPath: '/feed',
      messagePath: '/message',
    },
  }));
  assert.equal(social.ok, true);
  assert.deepEqual(social.manifest.social, {
    implementation: 'bridge',
    platform: 'douyin',
    requires: 'bridge',
    reads: true,
    writes: true,
    feedPath: '/feed',
    messagePath: '/message',
  });

  const appearance = parsePluginManifest(validManifest(appearanceBase, {
    appearance: {
      accent: '#123456',
      idle: ['idle-a', 'unknown', 'idle-a'],
      states: { thinking: ['think-a'] },
      categories: [{ id: 'extra', weight: 2, noMirror: true, actions: ['click-a'] }],
    },
  }));
  assert.equal(appearance.ok, true);
  assert.deepEqual(appearance.manifest.appearance.idle, ['idle-a', 'unknown']);
  assert.deepEqual(appearance.manifest.appearance.categories, [{ id: 'extra', weight: 2, noMirror: true, actions: ['click-a'] }]);
});

test('rejects malformed manifest headers and kind payloads', () => {
  const invalid = [
    ['wrong schemaVersion', { schemaVersion: PLUGIN_SCHEMA_VERSION + 1 }],
    ['wrong schemaVersion type', { schemaVersion: '1' }],
    ['bad id', { id: 'Night Skin' }],
    ['empty id', { id: '' }],
    ['bad version', { version: '1.0' }],
    ['unknown kind', { kind: 'theme' }],
    ['empty name', { name: '   ' }],
    ['missing description', { description: '' }],
    ['bad label', { labels: { zh: '' } }],
  ];
  for (const [, changes] of invalid) {
    assert.equal(parsePluginManifest(validManifest(socialBase, changes)).ok, false);
  }

  const appearanceChanges = [
    { appearance: { accent: 'blue' } },
    { appearance: { idle: [] } },
    { appearance: { states: { idle: [] } } },
    { appearance: { categories: [{ id: 'extra', weight: 0, actions: ['click-a'] }] } },
    { appearance: {} },
  ];
  for (const changes of appearanceChanges) {
    assert.equal(parsePluginManifest(validManifest(appearanceBase, changes)).ok, false);
  }

  const festivalChanges = [
    { festival: { window: { start: '13-01', end: '01-03' } } },
    { festival: { window: { start: '12-28', end: '01-03', accent: '#12g' } } },
    { festival: { window: { start: '12-28', end: '01-03', accessories: [] } } },
    { festival: { window: { start: '12-28', end: '01-3' } } },
  ];
  for (const changes of festivalChanges) {
    assert.equal(parsePluginManifest(validManifest(festivalBase, changes)).ok, false);
  }
});

test('social capabilities are pinned to compiled platform mappings', () => {
  assert.deepEqual(SOCIAL_PLATFORM_MAPPING.douyin, {
    implementation: 'bridge', requires: 'bridge', reads: true, writes: true,
  });

  const wrongAdapter = validManifest(socialBase, {
    id: 'douyin-bridge',
    social: { implementation: 'bilibili', platform: 'douyin', requires: 'bridge', reads: true, writes: true },
  });
  assert.equal(parsePluginManifest(wrongAdapter).ok, false);

  const wrongRequires = validManifest(socialBase, {
    id: 'douyin-bridge',
    social: { implementation: 'bridge', platform: 'douyin', requires: 'none', reads: true, writes: true },
  });
  assert.equal(parsePluginManifest(wrongRequires).ok, false);

  const untrustedWrite = validManifest(socialBase, {
    id: 'douyin-bridge',
    social: { implementation: 'bridge', platform: 'douyin', requires: 'bridge', reads: true, writes: true },
  });
  assert.equal(parsePluginManifest(untrustedWrite).ok, false);

  const impossibleWrite = validManifest(socialBase, {
    social: { implementation: 'bilibili', platform: 'bilibili', requires: 'none', reads: true, writes: true },
  });
  assert.equal(parsePluginManifest(impossibleWrite).ok, false);

  const pathOnCompiledAdapter = validManifest(socialBase, {
    social: { ...socialBase.social, feedPath: '/custom-feed' },
  });
  assert.equal(parsePluginManifest(pathOnCompiledAdapter).ok, false);
});

test('calendar helpers use inclusive local month-day windows across years', () => {
  assert.equal(monthDay(new Date(2027, 0, 2)), '01-02');
  assert.equal(inMonthDayWindow('01-02', '12-28', '01-03'), true);
  assert.equal(inMonthDayWindow('12-31', '12-28', '01-03'), true);
  assert.equal(inMonthDayWindow('01-03', '12-28', '01-03'), true);
  assert.equal(inMonthDayWindow('01-04', '12-28', '01-03'), false);
  assert.equal(festivalActive(festivalBase.festival.window, new Date(2026, 0, 2)), true);
  assert.equal(festivalActive(festivalBase.festival.window, new Date(2025, 11, 31)), true);
  assert.equal(festivalActive(festivalBase.festival.window, new Date(2026, 0, 4)), false);
  assert.equal(festivalActive({ start: '09-10', end: '10-10' }, new Date(2026, 9, 10)), true);
});

test('appearance patches filter unknown clips and preserve owned categories', () => {
  const catalog = {
    names: ['idle-a', 'idle-b', 'think-a', 'click-a'],
    idle: ['idle-a'],
    clicks: ['click-a'],
    categories: [{ id: 'owned', weight: 1, actions: ['click-a'] }],
    states: { idle: ['idle-a', 'idle-b'], thinking: ['think-a'] },
  };
  const patched = applyAppearance(catalog, {
    idle: ['idle-b', 'missing'],
    states: { thinking: ['missing'], idle: ['idle-a'] },
    categories: [
      { id: 'owned', weight: 9, actions: ['missing'] },
      { id: 'extra', weight: 2, actions: ['missing', 'click-a'] },
    ],
  });
  assert.deepEqual(patched.idle, ['idle-b']);
  assert.deepEqual(patched.states.thinking, ['think-a']);
  assert.deepEqual(patched.states.idle, ['idle-a']);
  assert.deepEqual(patched.categories, [{ id: 'owned', weight: 1, actions: ['click-a'] }, { id: 'extra', weight: 2, actions: ['click-a'] }]);
  assert.deepEqual(catalog.categories, [{ id: 'owned', weight: 1, actions: ['click-a'] }]);
});

test('registry rejects duplicate ids and records external manifest problems', t => {
  const registry = new PluginRegistry([]);
  const first = parsePluginManifest(validManifest());
  assert.equal(first.ok, true);
  assert.equal(registry.register({ manifest: first.manifest, source: 'external' }), true);
  assert.equal(registry.register({ manifest: first.manifest, source: 'external' }), false);
  const builtin = new PluginRegistry();
  assert.equal(builtin.hasAppearance('classic-finish'), true);
  assert.equal(builtin.hasAppearance('spring-festival'), false);
  assert.equal(builtin.hasFestival('spring-festival'), true);
  assert.equal(builtin.hasFestival('classic-finish'), false);
  assert.equal(manifestLabel(first.manifest), first.manifest.name);

  const directory = mkdtempSync(join(tmpdir(), 'dafeiyu-plugins-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'broken.plugin.json'), '{not json');
  writeFileSync(join(directory, 'invalid.plugin.json'), JSON.stringify(validManifest({ ...socialBase, id: 'Bad Id' })));
  writeFileSync(join(directory, 'duplicate.plugin.json'), JSON.stringify(validManifest()));
  writeFileSync(join(directory, 'ignored.txt'), 'not a plugin');

  const external = new PluginRegistry([]);
  external.register({ manifest: first.manifest, source: 'external' });
  const issues = external.loadDirectory(directory);
  assert.equal(issues.length, 3);
  assert.equal(issues.some(issue => issue.file.endsWith('broken.plugin.json')), true);
  assert.equal(issues.some(issue => issue.file.endsWith('invalid.plugin.json')), true);
  assert.equal(issues.some(issue => issue.error.includes('bilibili-popular')), true);
  assert.equal(external.get('bilibili-popular').manifest.id, 'bilibili-popular');
  assert.deepEqual(external.loadIssues(), issues);
});

test('host resolves appearance and active seasonal skins without changing settings', () => {
  const registry = new PluginRegistry();
  const current = settings({ appearance: 'classic-finish', enabled: { 'spring-festival': true } });
  const resolved = resolvePlugins({
    names: ['idle-a', 'idle-b'], idle: ['idle-a'], clicks: ['click-a'],
    categories: [], states: {},
  }, registry, current, new Date(2026, 1, 1));
  assert.equal(resolved.settingsChanged, false);
  assert.equal(current.plugins.appearance, 'classic-finish');
  assert.equal(resolved.catalog.idle[0], 'idle-a');
  assert.equal(resolved.view.appearance, 'classic-finish');
  assert.deepEqual(resolved.theme, { accent: '#d5373c' });
  assert.equal(resolved.festival.id, 'spring-festival');
  assert.equal(resolved.view.entries.find(entry => entry.id === 'spring-festival').active, true);
  assert.equal(resolved.view.entries.find(entry => entry.id === 'classic-finish').active, true);

  const disabled = resolvePlugins({ names: [], idle: [], clicks: [], categories: [], states: {} },
    registry, settings({ appearance: 'classic-finish', enabled: { 'spring-festival': false } }), new Date(2026, 1, 1));
  assert.equal(disabled.festival, null);
  assert.deepEqual(disabled.theme, { accent: '#2f6fe0' });
});

test('host prunes stale selections and reports the settings mutation', () => {
  const registry = new PluginRegistry();
  const current = settings({ appearance: 'missing-skin', enabled: { 'missing-festival': true, 'spring-festival': false } });
  assert.equal(prunePluginSelections(current, registry), true);
  assert.equal(current.plugins.appearance, null);
  assert.deepEqual(current.plugins.enabled, { 'spring-festival': false });

  const unchanged = settings({ appearance: 'classic-finish', enabled: { 'spring-festival': true } });
  assert.equal(prunePluginSelections(unchanged, registry), false);

  const resolved = resolvePlugins({ names: [], idle: [], clicks: [], categories: [], states: {} },
    registry, structuredClone(current), new Date(2026, 6, 1));
  assert.equal(resolved.settingsChanged, false);
  assert.equal(resolved.festival, null);
});

test('host merges a selected external appearance over the shipped catalog', () => {
  const registry = new PluginRegistry();
  const manifest = parsePluginManifest(validManifest(appearanceBase, {
    appearance: { accent: '#123456', idle: ['idle-b', 'unknown'], categories: [{ id: 'extra', weight: 3, actions: ['click-a', 'unknown'] }] },
  }));
  assert.equal(manifest.ok, true);
  assert.equal(registry.register({ manifest: manifest.manifest, source: 'external' }), true);

  const resolved = resolvePlugins({
    names: ['idle-a', 'idle-b', 'click-a'], idle: ['idle-a'], clicks: ['click-a'],
    categories: [], states: { idle: ['idle-a'] },
  }, registry, settings({ appearance: 'night-skin' }), new Date(2026, 6, 1));

  assert.equal(resolved.settingsChanged, false);
  assert.deepEqual(resolved.catalog.idle, ['idle-b']);
  assert.deepEqual(resolved.catalog.categories, [{ id: 'extra', weight: 3, actions: ['click-a'] }]);
  assert.deepEqual(resolved.theme, { accent: '#123456' });
  assert.equal(resolved.view.appearance, 'night-skin');
  assert.equal(resolved.view.entries.find(entry => entry.id === 'night-skin').active, true);
  assert.equal(resolved.view.entries.find(entry => entry.id === 'classic-finish').active, false);
  assert.equal(resolved.view.entries.find(entry => entry.id === 'night-skin').source, 'external');
});

test('built-in manifests use the current contract', () => {
  const manifests = builtinPlugins();
  assert.equal(manifests.length, new Set(manifests.map(entry => entry.id)).size);
  for (const manifest of manifests) assert.equal(parsePluginManifest(manifest).ok, true);
});
