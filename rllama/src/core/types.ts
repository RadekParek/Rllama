/**
 * Shared types for Rllama.
 *
 * Rllama talks to three wire protocols only:
 *  - `openai`    : /chat/completions  (OpenAI, AgentRouter, OpenRouter, DeepSeek, Kimi, Groq, Ollama Cloud ...)
 *  - `anthropic` : /v1/messages       (Anthropic, and AgentRouter's Anthropic-compatible mode)
 *  - `ollama`    : /api/chat + /api/tags (a local or remote Ollama daemon)
 *
 * Everything else in the app is built on top of these.
 */

export type Protocol = 'openai' | 'anthropic' | 'ollama';

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  /** Where the user creates a key. */
  keyUrl?: string;
  /** Does this provider need a key at all (local Ollama does not). */
  requiresKey: boolean;
  /** One-line note shown in the template gallery. */
  hint?: string;
  /** Extra request headers (OpenRouter attribution, for example). */
  headers?: Record<string, string>;
  /** Same provider reachable over the other wire protocol. */
  alternates?: Array<{ protocol: Protocol; baseUrl: string; label: string }>;
}

export interface Provider {
  id: string;
  templateId: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  /** Failover order; lower runs first. */
  priority: number;
  enabled: boolean;
  headers?: Record<string, string>;
}

export interface ModelInfo {
  id: string;
  label: string;
  details?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  providerId?: string;
  model?: string;
  /** Set when the request failed; the text is the error. */
  error?: string;
  /** Provider that actually answered after a failover. */
  answeredBy?: string;
}

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  providerId?: string;
  model?: string;
  skillIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Added to the system prompt while the skill is enabled. */
  prompt: string;
  /** Ships with the app; cannot be deleted. */
  builtin?: boolean;
  /** Skills that mainly cut token usage. */
  tokenSaver?: boolean;
}

export interface ProviderUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Optional budget the user typed in (tokens per window). */
  limitTokens?: number;
  windowStartedAt: number;
  /** Last error, so the UI can show why a provider is skipped. */
  lastError?: string;
}

export interface FailoverEvent {
  fromProviderId: string;
  toProviderId: string;
  reason: string;
  at: number;
}
