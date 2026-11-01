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

/**
 * Daemon handling.
 *
 * Two things used to go wrong here and both are fixed in this module:
 *
 *  1. A pull was sent to whichever Ollama provider sat first in the list, so
 *     with an Ollama Cloud provider present it went to `https://ollama.com/v1`
 *     and came back as a Cloudflare HTML 403 — a web page where a pull stream
 *     was expected. Pulls only ever belong on a local daemon.
 *  2. The daemon address was treated as fixed. It is not: on a phone it is the
 *     phone itself; on a desktop it may be a machine on the LAN; and the port
 *     or scheme can be mis-typed. Discovery, plus a LAN scan where the platform
 *     allows it, replaces "edit the URL until it works".
 */

/** True when a URL points at the hosted Ollama service rather than a daemon. */
export function isOllamaCloudUrl(url: string): boolean {
  const trimmed = url.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(trimmed);
  const host = withScheme ? trimmed.slice(withScheme[0].length).split(/[/:?#]/)[0] : trimmed.split(/[/:?#]/)[0];
  return /(^|\.)ollama\.com$/i.test(host);
}

/** True for an Ollama protocol provider that is not the cloud service. */
export function isLocalDaemon(provider: Provider): boolean {
  if (provider.protocol !== 'ollama') {
    return false;
  }
  return !isOllamaCloudUrl(provider.baseUrl);
}

/** The first usable local daemon: enabled ones first, then disabled ones. */
export function localDaemon(providers: Provider[]): Provider | undefined {
  return (
    providers.find((provider) => provider.enabled && isLocalDaemon(provider)) ??
    providers.find(isLocalDaemon)
  );
}

/**
 * Normalises a daemon URL: no trailing slash, and no `/v1` suffix, because the
 * native API lives at `/api/...` on the bare host.
 */
export function daemonBase(url: string): string {
  let value = url.trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(value)) {
    value = value.replace(/\/v1$/i, '');
  }
  return value;
}

/** Models tagged `-cloud` run on ollama.com and are never downloaded. */
export function isCloudOnlyModel(model: string): boolean {
  return /-cloud(:|$)/i.test(model) || /:cloud$/i.test(model);
}

export type PullPlan =
  | { ok: true; url: string; model: string; daemonName: string; providerId: string }
  | { ok: false; reason: string; short: string };

/**
 * Decides where a pull must go, or explains why it cannot go anywhere.
 *
 * `requested` is either a provider id (from the catalogue) or empty; a cloud
 * provider is never chosen, and a `-cloud` model is refused before a request is
 * made, so the user gets a sentence instead of an HTML 403 page.
 */
export function planPull(providers: Provider[], requested: string | undefined, model: string): PullPlan {
  if (isCloudOnlyModel(model)) {
    return {
      ok: false,
      short: `${model} is a cloud model.`,
      reason:
        `${model} is tagged cloud: it runs on ollama.com and is never downloaded. ` +
        'Add an Ollama Cloud provider to chat with it, or pick a local model.',
    };
  }

  const requestedProvider = providers.find((provider) => provider.id === requested);
  const daemon =
    (requestedProvider && isLocalDaemon(requestedProvider) ? requestedProvider : undefined) ??
    localDaemon(providers);

  if (!daemon) {
    const cloud = providers.find((provider) => provider.protocol === 'ollama');
    return {
      ok: false,
      short: 'No local Ollama daemon configured.',
      reason: cloud
        ? `Pulls cannot go to ${daemonBase(cloud.baseUrl)} — that is Ollama Cloud, and it answers a pull with an HTML 403 page. ` +
          'Add a local Ollama provider (Local backend → Start daemon) and Rllama will download into it.'
        : 'Add a local Ollama provider first (Local backend → Start daemon), then pull again.',
    };
  }

  return { ok: true, url: daemonBase(daemon.baseUrl), model, daemonName: daemon.name, providerId: daemon.id };
}

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

/**
 * Downloads a model into a *local daemon*.
 *
 * Taking a URL rather than a provider is deliberate: it makes it impossible to
 * aim a pull at Ollama Cloud by accident.
 */
export async function pullModel(
  daemonUrl: string,
  model: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<PullProgress> {
  const url = `${daemonBase(daemonUrl)}/api/pull`;
  if (isOllamaCloudUrl(url)) {
    throw new Error(
      'Refusing to pull from ollama.com: cloud models are never downloaded. Add an Ollama Cloud provider to chat instead.',
    );
  }
  let response: Response;
  try {
    response = await transportFetch(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, name: model, stream: true }),
      },
      signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No Ollama daemon answered at ${daemonBase(daemonUrl)}: ${message}.`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const looksHtml = /^\s*(<!doctype html|<html)/i.test(text.slice(0, 200));
    if (looksHtml) {
      throw new Error(
        `Pulling ${model} was refused by ${daemonBase(daemonUrl)} (HTTP ${response.status}, web page instead of a pull stream). ` +
          'Either the model is cloud-only, or a proxy/firewall sits in front of the daemon. ' +
          'Rllama now pulls only from the local daemon; add an Ollama Cloud provider for cloud models.',
      );
    }
    if (response.status === 404) {
      throw new Error(
        `${model} is not in the daemon's registry (HTTP 404). Check the spelling, or pull a model the library has.`,
      );
    }
    throw new Error(`Pull failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
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
