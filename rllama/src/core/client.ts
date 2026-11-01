import {
  authHeaders,
  chatEndpoint,
  modelsEndpoint,
  parseModelList,
} from './providers';
import { advise, type ErrorAdvice } from './errors';
import { createNdjsonParser, createSseParser } from './sse';
import { transportFetch } from './transport';
import type { ChatMessage, Effort, ModelInfo, Protocol, Provider, TokenUsage } from './types';

/** An HTTP or protocol failure from a provider. */
export class ProviderError extends Error {
  readonly status: number;
  readonly body: string;
  readonly advice: ErrorAdvice;

  constructor(status: number, body: string, url = '', protocol = 'openai') {
    const advice = advise({ status, body, url, protocol });
    super(advice.fix ? `${advice.summary}\n\n${advice.fix}` : advice.summary);
    this.name = 'ProviderError';
    this.status = status;
    this.body = body;
    this.advice = advice;
  }

  get kind(): ErrorAdvice['kind'] {
    return this.advice.kind;
  }

  /** True when the same provider may work over a different wire protocol. */
  get isProtocolMismatch(): boolean {
    if (this.status === 404) {
      return true;
    }
    if (this.status !== 400 && this.status !== 422) {
      return false;
    }
    const body = this.body.toLowerCase();
    return (
      body.includes('not supported') ||
      body.includes('unsupported') ||
      body.includes('responses') ||
      body.includes('chat/completions') ||
      body.includes('wire')
    );
  }

  /** True for conditions where moving to another provider makes sense. */
  get isFailoverWorthy(): boolean {
    return this.advice.failover;
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
  /** Codex-style effort control, mapped per wire API. */
  effort?: Effort;
  temperature?: number;
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

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
  protocol: Protocol,
): Promise<Response> {
  let response: Response;
  try {
    response = await transportFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      signal,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderError(0, message, url, protocol);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(response.status, text, url, protocol);
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
  const { provider, model, messages, system, maxTokens, effort, temperature, signal, handlers } = request;
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
      ...(effort === 'high' ? { think: true } : {}),
      ...(maxTokens || temperature !== undefined
        ? { options: { ...(maxTokens ? { num_predict: maxTokens } : {}), ...(temperature !== undefined ? { temperature } : {}) } }
        : {}),
    };
    const response = await post(url, headers, payload, signal, provider.protocol);
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
      ...(temperature !== undefined ? { temperature } : {}),
      ...(system ? { system } : {}),
      messages: messages.filter((message) => message.role !== 'system'),
    };
    const response = await post(url, headers, payload, signal, provider.protocol);
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
  } else if (provider.protocol === 'openai-responses') {
    // OpenAI Responses wire API — the one Codex selects with
    // `wire_api = "responses"`. AgentRouter exposes some models only here.
    const input = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content: [
          {
            type: message.role === 'user' ? 'input_text' : 'output_text',
            text: message.content,
          },
        ],
      }));
    const payload: Record<string, unknown> = { model, input, stream: true };
    if (system) {
      payload.instructions = system;
    }
    if (effort) {
      // Responses API uses the structured reasoning object.
      payload.reasoning = { effort };
    }
    if (temperature !== undefined) {
      payload.temperature = temperature;
    }
    if (maxTokens) {
      payload.max_output_tokens = maxTokens;
    }
    const response = await post(url, headers, payload, signal, provider.protocol);
    const parser = createSseParser((event) => {
      const record = safeJson(event.data);
      if (!record) {
        return;
      }
      const type = typeof record.type === 'string' ? record.type : event.event;
      switch (type) {
        case 'response.output_text.delta':
          if (typeof record.delta === 'string') {
            emit(record.delta);
          }
          break;
        case 'response.output_text.done':
          // Some gateways stream no deltas and only report the final text.
          if (!text && typeof record.text === 'string') {
            emit(record.text);
          }
          break;
        case 'response.output_item.done': {
          const item = record.item as Record<string, unknown> | undefined;
          const content = item?.content;
          if (!text && Array.isArray(content)) {
            for (const part of content) {
              const piece = part as Record<string, unknown>;
              if (typeof piece.text === 'string') {
                emit(piece.text);
              }
            }
          }
          break;
        }
        case 'response.completed':
        case 'response.incomplete': {
          const result = record.response as Record<string, unknown> | undefined;
          const found = result?.usage as Record<string, unknown> | undefined;
          if (found) {
            usage.promptTokens = Number(found.input_tokens ?? 0) || usage.promptTokens;
            usage.completionTokens = Number(found.output_tokens ?? 0) || usage.completionTokens;
          }
          if (result && typeof result.model === 'string') {
            handlers.onModel?.(result.model);
          }
          break;
        }
        case 'response.failed':
        case 'error': {
          const result = record.response as Record<string, unknown> | undefined;
          const error = (record.error ?? result?.error) as Record<string, unknown> | undefined;
          throw new ProviderError(0, String(error?.message ?? 'responses stream error'));
        }
        default:
          break;
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
    if (temperature !== undefined) {
      payload.temperature = temperature;
    }
    if (effort) {
      // Chat Completions takes the flat field; gateways ignore it when they
      // do not support reasoning models.
      payload.reasoning_effort = effort;
    }
    const response = await post(url, headers, payload, signal, provider.protocol);
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

/** Reads optional context lengths from a /models payload. */
function contextLengths(payload: unknown): Record<string, number> {
  const found: Record<string, number> = {};
  const record = payload as Record<string, unknown> | null;
  const data = record?.data;
  if (!Array.isArray(data)) {
    return found;
  }
  for (const entry of data) {
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string') {
      continue;
    }
    const context = Number(item.context_length ?? item.context_window ?? item.max_context_length ?? 0);
    if (context > 0) {
      found[item.id] = context;
    }
  }
  return found;
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
    response = await transportFetch(url, { headers: authHeaders(provider) }, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderError(0, message, url, provider.protocol);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(response.status, text, url, provider.protocol);
  }
  const payload: unknown = await response.json().catch(() => null);
  const contextById = contextLengths(payload);
  return parseModelList(provider.protocol, payload)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: id, context: contextById[id] }));
}
