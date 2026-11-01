import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listModels, ProviderError, streamChat } from './core/client';
import { pullModel, type PullProgress } from './core/ollama';
import { allSkills, buildSystemPrompt, PINNED_SKILLS } from './core/skills';
import { loadState, newThread, pruneUsage, saveState, uid, type PersistedState } from './core/store';
import {
  chooseProvider,
  clearProviderError,
  formatTokens,
  markProviderError,
  nextProvider,
  recordUsage,
  resetWindow,
  setLimit,
  usageLevel,
  usageOf,
  usageRatio,
} from './core/usage';
import type { ChatMessage, Message, ModelInfo, Provider, Skill, Thread } from './core/types';
import { Drawer } from './ui/Drawer';
import { Composer, ModelPicker, Sidebar, ThreadView, TopBar, type PanelId, type SlashCommand } from './ui/Shell';
import { ProvidersPanel } from './ui/panels/Providers';
import { SkillsPanel } from './ui/panels/Skills';
import { CatalogPanel, type PullState } from './ui/panels/Catalog';
import { UsagePanel } from './ui/panels/Usage';

export default function App(): React.ReactElement {
  const [state, setState] = useState<PersistedState>(() => loadState());
  const [panel, setPanel] = useState<PanelId>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    const found = thread?.providerId ? state.providers.find((item) => item.id === thread.providerId) : undefined;
    return found ?? enabledProviders[0] ?? state.providers[0];
  }, [thread?.providerId, state.providers, enabledProviders]);

  const activeModel = activeProvider
    ? state.modelByProvider[activeProvider.id] ?? thread?.model ?? state.modelsByProvider[activeProvider.id]?.[0]?.id ?? ''
    : '';

  const modelCount = useMemo(
    () => Object.values(state.modelsByProvider).reduce((total, models) => total + models.length, 0),
    [state.modelsByProvider],
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
    setSidebarOpen(false);
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
              [providerId]: previous.modelByProvider[providerId] ?? models[0]?.id ?? '',
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
                ? `reachable — ${models.length} models for this key (${models.slice(0, 3).map((model) => model.id).join(', ')}${
                    models.length > 3 ? ', …' : ''
                  })`
                : 'reachable, but the key exposes no models',
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

  /* -------------------------------------------------------------- skills */

  const toggleSkill = useCallback((skillId: string) => {
    setState((previous) => {
      const on = previous.skillIds.includes(skillId);
      const skillIds = on ? previous.skillIds.filter((id) => id !== skillId) : [...previous.skillIds, skillId];
      return {
        ...previous,
        skillIds,
        threads: previous.threads.map((item) =>
          item.id === previous.activeThreadId ? { ...item, skillIds } : item,
        ),
      };
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
            status: progress.percent !== undefined ? `${progress.status} ${progress.percent}%` : progress.status,
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

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || busy || !thread) {
      return;
    }

    const choice = chooseProvider(state.providers, state.usage, thread.providerId, state.failoverEnabled);
    const provider = choice.provider;
    if (!provider) {
      setNotice('Add a provider first — open Providers, paste a key, then load its models.');
      setPanel('providers');
      return;
    }
    if (choice.switched) {
      setNotice(`Switched to ${provider.name}: ${choice.reason ?? 'budget reached'}.`);
    }

    const requestedModel =
      state.modelByProvider[provider.id] ?? thread.model ?? state.modelsByProvider[provider.id]?.[0]?.id;
    if (!requestedModel) {
      setNotice(`${provider.name} has no model selected yet — open Providers and press “Load models”.`);
      setPanel('providers');
      return;
    }

    setDraft('');
    setBusy(true);

    const userMessage: Message = { id: uid('msg'), role: 'user', content: text, createdAt: Date.now() };
    const assistantId = uid('msg');
    const assistantBase: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      providerId: provider.id,
      model: requestedModel,
    };

    patchThread(thread.id, (value) => ({
      ...value,
      title: value.messages.length === 0 ? text.slice(0, 48) : value.title,
      providerId: provider.id,
      model: requestedModel,
      messages: [...value.messages, userMessage, assistantBase],
      updatedAt: Date.now(),
    }));

    const history: ChatMessage[] = thread.messages
      .filter((message) => !message.error && message.content)
      .map((message) => ({ role: message.role, content: message.content }));
    history.push({ role: 'user', content: text });

    const system = buildSystemPrompt(state.skillIds, state.customSkills, state.systemPrompt);
    const controller = new AbortController();
    abortRef.current = controller;

    const runAttempt = async (target: Provider, model: string): Promise<string> => {
      let buffer = '';
      const result = await streamChat({
        provider: target,
        model,
        messages: history,
        system: system || undefined,
        signal: controller.signal,
        handlers: {
          onDelta: (delta) => {
            buffer += delta;
            patchThread(thread.id, (value) => ({
              ...value,
              messages: value.messages.map((message) =>
                message.id === assistantId ? { ...message, content: buffer } : message,
              ),
            }));
          },
        },
      });
      setState((previous) => ({
        ...previous,
        usage: clearProviderError(recordUsage(previous.usage, target.id, result.usage), target.id),
      }));
      return buffer;
    };

    const settle = (answeredBy: Provider, model: string) => {
      patchThread(thread.id, (value) => ({
        ...value,
        messages: value.messages.map((message) =>
          message.id === assistantId
            ? { ...message, answeredBy: answeredBy.name, providerId: answeredBy.id, model }
            : message,
        ),
        updatedAt: Date.now(),
      }));
    };

    try {
      await runAttempt(provider, requestedModel);
      settle(provider, requestedModel);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      if (aborted) {
        patchThread(thread.id, (value) => ({
          ...value,
          messages: value.messages.map((message) =>
            message.id === assistantId && !message.content ? { ...message, content: '(stopped)' } : message,
          ),
        }));
        return;
      }

      const failure = error instanceof Error ? error.message : String(error);
      let handled = false;

      if (state.failoverEnabled) {
        const alternative = nextProvider(state.providers, state.usage, provider.id);
        const worthy = error instanceof ProviderError ? error.isFailoverWorthy : true;
        const alternativeModel = alternative
          ? state.modelByProvider[alternative.id] ?? state.modelsByProvider[alternative.id]?.[0]?.id
          : undefined;
        if (alternative && alternativeModel && worthy) {
          setNotice(`${provider.name} failed. Continuing on ${alternative.name}.`);
          try {
            await runAttempt(alternative, alternativeModel);
            settle(alternative, alternativeModel);
            handled = true;
          } catch (secondError) {
            const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
            setState((previous) => ({
              ...previous,
              usage: markProviderError(previous.usage, alternative.id, secondMessage),
            }));
            patchThread(thread.id, (value) => ({
              ...value,
              messages: value.messages.map((message) =>
                message.id === assistantId ? { ...message, error: secondMessage } : message,
              ),
            }));
            handled = true;
          }
        }
      }

      if (!handled) {
        const hint =
          error instanceof ProviderError && error.isProtocolMismatch
            ? ` ${provider.protocol === 'openai-responses' ? 'This gateway may only speak Chat Completions' : 'This gateway may need the Responses wire API'} — use “Switch wire API”.`
            : '';
        setState((previous) => ({
          ...previous,
          usage: markProviderError(previous.usage, provider.id, failure),
        }));
        patchThread(thread.id, (value) => ({
          ...value,
          messages: value.messages.map((message) =>
            message.id === assistantId ? { ...message, error: `${failure}${hint}` } : message,
          ),
        }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [
    draft,
    busy,
    thread,
    state.providers,
    state.usage,
    state.failoverEnabled,
    state.customSkills,
    state.systemPrompt,
    state.modelByProvider,
    state.modelsByProvider,
    state.skillIds,
    patchThread,
  ]);

  /* -------------------------------------------------------------- actions */

  const switchWireApi = useCallback(
    (providerId: string) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) {
        return;
      }
      const next =
        provider.protocol === 'openai-responses'
          ? { protocol: 'openai' as const }
          : provider.protocol === 'openai'
            ? { protocol: 'openai-responses' as const }
            : { protocol: 'openai' as const };
      setState((previous) => ({
        ...previous,
        providers: previous.providers.map((item) =>
          item.id === providerId ? { ...item, ...next } : item,
        ),
      }));
      setNotice(
        `${provider.name} switched to ${next.protocol === 'openai' ? 'Chat Completions' : 'Responses'} — retry the message.`,
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
        providerId: message.providerId ?? value.providerId,
        messages: value.messages.filter(
          (item) => item.id !== message.id && item.id !== previous?.id,
        ),
      }));
      setDraft('');
      void send(text);
    },
    [thread, patchThread, send],
  );

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
      { id: 'caveman', label: 'Toggle Caveman', hint: 'token compression', run: () => toggleSkill('caveman') },
      { id: 'rea', label: 'Toggle REA', hint: 'reverse engineering', run: () => toggleSkill('rea') },
      { id: 'openrouter', label: 'Toggle OpenRouter', hint: 'routing skill', run: () => toggleSkill('openrouter') },
      { id: 'new', label: 'New chat', hint: '⌘K', run: createThread },
      { id: 'providers', label: 'Open providers', run: () => setPanel('providers') },
      { id: 'models', label: 'Browse model catalog', run: () => setPanel('catalog') },
      { id: 'skills', label: 'Open skills', run: () => setPanel('skills') },
      { id: 'usage', label: 'Open usage', run: () => setPanel('usage') },
    ],
    [toggleSkill, createThread],
  );

  /* ------------------------------------------------------------------ view */

  const rawLevel = usageLevel(activeProvider ? usageOf(state.usage, activeProvider.id) : undefined);
  const level: 'ok' | 'warn' | 'danger' = rawLevel === 'ok' ? 'ok' : rawLevel === 'warn' ? 'warn' : 'danger';
  const ratio = usageRatio(activeProvider ? usageOf(state.usage, activeProvider.id) : undefined);
  const usageEntry = activeProvider ? usageOf(state.usage, activeProvider.id) : undefined;
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

  return (
    <div className="app">
      <Sidebar
        threads={state.threads}
        activeThreadId={thread?.id ?? ''}
        providerCount={state.providers.length}
        enabledProviderCount={enabledProviders.length}
        modelCount={modelCount}
        activePanel={panel}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={createThread}
        onSelect={(threadId) => {
          patchState({ activeThreadId: threadId });
          setSidebarOpen(false);
        }}
        onDelete={deleteThread}
        onOpenPanel={setPanel}
      />

      <main className="main">
        <TopBar
          title={thread?.title || 'New chat'}
          providerName={activeProvider?.name ?? ''}
          modelLabel={activeModel}
          usageLabel={usageLabel}
          usageLevel={level}
          failover={state.failoverEnabled}
          pickerOpen={pickerOpen}
          onTogglePicker={() => setPickerOpen((value) => !value)}
          onOpenPanel={setPanel}
          onOpenSidebar={() => setSidebarOpen(true)}
          picker={
            <ModelPicker
              providers={state.providers}
              modelsByProvider={state.modelsByProvider}
              status={modelStatus}
              activeProviderId={activeProvider?.id}
              activeModel={activeModel}
              onPick={selectModel}
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
          onRetry={retry}
          onSwitchProtocol={(message) => {
            if (message.providerId) {
              switchWireApi(message.providerId);
            }
          }}
          emptyState={
            <div className="empty">
              <h1>What are we building?</h1>
              <p>
                One workspace for Ollama Cloud, AgentRouter, OpenRouter, Anthropic, OpenAI, DeepSeek, Kimi, Groq,
                Gemini, local Ollama and any OpenAI/Anthropic-compatible endpoint.
              </p>
              <div className="starter-grid">
                <button className="starter" onClick={() => setPanel('providers')}>
                  <strong>Connect a key</strong>
                  Paste an API key and load the models it can use.
                </button>
                <button className="starter" onClick={() => setPanel('catalog')}>
                  <strong>Browse Ollama models</strong>
                  Pull a model into your local daemon, or add a cloud one.
                </button>
                <button className="starter" onClick={() => toggleSkill('caveman')}>
                  <strong>Caveman mode</strong>
                  Same facts, far fewer tokens.
                </button>
                <button className="starter" onClick={() => setPanel('skills')}>
                  <strong>Skills</strong>
                  REA, OpenRouter routing, planner, reviewer, debugger.
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
          modelLabel={activeModel ? `${activeProvider?.name ?? ''} · ${activeModel}` : ''}
          notice={notice}
          commands={commands}
          onChange={setDraft}
          onSend={() => void send()}
          onStop={stop}
          onToggleSkill={toggleSkill}
          onOpenPicker={() => setPickerOpen(true)}
          onDismissNotice={() => setNotice(null)}
        />
      </main>

      {panel === 'providers' ? (
        <Drawer
          title="Providers"
          subtitle="Keys, wire APIs and the models each key can see"
          onClose={() => setPanel(null)}
        >
          <ProvidersPanel
            providers={state.providers}
            modelsByProvider={state.modelsByProvider}
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
          title="Models"
          subtitle="Ollama catalog — pull locally or point the chat at a cloud model"
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
              setNotice(`${model} is selected for ${state.providers.find((item) => item.id === providerId)?.name}.`);
              setPanel(null);
            }}
            onOpenProviders={() => setPanel('providers')}
          />
        </Drawer>
      ) : null}

      {panel === 'usage' ? (
        <Drawer title="Usage" subtitle="Budgets and automatic failover" onClose={() => setPanel(null)}>
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
    </div>
  );
}
