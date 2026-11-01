import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '../client';
import type { Provider } from '../types';

/**
 * The Responses wire API is what Codex uses (`wire_api = "responses"`) and the
 * only mode some AgentRouter models accept, so its event shapes are pinned
 * here: text deltas, the completed event with usage, and the failure event.
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

const provider: Provider = {
  id: 'agentrouter-1',
  templateId: 'agentrouter',
  name: 'AgentRouter',
  protocol: 'openai-responses',
  baseUrl: 'https://agentrouter.org/v1',
  apiKey: 'sk-test',
  priority: 0,
  enabled: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('responses wire api', () => {
  it('posts to /responses with instructions and typed input parts', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello "}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"there"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"model":"gpt-6.1-sol","usage":{"input_tokens":11,"output_tokens":2}}}\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const models: string[] = [];
    const result = await streamChat({
      provider,
      model: 'gpt-6.1-sol',
      system: 'be brief',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ],
      handlers: { onDelta: (delta) => deltas.push(delta), onModel: (model) => models.push(model) },
    });

    expect(deltas.join('')).toBe('Hello there');
    expect(result.text).toBe('Hello there');
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 2 });
    expect(models).toEqual(['gpt-6.1-sol']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://agentrouter.org/v1/responses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.instructions).toBe('be brief');
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'again' }] },
    ]);
  });

  it('falls back to the finished text when a gateway sends no deltas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"all at once"}\n\n',
        ]),
      ),
    );

    const result = await streamChat({
      provider,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      handlers: { onDelta: () => undefined },
    });
    expect(result.text).toBe('all at once');
  });

  it('surfaces a response.failed event as a provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"model not enabled for this key"}}}\n\n',
        ]),
      ),
    );

    await expect(
      streamChat({
        provider,
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        handlers: { onDelta: () => undefined },
      }),
    ).rejects.toThrow(/model not enabled for this key/);
  });
});
