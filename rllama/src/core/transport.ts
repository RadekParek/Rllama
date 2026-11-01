/**
 * Network transport.
 *
 * Browsers enforce CORS, and most AI gateways do not send CORS headers, which
 * breaks direct calls. Each shell solves that once, in its native layer:
 *
 *  - desktop (Electron): requests go through the main process over IPC, so they
 *    are plain Node requests with no browser origin involved;
 *  - Android (Capacitor): CapacitorHttp rewrites fetch() to the native HTTP
 *    stack, see capacitor.config.ts;
 *  - web: a normal fetch, which works for gateways that do allow browser
 *    origins.
 *
 * This module is the single place that knows about the difference.
 */

export interface DesktopRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  request: (request: DesktopRequest) => Promise<Response>;
  abort: (id: string) => void;
}

declare global {
  interface Window {
    rllama?: DesktopBridge;
  }
}

let counter = 0;

export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.rllama;
}

/** True when running inside the Electron shell. */
export function isDesktop(): boolean {
  return desktopBridge()?.isDesktop === true;
}

export async function transportFetch(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const bridge = desktopBridge();
  if (!bridge) {
    return fetch(url, { ...init, signal });
  }

  const id = `req-${Date.now()}-${counter++}`;
  const headers: Record<string, string> = {};
  const source = init.headers;
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(source)) {
    for (const [key, value] of source) {
      headers[key] = value;
    }
  } else if (source) {
    Object.assign(headers, source as Record<string, string>);
  }

  const abort = () => bridge.abort(id);
  if (signal) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', abort, { once: true });
  }

  try {
    return await bridge.request({
      id,
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abort);
    }
  }
}
