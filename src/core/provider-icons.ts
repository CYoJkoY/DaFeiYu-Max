const BUNDLED = new Set(['cursor', 'deepseek-color', 'codex-color', 'volcengine-color',
  'claude-color', 'gemini-color', 'qwen-color', 'openai', 'grok', 'zhipu-color']);

/** Resolve a bundled provider SVG to a URL relative to the running bundle. */
export function providerIconSource(icon: string | undefined | null): string | null {
  return icon && BUNDLED.has(icon)
    ? new URL(`../assets/provider-icons/${icon}.svg`, import.meta.url).href
    : null;
}

export function providerInitial(entry: { name?: string; provider?: string } | null | undefined): string {
  return String(entry?.name || entry?.provider || '?').trim().charAt(0).toUpperCase() || '?';
}
