import { providerFromTemplate, templateById } from './providers';
import { DEFAULT_SETTINGS } from './settings';
import { emptyUsage, type UsageMap } from './usage';
import type { McpServer, ModelInfo, ParallelTarget, Provider, Settings, Skill, Thread } from './types';

export interface PersistedState {
  version: number;
  providers: Provider[];
  threads: Thread[];
  activeThreadId?: string;
  /** Last model used per provider, so switching back keeps the choice. */
  modelByProvider: Record<string, string>;
  /** Models each key actually exposes, cached so a reload is not a blank list. */
  modelsByProvider: Record<string, ModelInfo[]>;
  usage: UsageMap;
  customSkills: Skill[];
  skillIds: string[];
  failoverEnabled: boolean;
  systemPrompt: string;
  settings: Settings;
  mcpServers: McpServer[];
  /** Models answering the same prompt at once (empty = single model). */
  parallel: ParallelTarget[];
  /** Models the user pinned to the picker without fetching them. */
  pinnedModels: Record<string, ModelInfo[]>;
}

export const STORAGE_KEY = 'rllama.state.v2';

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newThread(skillIds: string[] = []): Thread {
  const now = Date.now();
  return {
    id: uid('thread'),
    title: 'New chat',
    messages: [],
    skillIds,
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyState(): PersistedState {
  const thread = newThread();
  return {
    version: 2,
    providers: [],
    threads: [thread],
    activeThreadId: thread.id,
    modelByProvider: {},
    modelsByProvider: {},
    usage: {},
    customSkills: [],
    skillIds: ['caveman', 'rea', 'openrouter'],
    failoverEnabled: true,
    systemPrompt: '',
    settings: { ...DEFAULT_SETTINGS },
    mcpServers: [],
    parallel: [],
    pinnedModels: {},
  };
}

/**
 * A first-run state with the providers most people want, left disabled until a
 * key is added. Nothing is enabled silently and no key is invented.
 */
export function initialState(): PersistedState {
  const state = emptyState();
  const wanted = [
    'ollama-cloud',
    'ollama-local',
    'agentrouter',
    'openrouter',
    'anthropic',
    'openai',
    'deepseek',
    'kimi',
  ];
  const providers: Provider[] = [];
  wanted.forEach((templateId, index) => {
    const template = templateById(templateId);
    if (!template) {
      return;
    }
    const provider = providerFromTemplate(template, '', index);
    provider.enabled = !template.requiresKey;
    providers.push(provider);
  });
  state.providers = providers;
  const local = providers.find((provider) => provider.templateId === 'ollama-local');
  const cloud = providers.find((provider) => provider.templateId === 'ollama-cloud');
  state.threads[0].providerId = local?.id ?? cloud?.id;

  // Seed what the app ships with, so a first launch has something to pick:
  // a tiny local model that runs on a phone, plus the cloud ids Ollama exposes
  // without a separate download.
  if (local) {
    state.pinnedModels[local.id] = [{ id: 'treyleo16/claude-oss', label: 'treyleo16/claude-oss' }];
    state.modelByProvider[local.id] = 'treyleo16/claude-oss';
  }
  if (cloud) {
    state.pinnedModels[cloud.id] = [
      { id: 'gemma4:31b-cloud', label: 'gemma4:31b-cloud' },
      { id: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash' },
      { id: 'glm-5.3', label: 'glm-5.3' },
      { id: 'muse-spark-open', label: 'muse-spark-open' },
      { id: 'treyleo16/claude-mythos-5-1', label: 'treyleo16/claude-mythos-5-1' },
    ];
    state.modelByProvider[cloud.id] = 'gemma4:31b-cloud';
  }
  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Loads and repairs persisted state; never throws. */
export function loadState(storage: Storage | undefined = safeStorage()): PersistedState {
  if (!storage) {
    return initialState();
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return initialState();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 2) {
      return initialState();
    }
    const base = emptyState();
    const providers = Array.isArray(parsed.providers) ? (parsed.providers as Provider[]) : [];
    const threads = Array.isArray(parsed.threads) && parsed.threads.length > 0 ? (parsed.threads as Thread[]) : base.threads;
    return {
      version: 2,
      providers: providers.filter((provider) => provider && typeof provider.id === 'string'),
      threads,
      activeThreadId: typeof parsed.activeThreadId === 'string' ? parsed.activeThreadId : threads[0].id,
      modelByProvider: isRecord(parsed.modelByProvider) ? (parsed.modelByProvider as Record<string, string>) : {},
      modelsByProvider: isRecord(parsed.modelsByProvider)
        ? (parsed.modelsByProvider as Record<string, ModelInfo[]>)
        : {},
      usage: isRecord(parsed.usage) ? (parsed.usage as UsageMap) : {},
      customSkills: Array.isArray(parsed.customSkills) ? (parsed.customSkills as Skill[]) : [],
      skillIds: Array.isArray(parsed.skillIds) ? (parsed.skillIds as string[]) : [],
      failoverEnabled: parsed.failoverEnabled !== false,
      systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '',
      settings: isRecord(parsed.settings) ? { ...DEFAULT_SETTINGS, ...(parsed.settings as unknown as Partial<Settings>) } : { ...DEFAULT_SETTINGS },
      mcpServers: Array.isArray(parsed.mcpServers) ? (parsed.mcpServers as McpServer[]) : [],
      parallel: Array.isArray(parsed.parallel) ? (parsed.parallel as ParallelTarget[]) : [],
      pinnedModels: isRecord(parsed.pinnedModels) ? (parsed.pinnedModels as Record<string, ModelInfo[]>) : {},
    };
  } catch {
    return initialState();
  }
}

export function saveState(state: PersistedState, storage: Storage | undefined = safeStorage()): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or private mode: the session continues in memory.
  }
}

export function safeStorage(): Storage | undefined {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return undefined;
    }
    const probe = '__rllama_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Usage helper used when a provider is deleted: keep the ledger tidy. */
export function pruneUsage(usage: UsageMap, providers: Provider[]): UsageMap {
  const ids = new Set(providers.map((provider) => provider.id));
  const next: UsageMap = {};
  for (const [id, entry] of Object.entries(usage)) {
    if (ids.has(id)) {
      next[id] = entry ?? emptyUsage();
    }
  }
  return next;
}
