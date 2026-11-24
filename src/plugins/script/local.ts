/**
 * Turns a locally authored plug-in into a manifest.
 *
 * The "authored code" tier lets a user point at a `main.zig` on their own disk;
 * we compile it and drop the module into `<userData>/plugins/<id>/`. To keep the
 * directory name, the manifest id and the runtime registry in agreement, the id
 * is derived here from a sibling `plugin.json` when the author provided one, and
 * from the source folder name otherwise.
 */
import { parsePluginManifest, type PluginManifest } from '../manifest.ts';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FALLBACK_ID = 'local-plugin';

export interface LocalManifestRequest {
  /** Folder that contains the user's `main.zig`. */
  directoryName: string;
  /** Parsed sibling `plugin.json`, when the author shipped one. */
  existing?: Record<string, unknown> | null;
}

export type LocalManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Id for a locally authored plug-in: the author's own id, else the folder name. */
export function localId(directoryName: string, existing?: Record<string, unknown> | null): string {
  const declared = existing?.id;
  if (typeof declared === 'string' && ID_PATTERN.test(declared)) return declared;
  const folder = directoryName.trim().toLowerCase();
  return ID_PATTERN.test(folder) ? folder : FALLBACK_ID;
}

/**
 * Build (and validate) the manifest written next to a locally compiled module.
 * Fields the author declared survive; `script.entry` always points at the module
 * we just wrote, because that is the file on disk.
 */
export function buildLocalManifest(request: LocalManifestRequest): LocalManifestResult {
  const existing = request.existing ?? null;
  const id = localId(request.directoryName, existing);
  const script = record(existing?.script) ?? {};
  const permissions = Array.isArray(script.permissions) && script.permissions.length
    ? script.permissions : ['pet'];
  const labels = record(existing?.labels);
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id,
    version: typeof existing?.version === 'string' ? existing.version : '0.0.0',
    kind: 'script',
    name: typeof existing?.name === 'string' ? existing.name : id,
    ...(labels ? { labels } : {}),
    description: typeof existing?.description === 'string' ? existing.description : '本地编写的脚本插件。',
    requiresTrust: true,
    script: {
      abi: 1,
      entry: 'plugin.wasm',
      permissions,
      ...(Array.isArray(script.settings) ? { settings: script.settings } : {}),
      ...(Array.isArray(script.commands) ? { commands: script.commands } : {}),
    },
  };
  const parsed = parsePluginManifest(manifest);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.manifest.kind !== 'script' || !parsed.manifest.script) {
    return { ok: false, error: '脚本插件清单缺少 script 段' };
  }
  return { ok: true, manifest: parsed.manifest };
}
