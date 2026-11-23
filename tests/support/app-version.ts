/**
 * Give the directly-imported TypeScript sources the build-time version constant.
 *
 * `src/core/magpie.ts` reads the `__APP_VERSION__` define that esbuild inlines
 * in the bundled app. Tests import the sources directly, so this module mirrors
 * that define from package.json before any source module is evaluated.
 */
import { readFileSync } from 'node:fs';

const metadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

(globalThis as Record<string, unknown>).__APP_VERSION__ = metadata.version;
