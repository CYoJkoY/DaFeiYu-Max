/**
 * Cross-platform smoke test for the Zig sidecar.
 *
 * Spawns the built `petkit` binary in `--serve` mode, sends a single ping line
 * and asserts the JSON reply. Replaces the per-shell pwsh/bash snippets that
 * used to live in CI, so the check is identical on Windows, macOS and Linux.
 *
 * Usage: node scripts/smoke-petkit.ts [--binary <path>]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function defaultBinaryPath(platform: string = process.platform): string {
  return resolve(root, 'dist/native', platform === 'win32' ? 'petkit.exe' : 'petkit');
}

/** Send one ping line to a petkit binary and return the parsed reply. */
export function pingPetkit(binary: string): Promise<{ id: number; ok: boolean; value: number }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, ['--serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('petkit --serve did not reply in time'));
    }, 5000);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(`petkit exited with code ${code}: ${Buffer.concat(errors).toString('utf8').trim()}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(output.split('\n')[0] ?? output));
      } catch {
        reject(new Error(`petkit returned non-JSON output: ${output}`));
      }
    });
    child.stdin.end('{"id":1,"op":"ping"}\n');
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const binaryIndex = process.argv.indexOf('--binary');
  const binary = binaryIndex >= 0 ? resolve(process.argv[binaryIndex + 1] as string) : defaultBinaryPath();
  if (!existsSync(binary)) {
    console.error(`petkit binary not found: ${binary}`);
    process.exitCode = 1;
  } else {
    pingPetkit(binary).then(
      reply => {
        if (reply.id !== 1 || reply.ok !== true || reply.value !== 1) {
          console.error(`Unexpected petkit response: ${JSON.stringify(reply)}`);
          process.exitCode = 1;
        } else {
          console.log(`petkit responded: ${JSON.stringify(reply)}`);
        }
      },
      error => {
        console.error(String(error instanceof Error ? error.message : error));
        process.exitCode = 1;
      },
    );
  }
}
