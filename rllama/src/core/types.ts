/**
 * Shared types for Rllama.
 *
 * Rllama talks to four wire protocols only:
 *  - `openai`           : /chat/completions (OpenAI, OpenRouter, DeepSeek, Kimi, Groq, Ollama Cloud ...)
 *  - `openai-responses` : /responses        (the newer OpenAI wire API; this is what
 *                         Codex uses via `wire_api = "responses"`, and the only mode
 *                         that exposes some AgentRouter models)
 *  - `anthropic`        : /v1/messages       (Anthropic, and AgentRouter's Anthropic mode)
 *  - `ollama`           : /api/chat + /api/tags (a local or remote Ollama daemon)
 *
 * Everything else in the app is built on top of these.
 */

export type Protocol = 'openai' | 'openai-responses' | 'anthropic' | 'ollama';

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
  /** Context window in tokens, when the provider reports one. */
  context?: number;
}

/** A model from the bundled Ollama catalog (https://ollama.com/search). */
export interface CatalogModel {
  /** Canonical pull name: `llama3.1`, `treyleo16/claude-mythos-5-1`. */
  name: string;
  description: string;
  /** tools | thinking | vision | embedding | audio | cloud ... */
  capabilities: string[];
  /** Other ids the same family is known by. */
  aliases?: string[];
  /** Tag sizes the family publishes, e.g. ["1b", "8b", "70b"]. */
  sizes?: string[];
  context?: string;
  downloads?: string;
  /** Runs on ollama.com rather than on this machine. */
  cloud?: boolean;
}

/** Reasoning effort, expanded from Codex's control to six named levels. */
export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'ultracode';

export interface Settings {
  effort: Effort;
  /** Cap on the reply length, in tokens. */
  maxTokens: number;
  /** How many tokens of history to send before trimming the oldest turns. */
  contextTokens: number;
  temperature: number;
  /** Agent preamble: plan, act, verify instead of plain chat. */
  agentMode: boolean;
  /** Vendor marks next to model names. */
  showLogos: boolean;
}

/** An MCP server definition; configuration only for now. */
export interface McpServer {
  id: string;
  name: string;
  /** stdio command or http(s) URL. */
  target: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
}

/** One target of a parallel run: several models answering the same prompt. */
export interface ParallelTarget {
  providerId: string;
  model: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  /** Answers produced by one parallel send share a group id. */
  groupId?: string;
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
  effort?: Effort;
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
