import {
  authHeaders,
  chatEndpoint,
  modelsEndpoint,
  parseModelList,
} from './providers';
import { createNdjsonParser, createSseParser } from './sse';
import type { ChatMessage, ModelInfo, Provider, TokenUsage } from './types';

/** An HTTP or protocol failure from a provider. */
export class ProviderError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(describeStatus(status, body));
    this.name = 'ProviderError';
    this.status = status;
    this.body = body;
  }

  /** True for conditions where moving to another provider makes sense. */
  get isFailoverWorthy(): boolean {
    return (
      this.status === 401 ||
      this.status === 402 ||
      this.status === 403 ||
      this.status === 404 ||
      this.status === 429 ||
      this.status >= 500 ||
      this.status === 0
    );
  }
}

function describeStatus(status: number, body: string): string {
  const trimmed = body.trim();
  const detail = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
  switch (status) {
    case 401:
      return `401 unauthorised — the API key was rejected. ${detail}`;
    case 402:
      return `402 payment required — the account is out of credit. ${detail}`;
    case 403:
      return `403 forbidden — this key may not use that model. ${detail}`;
    case 404:
      return `404 not found — check the base URL (for Ollama Cloud it is https://ollama.com/v1). ${detail}`;
    case 429:
      return `429 rate limited or quota exhausted. ${detail}`;
    default:
      return status === 0 ? `Network error: ${detail}` : `HTTP ${status}: ${detail}`;
  }
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  /** Provider-reported model name, when it differs from the request. */
  onModel?: (model: string) => void;
}

export interface StreamRequest {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  handlers: StreamHandlers;
}

export interface StreamResult {
  text: string;
  usage: TokenUsage;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderError(0, message);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(response.status, text);
  }
  return response;
}

/** Reads a response body as text chunks. */
async function readChunks(response: Response, onChunk: (chunk: string) => void): Promise<void> {
  if (!response.body) {
    const text = await response.text();
    if (text) {
      onChunk(text);
    }
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    onChunk(decoder.decode(value, { stream: true }));
  }
  onChunk(decoder.decode());
}

/** Streams a chat completion over whichever protocol the provider uses. */
export async function streamChat(request: StreamRequest): Promise<StreamResult> {
  const { provider, model, messages, system, maxTokens, signal, handlers } = request;
  const url = chatEndpoint(provider.protocol, provider.baseUrl);
  const headers = authHeaders(provider);

  let text = '';
  const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

  const emit = (delta: string) => {
    if (!delta) {
      return;
    }
    text += delta;
    handlers.onDelta(delta);
  };

  if (provider.protocol === 'ollama') {
    const payload = {
      model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      stream: true,
      ...(maxTokens ? { options: { num_predict: maxTokens } } : {}),
    };
    const response = await post(url, headers, payload, signal);
    const parser = createNdjsonParser((value) => {
      const record = value as Record<string, unknown>;
      const message = record.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === 'string') {
        emit(message.content);
      }
      if (record.done) {
        usage.promptTokens = Number(record.prompt_eval_count ?? 0) || estimateTokens(system ?? '');
        usage.completionTokens = Number(record.eval_count ?? 0) || estimateTokens(text);
      }
    });
    await readChunks(response, (chunk) => parser.push(chunk));
    parser.flush();
  } else if (provider.protocol === 'anthropic') {
    const payload = {
      model,
      max_tokens: maxTokens ?? 4096,
      stream: true,
      ...(system ? { system } : {}),
      messages: messages.filter((message) => message.role !== 'system'),
    };
    const response = await post(url, headers, payload, signal);
    const parser = createSseParser((event) => {
      const record = safeJson(event.data);
      if (!record) {
        return;
      }
      const type = typeof record.type === 'string' ? record.type : event.event;
      if (type === 'message_start') {
        const message = record.message as Record<string, unknown> | undefined;
        const found = message?.usage as Record<string, unknown> | undefined;
        if (found) {
          usage.promptTokens = Number(found.input_tokens ?? 0) || 0;
        }
        if (message && typeof message.model === 'string') {
          handlers.onModel?.(message.model);
        }
      } else if (type === 'content_block_delta') {
        const delta = record.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.text === 'string') {
          emit(delta.text);
        }
      } else if (type === 'message_delta') {
        const found = record.usage as Record<string, unknown> | undefined;
        if (found) {
          usage.completionTokens = Number(found.output_tokens ?? 0) || usage.completionTokens;
        }
      } else if (type === 'error') {
        const error = record.error as Record<string, unknown> | undefined;
        throw new ProviderError(0, String(error?.message ?? 'anthropic stream error'));
      }
    });
    await readChunks(response, (chunk) => parser.push(chunk));
    parser.flush();
  } else {
    const payload: Record<string, unknown> = {
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    };
    if (maxTokens) {
      payload.max_tokens = maxTokens;
    }
    const response = await post(url, headers, payload, signal);
    const parser = createSseParser((event) => {
      const record = safeJson(event.data);
      if (!record) {
        return;
      }
      const choices = record.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const choice = choices[0] as Record<string, unknown>;
        const delta = choice.delta as Record<string, unknown> | undefined;
        if (delta) {
          const content = delta.content;
          if (typeof content === 'string') {
            emit(content);
          } else if (Array.isArray(content)) {
            for (const part of content) {
              const piece = part as Record<string, unknown>;
              if (typeof piece.text === 'string') {
                emit(piece.text);
              }
            }
          }
        }
        if (typeof choice.text === 'string') {
          emit(choice.text);
        }
      }
      const found = record.usage as Record<string, unknown> | undefined;
      if (found) {
        usage.promptTokens = Number(found.prompt_tokens ?? 0) || usage.promptTokens;
        usage.completionTokens = Number(found.completion_tokens ?? 0) || usage.completionTokens;
      }
    });
    await readChunks(response, (chunk) => parser.push(chunk));
    parser.flush();
  }

  if (!usage.promptTokens) {
    usage.promptTokens = estimateTokens(
      (system ?? '') + messages.map((message) => message.content).join('\n'),
    );
  }
  if (!usage.completionTokens) {
    usage.completionTokens = estimateTokens(text);
  }
  handlers.onUsage?.(usage);
  return { text, usage };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Lists the models a provider exposes for the current key. */
export async function listModels(provider: Provider, signal?: AbortSignal): Promise<ModelInfo[]> {
  const url = modelsEndpoint(provider.protocol, provider.baseUrl);
  let response: Response;
  try {
    response = await fetch(url, { headers: authHeaders(provider), signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderError(0, message);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(response.status, text);
  }
  const payload: unknown = await response.json().catch(() => null);
  return parseModelList(provider.protocol, payload)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: id }));
}
