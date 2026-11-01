import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listModels, ProviderError, streamChat } from './core/client';
import { pullModel, type PullProgress } from './core/ollama';
import { AGENT_PREAMBLE, EFFORT_LABELS, trimHistory } from './core/settings';
import { allSkills, buildSystemPrompt, PINNED_SKILLS } from './core/skills';
import { loadState, newThread, pruneUsage, saveState, uid, type PersistedState } from './core/store';
import {
  chooseProvider,
  clearProviderError,
  emptyUsage,
  formatTokens,
  markProviderError,
  nextProvider,
  recordUsage,
  resetWindow,
  setLimit,
  usageLevel,
  usageOf,
  usageRatio,
  type UsageMap,
} from './core/usage';
import type { ChatMessage, Effort, Message, ModelInfo, ParallelTarget, Provider, Skill, Thread } from './core/types';
import { Drawer } from './ui/Drawer';
import { Composer, ModelPicker, ThreadView, TopBar, type PanelId, type SlashCommand } from './ui/Shell';
import { MenuPanel, type MenuTarget } from './ui/panels/Menu';
import { ProvidersPanel } from './ui/panels/Providers';
import { SkillsPanel } from './ui/panels/Skills';
import { CatalogPanel, type PullState } from './ui/panels/Catalog';
import { UsagePanel } from './ui/panels/Usage';
import { SettingsPanel } from './ui/panels/Settings';
import { CliPanel, McpPanel } from './ui/panels/Workspace';
import { LocalPanel } from './ui/panels/Local';

const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high'];

export default function App(): React.ReactElement {
  const [state, setState] = useState<PersistedState>(() => loadState());
  const [panel, setPanel] = useState<PanelId>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [modelStatus, setModelStatus] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});
  const [pullState, setPullState] = useState<Record<string, PullState>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const patchState = useCallback((patch: Partial<PersistedState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  const thread = useMemo<Thread>(() => {
    const found = state.threads.find((item) => item.id === state.activeThreadId);
    return found ?? state.threads[0];
  }, [state.threads, state.activeThreadId]);

  const skills = useMemo<Skill[]>(() => allSkills(state.customSkills), [state.customSkills]);
  const enabledProviders = useMemo(
    () => state.providers.filter((provider) => provider.enabled),
    [state.providers],
  );

  const activeProvider = useMemo<Provider | undefined>(() => {
    const found = thread?.providerId
      ? state.providers.find((item) => item.id === thread.providerId)
      : undefined;
    return found ?? enabledProviders[0] ?? state.providers[0];
  }, [thread?.providerId, state.providers, enabledProviders]);

  /** Models a provider can answer with: fetched ones plus the seeded ones. */
  const modelsFor = useCallback(
    (providerId: string): ModelInfo[] => {
      const fetched = state.modelsByProvider[providerId] ?? [];
      const pinned = state.pinnedModels[providerId] ?? [];
      const seen = new Set(fetched.map((model) => model.id));
      return [...fetched, ...pinned.filter((model) => !seen.has(model.id))];
    },
    [state.modelsByProvider, state.pinnedModels],
  );

  const allModels = useMemo(() => {
    const map: Record<string, ModelInfo[]> = {};
    for (const provider of state.providers) {
      map[provider.id] = modelsFor(provider.id);
    }
    return map;
  }, [state.providers, modelsFor]);

  const activeModel = activeProvider
    ? state.modelByProvider[activeProvider.id] ?? thread?.model ?? modelsFor(activeProvider.id)[0]?.id ?? ''
    : '';

  const modelCount = useMemo(
    () => Object.values(allModels).reduce((total, models) => total + models.length, 0),
    [allModels],
  );

  const patchThread = useCallback((threadId: string, updater: (value: Thread) => Thread) => {
    setState((previous) => ({
      ...previous,
      threads: previous.threads.map((item) => (item.id === threadId ? updater(item) : item)),
    }));
  }, []);

  const createThread = useCallback(() => {
    const created = newThread(state.skillIds);
    created.providerId = activeProvider?.id;
    setState((previous) => ({
      ...previous,
      threads: [created, ...previous.threads],
      activeThreadId: created.id,
    }));
    setPanel(null);
  }, [state.skillIds, activeProvider]);

  const deleteThread = useCallback((threadId: string) => {
    setState((previous) => {
      const remaining = previous.threads.filter((item) => item.id !== threadId);
      const threads = remaining.length > 0 ? remaining : [newThread(previous.skillIds)];
      return {
        ...previous,
        threads,
        activeThreadId: previous.activeThreadId === threadId ? threads[0].id : previous.activeThreadId,
      };
    });
  }, []);

  /* ------------------------------------------------------------- models */

  const fetchModels = useCallback(
    (providerId: string) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) {
        return;
      }
      setModelStatus((previous) => ({ ...previous, [providerId]: 'loading…' }));
      void listModels(provider)
        .then((models: ModelInfo[]) => {
          setState((previous) => ({
            ...previous,
            modelsByProvider: { ...previous.modelsByProvider, [providerId]: models },
            modelByProvider: {
              ...previous.modelByProvider,
              [providerId]: previous.modelByProvider[providerId] || models[0]?.id || '',
            },
          }));
          setModelStatus((previous) => ({
            ...previous,
            [providerId]:
              models.length === 0
                ? 'the provider returned no models — check the key and base URL'
                : `${models.length} models`,
          }));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setModelStatus((previous) => ({ ...previous, [providerId]: message }));
        });
    },
    [state.providers],
  );

  const testProvider = useCallback(
    (providerId: string) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) {
        return;
      }
      setTestStatus((previous) => ({ ...previous, [providerId]: 'testing…' }));
      void listModels(provider)
        .then((models) => {
          setTestStatus((previous) => ({
            ...previous,
            [providerId]:
              models.length > 0
                ? `reachable — ${models.length} models for this key (${models
                    .slice(0, 3)
                    .map((model) => model.id)
                    .join(', ')}${models.length > 3 ? ', …' : ''})`
                : 'reachable, but this key exposes no models',
          }));
          setState((previous) => ({
            ...previous,
            modelsByProvider: { ...previous.modelsByProvider, [providerId]: models },
          }));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setTestStatus((previous) => ({ ...previous, [providerId]: message }));
        });
    },
    [state.providers],
  );

  const selectModel = useCallback((providerId: string, model: string) => {
    setState((previous) => ({
      ...previous,
      modelByProvider: { ...previous.modelByProvider, [providerId]: model },
      threads: previous.threads.map((item) =>
        item.id === previous.activeThreadId ? { ...item, providerId, model } : item,
      ),
    }));
  }, []);

  const toggleParallel = useCallback((providerId: string, model: string) => {
    setState((previous) => {
      const exists = previous.parallel.some(
        (target) => target.providerId === providerId && target.model === model,
      );
      return {
        ...previous,
        parallel: exists
          ? previous.parallel.filter(
              (target) => !(target.providerId === providerId && target.model === model),
            )
          : [...previous.parallel, { providerId, model }],
      };
    });
  }, []);

  /* -------------------------------------------------------------- skills */

  const toggleSkill = useCallback((skillId: string) => {
    setState((previous) => {
      const on = previous.skillIds.includes(skillId);
      const skillIds = on
        ? previous.skillIds.filter((id) => id !== skillId)
        : [...previous.skillIds, skillId];
      return { ...previous, skillIds };
    });
  }, []);

  /* ------------------------------------------------------------ catalogue */

  const startPull = useCallback(
    (providerId: string, model: string) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) {
        return;
      }
      setPullState((previous) => ({ ...previous, [model]: { status: 'starting' } }));
      void pullModel(provider, model, (progress: PullProgress) => {
        setPullState((previous) => ({
          ...previous,
          [model]: {
            status:
              progress.percent !== undefined ? `${progress.status} ${progress.percent}%` : progress.status,
            percent: progress.percent,
          },
        }));
      })
        .then((final) => {
          setPullState((previous) => ({
            ...previous,
            [model]: { status: final.status, percent: final.status === 'success' ? 100 : final.percent },
          }));
          if (final.status === 'success') {
            setNotice(`Pulled ${model}.`);
            fetchModels(providerId);
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setPullState((previous) => ({ ...previous, [model]: { status: 'failed', error: message } }));
        });
    },
    [state.providers, fetchModels],
  );

  /* ----------------------------------------------------------------- chat */

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? draft).trim();
      if (!text || busy || !thread) {
        return;
      }

      const choice = chooseProvider(state.providers, state.usage, thread.providerId, state.failoverEnabled);
      const primary = choice.provider;
      if (!primary) {
        setNotice('Add a provider first: Menu → API providers.');
        setPanel('providers');
        return;
      }

      const primaryModel =
        state.modelByProvider[primary.id] || thread.model || modelsFor(primary.id)[0]?.id || '';
      if (!primaryModel) {
        setNotice(`${primary.name} has no model yet — open API providers and press “Load models”.`);
        setPanel('providers');
        return;
      }

      // Every target answers the same question in its own message.
      const targets: ParallelTarget[] = [
        { providerId: primary.id, model: primaryModel },
        ...state.parallel.filter((target) => state.providers.some((provider) => provider.id === target.providerId)),
      ];

      setDraft('');
      setBusy(true);
      if (choice.switched) {
        setNotice(`Switched to ${primary.name}: ${choice.reason ?? 'budget reached'}.`);
      }

      const groupId = uid('group');
      const userMessage: Message = { id: uid('msg'), role: 'user', content: text, createdAt: Date.now() };
      const replies = targets.map((target) => ({
        target,
        id: uid('msg'),
      }));

      patchThread(thread.id, (value) => ({
        ...value,
        title: value.messages.length === 0 ? text.slice(0, 48) : value.title,
        providerId: primary.id,
        model: primaryModel,
        messages: [
          ...value.messages,
          userMessage,
          ...replies.map(({ id, target }) => ({
            id,
            role: 'assistant' as const,
            content: '',
            createdAt: Date.now(),
            providerId: target.providerId,
            model: target.model,
            groupId,
          })),
        ],
        updatedAt: Date.now(),
      }));

      const history: ChatMessage[] = trimHistory(
        [
          ...thread.messages
            .filter((message) => !message.error && message.content)
            .map((message) => ({ role: message.role, content: message.content })),
          { role: 'user' as const, content: text },
        ],
        state.settings.contextTokens,
      );

      const skillPrompt = buildSystemPrompt(state.skillIds, state.customSkills, state.systemPrompt);
      const system = [state.settings.agentMode ? AGENT_PREAMBLE : '', skillPrompt]
        .filter(Boolean)
        .join('\n\n');

      const controller = new AbortController();
      abortRef.current = controller;

      const updateMessage = (messageId: string, patch: Partial<Message>) => {
        patchThread(thread.id, (value) => ({
          ...value,
          messages: value.messages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message,
          ),
        }));
      };

      const runOne = async (provider: Provider, model: string, messageId: string) => {
        let buffer = '';
        const result = await streamChat({
          provider,
          model,
          messages: history,
          system: system || undefined,
          maxTokens: state.settings.maxTokens,
          effort: state.settings.effort,
          temperature: state.settings.temperature,
          signal: controller.signal,
          handlers: {
            onDelta: (delta) => {
              buffer += delta;
              updateMessage(messageId, { content: buffer });
            },
          },
        });
        setState((previous) => ({
          ...previous,
          usage: clearProviderError(recordUsage(previous.usage, provider.id, result.usage), provider.id),
        }));
        updateMessage(messageId, { answeredBy: provider.name, providerId: provider.id, model });
        return buffer;
      };

      const runWithFailover = async (target: ParallelTarget, messageId: string) => {
        const provider =
          state.providers.find((item) => item.id === target.providerId) ?? primary;
        try {
          await runOne(provider, target.model, messageId);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            updateMessage(messageId, { content: '(stopped)' });
            return;
          }
          const failure = error instanceof Error ? error.message : String(error);
          const alternative = state.failoverEnabled
            ? nextProvider(state.providers, state.usage, provider.id)
            : undefined;
          const alternativeModel = alternative ? modelsFor(alternative.id)[0]?.id : undefined;
          const worthy = error instanceof ProviderError ? error.isFailoverWorthy : true;
          if (alternative && alternativeModel && worthy) {
            try {
              setNotice(`${provider.name} failed. Continuing on ${alternative.name}.`);
              await runOne(alternative, alternativeModel, messageId);
              return;
            } catch (secondError) {
              const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
              setState((previous) => ({
                ...previous,
                usage: markProviderError(previous.usage, alternative.id, secondMessage),
              }));
              updateMessage(messageId, { error: secondMessage });
              return;
            }
          }
          const hint =
            error instanceof ProviderError && error.isProtocolMismatch
              ? `\n\nWire-API mismatch is likely — ${provider.name} may need ${
                  provider.protocol === 'openai-responses' ? 'Chat Completions' : 'the Responses API'
                }. Use “Switch wire API”.`
              : '';
          setState((previous) => ({
            ...previous,
            usage: markProviderError(previous.usage, provider.id, failure),
          }));
          updateMessage(messageId, { error: `${failure}${hint}` });
        }
      };

      try {
        await Promise.all(replies.map(({ id, target }) => runWithFailover(target, id)));
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [
      draft,
      busy,
      thread,
      state.providers,
      state.usage,
      state.failoverEnabled,
      state.customSkills,
      state.systemPrompt,
      state.skillIds,
      state.settings,
      state.parallel,
      state.modelByProvider,
      modelsFor,
      patchThread,
    ],
  );

  /* -------------------------------------------------------------- actions */

  const switchWireApi = useCallback(
    (providerId: string) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) {
        return;
      }
      const protocol = provider.protocol === 'openai-responses' ? 'openai' : 'openai-responses';
      setState((previous) => ({
        ...previous,
        providers: previous.providers.map((item) =>
          item.id === providerId ? { ...item, protocol } : item,
        ),
      }));
      setNotice(
        `${provider.name} switched to ${protocol === 'openai' ? 'Chat Completions' : 'Responses'} — send the message again.`,
      );
    },
    [state.providers],
  );

  const retry = useCallback(
    (message: Message) => {
      if (!thread) {
        return;
      }
      const index = thread.messages.findIndex((item) => item.id === message.id);
      const previous = index > 0 ? thread.messages[index - 1] : undefined;
      const text = previous?.role === 'user' ? previous.content : '';
      if (!text) {
        setNotice('Nothing to retry — that answer has no question in this chat.');
        return;
      }
      patchThread(thread.id, (value) => ({
        ...value,
        messages: value.messages.filter((item) => item.id !== message.id && item.id !== previous?.id),
      }));
      void send(text);
    },
    [thread, patchThread, send],
  );

  const cycleEffort = useCallback(() => {
    setState((previous) => {
      const index = EFFORT_ORDER.indexOf(previous.settings.effort);
      const effort = EFFORT_ORDER[(index + 1) % EFFORT_ORDER.length];
      return { ...previous, settings: { ...previous.settings, effort } };
    });
    setNotice(`Effort: ${EFFORT_LABELS[state.settings.effort]} → next send uses the new level.`);
  }, [state.settings.effort]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        createThread();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createThread]);

  const commands: SlashCommand[] = useMemo(
    () => [
      { id: 'caveman', label: 'Toggle Caveman', hint: 'tokens', run: () => toggleSkill('caveman') },
      { id: 'rea', label: 'Toggle REA', hint: 'reverse engineering', run: () => toggleSkill('rea') },
      { id: 'openrouter', label: 'Toggle OpenRouter', hint: 'routing', run: () => toggleSkill('openrouter') },
      { id: 'new', label: 'New chat', hint: '⌘K', run: createThread },
      { id: 'providers', label: 'API providers', run: () => setPanel('providers') },
      { id: 'models', label: 'My models', run: () => setPanel('catalog') },
      { id: 'skills', label: 'Skills', run: () => setPanel('skills') },
      { id: 'settings', label: 'Settings', run: () => setPanel('settings') },
      { id: 'usage', label: 'Usage', run: () => setPanel('usage') },
    ],
    [toggleSkill, createThread],
  );

  const openMenu = (target: MenuTarget) => setPanel(target);

  const level = (() => {
    const raw = usageLevel(activeProvider ? usageOf(state.usage, activeProvider.id) : undefined);
    return (raw === 'ok' ? 'ok' : raw === 'warn' ? 'warn' : 'danger') as 'ok' | 'warn' | 'danger';
  })();
  const usageEntry = activeProvider ? usageOf(state.usage, activeProvider.id) : undefined;
  const ratio = usageRatio(usageEntry);
  const usageLabel = usageEntry?.limitTokens
    ? `${Math.round(ratio * 100)}% of ${formatTokens(usageEntry.limitTokens)}`
    : `${formatTokens((usageEntry?.promptTokens ?? 0) + (usageEntry?.completionTokens ?? 0))} tokens`;

  const installedByProvider = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [providerId, models] of Object.entries(state.modelsByProvider)) {
      map[providerId] = models.map((model) => model.id);
    }
    return map;
  }, [state.modelsByProvider]);

  const modelLabelForComposer = activeModel ? `${activeProvider?.name ?? ''} · ${activeModel}` : '';

  return (
    <div className="app">
      <main className="main">
        <TopBar
          title={thread?.title || 'New chat'}
          providerName={activeProvider?.name ?? ''}
          modelLabel={activeModel}
          usageLabel={usageLabel}
          usageLevel={level}
          effort={state.settings.effort}
          parallelCount={state.parallel.length}
          pickerOpen={pickerOpen}
          onOpenMenu={() => setPanel('menu')}
          onTogglePicker={() => setPickerOpen((value) => !value)}
          onCycleEffort={cycleEffort}
          onOpenPanel={setPanel}
          picker={
            <ModelPicker
              providers={state.providers}
              modelsByProvider={allModels}
              status={modelStatus}
              activeProviderId={activeProvider?.id}
              activeModel={activeModel}
              parallel={state.parallel}
              showLogos={state.settings.showLogos}
              onPick={selectModel}
              onToggleParallel={toggleParallel}
              onLoad={fetchModels}
              onOpenProviders={() => {
                setPickerOpen(false);
                setPanel('providers');
              }}
              onClose={() => setPickerOpen(false)}
            />
          }
        />

        <ThreadView
          messages={thread?.messages ?? []}
          busy={busy}
          showLogos={state.settings.showLogos}
          onRetry={retry}
          onSwitchProtocol={(message) => {
            if (message.providerId) {
              switchWireApi(message.providerId);
            }
          }}
          onFixConnection={() => setPanel('local')}
          emptyState={
            <div className="empty">
              <h1>Hey! What are you up to today?</h1>
              <p>
                Ask for anything — code, research, a fix. Rllama runs it as an agent: it plans, does the work, and
                tells you what changed.
              </p>
              <div className="starter-grid">
                <button
                  className="starter"
                  onClick={() => setDraft('Reverse engineer this binary and tell me how it talks to its server')}
                >
                  <strong>Reverse engineer something</strong>
                  REA walks the surface → shape → probe → confirm loop.
                </button>
                <button className="starter" onClick={() => setPanel('catalog')}>
                  <strong>Pick a model</strong>
                  Pull a local one or use a cloud model your key already has.
                </button>
                <button className="starter" onClick={() => setPanel('providers')}>
                  <strong>Connect a key</strong>
                  Ollama Cloud, AgentRouter, OpenRouter, Anthropic, OpenAI, DeepSeek, Kimi…
                </button>
                <button className="starter" onClick={() => setPanel('settings')}>
                  <strong>Set the effort</strong>
                  Low, medium or high reasoning — and how much history to send.
                </button>
              </div>
            </div>
          }
        />

        <Composer
          value={draft}
          busy={busy}
          skills={skills}
          enabledSkillIds={state.skillIds}
          modelLabel={modelLabelForComposer}
          effort={state.settings.effort}
          agentMode={state.settings.agentMode}
          parallelCount={state.parallel.length}
          notice={notice}
          commands={commands}
          onChange={setDraft}
          onSend={() => void send()}
          onStop={stop}
          onToggleSkill={toggleSkill}
          onToggleAgentMode={() =>
            setState((previous) => ({
              ...previous,
              settings: { ...previous.settings, agentMode: !previous.settings.agentMode },
            }))
          }
          onOpenPicker={() => setPickerOpen(true)}
          onCycleEffort={cycleEffort}
          onDismissNotice={() => setNotice(null)}
        />
      </main>

      {panel === 'menu' ? (
        <Drawer title="Rllama" subtitle={`${state.providers.length} providers · ${modelCount} models`} side="left" onClose={() => setPanel(null)}>
          <MenuPanel
            threads={state.threads}
            activeThreadId={thread?.id ?? ''}
            onNewChat={createThread}
            onSelectThread={(threadId) => {
              patchState({ activeThreadId: threadId });
              setPanel(null);
            }}
            onDeleteThread={deleteThread}
            onOpen={openMenu}
          />
        </Drawer>
      ) : null}

      {panel === 'providers' ? (
        <Drawer title="API providers" subtitle="Keys, wire APIs and the models each key can see" onClose={() => setPanel(null)}>
          <ProvidersPanel
            providers={state.providers}
            modelsByProvider={allModels}
            modelStatus={modelStatus}
            selectedModels={state.modelByProvider}
            testStatus={testStatus}
            onChange={(providers) =>
              setState((previous) => ({
                ...previous,
                providers,
                usage: pruneUsage(previous.usage, providers),
              }))
            }
            onFetchModels={fetchModels}
            onTest={testProvider}
            onSelectModel={selectModel}
          />
        </Drawer>
      ) : null}

      {panel === 'skills' ? (
        <Drawer
          title="Skills"
          subtitle={`${PINNED_SKILLS.length} pre-installed · ${state.skillIds.length} enabled`}
          onClose={() => setPanel(null)}
        >
          <SkillsPanel
            skills={skills}
            enabledIds={state.skillIds}
            systemPrompt={state.systemPrompt}
            onToggle={toggleSkill}
            onAdd={(skill) =>
              setState((previous) => ({
                ...previous,
                customSkills: [...previous.customSkills, skill],
                skillIds: [...previous.skillIds, skill.id],
              }))
            }
            onRemove={(skillId) =>
              setState((previous) => ({
                ...previous,
                customSkills: previous.customSkills.filter((skill) => skill.id !== skillId),
                skillIds: previous.skillIds.filter((id) => id !== skillId),
              }))
            }
            onSystemPromptChange={(systemPrompt) => patchState({ systemPrompt })}
          />
        </Drawer>
      ) : null}

      {panel === 'catalog' ? (
        <Drawer
          title="My models"
          subtitle={`${modelCount} available · ${state.parallel.length} in a parallel run`}
          wide
          onClose={() => setPanel(null)}
        >
          <CatalogPanel
            providers={state.providers}
            installed={installedByProvider}
            pullState={pullState}
            onPull={startPull}
            onUse={(providerId, model) => {
              selectModel(providerId, model);
              setNotice(
                `${model} selected for ${state.providers.find((item) => item.id === providerId)?.name}.`,
              );
              setPanel(null);
            }}
            onOpenProviders={() => setPanel('providers')}
          />
        </Drawer>
      ) : null}

      {panel === 'usage' ? (
        <Drawer title="Usage" subtitle="Budgets, failover and the last error per provider" onClose={() => setPanel(null)}>
          <UsagePanel
            providers={state.providers}
            usage={state.usage}
            failoverEnabled={state.failoverEnabled}
            onToggleFailover={(failoverEnabled) => patchState({ failoverEnabled })}
            onSetLimit={(providerId, limit) =>
              setState((previous) => ({ ...previous, usage: setLimit(previous.usage, providerId, limit) }))
            }
            onReset={(providerId) =>
              setState((previous) => ({ ...previous, usage: resetWindow(previous.usage, providerId) }))
            }
          />
        </Drawer>
      ) : null}

      {panel === 'settings' ? (
        <Drawer title="Settings" subtitle="Effort, context, behaviour" onClose={() => setPanel(null)}>
          <SettingsPanel
            settings={state.settings}
            failoverEnabled={state.failoverEnabled}
            onChange={(patch) =>
              setState((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }))
            }
            onToggleFailover={(failoverEnabled) => patchState({ failoverEnabled })}
            onResetUsage={() => setState((previous) => ({ ...previous, usage: {} as UsageMap }))}
            onClearModelCache={() =>
              setState((previous) => ({ ...previous, modelsByProvider: {} }))
            }
          />
        </Drawer>
      ) : null}

      {panel === 'mcp' ? (
        <Drawer title="MCP servers" subtitle="Model Context Protocol endpoints" onClose={() => setPanel(null)}>
          <McpPanel
            servers={state.mcpServers}
            onChange={(mcpServers) => patchState({ mcpServers })}
          />
        </Drawer>
      ) : null}

      {panel === 'local' ? (
        <Drawer title="Local backend" subtitle="Ollama on this phone or on your computer" onClose={() => setPanel(null)}>
          <LocalPanel
            providers={state.providers}
            testStatus={testStatus}
            onUpdate={(providerId, patch) =>
              setState((previous) => ({
                ...previous,
                providers: previous.providers.map((provider) =>
                  provider.id === providerId ? { ...provider, ...patch } : provider,
                ),
              }))
            }
            onTest={testProvider}
          />
        </Drawer>
      ) : null}

      {panel === 'cli' ? (
        <Drawer title="Terminal CLI" subtitle="Claude Code, Codex, Hermes" onClose={() => setPanel(null)}>
          <CliPanel />
        </Drawer>
      ) : null}
    </div>
  );
}

/** Exported for tests that want the same wiring without rendering. */
export type { UsageMap };
export { emptyUsage };
