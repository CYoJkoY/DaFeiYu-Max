// Bundles the TypeScript sources into the runtime layout:
//   dist/main.cjs, dist/preload.cjs   CommonJS for Electron
//   dist/pet.js, dist/panel.js        ES modules for the two renderer windows
//   dist/core/*.js                    ES modules imported by the node tests
//   magpie/page.js                    committed classic script for the Magpie host
import { build, transform } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const define = { __APP_VERSION__: JSON.stringify(metadata.version) };
const nodeExternals = ['electron', 'node:*'];

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist', 'core'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/main.ts'), join(root, 'src/preload.ts')],
  outdir: join(root, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: nodeExternals,
  define,
  logLevel: 'warning',
});

await build({
  entryPoints: [join(root, 'src/renderer/pet.ts'), join(root, 'src/renderer/panel.ts')],
  outdir: join(root, 'dist'),
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'esm',
  define,
  logLevel: 'warning',
});

await build({
  // Flat output: tests import dist/core/<name>.js, so relative imports must
  // not re-create the src/core and src/social directory levels.
  entryPoints: [
    ['src/core/magpie.ts', 'magpie'], ['src/core/magpie-cache.ts', 'magpie-cache'],
    ['src/core/quota-display.ts', 'quota-display'], ['src/core/position.ts', 'position'],
    ['src/core/animation.ts', 'animation'], ['src/core/platform.ts', 'platform'],
    ['src/core/settings.ts', 'settings'], ['src/core/provider-icons.ts', 'provider-icons'],
    ['src/core/native.ts', 'native'],
    ['src/plugins/manifest.ts', 'plugin-manifest'], ['src/plugins/calendar.ts', 'plugin-calendar'],
    ['src/plugins/appearance.ts', 'plugin-appearance'], ['src/plugins/registry.ts', 'plugin-registry'],
    ['src/plugins/host.ts', 'plugin-host'], ['src/plugins/builtin.ts', 'plugin-builtin'],
    ['src/social/digest.ts', 'social-digest'], ['src/social/policy.ts', 'social-policy'],
    ['src/social/registry.ts', 'social-registry'],
    ['src/social/adapters/bilibili.ts', 'social-bilibili'],
    ['src/social/adapters/tieba.ts', 'social-tieba'],
    ['src/social/adapters/bridged.ts', 'social-bridged'],
  ].map(([file, name]) => ({ in: join(root, file), out: name })),
  outdir: join(root, 'dist/core'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: nodeExternals,
  define,
  logLevel: 'warning',
});

for (const name of ['pet.html', 'pet.css', 'panel.html', 'panel.css']) {
  cpSync(join(root, 'src', name), join(root, 'dist', name));
}

// The Magpie plug-in host loads a classic script, so keep it free of module syntax.
const page = readFileSync(join(root, 'src/magpie/page.ts'), 'utf8');
// Keep CJK literals readable in the committed page; esbuild would otherwise
// escape them and the distribution test matches them as raw text.
const compiled = await transform(page, { loader: 'ts', target: 'es2020', format: 'esm', charset: 'utf8' });
writeFileSync(join(root, 'magpie/page.js'), compiled.code.trimEnd() + '\n');

// Ship the Zig sidecar. `zig build` writes to native/zig-out/bin; native/bin is
// kept as a fallback for pre-built binaries dropped in by hand.
const nativeOutputs = [
  join(root, 'native/zig-out/bin'),
  join(root, 'native/bin'),
];
const nativeOutput = nativeOutputs.find(directory => existsSync(directory));
if (nativeOutput) {
  cpSync(nativeOutput, join(root, 'dist/native'), { recursive: true });
}

console.log(`Built DaFeiYu ${metadata.version} into dist/.`);
