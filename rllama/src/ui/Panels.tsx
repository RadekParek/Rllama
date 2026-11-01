import React, { useState } from 'react';
import { TEMPLATES, providerFromTemplate, templateById } from '../core/providers';
import { customSkillFromMarkdown } from '../core/skills';
import { formatTokens, usageLevel, usageRatio, usageOf, type UsageMap } from '../core/usage';
import type { ModelInfo, Provider, Skill } from '../core/types';

export interface ProvidersPanelProps {
  providers: Provider[];
  usage: UsageMap;
  modelsByProvider: Record<string, ModelInfo[]>;
  modelStatus: Record<string, string>;
  onChange: (providers: Provider[]) => void;
  onFetchModels: (providerId: string) => void;
  onSelectModel: (providerId: string, model: string) => void;
  selectedModels: Record<string, string>;
}

export function ProvidersPanel(props: ProvidersPanelProps): React.ReactElement {
  const { providers, usage, modelsByProvider, modelStatus, onChange, onFetchModels, onSelectModel, selectedModels } =
    props;
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [apiKey, setApiKey] = useState('');

  const update = (id: string, patch: Partial<Provider>) => {
    onChange(providers.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)));
  };

  const add = () => {
    const template = templateById(templateId);
    if (!template) {
      return;
    }
    const provider = providerFromTemplate(template, apiKey.trim(), providers.length);
    provider.enabled = true;
    onChange([...providers, provider]);
    setApiKey('');
  };

  return (
    <div className="panel" id="panel-providers">
      <section>
        <h2>Add a provider</h2>
        <div className="card">
          <div className="field">
            <label htmlFor="template">Template</label>
            <select id="template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{templateById(templateId)?.hint ?? 'Paste an API key to create this connection.'}</p>
          <div className="field">
            <label htmlFor="apiKey">API key {templateById(templateId)?.requiresKey ? '' : '(optional)'}</label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <div className="row">
            <button className="button primary" onClick={add}>
              Add provider
            </button>
            {templateById(templateId)?.keyUrl ? (
              <a className="hint" href={templateById(templateId)?.keyUrl} target="_blank" rel="noreferrer noopener">
                get a key
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section>
        <h2>Connected ({providers.length})</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {providers.length === 0 ? <p className="hint">No providers yet.</p> : null}
          {providers.map((provider) => {
            const models = modelsByProvider[provider.id] ?? [];
            const level = usageLevel(usageOf(usage, provider.id));
            return (
              <div className="card" key={provider.id}>
                <div className="card-head">
                  <div className="card-title">
                    <span className={`dot ${level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : 'danger'}`} />
                    {provider.name}
                  </div>
                  <div className="row">
                    <span className="badge">{provider.protocol}</span>
                    {provider.enabled ? (
                      <button className="button small" onClick={() => update(provider.id, { enabled: false })}>
                        Disable
                      </button>
                    ) : (
                      <button className="button small" onClick={() => update(provider.id, { enabled: true })}>
                        Enable
                      </button>
                    )}
                    <button
                      className="button small danger"
                      onClick={() => onChange(providers.filter((item) => item.id !== provider.id))}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label>Base URL</label>
                  <input
                    value={provider.baseUrl}
                    spellCheck={false}
                    onChange={(event) => update(provider.id, { baseUrl: event.target.value })}
                  />
                </div>

                <div className="field">
                  <label>API key</label>
                  <input
                    type="password"
                    value={provider.apiKey}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="not set"
                    onChange={(event) => update(provider.id, { apiKey: event.target.value })}
                  />
                </div>

                {templateById(provider.templateId)?.alternates?.length ? (
                  <div className="field">
                    <label>Wire protocol</label>
                    <div className="row">
                      <button
                        className={`chip-button ${provider.protocol === 'openai' ? 'active' : ''}`}
                        onClick={() =>
                          update(provider.id, {
                            protocol: 'openai',
                            baseUrl: templateById(provider.templateId)?.baseUrl ?? provider.baseUrl,
                          })
                        }
                      >
                        OpenAI (/v1)
                      </button>
                      {templateById(provider.templateId)?.alternates?.map((alternate) => (
                        <button
                          key={alternate.protocol}
                          className={`chip-button ${provider.protocol === alternate.protocol ? 'active' : ''}`}
                          onClick={() =>
                            update(provider.id, { protocol: alternate.protocol, baseUrl: alternate.baseUrl })
                          }
                        >
                          {alternate.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="row">
                  <button className="button small" onClick={() => onFetchModels(provider.id)}>
                    Load models
                  </button>
                  {models.length > 0 ? (
                    <select
                      value={selectedModels[provider.id] ?? ''}
                      onChange={(event) => onSelectModel(provider.id, event.target.value)}
                    >
                      <option value="">choose a model…</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                {modelStatus[provider.id] ? <p className="hint">{modelStatus[provider.id]}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      <p className="hint">
        Keys are stored only on this device, in this app's local profile. Nothing is sent anywhere except to the
        provider you configured.
      </p>
    </div>
  );
}

export interface SkillsPanelProps {
  skills: Skill[];
  enabledIds: string[];
  systemPrompt: string;
  onToggle: (id: string) => void;
  onAdd: (skill: Skill) => void;
  onRemove: (id: string) => void;
  onSystemPromptChange: (value: string) => void;
}

export function SkillsPanel(props: SkillsPanelProps): React.ReactElement {
  const { skills, enabledIds, systemPrompt, onToggle, onAdd, onRemove, onSystemPromptChange } = props;
  const [name, setName] = useState('');
  const [markdown, setMarkdown] = useState('');

  return (
    <div className="panel" id="panel-skills">
      <section>
        <h2>Skills ({enabledIds.length} on)</h2>
        <p className="hint">Enabled skills are appended to this chat's system prompt.</p>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {skills.map((skill) => (
            <label className="skill-toggle" key={skill.id}>
              <input
                type="checkbox"
                checked={enabledIds.includes(skill.id)}
                onChange={() => onToggle(skill.id)}
              />
              <span>
                <span className="name">{skill.name}</span>{' '}
                {skill.tokenSaver ? <span className="badge token">token saver</span> : null}
                <div className="desc">{skill.description}</div>
                {!skill.builtin ? (
                  <button
                    className="button small danger"
                    style={{ marginTop: 6 }}
                    onClick={(event) => {
                      event.preventDefault();
                      onRemove(skill.id);
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Add your own skill</h2>
        <div className="card">
          <div className="field">
            <label>Name</label>
            <input value={name} placeholder="e.g. sql-expert" onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label>Instructions (markdown)</label>
            <textarea
              value={markdown}
              placeholder="Write the instructions the model should follow…"
              onChange={(event) => setMarkdown(event.target.value)}
            />
          </div>
          <button
            className="button primary"
            disabled={!markdown.trim()}
            onClick={() => {
              onAdd(customSkillFromMarkdown(name, markdown));
              setName('');
              setMarkdown('');
            }}
          >
            Add skill
          </button>
        </div>
      </section>

      <section>
        <h2>Base system prompt</h2>
        <div className="field">
          <textarea
            value={systemPrompt}
            placeholder="Always-apply instructions (optional)"
            onChange={(event) => onSystemPromptChange(event.target.value)}
          />
        </div>
      </section>
    </div>
  );
}

export interface UsagePanelProps {
  providers: Provider[];
  usage: UsageMap;
  failoverEnabled: boolean;
  onToggleFailover: (value: boolean) => void;
  onSetLimit: (providerId: string, limit: number | undefined) => void;
  onReset: (providerId: string) => void;
}

export function UsagePanel(props: UsagePanelProps): React.ReactElement {
  const { providers, usage, failoverEnabled, onToggleFailover, onSetLimit, onReset } = props;
  return (
    <div className="panel" id="panel-usage">
      <section>
        <h2>Usage &amp; limits</h2>
        <label className="skill-toggle">
          <input type="checkbox" checked={failoverEnabled} onChange={(event) => onToggleFailover(event.target.checked)} />
          <span>
            <span className="name">Continue on the next provider</span>
            <div className="desc">
              At 90% of a budget the request moves to the next enabled provider instead of failing. At 75% the app
              warns. Budgets are the token limits you enter below.
            </div>
          </span>
        </label>
      </section>

      <section>
        <h2>Per provider</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {providers.map((provider) => {
            const entry = usageOf(usage, provider.id);
            const ratio = usageRatio(entry);
            const level = usageLevel(entry);
            const used = entry.promptTokens + entry.completionTokens;
            return (
              <div className="card" key={provider.id}>
                <div className="card-head">
                  <div className="card-title">{provider.name}</div>
                  <span className="badge">{entry.requests} req</span>
                </div>
                <div className={`meter ${level === 'warn' || level === 'ok' ? '' : 'danger'} ${level === 'warn' ? 'warn' : ''}`}>
                  <span style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }} />
                </div>
                <p className="hint">
                  {formatTokens(used)} tokens used
                  {entry.limitTokens ? ` of ${formatTokens(entry.limitTokens)} (${Math.round(ratio * 100)}%)` : ' (no budget set)'}
                  {entry.lastError ? ` · last error: ${entry.lastError}` : ''}
                </p>
                <div className="row">
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    placeholder="token budget"
                    value={entry.limitTokens ?? ''}
                    style={{ maxWidth: 150 }}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      onSetLimit(provider.id, value ? Number(value) : undefined);
                    }}
                  />
                  <button className="button small" onClick={() => onReset(provider.id)}>
                    Reset window
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="hint">
        Rllama keeps the limits honest: it never creates accounts to reset a quota. When a budget runs out the work
        simply continues on another provider you added, or on a local model.
      </p>
    </div>
  );
}
