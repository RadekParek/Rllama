import type { Provider, ProviderUsage, TokenUsage } from './types';

/**
 * Usage ledger and the rule that keeps a session alive.
 *
 * Providers rarely expose a trustworthy "remaining quota" number, so Rllama
 * tracks what it sent (tokens, requests) against a budget you set per provider.
 * At 75% the UI warns, at 90% the request is moved to the next provider in the
 * failover order instead of failing the user's turn.
 *
 * Rllama never creates accounts to reset a quota; the limit is respected, the
 * work just continues somewhere else (another key, another provider, a local
 * model).
 */
export const WARN_THRESHOLD = 0.75;
export const SWITCH_THRESHOLD = 0.9;

export type UsageMap = Record<string, ProviderUsage>;

export function emptyUsage(now: number = Date.now()): ProviderUsage {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    windowStartedAt: now,
  };
}

export function usageOf(map: UsageMap, providerId: string): ProviderUsage {
  return map[providerId] ?? emptyUsage();
}

/** Share of the budget used, clamped to 0..1. Zero when no budget is set. */
export function usageRatio(usage: ProviderUsage | undefined): number {
  if (!usage || !usage.limitTokens || usage.limitTokens <= 0) {
    return 0;
  }
  const used = usage.promptTokens + usage.completionTokens;
  return Math.min(1, Math.max(0, used / usage.limitTokens));
}

export function usageLevel(usage: ProviderUsage | undefined): 'ok' | 'warn' | 'switch' | 'exhausted' {
  const ratio = usageRatio(usage);
  if (ratio >= 1) {
    return 'exhausted';
  }
  if (ratio >= SWITCH_THRESHOLD) {
    return 'switch';
  }
  if (ratio >= WARN_THRESHOLD) {
    return 'warn';
  }
  return 'ok';
}

export function recordUsage(
  map: UsageMap,
  providerId: string,
  usage: TokenUsage,
  now: number = Date.now(),
): UsageMap {
  const previous = map[providerId] ?? emptyUsage(now);
  return {
    ...map,
    [providerId]: {
      ...previous,
      requests: previous.requests + 1,
      promptTokens: previous.promptTokens + Math.max(0, Math.round(usage.promptTokens)),
      completionTokens: previous.completionTokens + Math.max(0, Math.round(usage.completionTokens)),
      lastError: undefined,
    },
  };
}

export function markProviderError(map: UsageMap, providerId: string, message: string): UsageMap {
  const previous = map[providerId] ?? emptyUsage();
  return { ...map, [providerId]: { ...previous, lastError: message } };
}

export function clearProviderError(map: UsageMap, providerId: string): UsageMap {
  const previous = map[providerId];
  if (!previous || !previous.lastError) {
    return map;
  }
  return { ...map, [providerId]: { ...previous, lastError: undefined } };
}

export function setLimit(map: UsageMap, providerId: string, limitTokens: number | undefined): UsageMap {
  const previous = map[providerId] ?? emptyUsage();
  return { ...map, [providerId]: { ...previous, limitTokens } };
}

/** Starts a new usage window (new month, new key, or a manual reset). */
export function resetWindow(map: UsageMap, providerId: string, now: number = Date.now()): UsageMap {
  const previous = map[providerId];
  return {
    ...map,
    [providerId]: {
      ...(previous ?? emptyUsage(now)),
      promptTokens: 0,
      completionTokens: 0,
      requests: 0,
      windowStartedAt: now,
      lastError: undefined,
    },
  };
}

/**
 * Next provider to use, respecting `priority` and skipping providers that are
 * disabled, already at their switch threshold, or that failed most recently.
 */
export function nextProvider(
  providers: Provider[],
  usage: UsageMap,
  currentId?: string,
): Provider | undefined {
  const candidates = providers
    .filter((provider) => provider.enabled && provider.id !== currentId)
    .sort((a, b) => a.priority - b.priority);
  const healthy = candidates.filter((provider) => {
    const state = usage[provider.id];
    return usageRatio(state) < SWITCH_THRESHOLD && !state?.lastError;
  });
  return healthy[0] ?? candidates[0];
}

/**
 * Chooses where a request should go: the requested provider while it is under
 * the switch threshold, otherwise the next healthy one.
 */
export function chooseProvider(
  providers: Provider[],
  usage: UsageMap,
  requestedId: string | undefined,
  failoverEnabled: boolean,
): { provider?: Provider; switched: boolean; reason?: string } {
  const enabled = providers.filter((provider) => provider.enabled);
  if (enabled.length === 0) {
    return { provider: undefined, switched: false, reason: 'no providers configured' };
  }
  const requested = requestedId ? enabled.find((provider) => provider.id === requestedId) : undefined;
  const current = requested ?? [...enabled].sort((a, b) => a.priority - b.priority)[0];

  if (!failoverEnabled) {
    return { provider: current, switched: false };
  }
  const level = usageLevel(usage[current.id]);
  if (level === 'switch' || level === 'exhausted') {
    const replacement = nextProvider(providers, usage, current.id);
    if (replacement) {
      return {
        provider: replacement,
        switched: true,
        reason: `${current.name} is at ${Math.round(usageRatio(usage[current.id]) * 100)}% of its budget`,
      };
    }
  }
  return { provider: current, switched: false };
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}
