import { transform } from 'esbuild';

/**
 * Compiles the Magpie plug-in page script.
 *
 * The Magpie host loads `magpie/page.js` as a classic script, and installing
 * the plug-in does not run a build, so the compiled file stays in the
 * repository. It is generated output, not a hand-written source: the header
 * marks it, `scripts/build.ts` rewrites it from `src/magpie/page.ts`, and
 * `tests/distribution.test.ts` fails when the committed copy drifts.
 */
export const MAGPIE_PAGE_SOURCE = 'src/magpie/page.ts';
export const MAGPIE_PAGE_OUTPUT = 'magpie/page.js';

const HEADER = `// Generated from ${MAGPIE_PAGE_SOURCE} by scripts/build.ts. Do not edit by hand.\n`;

export async function compileMagpiePage(source: string): Promise<string> {
  // Keep CJK literals readable in the generated page; esbuild would otherwise
  // escape them and the distribution test matches them as raw text.
  const compiled = await transform(source, { loader: 'ts', target: 'es2020', format: 'esm', charset: 'utf8' });
  return HEADER + compiled.code.trimEnd() + '\n';
}
