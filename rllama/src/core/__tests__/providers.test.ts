import { describe, expect, it } from 'vitest';
import {
  authHeaders,
  chatEndpoint,
  joinUrl,
  modelsEndpoint,
  parseModelList,
  templateById,
  TEMPLATES,
} from '../providers';

describe('endpoint building', () => {
  it('joins base URLs without creating double slashes', () => {
    expect(joinUrl('https://ollama.com/v1/', '/chat/completions')).toBe('https://ollama.com/v1/chat/completions');
    expect(joinUrl('https://ollama.com/v1', 'chat/completions')).toBe('https://ollama.com/v1/chat/completions');
    expect(joinUrl('http://127.0.0.1:11434/', '/api/chat')).toBe('http://127.0.0.1:11434/api/chat');
  });

  it('uses the documented Ollama Cloud base URL', () => {
    // /api/v1 404s, so the template must be https://ollama.com/v1.
    expect(chatEndpoint('openai', 'https://ollama.com/v1')).toBe('https://ollama.com/v1/chat/completions');
    expect(modelsEndpoint('openai', 'https://ollama.com/v1')).toBe('https://ollama.com/v1/models');
  });

  it('appends /v1/messages only for the anthropic protocol', () => {
    expect(chatEndpoint('anthropic', 'https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages');
    expect(chatEndpoint('anthropic', 'https://agentrouter.org')).toBe('https://agentrouter.org/v1/messages');
    expect(chatEndpoint('openai', 'https://agentrouter.org/v1')).toBe('https://agentrouter.org/v1/chat/completions');
  });

  it('uses the native ollama paths', () => {
    expect(chatEndpoint('ollama', 'http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434/api/chat');
    expect(modelsEndpoint('ollama', 'http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434/api/tags');
  });
});

describe('agentrouter template', () => {
  it('ships both wire protocols with the right bases', () => {
    const template = templateById('agentrouter');
    expect(template).toBeDefined();
    expect(template?.baseUrl).toBe('https://agentrouter.org/v1');
    expect(template?.alternates?.[0]).toMatchObject({
      protocol: 'anthropic',
      baseUrl: 'https://agentrouter.org',
    });
  });
});

describe('auth headers', () => {
  it('uses bearer auth for openai-compatible providers', () => {
    const headers = authHeaders({ protocol: 'openai', apiKey: 'sk-test' });
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('uses x-api-key plus the browser opt-in for anthropic', () => {
    const headers = authHeaders({ protocol: 'anthropic', apiKey: 'sk-ant' });
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers.Authorization).toBeUndefined();
  });

  it('passes template headers such as OpenRouter attribution', () => {
    const openrouter = templateById('openrouter');
    const headers = authHeaders({ protocol: 'openai', apiKey: 'k', headers: openrouter?.headers });
    expect(headers['X-Title']).toBe('Rllama');
  });

  it('omits auth for a keyless local ollama', () => {
    const headers = authHeaders({ protocol: 'ollama', apiKey: '' });
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('model list parsing', () => {
  it('reads openai-style data arrays', () => {
    expect(parseModelList('openai', { data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['b', 'a']);
  });

  it('reads ollama tags', () => {
    expect(parseModelList('ollama', { models: [{ name: 'gemma3:1b' }, { model: 'qwen3:8b' }] })).toEqual([
      'gemma3:1b',
      'qwen3:8b',
    ]);
  });

  it('survives malformed payloads', () => {
    expect(parseModelList('openai', null)).toEqual([]);
    expect(parseModelList('openai', { data: 'nope' })).toEqual([]);
    expect(parseModelList('ollama', { models: [{}] })).toEqual([]);
  });
});

describe('templates', () => {
  it('has unique ids', () => {
    const ids = TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never has a trailing slash in a template base URL', () => {
    for (const template of TEMPLATES) {
      expect(template.baseUrl.endsWith('/')).toBe(false);
    }
  });
});
