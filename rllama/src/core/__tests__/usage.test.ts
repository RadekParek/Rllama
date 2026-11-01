import { describe, expect, it } from 'vitest';
import {
  chooseProvider,
  emptyUsage,
  formatTokens,
  markProviderError,
  nextProvider,
  recordUsage,
  resetWindow,
  setLimit,
  SWITCH_THRESHOLD,
  usageLevel,
  usageRatio,
  WARN_THRESHOLD,
} from '../usage';
import type { Provider } from '../types';

function provider(id: string, priority: number, enabled = true): Provider {
  return {
    id,
    templateId: 'openai',
    name: id,
    protocol: 'openai',
    baseUrl: 'https://example.com/v1',
    apiKey: 'k',
    priority,
    enabled,
  };
}

describe('usage ratio and levels', () => {
  it('is zero without a budget', () => {
    expect(usageRatio(undefined)).toBe(0);
    expect(usageRatio({ ...emptyUsage(), promptTokens: 5000 })).toBe(0);
  });

  it('reports warn at 75% and switch at 90%', () => {
    const usage = { ...emptyUsage(), limitTokens: 1000, promptTokens: 700 };
    expect(usageRatio(usage)).toBeCloseTo(0.7);
    expect(usageLevel(usage)).toBe('ok');
    expect(usageLevel({ ...usage, promptTokens: 750 })).toBe('warn');
    expect(usageLevel({ ...usage, promptTokens: 900 })).toBe('switch');
    expect(usageLevel({ ...usage, promptTokens: 1200 })).toBe('exhausted');
  });

  it('uses the documented thresholds', () => {
    expect(WARN_THRESHOLD).toBe(0.75);
    expect(SWITCH_THRESHOLD).toBe(0.9);
  });

  it('counts prompt plus completion tokens', () => {
    const usage = { ...emptyUsage(), limitTokens: 1000, promptTokens: 400, completionTokens: 200 };
    expect(usageRatio(usage)).toBeCloseTo(0.6);
  });
});

describe('ledger updates', () => {
  it('accumulates tokens and requests', () => {
    let map = recordUsage({}, 'p1', { promptTokens: 100, completionTokens: 50 });
    map = recordUsage(map, 'p1', { promptTokens: 10, completionTokens: 5 });
    expect(map.p1.requests).toBe(2);
    expect(map.p1.promptTokens).toBe(110);
    expect(map.p1.completionTokens).toBe(55);
  });

  it('clears the previous error on success', () => {
    let map = markProviderError({}, 'p1', 'boom');
    expect(map.p1.lastError).toBe('boom');
    map = recordUsage(map, 'p1', { promptTokens: 1, completionTokens: 1 });
    expect(map.p1.lastError).toBeUndefined();
  });

  it('keeps the budget when resetting the window', () => {
    let map = setLimit({}, 'p1', 5000);
    map = recordUsage(map, 'p1', { promptTokens: 4000, completionTokens: 0 });
    map = resetWindow(map, 'p1');
    expect(map.p1.limitTokens).toBe(5000);
    expect(map.p1.promptTokens).toBe(0);
    expect(map.p1.requests).toBe(0);
  });

  it('rounds fractional token counts', () => {
    const map = recordUsage({}, 'p1', { promptTokens: 10.6, completionTokens: 3.2 });
    expect(map.p1.promptTokens).toBe(11);
    expect(map.p1.completionTokens).toBe(3);
  });
});

describe('provider selection', () => {
  const providers = [provider('a', 0), provider('b', 1), provider('c', 2)];

  it('stays on the requested provider below the switch threshold', () => {
    const usage = { b: { ...emptyUsage(), limitTokens: 1000, promptTokens: 100 } };
    const choice = chooseProvider(providers, usage, 'b', true);
    expect(choice.provider?.id).toBe('b');
    expect(choice.switched).toBe(false);
  });

  it('moves to the next provider at 90%', () => {
    const usage = { a: { ...emptyUsage(), limitTokens: 1000, promptTokens: 900 } };
    const choice = chooseProvider(providers, usage, 'a', true);
    expect(choice.switched).toBe(true);
    expect(choice.provider?.id).toBe('b');
  });

  it('does not move when failover is off', () => {
    const usage = { a: { ...emptyUsage(), limitTokens: 1000, promptTokens: 990 } };
    const choice = chooseProvider(providers, usage, 'a', false);
    expect(choice.provider?.id).toBe('a');
    expect(choice.switched).toBe(false);
  });

  it('skips disabled providers', () => {
    const withDisabled = [provider('a', 0, false), provider('b', 1)];
    const choice = chooseProvider(withDisabled, {}, 'a', true);
    expect(choice.provider?.id).toBe('b');
  });

  it('skips a provider whose last request failed', () => {
    const usage = markProviderError({}, 'b', 'boom');
    expect(nextProvider(providers, usage, 'a')?.id).toBe('c');
  });

  it('reports when nothing is configured', () => {
    const choice = chooseProvider([], {}, undefined, true);
    expect(choice.provider).toBeUndefined();
    expect(choice.reason).toBe('no providers configured');
  });

  it('prefers a provider that still has budget when others are exhausted', () => {
    const usage = {
      a: { ...emptyUsage(), limitTokens: 100, promptTokens: 100 },
      b: { ...emptyUsage(), limitTokens: 100, promptTokens: 100 },
    };
    const choice = chooseProvider(providers, usage, 'a', true);
    expect(choice.provider?.id).toBe('c');
  });

  it('still returns a provider when every one is exhausted', () => {
    const usage = {
      a: { ...emptyUsage(), limitTokens: 100, promptTokens: 100 },
      b: { ...emptyUsage(), limitTokens: 100, promptTokens: 100 },
      c: { ...emptyUsage(), limitTokens: 100, promptTokens: 100 },
    };
    const choice = chooseProvider(providers, usage, 'a', true);
    expect(choice.provider?.id).toBe('b');
  });
});

describe('formatTokens', () => {
  it('formats thousands and millions', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2_400_000)).toBe('2.4M');
  });
});
