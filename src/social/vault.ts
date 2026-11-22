import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Credentials never leave the main process and never touch the settings file.
 * They are encrypted with Electron's OS-backed safeStorage when available and
 * only decrypted inside adapters that explicitly need them.
 */
export class CredentialVault {
  readonly file: string;
  private entries: Record<string, Record<string, string>> = {};

  constructor(directory = app.getPath('userData')) {
    this.file = join(directory, 'social-credentials.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      for (const [platform, fields] of Object.entries(raw)) {
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
        const decoded: Record<string, string> = {};
        for (const [name, value] of Object.entries(fields as Record<string, unknown>)) {
          if (typeof value !== 'string') continue;
          const text = this.decrypt(value);
          if (text) decoded[name.slice(0, 40)] = text;
        }
        if (Object.keys(decoded).length) this.entries[platform] = decoded;
      }
    } catch {
      this.entries = {};
    }
  }

  private decrypt(value: string): string | null {
    try {
      if (value.startsWith('safe:')) {
        if (!safeStorage.isEncryptionAvailable()) return null;
        return safeStorage.decryptString(Buffer.from(value.slice(5), 'base64'));
      }
      if (value.startsWith('plain:')) return Buffer.from(value.slice(6), 'base64').toString('utf8');
      return null;
    } catch {
      return null;
    }
  }

  private encrypt(value: string): string {
    try {
      if (safeStorage.isEncryptionAvailable()) return 'safe:' + safeStorage.encryptString(value).toString('base64');
    } catch {}
    // safeStorage is unavailable on a few headless Linux sessions; the file is
    // still user-only, but we tag the encoding so it is obvious in the UI.
    return 'plain:' + Buffer.from(value, 'utf8').toString('base64');
  }

  private persist(): void {
    mkdirSync(app.getPath('userData'), { recursive: true });
    const encoded: Record<string, Record<string, string>> = {};
    for (const [platform, fields] of Object.entries(this.entries)) {
      encoded[platform] = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, this.encrypt(value)]));
    }
    writeFileSync(this.file, JSON.stringify(encoded, null, 2), { mode: 0o600 });
  }

  has(platform: string): boolean {
    return Object.keys(this.entries[platform] || {}).length > 0;
  }

  fieldNames(platform: string): string[] {
    return Object.keys(this.entries[platform] || {});
  }

  get(platform: string): Record<string, string> {
    return { ...(this.entries[platform] || {}) };
  }

  set(platform: string, fields: Record<string, unknown>): void {
    const clean: Record<string, string> = {};
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (!text || text.length > 4096) continue;
      clean[name.slice(0, 40)] = text;
    }
    if (Object.keys(clean).length) this.entries[platform] = { ...(this.entries[platform] || {}), ...clean };
    this.persist();
  }

  clear(platform: string): void {
    delete this.entries[platform];
    this.persist();
  }
}

/** Never hand a full secret to the renderer. */
export function maskCredential(value: string): string {
  if (value.length <= 6) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}
