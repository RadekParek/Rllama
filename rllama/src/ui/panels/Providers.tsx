import React, { useMemo, useState } from 'react';
import { TEMPLATES, templateById } from '../../core/providers';
import type { ModelInfo, Protocol, Provider } from '../../core/types';
import { IconCheck, IconKey, IconRefresh, IconTrash, IconX } from '../Icons';

const PROTOCOL_LABELS: Record<Protocol, string> = {
  openai: 'Chat Completions',
  'openai-responses': 'Responses (Codex wire_api)',
  anthropic: 'Anthropic Messages',
  ollama: 'Ollama native',
};

export interface ProvidersPanelProps {
  providers: Provider[];
  modelsByProvider: Record<string, ModelInfo[]>;
  modelStatus: Record<string, string>;
  selectedModels: Record<string, string>;
  testStatus: Record<string, string>;
  onChange: (providers: Provider[]) => void;
  onFetchModels: (providerId: string) => void;
  onTest: (providerId: string) => void;
  onSelectModel: (providerId: string, model: string) => void;
}

export function ProvidersPanel(props: ProvidersPanelProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const update = (providerId: string, patch: Partial<Provider>) => {
    props.onChange(props.providers.map((provider) => (provider.id === providerId ? { ...provider, ...patch } : provider)));
  };

  const addTemplate = (templateId: string) => {
    const template = templateById(templateId);
    if (!template) {
      return;
    }
    const priority = props.providers.length;
    props.onChange([
      ...props.providers,
      {
        id: `${template.id}-${Math.random().toString(36).slice(2, 8)}`,
        templateId: template.id,
        name: template.name,
        protocol: template.protocol,
        baseUrl: template.baseUrl,
        apiKey: '',
        priority,
        enabled: !template.requiresKey,
        headers: template.headers,
      },
    ]);
    setAdding(false);
  };

  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return TEMPLATES;
    }
    return TEMPLATES.filter(
      (template) => template.name.toLowerCase().includes(needle) || template.id.includes(needle),
    );
  }, [query]);

  return (
    <>
      <div className="row wrap">
        <div className="grow" />
        <button className="btn primary tiny" onClick={() => setAdding((value) => !value)}>
          {adding ? <IconX width={12} height={12} /> : <IconKey width={12} height={12} />}
          {adding ? 'Cancel' : 'Add provider'}
        </button>
      </div>

      {adding ? (
        <div className="card">
          <div className="field-label">Pick a template</div>
          <input
            type="search"
            placeholder="Search providers…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <div style={{ display: 'grid', gap: 6, marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
            {filteredTemplates.map((template) => (
              <button key={template.id} className="model-option" onClick={() => addTemplate(template.id)}>
                <span>{template.name}</span>
                <span className="trailing">{template.requiresKey ? 'key' : 'local'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {props.providers.length === 0 ? (
        <div className="hint">No providers yet. Add one, paste a key, and its models appear in the picker.</div>
      ) : null}

      {props.providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} {...props} onUpdate={update} />
      ))}

      <div className="hint" style={{ marginTop: 4 }}>
        Keys live in this device's app storage only. Ollama Cloud is <code>https://ollama.com/v1</code>; AgentRouter
        runs over the Responses wire API at <code>https://agentrouter.org/v1</code>, exactly like Codex.
      </div>
    </>
  );
}

function ProviderCard(
  props: ProvidersPanelProps & { provider: Provider; onUpdate: (id: string, patch: Partial<Provider>) => void },
): React.ReactElement {
  const { provider } = props;
  const [expanded, setExpanded] = useState(provider.templateId !== 'ollama-local');
  const models = props.modelsByProvider[provider.id] ?? [];
  const status = props.modelStatus[provider.id];
  const selected = props.selectedModels[provider.id] ?? '';
  const template = templateById(provider.templateId);
  const tested = props.testStatus[provider.id];

  return (
    <div className="card">
      <div className="card-head">
        <div className="grow">
          <div className="card-title">
            {provider.name}
            {provider.enabled ? null : <span className="badge" style={{ marginLeft: 8 }}>off</span>}
          </div>
          <div className="card-note">
            {PROTOCOL_LABELS[provider.protocol]} · <code>{provider.baseUrl}</code>
          </div>
        </div>
        <button
          className={`switch ${provider.enabled ? 'on' : ''}`}
          onClick={() => props.onUpdate(provider.id, { enabled: !provider.enabled })}
          aria-label={provider.enabled ? 'Disable provider' : 'Enable provider'}
          title={provider.enabled ? 'Enabled' : 'Disabled'}
        />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <input
          type="password"
          placeholder={provider.protocol === 'ollama' ? 'no key needed' : 'paste API key'}
          value={provider.apiKey}
          onChange={(event) => props.onUpdate(provider.id, { apiKey: event.target.value })}
          onBlur={() => {
            if (provider.apiKey.trim() && models.length === 0) {
              props.onFetchModels(provider.id);
            }
          }}
          disabled={provider.protocol === 'ollama'}
          autoComplete="off"
          spellCheck={false}
        />
        {template?.keyUrl ? (
          <a className="btn tiny" href={template.keyUrl} target="_blank" rel="noreferrer">
            get key
          </a>
        ) : null}
      </div>

      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn tiny" onClick={() => props.onFetchModels(provider.id)}>
          <IconRefresh width={12} height={12} />
          {models.length > 0 ? `${models.length} models` : 'Load models'}
        </button>
        <button className="btn tiny" onClick={() => props.onTest(provider.id)}>
          <IconCheck width={12} height={12} />
          Test
        </button>
        <button className="btn ghost tiny" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Hide settings' : 'Settings'}
        </button>
        <span className="spacer" />
        <button
          className="btn ghost tiny"
          onClick={() => props.onChange(props.providers.filter((item) => item.id !== provider.id))}
          title="Remove provider"
        >
          <IconTrash width={12} height={12} />
        </button>
      </div>

      {status || tested ? (
        <div className="hint" style={{ marginTop: 6 }}>
          {tested ? <div>{tested}</div> : null}
          {status ? <div>{status}</div> : null}
        </div>
      ) : null}

      {expanded ? (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div className="grid-2">
            <div>
              <label className="field-label" htmlFor={`protocol-${provider.id}`}>
                Wire API
              </label>
              <select
                id={`protocol-${provider.id}`}
                className="field"
                value={provider.protocol}
                onChange={(event) => props.onUpdate(provider.id, { protocol: event.target.value as Protocol })}
              >
                <option value="openai">Chat Completions</option>
                <option value="openai-responses">Responses (Codex)</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="ollama">Ollama native</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor={`base-${provider.id}`}>
                Base URL
              </label>
              <input
                id={`base-${provider.id}`}
                type="text"
                value={provider.baseUrl}
                onChange={(event) => props.onUpdate(provider.id, { baseUrl: event.target.value })}
                spellCheck={false}
              />
            </div>
          </div>

          {template?.alternates ? (
            <div className="chip-row">
              {template.alternates.map((alternate) => (
                <button
                  key={`${alternate.protocol}-${alternate.baseUrl}`}
                  className="chip"
                  onClick={() =>
                    props.onUpdate(provider.id, { protocol: alternate.protocol, baseUrl: alternate.baseUrl })
                  }
                >
                  {alternate.label}
                </button>
              ))}
            </div>
          ) : null}

          {models.length > 0 ? (
            <div>
              <div className="field-label">Model for this key</div>
              <select
                className="field"
                value={selected}
                onChange={(event) => props.onSelectModel(provider.id, event.target.value)}
              >
                <option value="">choose…</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {template?.hint ? <div className="hint">{template.hint}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function findTemplateHint(provider: Provider): string | undefined {
  return templateById(provider.templateId)?.hint;
}

export const searchProviders = TEMPLATES;
