/**
 * Build every platform icon from the committed 1024 px brand masters in
 * `assets/brand`. Pure TypeScript: PNG decoding, Lanczos resampling and the
 * .ico/.icns containers all come from `scripts/lib/png.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIcns, buildIco, decodePng, encodePng, resample, type RgbaImage } from './lib/png.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadMaster(path: string): RgbaImage {
  if (!existsSync(path)) throw new Error(`Missing icon master: ${path}`);
  const image = decodePng(readFileSync(path));
  if (image.width !== image.height || image.width < 256) {
    throw new Error(`Expected a square master of at least 256 px: ${path}`);
  }
  return image;
}

function write(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export function buildIcons(base = root): string[] {
  const app = loadMaster(join(base, 'assets', 'brand', 'app-icon.png'));
  const tray = loadMaster(join(base, 'assets', 'brand', 'tray-icon.png'));
  const outputs: Array<[string, Buffer]> = [
    [join(base, 'assets', 'app-icon.png'), encodePng(app)],
    [join(base, 'assets', 'app-icon.ico'), buildIco(app)],
    [join(base, 'assets', 'app-icon.icns'), buildIcns(app)],
    [join(base, 'magpie', 'icon.png'), encodePng(resample(app, 256, 256))],
    [join(base, 'assets', 'tray-icon.png'), encodePng(resample(tray, 32, 32))],
    [join(base, 'assets', 'tray-icon@2x.png'), encodePng(resample(tray, 64, 64))],
  ];
  for (const [path, data] of outputs) write(path, data);
  return outputs.map(([path]) => path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = buildIcons();
  console.log(`Built ${outputs.length} icon files from the PNG masters:`);
  for (const output of outputs) console.log(`  ${output.slice(root.length + 1)}`);
}
