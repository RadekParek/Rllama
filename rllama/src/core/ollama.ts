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
