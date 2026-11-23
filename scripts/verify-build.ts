/**
 * Assert the build produced every runtime file the packager needs.
 * Replaces the inline `node -e` check that used to live in CI.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function requiredBuildInputs(platform: string = process.platform): string[] {
  return [
    'dist/main.cjs', 'dist/preload.cjs', 'dist/pet.js', 'dist/panel.js',
    'dist/pet.html', 'dist/pet.css', 'dist/panel.html', 'dist/panel.css',
    platform === 'win32' ? 'dist/native/petkit.exe' : 'dist/native/petkit',
    'assets/catalog.json', 'assets/tray-icon.png', 'assets/app-icon.ico', 'assets/app-icon.icns',
  ];
}

export function missingBuildInputs(base = root, platform: string = process.platform): string[] {
  return requiredBuildInputs(platform).filter(path => !existsSync(resolve(base, path)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = missingBuildInputs();
  if (missing.length) {
    console.error(`Missing CI build inputs: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Build inputs verified: ${requiredBuildInputs().length} files present.`);
  }
}
