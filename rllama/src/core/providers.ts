import type { Protocol, Provider, ProviderTemplate } from './types';

/**
 * Provider templates that only need an API key.
 *
 * Every base URL here was checked against the provider's own documentation;
 * the two that people get wrong are called out in `hint`:
 *  - Ollama Cloud is `https://ollama.com/v1`, *not* `/api/v1`.
 *  - AgentRouter speaks both protocols: `https://agentrouter.org/v1` for
 *    OpenAI-compatible clients, `https://agentrouter.org` for Anthropic ones
 *    (the Anthropic SDK appends `/v1/messages` itself).
 */
export const TEMPLATES: ProviderTemplate[] = [
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    protocol: 'openai',
    baseUrl: 'https://ollama.com/v1',
    keyUrl: 'https://ollama.com/settings/keys',
    requiresKey: true,
    hint: 'Base URL is https://ollama.com/v1 — the /api/v1 prefix returns 404. Key from your own Ollama account.',
  },
  {
    id: 'ollama-local',
    name: 'Ollama (local)',
    protocol: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    requiresKey: false,
    hint: 'Runs against a local Ollama daemon, including a phone running Rllama/PocketPal on your network.',
  },
  {
    id: 'agentrouter',
    name: 'AgentRouter',
    protocol: 'openai-responses',
    baseUrl: 'https://agentrouter.org/v1',
    keyUrl: 'https://agentrouter.org/console/token',
    requiresKey: true,
    hint: 'Codex reaches AgentRouter with wire_api = "responses" on https://agentrouter.org/v1 — that is the default here. Load models to see what your key exposes.',
    alternates: [
      { protocol: 'openai', baseUrl: 'https://agentrouter.org/v1', label: 'Chat Completions (/chat/completions)' },
      { protocol: 'anthropic', baseUrl: 'https://agentrouter.org', label: 'Anthropic protocol (no /v1)' },
    ],
  },
  {
    id: 'agentrouter-anthropic',
    name: 'AgentRouter (Anthropic wire)',
    protocol: 'anthropic',
    baseUrl: 'https://agentrouter.org',
    keyUrl: 'https://agentrouter.org/console/token',
    requiresKey: true,
    hint: 'Same key, Anthropic wire protocol: the app appends /v1/messages to https://agentrouter.org.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
    hint: 'Hundreds of models behind one key; free models are tagged :free.',
    headers: { 'HTTP-Referer': 'https://rllama.app', 'X-Title': 'Rllama' },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true,
    hint: 'Claude models over /v1/messages.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    requiresKey: true,
    hint: 'Very cheap reasoning models; deepseek-chat and deepseek-reasoner.',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    requiresKey: true,
    hint: 'Long-context Kimi models. Mainland China keys live on api.moonshot.cn — edit the base URL.',
  },
  {
    id: 'groq',
    name: 'Groq',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    requiresKey: true,
    hint: 'Fastest open-model inference; generous free tier.',
  },
  {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    requiresKey: true,
    hint: 'Gemini through its OpenAI-compatible endpoint; free tier available.',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    protocol: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    requiresKey: true,
  },
  {
    id: 'custom-openai',
    name: 'Custom (OpenAI-compatible)',
    protocol: 'openai',
    baseUrl: 'https://example.com/v1',
    requiresKey: true,
    hint: 'Any gateway, vLLM, LM Studio, llama.cpp server or proxy.',
  },
  {
    id: 'custom-anthropic',
    name: 'Custom (Anthropic-compatible)',
    protocol: 'anthropic',
    baseUrl: 'https://example.com',
    requiresKey: true,
    hint: 'Any Claude-compatible gateway; the app appends /v1/messages.',
  },
];

export function templateById(id: string): ProviderTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Trims trailing slashes so path joining cannot produce `//v1`. */
export function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = trimBase(baseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return base + suffix;
}

/** Chat endpoint for a protocol, given the base URL the user configured. */
export function chatEndpoint(protocol: Protocol, baseUrl: string): string {
  switch (protocol) {
    case 'openai':
      return joinUrl(baseUrl, '/chat/completions');
    case 'openai-responses':
      return joinUrl(baseUrl, '/responses');
    case 'anthropic':
      return joinUrl(baseUrl, '/v1/messages');
    case 'ollama':
      return joinUrl(baseUrl, '/api/chat');
  }
}

export function modelsEndpoint(protocol: Protocol, baseUrl: string): string {
  switch (protocol) {
    case 'openai':
    case 'openai-responses':
      return joinUrl(baseUrl, '/models');
    case 'anthropic':
      return joinUrl(baseUrl, '/v1/models');
    case 'ollama':
      return joinUrl(baseUrl, '/api/tags');
  }
}

export function authHeaders(provider: Pick<Provider, 'protocol' | 'apiKey' | 'headers'>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = provider.apiKey.trim();
  if (provider.protocol === 'anthropic') {
    if (key) {
      headers['x-api-key'] = key;
    }
    headers['anthropic-version'] = '2023-06-01';
    // Anthropic only allows browser calls with this opt-in header.
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  if (provider.headers) {
    Object.assign(headers, provider.headers);
  }
  return headers;
}

/** Creates a configured provider instance from a template. */
export function providerFromTemplate(template: ProviderTemplate, apiKey: string, priority: number): Provider {
  return {
    id: `${template.id}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: template.id,
    name: template.name,
    protocol: template.protocol,
    baseUrl: template.baseUrl,
    apiKey,
    priority,
    enabled: true,
    headers: template.headers,
  };
}

/** Parses a model list response for any of the three protocols. */
export function parseModelList(protocol: Protocol, payload: unknown): string[] {
  const record = payload as Record<string, unknown> | null;
  if (!record) {
    return [];
  }
  if (protocol === 'ollama') {
    const models = record.models;
    if (!Array.isArray(models)) {
      return [];
    }
    return models
      .map((entry) => {
        const item = entry as Record<string, unknown>;
        return typeof item.name === 'string' ? item.name : typeof item.model === 'string' ? item.model : '';
      })
      .filter(Boolean);
  }
  const data = record.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      return typeof item.id === 'string' ? item.id : '';
    })
    .filter(Boolean);
}
