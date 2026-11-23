// Bundles the TypeScript sources into the runtime layout:
//   dist/main.cjs, dist/preload.cjs   CommonJS for Electron
//   dist/pet.js, dist/panel.js        ES modules for the two renderer windows
//   dist/tools/*.cjs                  screenshot helpers run by `electron`
//   magpie/page.js                    classic script for the Magpie host
//
// Tests load src/**/*.ts directly through Node's type stripping, so this script
// no longer emits an extra module tree for them.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMagpiePage, MAGPIE_PAGE_OUTPUT, MAGPIE_PAGE_SOURCE } from './lib/magpie-page.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const define = { __APP_VERSION__: JSON.stringify(metadata.version) };
const nodeExternals = ['electron', 'node:*'];

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist'), { recursive: true });

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
  // Screenshot helpers are Electron main-process scripts; they are compiled so
  // `electron dist/tools/<name>.cjs` runs plain CommonJS.
  entryPoints: [join(root, 'scripts/capture-demo.ts'), join(root, 'scripts/capture-panel-demo.ts')],
  outdir: join(root, 'dist/tools'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: nodeExternals,
  define,
  logLevel: 'warning',
});

for (const name of ['pet.html', 'pet.css', 'panel.html', 'panel.css']) {
  cpSync(join(root, 'src', name), join(root, 'dist', name));
}

// `magpie/page.js` is generated from `src/magpie/page.ts` and committed so
// `magpie plugin add github:...` can serve it without a build step; the
// distribution test fails if the committed copy drifts from this output.
const page = readFileSync(join(root, MAGPIE_PAGE_SOURCE), 'utf8');
writeFileSync(join(root, MAGPIE_PAGE_OUTPUT), await compileMagpiePage(page));

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
