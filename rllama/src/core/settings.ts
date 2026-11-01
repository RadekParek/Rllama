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

export interface EffortMeta {
  id: Effort;
  label: string;
  /** Colour used for the pill and the dot. */
  color: string;
  /** What the level actually does. */
  description: string;
  /** Value sent to providers that understand reasoning effort. */
  api: string;
}

/**
 * Six levels, from "answer without deliberating" to "verify everything".
 * `ultracode` is the top end: maximum provider effort plus an extra directive,
 * shown with an animated gradient so it is unmistakable.
 */
export const EFFORT_META: Record<Effort, EffortMeta> = {
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    color: '#5b8def',
    description: 'Direct answers, no deliberation. Cheapest.',
    api: 'minimal',
  },
  low: {
    id: 'low',
    label: 'Low',
    color: '#7fb87f',
    description: 'Short reasoning, quick checks.',
    api: 'low',
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    color: '#d9b26a',
    description: 'Balanced default.',
    api: 'medium',
  },
  high: {
    id: 'high',
    label: 'High',
    color: '#e08b52',
    description: 'Thinks before writing, checks its own work.',
    api: 'high',
  },
  max: {
    id: 'max',
    label: 'Max',
    color: '#e2685c',
    description: 'Longest reasoning the provider allows, larger reply budget.',
    api: 'high',
  },
  ultracode: {
    id: 'ultracode',
    label: 'Ultracode',
    color: '#a855f7',
    description: 'Max effort plus a verify-every-step directive.',
    api: 'high',
  },
};

export const EFFORT_ORDER: Effort[] = ['minimal', 'low', 'medium', 'high', 'max', 'ultracode'];

export const EFFORT_LABELS: Record<Effort, string> = Object.fromEntries(
  EFFORT_ORDER.map((id) => [id, EFFORT_META[id].label]),
) as Record<Effort, string>;

/** Extra system instruction for the top level. */
export const ULTRACODE_PREAMBLE = [
  'ULTRACODE: maximum rigour.',
  'Break the task into explicit steps, state assumptions, verify each result before using it, and re-check the final answer against the request.',
  'Prefer evidence over recollection; when something cannot be verified, say so plainly.',
].join('\n');

/** Provider-facing effort value (max/ultracode both run at the provider ceiling). */
export function apiEffort(effort: Effort): string {
  return EFFORT_META[effort]?.api ?? 'medium';
}

/** Reply budget that grows with effort, unless the user set a hard cap. */
export function effortMaxTokens(effort: Effort, configured: number): number {
  if (effort === 'max' || effort === 'ultracode') {
    return Math.max(configured, 8192);
  }
  return configured;
}

/**
 * Display name for a model: `treyleo16/Opus-5.5` reads `Opus-5.5`.
 * Namespaces are registry detail; the tag stays, because `gemma4:31b-cloud`
 * and `gemma4:12b` are different models.
 */
export function modelShortName(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

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
