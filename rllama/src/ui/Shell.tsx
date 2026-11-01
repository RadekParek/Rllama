import React, { useEffect, useRef, useState } from 'react';
import type { Effort, Message, ModelInfo, Provider, Skill } from '../core/types';
import { EFFORT_META, EFFORT_ORDER, modelShortName } from '../core/settings';
import { Markdown } from './Markdown';
import { ModelLogo } from './ModelLogo';
import {
  IconArrowUp,
  IconBolt,
  IconChevron,
  IconMenu,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSliders,
  IconX,
} from './Icons';

export type PanelId =
  | 'menu'
  | 'providers'
  | 'skills'
  | 'catalog'
  | 'usage'
  | 'settings'
  | 'mcp'
  | 'cli'
  | 'local'
  | null;

/* ------------------------------------------------------------------ top bar */

export interface TopBarProps {
  title: string;
  providerName: string;
  modelLabel: string;
  parallelCount: number;
  pickerOpen: boolean;
  onOpenMenu: () => void;
  onTogglePicker: () => void;
  onOpenPanel: (panel: PanelId) => void;
  picker: React.ReactNode;
}

export function TopBar(props: TopBarProps): React.ReactElement {
  return (
    <div className="topbar">
      <button className="icon-button" onClick={props.onOpenMenu} aria-label="Menu" title="Menu">
        <IconMenu />
      </button>

      <div className="picker-anchor">
        <button
          className="pill model-pill"
          onClick={props.onTogglePicker}
          aria-expanded={props.pickerOpen}
          title={props.modelLabel ? `${props.providerName} · ${props.modelLabel}` : 'Choose a model'}
        >
          {props.modelLabel ? <ModelLogo model={props.modelLabel} /> : <span className="dot ok" />}
          <span className="pill-label">{props.modelLabel ? modelShortName(props.modelLabel) : 'no model'}</span>
          {props.parallelCount > 0 ? <span className="badge accent">+{props.parallelCount}</span> : null}
          <IconChevron width={11} height={11} />
        </button>
        {props.pickerOpen ? props.picker : null}
      </div>

      <span className="topbar-title">{props.title}</span>

      <span className="spacer" />

      <button
        className="icon-button"
        onClick={() => props.onOpenPanel('settings')}
        title="Settings"
        aria-label="Settings"
      >
        <IconSliders />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- model picker */

export interface ModelPickerProps {
  providers: Provider[];
  modelsByProvider: Record<string, ModelInfo[]>;
  status: Record<string, string>;
  activeProviderId?: string;
  activeModel: string;
  parallel: Array<{ providerId: string; model: string }>;
  showLogos: boolean;
  onPick: (providerId: string, model: string) => void;
  onToggleParallel: (providerId: string, model: string) => void;
  onLoad: (providerId: string) => void;
  onOpenProviders: () => void;
  onClose: () => void;
}

export function ModelPicker(props: ModelPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        props.onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [props]);

  const needle = query.trim().toLowerCase();
  const groups = props.providers.map((provider) => ({
    provider,
    models: (props.modelsByProvider[provider.id] ?? []).filter(
      (model) => !needle || model.id.toLowerCase().includes(needle),
    ),
  }));

  const isParallel = (providerId: string, model: string) =>
    props.parallel.some((target) => target.providerId === providerId && target.model === model);

  return (
    <div className="popover model-popover" ref={ref}>
      <div className="popover-header">
        <IconSearch width={14} height={14} />
        <input
          type="search"
          value={query}
          autoFocus
          placeholder="Search models from your keys…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="close-button" onClick={props.onClose} aria-label="Close model picker">
          <IconX />
        </button>
      </div>
      <div className="popover-body">
        {groups.map(({ provider, models }) => (
          <div key={provider.id}>
            <div className="picker-group-label">
              {provider.name}
              {provider.enabled ? '' : ' · disabled'}
              {models.length === 0 ? ` · ${props.status[provider.id] ?? 'no models loaded'}` : ''}
            </div>
            {models.map((model) => {
              const isActive = provider.id === props.activeProviderId && model.id === props.activeModel;
              const inParallel = isParallel(provider.id, model.id);
              return (
                <div className={`model-row ${isActive ? 'active' : ''}`} key={model.id}>
                  <button
                    className="model-option"
                    onClick={() => {
                      props.onPick(provider.id, model.id);
                      props.onClose();
                    }}
                  >
                    {props.showLogos ? <ModelLogo model={model.id} /> : null}
                    <span className="model-name">{modelShortName(model.id)}</span>
                    {model.id.includes('/') ? (
                      <span className="model-namespace">{model.id.split('/')[0]}/</span>
                    ) : null}
                    {model.context ? <span className="trailing">{formatContext(model.context)}</span> : null}
                  </button>
                  <button
                    className={`parallel-toggle ${inParallel ? 'on' : ''}`}
                    onClick={() => props.onToggleParallel(provider.id, model.id)}
                    title={inParallel ? 'Remove from parallel run' : 'Answer with this model too'}
                    aria-label={inParallel ? 'Remove from parallel run' : 'Add to parallel run'}
                  >
                    <IconPlus width={12} height={12} />
                  </button>
                </div>
              );
            })}
            {models.length === 0 ? (
              <button className="model-option" onClick={() => props.onLoad(provider.id)}>
                <IconRefresh width={13} height={13} />
                <span>Load models for {provider.name}</span>
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="popover-footer">
        <span className="hint">+ adds a model to a parallel run</span>
        <span className="spacer" />
        <button className="btn ghost tiny" onClick={props.onOpenProviders}>
          Manage providers
        </button>
      </div>
    </div>
  );
}

function formatContext(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 100_000) / 10}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return String(value);
}

/* ------------------------------------------------------------------- thread */

export interface ThreadViewProps {
  messages: Message[];
  busy: boolean;
  emptyState: React.ReactNode;
  showLogos: boolean;
  onRetry?: (message: Message) => void;
  onSwitchProtocol?: (message: Message) => void;
  onFixConnection?: () => void;
}

export function ThreadView(props: ThreadViewProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  // Only follow the stream when the reader is already at the bottom. Yanking the
  // viewport while someone scrolls back was one of the "it moves" complaints.
  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  useEffect(() => {
    const node = scrollRef.current;
    if (node && pinnedRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [props.messages, props.busy]);

  if (props.messages.length === 0) {
    return <div className="scroll">{props.emptyState}</div>;
  }

  return (
    <div className="scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="thread">
        {props.messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            {message.role === 'user' ? (
              <div className="meta">
                <span className="who">You</span>
              </div>
            ) : (
              <div className="meta">
                {props.showLogos && message.model ? <ModelLogo model={message.model} size={13} /> : null}
                <span className="who">{message.answeredBy ?? message.providerId ?? 'assistant'}</span>
                {message.model ? <code title={message.model}>{modelShortName(message.model)}</code> : null}
              </div>
            )}
            <div className="bubble">
              {message.error ? (
                <div className="error-block">
                  <div className="error-text">{message.error}</div>
                  <div className="actions">
                    {props.onRetry ? (
                      <button className="btn tiny" onClick={() => props.onRetry?.(message)}>
                        <IconRefresh width={12} height={12} />
                        Retry
                      </button>
                    ) : null}
                    {props.onSwitchProtocol ? (
                      <button className="btn tiny" onClick={() => props.onSwitchProtocol?.(message)}>
                        Switch wire API
                      </button>
                    ) : null}
                    {props.onFixConnection && /daemon|127\.0\.0\.1|localhost|Network error/i.test(message.error) ? (
                      <button className="btn tiny" onClick={props.onFixConnection}>
                        Fix connection
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : message.content ? (
                message.role === 'user' ? (
                  <span className="plain">{message.content}</span>
                ) : (
                  <Markdown text={message.content} />
                )
              ) : (
                <span className="thinking">{props.busy ? 'Thinking' : 'Empty response'}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- composer */

export interface SlashCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export interface ComposerProps {
  value: string;
  busy: boolean;
  skills: Skill[];
  enabledSkillIds: string[];
  modelLabel: string;
  effort: Effort;
  agentMode: boolean;
  parallelCount: number;
  notice: string | null;
  commands: SlashCommand[];
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleSkill: (skillId: string) => void;
  onToggleAgentMode: () => void;
  onOpenPicker: () => void;
  onSetEffort: (effort: Effort) => void;
  onDismissNotice: () => void;
}

export function Composer(props: ComposerProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [effortOpen, setEffortOpen] = useState(false);
  const effortMeta = EFFORT_META[props.effort];

  const slash = props.value.startsWith('/');
  const query = slash ? props.value.slice(1).toLowerCase().split(/\s+/)[0] : '';
  const matches = slash
    ? props.commands.filter(
        (command) =>
          command.id.toLowerCase().includes(query) || command.label.toLowerCase().includes(query),
      )
    : [];

  useEffect(() => {
    setCommandIndex(0);
  }, [props.value]);

  const runCommand = (command: SlashCommand) => {
    command.run();
    props.onChange('');
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCommandIndex((index) => (index + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCommandIndex((index) => (index - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        runCommand(matches[Math.min(commandIndex, matches.length - 1)]);
        return;
      }
      if (event.key === 'Escape') {
        props.onChange('');
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      props.onSend();
    }
  };

  return (
    <div className="composer-wrap">
      {props.notice ? (
        <div className="notice-row">
          <span className="grow">{props.notice}</span>
          <button className="btn ghost tiny" onClick={props.onDismissNotice}>
            dismiss
          </button>
        </div>
      ) : null}

      <div className="composer">
        {matches.length > 0 ? (
          <div className="popover slash-popover">
            <div className="popover-body">
              {matches.map((command, index) => (
                <button
                  key={command.id}
                  className={`model-option ${index === commandIndex ? 'active' : ''}`}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => runCommand(command)}
                >
                  <span>{command.label}</span>
                  {command.hint ? <span className="trailing">{command.hint}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={props.value}
          placeholder="Ask anything…  / for commands"
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />

        <div className="composer-row">
          <button className="pill model-pill" onClick={props.onOpenPicker} title="Choose model">
            {props.modelLabel ? <ModelLogo model={props.modelLabel} size={13} /> : <span className="dot ok" />}
            <span className="pill-label">{props.modelLabel || 'no model'}</span>
            {props.parallelCount > 0 ? <span className="badge accent">+{props.parallelCount}</span> : null}
            <IconChevron width={11} height={11} />
          </button>

          <div style={{ position: 'relative' }}>
            <button
              className="pill effort-pill"
              data-effort={props.effort}
              onClick={() => setEffortOpen((value) => !value)}
              title={`Effort: ${effortMeta.label} — ${effortMeta.description}`}
              aria-expanded={effortOpen}
            >
              <span className="effort-dot" style={{ background: effortMeta.color }} />
              <span className="pill-label">{effortMeta.label}</span>
            </button>
            {effortOpen ? (
              <div className="popover effort-popover">
                <div className="popover-body">
                  {EFFORT_ORDER.map((level) => {
                    const meta = EFFORT_META[level];
                    return (
                      <button
                        key={level}
                        className={`effort-option ${level === props.effort ? 'active' : ''}`}
                        data-effort={level}
                        onClick={() => {
                          props.onSetEffort(level);
                          setEffortOpen(false);
                        }}
                      >
                        <span className="effort-dot" style={{ background: meta.color }} />
                        <span className="effort-name">{meta.label}</span>
                        <span className="effort-note">{meta.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <button
            className={`pill ${props.agentMode ? 'on' : ''}`}
            onClick={props.onToggleAgentMode}
            title="Agent mode: plan, act, verify"
          >
            <IconBolt width={11} height={11} />
            <span className="pill-label">{props.agentMode ? 'Agent' : 'Chat'}</span>
          </button>

          {props.enabledSkillIds.length > 0 ? (
            <span className="composer-hint" title="Skills in use">
              {props.enabledSkillIds.length} skill{props.enabledSkillIds.length === 1 ? '' : 's'}
            </span>
          ) : null}

          <span className="spacer" />

          {props.busy ? (
            <button className="stop-button" onClick={props.onStop}>
              Stop
            </button>
          ) : (
            <button
              className="send-button"
              onClick={props.onSend}
              disabled={!props.value.trim()}
              aria-label="Send message"
              title="Send"
            >
              <IconArrowUp />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
