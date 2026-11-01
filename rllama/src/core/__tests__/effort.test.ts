import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '../client';
import { daemonCandidates, discoverDaemon, probeDaemon } from '../ollama';
import { apiEffort, effortMaxTokens, modelShortName } from '../settings';
import type { Provider } from '../types';

/**
 * Effort now has six levels and the daemon can be discovered, so both get
 * pinned here: the levels must reach the wire in the shape each protocol
 * expects, and discovery must report the reachable daemon first.
 */

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function provider(protocol: Provider['protocol'], baseUrl: string): Provider {
  return {
    id: 'p1',
    templateId: 'custom',
    name: 'Test',
    protocol,
    baseUrl,
    apiKey: '',
    priority: 0,
    enabled: true,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('effort levels', () => {
  it('orders the six levels and sends the provider ceiling for max/ultracode', () => {
    expect(apiEffort('minimal')).toBe('minimal');
    expect(apiEffort('medium')).toBe('medium');
    expect(apiEffort('max')).toBe('high');
    expect(apiEffort('ultracode')).toBe('high');
  });

  it('raises the reply budget at the top levels only', () => {
    expect(effortMaxTokens('medium', 4096)).toBe(4096);
    expect(effortMaxTokens('max', 4096)).toBe(8192);
    expect(effortMaxTokens('ultracode', 20000)).toBe(20000);
  });

  it('strips the registry namespace from model names', () => {
    expect(modelShortName('treyleo16/Opus-5.5')).toBe('Opus-5.5');
    expect(modelShortName('gemma4:31b-cloud')).toBe('gemma4:31b-cloud');
    expect(modelShortName(' org/team/model ')).toBe('model');
  });
});

describe('effort on the wire', () => {
  it('maps minimal onto reasoning.effort for the responses api', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(['event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);

    await streamChat({
      provider: provider('openai-responses', 'https://example.test/v1'),
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      effort: 'minimal',
      handlers: { onDelta: () => undefined },
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.reasoning).toEqual({ effort: 'minimal' });
  });

  it('sends high for ultracode on chat completions', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);

    await streamChat({
      provider: provider('openai', 'https://example.test/v1'),
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      effort: 'ultracode',
      handlers: { onDelta: () => undefined },
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.reasoning_effort).toBe('high');
  });

  it('turns on ollama thinking for high and leaves it off for medium', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(['{"message":{"content":"hi"},"done":true}\n']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const local = provider('ollama', 'http://127.0.0.1:11434');
    await streamChat({
      provider: local,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      effort: 'high',
      handlers: { onDelta: () => undefined },
    });
    const high = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(high.think).toBe(true);

    await streamChat({
      provider: local,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      effort: 'medium',
      handlers: { onDelta: () => undefined },
    });
    const medium = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(medium.think).toBeUndefined();
  });
});

describe('daemon discovery', () => {
  it('always offers the reachable loopback forms, current address first and without duplicates', () => {
    const candidates = daemonCandidates('http://localhost:11434/', ['http://192.168.1.9:11434']);
    expect(candidates[0]).toBe('http://localhost:11434');
    expect(candidates).toContain('http://127.0.0.1:11434');
    expect(candidates).toContain('http://192.168.1.9:11434');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('reports a reachable daemon with its version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ version: '0.6.8' }), { status: 200 })),
    );
    await expect(probeDaemon('http://127.0.0.1:11434')).resolves.toEqual({
      url: 'http://127.0.0.1:11434',
      ok: true,
      version: '0.6.8',
    });
  });

  it('treats a refused connection as unreachable instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const probe = await probeDaemon('http://127.0.0.1:11434');
    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/Failed to fetch/);
  });

  it('sorts the answering daemon to the front', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith('http://10.0.2.2:11434')) {
          return new Response(JSON.stringify({ version: '0.9.1' }), { status: 200 });
        }
        throw new TypeError('Failed to fetch');
      }),
    );

    const probes = await discoverDaemon('http://127.0.0.1:11434');
    expect(probes[0].ok).toBe(true);
    expect(probes[0].url).toBe('http://10.0.2.2:11434');
    expect(probes.filter((probe) => probe.ok)).toHaveLength(1);
  });
});
