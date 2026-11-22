import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Thin client for the Zig core (`native/src/petkit.zig`).
 *
 * The Zig binary runs as a long lived sidecar speaking newline-delimited JSON,
 * so the hot-path decisions (window clamping, activity classification, quota
 * freshness, screenshot → ASCII) run in compiled code instead of the JS heap.
 * When the binary is missing — a plain `npm start` before `npm run native`, or
 * an unsupported platform — every call falls back to the equivalent TypeScript
 * implementation below, so behaviour never depends on the sidecar existing.
 */

export const NATIVE_BINARY = process.platform === 'win32' ? 'petkit.exe' : 'petkit';

export type ActivityStateCode = 0 | 1 | 2 | 3;

/** 0 idle, 1 thinking, 2 waiting, 3 working — mirrors `dafeiyu_activity_state`. */
export function tsActivityState(requests: number, waiting: number, tools: number): ActivityStateCode {
  if (requests > waiting) return 1;
  if (waiting > 0) return 2;
  if (tools > 0) return 3;
  return 0;
}

export const ACTIVITY_STATE_NAMES = ['idle', 'thinking', 'waiting', 'working'] as const;

export function activityStateName(code: number): string {
  return ACTIVITY_STATE_NAMES[code] ?? 'idle';
}

/** Mirrors `dafeiyu_fresh`: is a reading taken at `readAt` still inside its TTL? */
export function tsFresh(readAt: number | null | undefined, now: number, ttlMs: number): boolean {
  if (!Number.isFinite(readAt)) return false;
  const stamp = readAt as number;
  return now >= stamp && now - stamp <= ttlMs;
}

export function nativeBinaryCandidates(base: string): string[] {
  return [
    join(base, 'native', NATIVE_BINARY),
    join(base, '..', 'native', NATIVE_BINARY),
    join(base, '..', 'native', 'bin', NATIVE_BINARY),
    join(base, '..', '..', 'native', 'bin', NATIVE_BINARY),
  ];
}

interface Pending {
  resolve: (value: number) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class NativeCore {
  private child: ChildProcess | null = null;
  private buffer = '';
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private unavailable = false;
  readonly binary: string;

  constructor(binary: string) {
    this.binary = binary;
  }

  /** Find a usable binary under `base` (the packaged app root) and start it. */
  static async connect(base: string): Promise<NativeCore | null> {
    const binary = nativeBinaryCandidates(base).find(candidate => existsSync(candidate));
    if (!binary) return null;
    const core = new NativeCore(binary);
    const ok = await core.probe();
    if (!ok) {
      core.close();
      return null;
    }
    return core;
  }

  get active(): boolean {
    return !this.unavailable && this.child !== null;
  }

  private start(): boolean {
    if (this.child || this.unavailable) return this.child !== null;
    try {
      const child = spawn(this.binary, ['--serve'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => this.onData(chunk));
      child.on('error', () => this.fail());
      child.on('exit', () => this.fail());
      child.stdin?.on('error', () => this.fail());
      this.child = child;
      return true;
    } catch {
      this.unavailable = true;
      return false;
    }
  }

  private fail(): void {
    this.unavailable = true;
    this.child = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Zig core stopped'));
    }
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: { id?: number; ok?: boolean; value?: number };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const entry = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
      if (!entry) continue;
      this.pending.delete(message.id as number);
      clearTimeout(entry.timer);
      if (message.ok && typeof message.value === 'number') entry.resolve(message.value);
      else entry.reject(new Error('Zig core returned no value'));
    }
  }

  private call(op: string, payload: Record<string, number>, timeoutMs = 250): Promise<number> {
    if (!this.start() || !this.child?.stdin) return Promise.reject(new Error('Zig core unavailable'));
    const id = ++this.sequence;
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Zig core timeout: ${op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin?.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    });
  }

  async probe(): Promise<boolean> {
    try {
      return (await this.call('ping', {}, 1500)) === 1;
    } catch {
      return false;
    }
  }

  async clamp(value: number, low: number, high: number): Promise<number> {
    try {
      return await this.call('clamp', { value, low, high });
    } catch {
      return Math.max(low, Math.min(high, value));
    }
  }

  async activityState(requests: number, waiting: number, tools: number): Promise<ActivityStateCode> {
    try {
      return (await this.call('classify', { requests, waiting, tools })) as ActivityStateCode;
    } catch {
      return tsActivityState(requests, waiting, tools);
    }
  }

  async fresh(readAt: number, now: number, ttlMs: number): Promise<boolean> {
    try {
      return (await this.call('fresh', { readAt, now, ttlMs })) === 1;
    } catch {
      return tsFresh(readAt, now, ttlMs);
    }
  }

  close(): void {
    this.unavailable = true;
    const child = this.child;
    this.child = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Zig core closed'));
    }
    this.pending.clear();
    try {
      child?.stdin?.end();
      child?.kill();
    } catch {}
  }
}
