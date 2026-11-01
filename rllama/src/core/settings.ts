import type { ChatMessage, Effort, Settings } from './types';

/** Defaults chosen to be safe on a phone: short replies, roomy history. */
export const DEFAULT_SETTINGS: Settings = {
  effort: 'medium',
  maxTokens: 4096,
  contextTokens: 1_000_000,
  temperature: 0.7,
  agentMode: true,
  showLogos: true,
};

export const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const CONTEXT_PRESETS = [128_000, 256_000, 512_000, 1_000_000, 2_000_000];

/** Tokens ≈ characters / 4, the same estimate the usage ledger uses. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/**
 * Keeps the newest turns that fit the context budget.
 *
 * The alternative — sending everything and letting the provider 400 — produces
 * exactly the kind of opaque error this app is trying to remove.
 */
export function trimHistory(messages: ChatMessage[], contextTokens: number): ChatMessage[] {
  if (contextTokens <= 0) {
    return messages;
  }
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = estimateTokens(message.content) + 4;
    if (used + cost > contextTokens && kept.length > 0) {
      break;
    }
    used += cost;
    kept.unshift(message);
  }
  return kept;
}

/** Agent preamble, applied on top of the skills when agent mode is on. */
export const AGENT_PREAMBLE = [
  'You are an agent, not a chat assistant.',
  'Work in this loop: understand the goal, state a short plan, do the work, verify it, then report what changed.',
  'Prefer concrete artefacts (files, commands, diffs, URLs) over advice. When something is uncertain, say what you would check and how, instead of guessing.',
  'Never claim a result you did not verify; label unverified steps as unverified.',
].join('\n');
