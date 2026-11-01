import React, { useEffect, useRef, useState } from 'react';
import type { Message, ModelInfo, Provider, Skill, Thread } from '../core/types';
import { Markdown } from './Markdown';
import {
  IconArrowUp,
  IconBolt,
  IconChart,
  IconChevron,
  IconMenu,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSliders,
  IconStack,
  IconTrash,
  IconX,
} from './Icons';

export type PanelId = 'providers' | 'skills' | 'catalog' | 'usage' | null;

/* ------------------------------------------------------------------ sidebar */

export interface SidebarProps {
  threads: Thread[];
  activeThreadId: string;
  providerCount: number;
  enabledProviderCount: number;
  modelCount: number;
  activePanel: PanelId;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onOpenPanel: (panel: PanelId) => void;
}

export function Sidebar(props: SidebarProps): React.ReactElement {
  const { threads, activeThreadId } = props;
  return (
    <>
      {props.open ? <div className="sidebar-scrim" onClick={props.onClose} role="presentation" /> : null}
      <aside className={`sidebar ${props.open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <img src="./icons/icon-192.png" alt="" />
          </span>
          <div>
            <div className="brand-name">Rllama</div>
            <div className="brand-sub">multi-provider workspace</div>
          </div>
          <button
            className="icon-button mobile-only"
            style={{ marginLeft: 'auto' }}
            onClick={props.onClose}
            aria-label="Close sidebar"
          >
            <IconX />
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="nav-item new" onClick={props.onNew}>
            <IconPlus className="icon" />
            <span>New chat</span>
            <span className="trailing">⌘K</span>
          </button>
        </div>

        <div className="sidebar-scroll">
          <div className="section-label">Recents</div>
          {threads.map((thread) => (
            <div
              className={`thread-row ${thread.id === activeThreadId ? 'active' : ''}`}
              key={thread.id}
            >
              <button
                className="thread-button"
                onClick={() => props.onSelect(thread.id)}
                title={thread.title}
              >
                {thread.title || 'Untitled'}
              </button>
              {threads.length > 1 ? (
                <button
                  className="row-delete"
                  onClick={() => props.onDelete(thread.id)}
                  title="Delete chat"
                  aria-label={`Delete ${thread.title}`}
                >
                  <IconTrash width={12} height={12} />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            className={`nav-item ${props.activePanel === 'providers' ? 'active' : ''}`}
            onClick={() => props.onOpenPanel(props.activePanel === 'providers' ? null : 'providers')}
          >
            <IconSliders className="icon" />
            <span>Providers</span>
            <span className="trailing">
              {props.enabledProviderCount}/{props.providerCount}
            </span>
          </button>
          <button
            className={`nav-item ${props.activePanel === 'catalog' ? 'active' : ''}`}
            onClick={() => props.onOpenPanel(props.activePanel === 'catalog' ? null : 'catalog')}
          >
            <IconStack className="icon" />
            <span>Models</span>
            <span className="trailing">{props.modelCount}</span>
          </button>
          <button
            className={`nav-item ${props.activePanel === 'skills' ? 'active' : ''}`}
            onClick={() => props.onOpenPanel(props.activePanel === 'skills' ? null : 'skills')}
          >
            <IconBolt className="icon" />
            <span>Skills</span>
          </button>
          <button
            className={`nav-item ${props.activePanel === 'usage' ? 'active' : ''}`}
            onClick={() => props.onOpenPanel(props.activePanel === 'usage' ? null : 'usage')}
          >
            <IconChart className="icon" />
            <span>Usage</span>
          </button>
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ top bar */

export interface TopBarProps {
  title: string;
  providerName: string;
  modelLabel: string;
  usageLabel: string;
  usageLevel: 'ok' | 'warn' | 'danger';
  failover: boolean;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onOpenPanel: (panel: PanelId) => void;
  onOpenSidebar: () => void;
  picker: React.ReactNode;
}

export function TopBar(props: TopBarProps): React.ReactElement {
  return (
    <div className="topbar">
      <button className="icon-button mobile-only" onClick={props.onOpenSidebar} aria-label="Chats">
        <IconMenu />
      </button>
      <span className="topbar-title">{props.title}</span>
      <div style={{ position: 'relative' }}>
        <button className="pill" onClick={props.onTogglePicker} title="Provider and model" aria-expanded={props.pickerOpen}>
          <span className="dot ok" />
          <span className="pill-label">
            {props.providerName ? `${props.providerName} · ${props.modelLabel || 'no model'}` : 'no provider'}
          </span>
          <IconChevron width={12} height={12} />
        </button>
        {props.pickerOpen ? props.picker : null}
      </div>
      <span className="spacer" />
      <span className="pill" title={props.failover ? 'Automatic failover is on' : 'Automatic failover is off'}>
        <span className={`dot ${props.usageLevel}`} />
        <span className="pill-label">{props.usageLabel}</span>
      </span>
      <button className="icon-button" onClick={() => props.onOpenPanel('skills')} title="Skills" aria-label="Skills">
        <IconBolt />
      </button>
      <button className="icon-button" onClick={() => props.onOpenPanel('usage')} title="Usage" aria-label="Usage">
        <IconChart />
      </button>
      <button
        className="icon-button"
        onClick={() => props.onOpenPanel('providers')}
        title="Providers"
        aria-label="Providers"
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
  onPick: (providerId: string, model: string) => void;
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
  const groups = props.providers
    .map((provider) => ({
      provider,
      models: (props.modelsByProvider[provider.id] ?? []).filter(
        (model) => !needle || model.id.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.models.length > 0 || (!needle && group.provider.enabled));

  return (
    <div className="popover" ref={ref} style={{ top: 36, left: 0, width: 360 }}>
      <div className="popover-header">
        <IconSearch width={14} height={14} />
        <input
          type="search"
          value={query}
          autoFocus
          placeholder="Search models from your keys…"
          onChange={(event) => setQuery(event.target.value)}
          style={{ border: 'none', background: 'transparent', padding: 0 }}
        />
      </div>
      <div className="popover-body">
        {groups.length === 0 ? (
          <div className="hint" style={{ padding: 10 }}>
            No models yet. Open Providers, paste a key, then press “Load models”.
          </div>
        ) : null}
        {groups.map(({ provider, models }) => (
          <div key={provider.id}>
            <div className="picker-group-label">
              {provider.name}
              {provider.enabled ? '' : ' · disabled'}
              {models.length === 0 ? ` · ${props.status[provider.id] ?? 'no models loaded'}` : ''}
            </div>
            {models.map((model) => (
              <button
                key={model.id}
                className={`model-option ${
                  provider.id === props.activeProviderId && model.id === props.activeModel ? 'active' : ''
                }`}
                onClick={() => {
                  props.onPick(provider.id, model.id);
                  props.onClose();
                }}
              >
                <code>{model.id}</code>
                {model.context ? <span className="trailing">{formatContext(model.context)}</span> : null}
              </button>
            ))}
            {models.length === 0 ? (
              <button className="model-option" onClick={() => props.onLoad(provider.id)}>
                <IconRefresh width={13} height={13} />
                <span>Load models for {provider.name}</span>
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="popover-header" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
        <button className="btn ghost tiny" onClick={props.onLoad.bind(null, props.activeProviderId ?? '')} disabled={!props.activeProviderId}>
          <IconRefresh width={12} height={12} />
          Reload {props.providers.find((provider) => provider.id === props.activeProviderId)?.name ?? ''}
        </button>
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
  onRetry?: (message: Message) => void;
  onSwitchProtocol?: (message: Message) => void;
}

export function ThreadView(props: ThreadViewProps): React.ReactElement {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [props.messages.length, props.busy]);

  if (props.messages.length === 0) {
    return <div className="scroll">{props.emptyState}</div>;
  }

  return (
    <div className="scroll">
      <div className="thread">
        {props.messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            {message.role === 'user' ? (
              <div className="meta">
                <span className="who">You</span>
              </div>
            ) : (
              <div className="meta">
                <span className="who">{message.answeredBy ?? message.providerId ?? 'assistant'}</span>
                {message.model ? <code>{message.model}</code> : null}
              </div>
            )}
            <div className="bubble">
              {message.error ? (
                <div className="error-block">
                  <div>{message.error}</div>
                  {message.content ? <Markdown text={message.content} /> : null}
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
                  </div>
                </div>
              ) : message.content ? (
                message.role === 'user' ? (
                  <span>{message.content}</span>
                ) : (
                  <Markdown text={message.content} />
                )
              ) : (
                <span className="thinking">{props.busy ? 'Thinking' : 'Empty response'}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
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
  notice: string | null;
  commands: SlashCommand[];
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleSkill: (skillId: string) => void;
  onOpenPicker: () => void;
  onDismissNotice: () => void;
}

export function Composer(props: ComposerProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);

  const slash = props.value.startsWith('/');
  const query = slash ? props.value.slice(1).toLowerCase().split(/\s+/)[0] : '';
  const matches = slash
    ? props.commands.filter((command) => command.id.toLowerCase().includes(query) || command.label.toLowerCase().includes(query))
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
      void props.onSend();
    }
  };

  const activeSkills = props.skills.filter((skill) => props.enabledSkillIds.includes(skill.id));

  return (
    <div className="composer-wrap">
      {props.notice ? (
        <div className="composer" style={{ marginBottom: 8, padding: '8px 10px' }}>
          <div className="banner" style={{ border: 'none', background: 'transparent', padding: 0 }}>
            <span className="grow">{props.notice}</span>
            <button className="btn ghost tiny" onClick={props.onDismissNotice}>
              dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="composer" style={{ position: 'relative' }}>
        {matches.length > 0 ? (
          <div className="popover" style={{ bottom: '100%', left: 0, right: 0, marginBottom: 6 }}>
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
          placeholder="Message Rllama…  / for commands, Enter to send, Shift+Enter for a new line"
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />

        <div className="composer-row">
          <button className="pill" onClick={props.onOpenPicker} title="Choose provider and model">
            <span className="dot ok" />
            <span className="pill-label">{props.modelLabel || 'no model'}</span>
            <IconChevron width={11} height={11} />
          </button>

          {props.skills
            .filter((skill) => ['caveman', 'rea', 'openrouter'].includes(skill.id))
            .map((skill) => {
              const on = props.enabledSkillIds.includes(skill.id);
              return (
                <button
                  key={skill.id}
                  className={`pill ${on ? 'on' : ''}`}
                  onClick={() => props.onToggleSkill(skill.id)}
                  title={skill.description}
                >
                  <IconBolt width={11} height={11} />
                  <span className="pill-label">{skill.name.replace(/ —.*$/, '')}</span>
                </button>
              );
            })}

          {activeSkills.length > 3 ? (
            <span className="composer-hint">+{activeSkills.length - 3} skills</span>
          ) : null}

          <span className="spacer" />

          {props.busy ? (
            <button className="stop-button" onClick={props.onStop}>
              Stop
            </button>
          ) : (
            <button
              className="send-button"
              onClick={() => props.onSend()}
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
