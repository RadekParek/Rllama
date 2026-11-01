/**
 * Ollama daemon operations that are not "send a chat message".
 *
 * Pulling is the interesting one: `/api/pull` streams newline-delimited JSON
 * where each line is a manifest layer or a download progress report, so the UI
 * can show a real percentage instead of a spinner.
 */
import { trimBase } from './providers';
import { transportFetch } from './transport';
import type { Provider } from './types';

export interface PullProgress {
  /** The daemon's own wording: "pulling manifest", "verifying sha256 digest", "success" ... */
  status: string;
  /** 0-100 for the layer currently transferring, when the daemon reports sizes. */
  percent?: number;
  completed?: number;
  total?: number;
}

export interface DaemonProbe {
  url: string;
  ok: boolean;
  version?: string;
  error?: string;
}

/**
 * Addresses worth trying, in order: whatever is configured, then the loopback
 * forms (Termux / Ollama installed on the phone itself), then the Android
 * emulator's host alias.
 */
export function daemonCandidates(current?: string, extras: string[] = []): string[] {
  const list = [
    current,
    'http://127.0.0.1:11434',
    'http://localhost:11434',
    'http://10.0.2.2:11434',
    'http://[::1]:11434',
    ...extras,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of list) {
    const normalised = value.trim().replace(/\/+$/, '');
    if (!seen.has(normalised)) {
      seen.add(normalised);
      out.push(normalised);
    }
  }
  return out;
}

/** Asks one address for /api/version, with a short deadline. */
export async function probeDaemon(url: string, timeoutMs = 1800): Promise<DaemonProbe> {
  const timeoutFactory = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  const signal = timeoutFactory ? timeoutFactory(timeoutMs) : undefined;
  try {
    const response = await transportFetch(`${trimBase(url)}/api/version`, { method: 'GET' }, signal);
    if (!response.ok) {
      return { url, ok: false, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json().catch(() => null)) as { version?: string } | null;
    return { url, ok: true, version: payload?.version };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Probes every candidate at once and reports them with the reachable ones
 * first. This is what makes a stale 127.0.0.1 address self-healing instead of a
 * dead end: the app can move itself to whatever daemon is actually answering.
 */
export async function discoverDaemon(current?: string, extras: string[] = []): Promise<DaemonProbe[]> {
  const probes = await Promise.all(daemonCandidates(current, extras).map((url) => probeDaemon(url)));
  return probes.sort((a, b) => Number(b.ok) - Number(a.ok) || a.url.localeCompare(b.url));
}

function endpoint(provider: Provider, path: string): string {
  return `${trimBase(provider.baseUrl)}${path}`;
}

function headers(provider: Provider): Record<string, string> {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey.trim() && provider.protocol !== 'anthropic') {
    value.Authorization = `Bearer ${provider.apiKey.trim()}`;
  }
  return value;
}

function parseProgress(line: string): PullProgress | null {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const status = typeof record.status === 'string' ? record.status : 'working';
    const total = Number(record.total ?? 0) || undefined;
    const completed = Number(record.completed ?? 0) || undefined;
    return {
      status,
      completed,
      total,
      percent: total && completed ? Math.min(100, Math.round((completed / total) * 100)) : undefined,
    };
  } catch {
    return null;
  }
}

/** Downloads a model into the daemon behind `provider`. */
export async function pullModel(
  provider: Provider,
  model: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<PullProgress> {
  let response: Response;
  try {
    response = await transportFetch(
      endpoint(provider, '/api/pull'),
      {
        method: 'POST',
        headers: headers(provider),
        body: JSON.stringify({ model, name: model, stream: true }),
      },
      signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach the Ollama daemon at ${provider.baseUrl}: ${message}. Is \`ollama serve\` running?`,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const looksHtml = /^\s*(<!doctype html|<html)/i.test(text.slice(0, 200));
    if (looksHtml) {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim() ?? 'no title';
      throw new Error(
        `Pulling “${model}” was blocked (HTTP ${response.status} — ${title}). ` +
          'The daemon returned a web page instead of a pull stream, which happens when the model is cloud-only ' +
          '(it runs on ollama.com and is never downloaded) or when a proxy sits in front of the daemon. ' +
          'Cloud models belong on an Ollama Cloud provider; local pulls should hit the daemon directly at /api/pull.',
      );
    }
    throw new Error(`ollama pull failed (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.body) {
    const text = await response.text();
    const last = text
      .split('\n')
      .map((line) => parseProgress(line))
      .filter((item): item is PullProgress => item !== null)
      .pop();
    const final = last ?? { status: 'success' };
    onProgress(final);
    return final;
  }

  let latest: PullProgress = { status: 'starting' };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        const progress = parseProgress(line);
        if (progress) {
          latest = progress;
          onProgress(progress);
          if (progress.status === 'success') {
            return progress;
          }
        }
      }
      index = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail) {
    const progress = parseProgress(tail);
    if (progress) {
      latest = progress;
      onProgress(progress);
    }
  }
  return latest;
}

/** Removes a model from the daemon. */
export async function deleteModel(provider: Provider, model: string, signal?: AbortSignal): Promise<void> {
  const response = await transportFetch(
    endpoint(provider, '/api/delete'),
    {
      method: 'DELETE',
      headers: headers(provider),
      body: JSON.stringify({ model }),
    },
    signal,
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ollama delete failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
}
