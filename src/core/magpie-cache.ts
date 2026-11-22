import type { Quota } from './types.js';

/**
 * Keep the last usable quota values when a refresh fails, so the pet's badges
 * do not flicker to "—%" every time Magpie blips.
 */
export function mergeCachedQuota(previous: Quota | null, fallback: Quota): Quota {
  if (!previous || !previous.ok) return fallback;
  return {
    ...previous,
    accounts: (previous.accounts || []).map(account => ({
      ...account,
      cached: true,
      ...(account.kind === 'balance'
        ? { balance: account.balance ?? fallback.accounts?.find(item => item.accountId === account.accountId)?.balance ?? null }
        : {}),
    })),
    windows: previous.windows.map(window => ({ ...window, cached: true })),
    usage: fallback.usage ?? previous.usage,
    cachedAt: previous.observedAt ?? undefined,
    observedAt: fallback.observedAt,
    error: fallback.error,
  };
}
