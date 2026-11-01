import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listModels, ProviderError, streamChat } from './core/client';
import { allSkills, buildSystemPrompt } from './core/skills';
import { loadState, newThread, pruneUsage, saveState, uid, type PersistedState } from './core/store';
import {
  chooseProvider,
  clearProviderError,
  markProviderError,
  nextProvider,
  recordUsage,
  resetWindow,
  setLimit,
  usageLevel,
  usageOf,
  usageRatio,
  formatTokens,
  type UsageMap,
} from './core/usage';
import type { ChatMessage, ModelInfo, Provider, Skill, Thread } from './core/types';
import { Markdown } from './ui/Markdown';
import { ProvidersPanel, SkillsPanel, UsagePanel } from './ui/Panels';

type PanelId = 'providers' | 'skills' | 'usage' | null;

export default function App(): React.ReactElement {
  const [state, setState] = useState<PersistedState>(() => loadState());
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelInfo[]>>({});
  const [modelStatus, setModelStatus] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<PanelId>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const thread = useMemo<Thread>(() => {
    const found = state.threads.find((item) => item.id === state.activeThreadId);
    return found ?? state.threads[0];
  }, [state.threads, state.activeThreadId]);

  const enabledProviders = useMemo(() => state.providers.filter((provider) => provider.enabled), [state.providers]);

  const skills = useMemo<Skill[]>(() => allSkills(state.customSkills), [state.customSkills]);

  const activeProvider = useMemo<Provider | undefined>(() => {
    if (thread.providerId) {
      const found = state.providers.find((provider) => provider.id === thread.providerId);
      if (found) {
        return found;
      }
    }
    return enabledProviders[0];
  }, [thread.providerId, state.providers, enabledProviders]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [thread?.messages, busy]);

  const patchState = useCallback((patch: Partial<PersistedState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  const patchThread = useCallback(
    (threadId: string, updater: (value: Thread) => Thread) => {
      setState((previous) => ({
        ...previous,
        threads: previous.threads.map((item) => (item.id === threadId ? updater(item) : item)),
      }));
    },
    [],
  );

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

  const deleteThread = useCallback(
    (threadId: string) => {
      setState((previous) => {
        const remaining = previous.threads.filter((item) => item.id !== threadId);
        const threads = remaining.length > 0 ? remaining : [newThread(previous.skillIds)];
        return {
          ...previous,
          threads,
          activeThreadId: previous.activeThreadId === threadId ? threads[0].id : previous.activeThreadId,
        };
      });
    },
    [],
  );

  const fetchModels = useCallback(
    (providerId: string) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) {
        return;
      }
      setModelStatus((previous) => ({ ...previous, [providerId]: 'loading…' }));
      void listModels(provider)
        .then((models) => {
          setModelsByProvider((previous) => ({ ...previous, [providerId]: models }));
          setModelStatus((previous) => ({
            ...previous,
            [providerId]: models.length === 0 ? 'the provider returned no models' : `${models.length} models`,
          }));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setModelStatus((previous) => ({ ...previous, [providerId]: message }));
        });
    },
    [state.providers],
  );

  const selectModel = useCallback((providerId: string, model: string) => {
    setState((previous) => ({
      ...previous,
      modelByProvider: { ...previous.modelByProvider, [providerId]: model },
      threads: previous.threads.map((item) =>
        item.id === previous.activeThreadId ? { ...item, model } : item,
      ),
    }));
  }, []);

  const toggleSkill = useCallback((skillId: string) => {
    setState((previous) => {
      const enabled = previous.skillIds.includes(skillId);
      const skillIds = enabled
        ? previous.skillIds.filter((id) => id !== skillId)
        : [...previous.skillIds, skillId];
      return {
        ...previous,
        skillIds,
        threads: previous.threads.map((item) =>
          item.id === previous.activeThreadId ? { ...item, skillIds } : item,
        ),
      };
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !thread) {
      return;
    }

    const choice = chooseProvider(state.providers, state.usage, thread.providerId, state.failoverEnabled);
    let provider = choice.provider;
    if (!provider) {
      setNotice('Add a provider first — open Providers and paste a key.');
      setPanel('providers');
      return;
    }
    if (choice.switched) {
      setNotice(`Switched to ${provider.name}: ${choice.reason ?? 'budget reached'}.`);
    }

    const fallbackTemplate = state.providers.find((item) => item.id === provider?.id);
    if (!fallbackTemplate) {
      return;
    }

    const requestedModel =
      state.modelByProvider[provider.id] ?? thread.model ?? modelsByProvider[provider.id]?.[0]?.id;
    if (!requestedModel) {
      setNotice(`Pick a model for ${provider.name} (Providers → Load models).`);
      setPanel('providers');
      return;
    }

    setDraft('');
    setNotice(null);
    setBusy(true);

    const userMessage = {
      id: uid('msg'),
      role: 'user' as const,
      content: text,
      createdAt: Date.now(),
    };
    const assistantId = uid('msg');
    const assistantBase = {
      id: assistantId,
      role: 'assistant' as const,
      content: '',
      createdAt: Date.now(),
      providerId: provider.id,
      model: requestedModel,
    };

    patchThread(thread.id, (value) => ({
      ...value,
      title: value.messages.length === 0 ? text.slice(0, 48) : value.title,
      providerId: provider?.id ?? value.providerId,
      model: requestedModel,
      messages: [...value.messages, userMessage, assistantBase],
      updatedAt: Date.now(),
    }));

    const history: ChatMessage[] = thread.messages
      .filter((message) => !message.error)
      .map((message) => ({ role: message.role, content: message.content }));
    history.push({ role: 'user', content: text });

    const system = buildSystemPrompt(thread.skillIds, state.customSkills, state.systemPrompt);
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
      setState((previous) => {
        const usage = recordUsage(previous.usage, target.id, result.usage);
        return { ...previous, usage: clearProviderError(usage, target.id) };
      });
      return buffer;
    };

    try {
      await runAttempt(provider, requestedModel);
      patchThread(thread.id, (value) => ({
        ...value,
        messages: value.messages.map((message) =>
          message.id === assistantId
            ? { ...message, answeredBy: provider?.name, providerId: provider?.id, model: requestedModel }
            : message,
        ),
        updatedAt: Date.now(),
      }));
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      if (aborted) {
        patchThread(thread.id, (value) => ({
          ...value,
          messages: value.messages.map((message) =>
            message.id === assistantId && !message.content
              ? { ...message, content: '(stopped)' }
              : message,
          ),
        }));
        setBusy(false);
        abortRef.current = null;
        return;
      }

      const failure = error instanceof Error ? error.message : String(error);
      let handled = false;
      if (state.failoverEnabled) {
        const alternative = provider ? nextProvider(state.providers, state.usage, provider.id) : undefined;
        if (alternative && (error instanceof ProviderError ? error.isFailoverWorthy : true)) {
          const alternativeModel =
            state.modelByProvider[alternative.id] ?? modelsByProvider[alternative.id]?.[0]?.id;
          if (alternativeModel) {
            setNotice(`${provider.name} failed (${failure.slice(0, 120)}). Continuing on ${alternative.name}.`);
            try {
              await runAttempt(alternative, alternativeModel);
              patchThread(thread.id, (value) => ({
                ...value,
                messages: value.messages.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        answeredBy: alternative.name,
                        providerId: alternative.id,
                        model: alternativeModel,
                      }
                    : message,
                ),
                updatedAt: Date.now(),
              }));
              handled = true;
            } catch (secondError) {
              const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
              setState((previous) => ({ ...previous, usage: markProviderError(previous.usage, alternative.id, secondMessage) }));
              patchThread(thread.id, (value) => ({
                ...value,
                messages: value.messages.map((message) =>
                  message.id === assistantId ? { ...message, error: secondMessage } : message,
                ),
              }));
            }
          }
        }
      }

      if (!handled) {
        if (provider) {
          setState((previous) => ({ ...previous, usage: markProviderError(previous.usage, provider.id, failure) }));
        }
        patchThread(thread.id, (value) => ({
          ...value,
          messages: value.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content || '',
                  error: failure,
                }
              : message,
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
    modelsByProvider,
    patchThread,
  ]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const modelChoices = activeProvider ? modelsByProvider[activeProvider.id] ?? [] : [];
  const currentModel = activeProvider
    ? state.modelByProvider[activeProvider.id] ?? thread.model ?? ''
    : '';

  const usageState = activeProvider ? usageOf(state.usage, activeProvider.id) : undefined;
  const level = usageLevel(usageState);
  const ratio = usageRatio(usageState);

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <div className="brand-name">Rllama</div>
            <div className="brand-version">multi-provider workspace</div>
          </div>
        </div>
        <button className="new-chat" onClick={createThread}>
          <span>New chat</span>
          <span className="hint">⌘K</span>
        </button>
        <div className="thread-list">
          {state.threads.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 2 }}>
              <button
                className={`thread ${item.id === thread?.id ? 'active' : ''}`}
                onClick={() => {
                  patchState({ activeThreadId: item.id });
                  setSidebarOpen(false);
                }}
              >
                {item.title || 'Untitled'}
              </button>
              {state.threads.length > 1 ? (
                <button
                  className="thread"
                  style={{ width: 28, flex: '0 0 28px', color: 'var(--text-faint)' }}
                  title="Delete chat"
                  onClick={() => deleteThread(item.id)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="tab-row">
            <button
              className={`chip-button ${panel === 'providers' ? 'active' : ''}`}
              onClick={() => setPanel(panel === 'providers' ? null : 'providers')}
            >
              Providers
            </button>
            <button
              className={`chip-button ${panel === 'skills' ? 'active' : ''}`}
              onClick={() => setPanel(panel === 'skills' ? null : 'skills')}
            >
              Skills ({state.skillIds.length})
            </button>
            <button
              className={`chip-button ${panel === 'usage' ? 'active' : ''}`}
              onClick={() => setPanel(panel === 'usage' ? null : 'usage')}
            >
              Usage
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="button small" onClick={() => setSidebarOpen((value) => !value)} aria-label="Chats">
            ☰
          </button>
          <select
            value={activeProvider?.id ?? ''}
            onChange={(event) => patchThread(thread.id, (value) => ({ ...value, providerId: event.target.value }))}
          >
            {state.providers.length === 0 ? <option value="">no providers</option> : null}
            {state.providers.map((provider) => (
              <option key={provider.id} value={provider.id} disabled={!provider.enabled}>
                {provider.name}
                {provider.enabled ? '' : ' (disabled)'}
              </option>
            ))}
          </select>
          <select
            value={currentModel}
            onChange={(event) => (activeProvider ? selectModel(activeProvider.id, event.target.value) : undefined)}
            disabled={modelChoices.length === 0}
          >
            <option value="">
              {modelChoices.length === 0 ? 'load models…' : 'choose model…'}
            </option>
            {modelChoices.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          {activeProvider ? (
            <span className="status-pill">
              <span className={`dot ${level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : 'danger'}`} />
              {usageState && usageState.limitTokens
                ? `${Math.round(ratio * 100)}% of ${formatTokens(usageState.limitTokens)}`
                : `${formatTokens((usageState?.promptTokens ?? 0) + (usageState?.completionTokens ?? 0))} tokens`}
            </span>
          ) : null}
          <span className="spacer" />
          {state.failoverEnabled ? <span className="status-pill">failover on</span> : null}
          <button className="button small" onClick={() => setPanel(panel === 'skills' ? null : 'skills')}>
            Skills
          </button>
          <button className="button small" onClick={() => setPanel(panel === 'providers' ? null : 'providers')}>
            Providers
          </button>
        </div>

        {notice ? (
          <div style={{ padding: '8px 14px 0' }}>
            <div className="banner">
              {notice}{' '}
              <button className="button small" style={{ marginLeft: 8 }} onClick={() => setNotice(null)}>
                dismiss
              </button>
            </div>
          </div>
        ) : null}

        <div className="messages" ref={scrollRef}>
          {thread && thread.messages.length === 0 ? (
            <div className="empty">
              <h1>What are we building?</h1>
              <p>
                Rllama talks to Ollama Cloud, AgentRouter, OpenRouter, Anthropic, OpenAI, DeepSeek, Kimi, Groq,
                Gemini, local Ollama and any OpenAI/Anthropic-compatible endpoint.
              </p>
              <ul>
                <li>Add a provider key in Providers, load its models, pick one.</li>
                <li>Turn on skills like Caveman (fewer tokens) or REA (reverse engineering).</li>
                <li>When a provider hits 90% of its budget, the next one takes over.</li>
              </ul>
            </div>
          ) : null}

          {thread?.messages.map((message) => (
            <div className={`message ${message.role} ${message.error ? 'error' : ''}`} key={message.id}>
              <div className="avatar">{message.role === 'user' ? 'You' : 'R'}</div>
              <div className="body">
                <div className="meta">
                  <span>{message.role === 'user' ? 'you' : message.answeredBy ?? message.model ?? 'assistant'}</span>
                  {message.model && message.role === 'assistant' ? <span>{message.model}</span> : null}
                </div>
                {message.error ? (
                  <div className="content">
                    <p>{message.error}</p>
                    {message.content ? <Markdown text={message.content} /> : null}
                  </div>
                ) : message.content ? (
                  <div className="content">
                    <Markdown text={message.content} />
                  </div>
                ) : (
                  <p className="hint">thinking…</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="composer">
          <div className="composer-inner">
            <textarea
              value={draft}
              placeholder="Message Rllama…  (Enter to send, Shift+Enter for a new line)"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="composer-actions">
              {busy ? (
                <button className="button" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="button primary" onClick={() => void send()} disabled={!draft.trim()}>
                  Send
                </button>
              )}
              <span className="hint">
                {state.skillIds.length > 0
                  ? `skills: ${state.skillIds
                      .map((id) => skills.find((skill) => skill.id === id)?.name ?? id)
                      .join(', ')}`
                  : 'no skills on'}
              </span>
            </div>
          </div>
        </div>
      </main>

      {panel === 'providers' ? (
        <ProvidersPanel
          providers={state.providers}
          usage={state.usage}
          modelsByProvider={modelsByProvider}
          modelStatus={modelStatus}
          onChange={(providers) =>
            setState((previous) => ({
              ...previous,
              providers,
              usage: pruneUsage(previous.usage, providers),
            }))
          }
          onFetchModels={fetchModels}
          onSelectModel={selectModel}
          selectedModels={state.modelByProvider}
        />
      ) : null}

      {panel === 'skills' ? (
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
      ) : null}

      {panel === 'usage' ? (
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
      ) : null}
    </div>
  );
}

/** Exported for tests that want the same wiring without rendering. */
export type { UsageMap };
