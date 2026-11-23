import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const metadata = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('Magpie discovers a committed page rather than loading Electron in its plugin host', () => {
  assert.equal(metadata.main, undefined);
  assert.equal(metadata.exports, undefined);
  assert.deepEqual(metadata.magpie.permissions, []);
  for (const name of [metadata.magpie.page.file, metadata.magpie.page.icon]) {
    assert.ok(existsSync(fileURLToPath(new URL(name, root))));
  }
  const page = readFileSync(new URL(metadata.magpie.page.file, root), 'utf8');
  assert.ok(page.includes('安装这个插件不会安装、下载或启动它'));
  assert.ok(page.includes('does not install, download or start the app'));
  assert.ok(page.includes('dsh-pet') && page.includes('non-commercial'));
  assert.ok(page.includes('https://github.com/wolfvoid/magpie-DaFeiYu/releases/latest'));
  // Both languages live in the document; the switch is CSS only, so the whole
  // guide is readable without a script engine.
  assert.ok(page.includes('lang="en"'));
});

test('the Magpie page carries no script at all', () => {
  const page = readFileSync(new URL('magpie/index.html', root), 'utf8');
  assert.ok(!/<script/i.test(page), 'the guide page must stay HTML + CSS only');
  assert.ok(!/\son[a-z]+\s*=/i.test(page), 'no inline event handlers either');
  const files = readdirSync(new URL('magpie/', root));
  assert.deepEqual(
    files.filter(name => /\.(c|m)?jsx?$|\.tsx?$|\.css$/.test(name)).sort(),
    ['page.css'],
  );
});

// Build output, dependencies and local scratch directories are not sources.
const skippedDirectories = new Set(['node_modules', 'dist', '.git', '.runtime', 'qa', 'zig-out', '.zig-cache']);
const forbiddenExtensions = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.tsx',
  '.py', '.ps1', '.psm1', '.sh', '.bat', '.cmd',
  '.rs', '.c', '.h', '.cpp', '.hpp', '.go', '.java', '.cs', '.kt', '.swift',
  '.rb', '.php', '.lua', '.pl', '.dart',
]);

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) walk(join(directory, entry.name), found);
      continue;
    }
    found.push(join(directory, entry.name));
  }
  return found;
}

test('the repository ships exactly two code languages: TypeScript and Zig', () => {
  const offenders: string[] = [];
  const languages = new Set<string>();
  for (const file of walk(rootPath)) {
    const path = relative(rootPath, file).replaceAll('\\', '/');
    const extension = /\.[^./]+$/.exec(path)?.[0]?.toLowerCase() ?? '';
    if (forbiddenExtensions.has(extension)) offenders.push(path);
    if (extension === '.ts' || extension === '.zig') languages.add(extension);
  }
  assert.deepEqual(offenders, [], 'authored code must be TypeScript or Zig');
  assert.deepEqual([...languages].sort(), ['.ts', '.zig']);
});
