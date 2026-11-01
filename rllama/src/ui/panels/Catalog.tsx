import React, { useMemo, useState } from 'react';
import { CATALOG_SNAPSHOT, OLLAMA_CATALOG, filterCatalog, searchCatalog } from '../../core/catalog';
import type { CatalogModel, Provider } from '../../core/types';
import { IconDownload, IconSearch } from '../Icons';

export interface PullState {
  status: string;
  percent?: number;
  error?: string;
}

export interface CatalogPanelProps {
  providers: Provider[];
  /** providerId -> installed model names. */
  installed: Record<string, string[]>;
  pullState: Record<string, PullState>;
  onPull: (providerId: string, model: string) => void;
  onUse: (providerId: string, model: string) => void;
  onOpenProviders: () => void;
}

const CAPABILITIES = ['tools', 'thinking', 'vision', 'embedding', 'cloud'];

export function CatalogPanel(props: CatalogPanelProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState<'any' | 'local' | 'cloud'>('any');
  const [capability, setCapability] = useState<string | undefined>(undefined);
  const [customName, setCustomName] = useState('');

  const ollamaProviders = props.providers.filter(
    (provider) => provider.protocol === 'ollama' || provider.templateId.includes('ollama'),
  );
  const target = ollamaProviders[0];

  const items = useMemo(
    () => filterCatalog(searchCatalog(OLLAMA_CATALOG, query), { where, capability }),
    [query, where, capability],
  );

  const pull = (model: string) => {
    if (!target) {
      props.onOpenProviders();
      return;
    }
    props.onPull(target.id, model);
  };

  return (
    <>
      <div className="hint">
        {OLLAMA_CATALOG.length} models snapshotted from ollama.com/search on {CATALOG_SNAPSHOT}. Pull downloads into
        your Ollama daemon; “Use” just points the chat at it. Anything else can be pulled by name.
      </div>

      {!target ? (
        <div className="banner">
          <span className="grow">Add a local Ollama provider to download models.</span>
          <button className="btn tiny" onClick={props.onOpenProviders}>
            Open providers
          </button>
        </div>
      ) : (
        <div className="hint">
          Pulling into <code>{target.name}</code> ({target.baseUrl})
        </div>
      )}

      <div className="catalog-toolbar">
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <IconSearch
            width={13}
            height={13}
            style={{ position: 'absolute', left: 9, top: 9, opacity: 0.6 }}
          />
          <input
            type="search"
            placeholder="Search the catalog…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ paddingLeft: 28 }}
          />
        </div>
      </div>

      <div className="chip-row">
        {(['any', 'local', 'cloud'] as const).map((option) => (
          <button
            key={option}
            className={`chip ${where === option ? 'on' : ''}`}
            onClick={() => setWhere(option)}
          >
            {option === 'any' ? 'Anywhere' : option === 'local' ? 'Local' : 'Cloud'}
          </button>
        ))}
        <span style={{ width: 6 }} />
        {CAPABILITIES.map((option) => (
          <button
            key={option}
            className={`chip ${capability === option ? 'on' : ''}`}
            onClick={() => setCapability(capability === option ? undefined : option)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginTop: 2 }}>
        <input
          type="text"
          placeholder="Pull any model by name, e.g. treyleo16/claude-mythos-5-1:latest"
          value={customName}
          onChange={(event) => setCustomName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && customName.trim()) {
              pull(customName.trim());
              setCustomName('');
            }
          }}
        />
        <button
          className="btn tiny"
          disabled={!customName.trim() || !target}
          onClick={() => {
            pull(customName.trim());
            setCustomName('');
          }}
        >
          <IconDownload width={12} height={12} />
          Pull
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
        {items.map((model) => (
          <CatalogRow
            key={model.name}
            model={model}
            installed={target ? (props.installed[target.id] ?? []).some((name) => name.split(':')[0] === model.name) : false}
            pull={props.pullState[model.name]}
            canPull={Boolean(target)}
            onPull={() => pull(model.name)}
            onUse={() => {
              const provider = model.cloud
                ? (ollamaProviders.find((item) => item.templateId === 'ollama-cloud') ?? target ?? props.providers[0])
                : (target ?? props.providers[0]);
              if (provider) {
                props.onUse(provider.id, model.name);
              }
            }}
          />
        ))}
        {items.length === 0 ? <div className="hint">Nothing matches that search.</div> : null}
      </div>
    </>
  );
}

function CatalogRow(props: {
  model: CatalogModel;
  installed: boolean;
  pull?: PullState;
  canPull: boolean;
  onPull: () => void;
  onUse: () => void;
}): React.ReactElement {
  const { model, pull } = props;
  return (
    <div className="catalog-item">
      <div className="row">
        <span className="catalog-name">{model.name}</span>
        {model.context ? <span className="badge">{model.context}</span> : null}
        {props.installed ? <span className="badge ok">installed</span> : null}
        <span className="spacer" />
        <button className="btn tiny" onClick={props.onUse}>
          {model.cloud ? 'Add to cloud' : 'Use'}
        </button>
        {model.cloud ? null : (
          <button
            className="btn tiny"
            onClick={props.onPull}
            disabled={!props.canPull || Boolean(pull && !pull.error)}
          >
            <IconDownload width={12} height={12} />
            Pull
          </button>
        )}
      </div>
      <div className="catalog-desc">{model.description}</div>
      <div className="chip-row">
        {model.capabilities.slice(0, 5).map((capability) => (
          <span className="badge" key={capability}>
            {capability}
          </span>
        ))}
        {model.sizes?.slice(0, 6).map((size) => (
          <span className="badge" key={size}>
            {size}
          </span>
        ))}
        {model.downloads ? <span className="badge">{model.downloads} pulls</span> : null}
      </div>
      {pull ? (
        <div>
          <div className="progress">
            <span style={{ width: `${pull.percent ?? (pull.error ? 100 : 12)}%`, background: pull.error ? 'var(--danger)' : undefined }} />
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {pull.error ?? `${pull.status}${pull.percent !== undefined ? ` · ${pull.percent}%` : ''}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
