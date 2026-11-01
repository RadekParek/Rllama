/**
 * Turning provider failures into something a person can act on.
 *
 * The three that actually bite in practice:
 *  - Cloudflare / WAF pages: the body is HTML, not JSON. "403 Forbidden
 *    <!doctype html>…" is unreadable, and retrying is pointless.
 *  - A key that cannot use the chosen model: 403 with a JSON error body.
 *  - A local daemon that is not running, or `127.0.0.1` on a phone (which
 *    points at the phone, not at the computer running Ollama).
 */

export interface ErrorAdvice {
  /** One line, human wording. */
  summary: string;
  /** What to do about it. Empty when the cause is unknown. */
  fix?: string;
  /** Machine-ish label used for grouping in the error list. */
  kind:
    | 'auth'
    | 'forbidden'
    | 'html-block'
    | 'quota'
    | 'rate-limit'
    | 'not-found'
    | 'model'
    | 'network'
    | 'local-daemon'
    | 'server'
    | 'protocol'
    | 'aborted'
    | 'unknown';
  /** Safe to move to another provider immediately. */
  failover: boolean;
}

const HTML_START = /^\s*(<!doctype html|<html|<\?xml|<head)/i;

/** True when the response body is a web page rather than an API payload. */
export function looksLikeHtml(body: string): boolean {
  return HTML_START.test(body.slice(0, 200));
}

/** Strips tags and collapses whitespace so an HTML error page is readable. */
function htmlToText(body: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.trim();
  const bodyText = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const first = bodyText.slice(0, 160);
  return title && title.length > 0 ? `${title} — ${first}` : first;
}

/** Short host for messages: `ollama.com`, `127.0.0.1:11434`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface AdviceInput {
  status: number;
  body: string;
  url: string;
  protocol: string;
}

export function advise(input: AdviceInput): ErrorAdvice {
  const { status, body, url } = input;
  const host = hostOf(url);
  const html = looksLikeHtml(body);
  const detail = html ? htmlToText(body) : body.trim().slice(0, 300);

  if (status === 0) {
    const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host);
    if (localHost) {
      return {
        kind: 'local-daemon',
        summary: `No Ollama daemon answered at ${host}.`,
        fix:
          'Rllama checks the usual addresses automatically. Start Ollama (`ollama serve`; in Termux `pkg install ollama && ollama serve &`), then open Local backend → Find daemon and it will reconnect.',
        failover: true,
      };
    }
    return {
      kind: 'network',
      summary: `Network error contacting ${host}: ${detail || 'the request did not complete'}.`,
      fix:
        'Check the base URL (no trailing /v1/v1), your connection, and any VPN or firewall. A wrong DNS name and an offline device look identical from here.',
      failover: true,
    };
  }

  if (html) {
    return {
      kind: 'html-block',
      summary:
        status === 403
          ? `403 from ${host}: the gateway returned a web page instead of the API — a bot/WAF check blocked the request.`
          : `HTTP ${status} from ${host}: the gateway returned a web page instead of an API response.`,
      fix:
        'This is not a model or key problem. Usually a Cloudflare challenge on the browser origin: open the URL in a normal browser, check whether the host requires an app-specific API domain, or use the desktop/Android build (their requests run natively, not from a browser origin). ' +
        (detail ? `Server said: ${detail}` : ''),
      failover: true,
    };
  }

  switch (status) {
    case 401:
      return {
        kind: 'auth',
        summary: `401 from ${host}: the key was rejected.`,
        fix: 'Paste the key again — watch for a leading/trailing space, a truncated copy, or a key from a different environment (test vs live).',
        failover: true,
      };
    case 403:
      return {
        kind: 'forbidden',
        summary: `403 from ${host}: the key is valid but not allowed to do this.`,
        fix:
          'Most often the account cannot use that specific model. Check that the model id exists for this key (press “Load models”), that billing/verification is complete, or switch to another provider.',
        failover: true,
      };
    case 402:
      return {
        kind: 'quota',
        summary: `402 from ${host}: the account is out of credit.`,
        fix: 'Top up the account, or let failover move this chat to another provider.',
        failover: true,
      };
    case 404:
      return {
        kind: 'not-found',
        summary: `404 from ${host}: the endpoint or model does not exist.`,
        fix:
          input.protocol === 'ollama'
            ? 'The Ollama daemon answered, but not at this path — the base URL must be the daemon root, without /api.'
            : 'Check the base URL. Ollama Cloud is https://ollama.com/v1; some gateways want the bare host for the Anthropic protocol. If the URL is right, the model id is wrong.',
        failover: true,
      };
    case 429:
      return {
        kind: 'rate-limit',
        summary: `429 from ${host}: rate limited or out of quota for now.`,
        fix: 'Wait, or let failover continue the same message on another provider.',
        failover: true,
      };
    case 400:
    case 422:
      return {
        kind: 'model',
        summary: `HTTP ${status} from ${host}: the request was rejected.`,
        fix: /model/i.test(body)
          ? 'The model id is probably not available to this key — press “Load models” to see the real list.'
          : 'Read the message above. A wire-API mismatch (chat-completions vs responses) also lands here — try “Switch wire API”.',
        failover: false,
      };
    default:
      if (status >= 500) {
        return {
          kind: 'server',
          summary: `HTTP ${status} from ${host}: the provider had a server error.`,
          fix: 'Not your fault. Retry, or let failover use another provider.',
          failover: true,
        };
      }
      return {
        kind: 'unknown',
        summary: `HTTP ${status}: ${detail || 'no details returned'}`,
        fix: '',
        failover: status >= 500,
      };
  }
}
