import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  daemonBase,
  discoverDaemon,
  isCloudOnlyModel,
  isLocalDaemon,
  localDaemon,
  planPull,
  pullModel,
} from '../ollama';
import { hfModelRef, huggingFaceRepo, isGgufName, quantFromFilename, searchHuggingFace } from '../huggingface';
import { importGgufCommand, runCommand, terminalInfo } from '../terminal';
import type { Provider } from '../types';

/**
 * The local half of the app: where a pull may go, what a daemon address means,
 * how Hugging Face references are built, and what the terminal does when there
 * is no shell. All of these were sources of real bugs, so they are pinned.
 */

function provider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p',
    templateId: 'custom',
    name: 'Provider',
    protocol: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    apiKey: '',
    priority: 0,
    enabled: true,
    ...overrides,
  };
}

const local = provider({ id: 'local', name: 'Ollama (local)' });
const cloud = provider({
  id: 'cloud',
  name: 'Ollama Cloud',
  baseUrl: 'https://ollama.com/v1',
  apiKey: 'k',
});
const anthropic = provider({ id: 'a', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('daemon addresses', () => {
  it('normalises a URL and drops a /v1 suffix', () => {
    expect(daemonBase('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    expect(daemonBase('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434');
    expect(daemonBase(' https://ollama.com/v1 ')).toBe('https://ollama.com');
  });

  it('knows which providers are local daemons', () => {
    expect(isLocalDaemon(local)).toBe(true);
    expect(isLocalDaemon(cloud)).toBe(false);
    expect(isLocalDaemon(anthropic)).toBe(false);
    expect(localDaemon([cloud, local])?.id).toBe('local');
    expect(localDaemon([cloud])).toBeUndefined();
  });

  it('treats -cloud tags as cloud-only models', () => {
    expect(isCloudOnlyModel('gemma4:31b-cloud')).toBe(true);
    expect(isCloudOnlyModel('kimi-k2:cloud')).toBe(true);
    expect(isCloudOnlyModel('gemma4:12b')).toBe(false);
    expect(isCloudOnlyModel('qwen3:8b')).toBe(false);
  });
});

describe('where a pull may go', () => {
  it('picks the local daemon even when a cloud provider has a lower priority', () => {
    const plan = planPull([cloud, local], 'cloud', 'llama3.2:3b');
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.url).toBe('http://127.0.0.1:11434');
      expect(plan.providerId).toBe('local');
    }
  });

  it('refuses a cloud-only model before any request is made', () => {
    const plan = planPull([cloud, local], 'local', 'gemma4:31b-cloud');
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toMatch(/never downloaded/i);
      expect(plan.reason).toMatch(/Ollama Cloud/);
    }
  });

  it('explains the 403 when only Ollama Cloud is configured', () => {
    const plan = planPull([cloud], 'cloud', 'llama3.2:3b');
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toMatch(/HTML 403/);
      expect(plan.short).toMatch(/No local Ollama daemon/i);
    }
  });

  it('accepts an hf.co reference as a model name', () => {
    const plan = planPull([local], 'local', 'hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M');
    expect(plan.ok).toBe(true);
  });
});

describe('pullModel', () => {
  it('posts to /api/pull on the daemon and sends no credentials', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"status":"success"}\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const progress: string[] = [];
    await pullModel('http://127.0.0.1:11434/v1', 'llama3.2:3b', (update) => progress.push(update.status));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/pull');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(progress).toEqual(['success']);
  });

  it('refuses an ollama.com endpoint outright', async () => {
    await expect(pullModel('https://ollama.com/v1', 'llama3.2:3b', () => undefined)).rejects.toThrow(
      /Refusing to pull from ollama\.com/,
    );
  });

  it('turns an HTML 403 into a short explanation instead of a page dump', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!doctype html><html><head><title>403 Forbidden</title></head></html>', {
            status: 403,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );

    await expect(pullModel('http://127.0.0.1:11434', 'treyleo16/claude-oss', () => undefined)).rejects.toThrow(
      /web page instead of a pull stream/,
    );
  });

  it('reports a 404 as a registry miss', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not found"}', { status: 404 })));
    await expect(pullModel('http://127.0.0.1:11434', 'nope:1b', () => undefined)).rejects.toThrow(/HTTP 404/);
  });
});

describe('hugging face references', () => {
  it('reads the quantisation out of a file name', () => {
    expect(quantFromFilename('Qwen2.5-7B-Instruct-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(quantFromFilename('llama-3.2-3b.Q8_0.gguf')).toBe('Q8_0');
    expect(quantFromFilename('model-f16.gguf')).toBe('F16');
    expect(quantFromFilename('model.gguf')).toBeUndefined();
    expect(isGgufName('a.GGUF')).toBe(true);
    expect(isGgufName('a.bin')).toBe(false);
  });

  it('builds a single-file reference without a tag and a multi-file one with a quant', () => {
    expect(hfModelRef('user/repo', { name: 'model.gguf' }, 1)).toBe('hf.co/user/repo');
    expect(hfModelRef('user/repo', { name: 'a-Q4_K_M.gguf', quant: 'Q4_K_M' }, 3)).toBe('hf.co/user/repo:Q4_K_M');
    expect(hfModelRef('user/repo', { name: 'odd-name.gguf' }, 2)).toBe('hf.co/user/repo:odd-name.gguf');
  });

  it('maps a search response and ignores entries without a namespace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { id: 'bartowski/Qwen2.5-7B-GGUF', downloads: 1200, likes: 4 },
              { id: 'no-namespace', downloads: 5, likes: 0 },
            ]),
            { status: 200 },
          ),
      ),
    );

    const repos = await searchHuggingFace('qwen');
    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({ id: 'bartowski/Qwen2.5-7B-GGUF', downloads: 1200, likes: 4, updated: undefined });
  });

  it('keeps only .gguf siblings, largest first, each with a usable reference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'user/repo',
              siblings: [
                { rfilename: 'README.md' },
                { rfilename: 'model-Q4_K_M.gguf', size: 4000 },
                { rfilename: 'model-Q8_0.gguf', size: 8000 },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const detail = await huggingFaceRepo('user/repo');
    expect(detail.files.map((file) => file.name)).toEqual(['model-Q8_0.gguf', 'model-Q4_K_M.gguf']);
    expect(detail.refs.map((entry) => entry.ref)).toEqual(['hf.co/user/repo:Q8_0', 'hf.co/user/repo:Q4_K_M']);
  });
});

describe('terminal', () => {
  it('says there is no shell in a plain build instead of pretending', async () => {
    const info = await terminalInfo();
    expect(info.canRun).toBe(false);
    expect(info.host).toBe('unavailable');

    const result = await runCommand('ollama list');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/desktop and Android/);
  });

  it('builds an import command that names the model and the file', () => {
    const command = importGgufCommand('/storage/emulated/0/Download/tiny.Q4_K_M.gguf', 'PocketPal Tiny');
    expect(command).toContain("echo 'FROM /storage/emulated/0/Download/tiny.Q4_K_M.gguf'");
    expect(command).toContain('ollama create PocketPal-Tiny');
    expect(command).toContain('$HOME/.rllama/PocketPal-Tiny.Modelfile');
  });
});

describe('discovery', () => {
  it('still sorts a reachable daemon to the front', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).startsWith('http://localhost:11434')) {
          return new Response(JSON.stringify({ version: '0.9.0' }), { status: 200 });
        }
        throw new TypeError('Failed to fetch');
      }),
    );

    const probes = await discoverDaemon('http://127.0.0.1:11434');
    expect(probes[0].url).toBe('http://localhost:11434');
    expect(probes[0].ok).toBe(true);
  });
});
