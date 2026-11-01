import React from 'react';
import { CONTEXT_PRESETS, EFFORT_LABELS } from '../../core/settings';
import type { Effort, Settings } from '../../core/types';

export interface SettingsPanelProps {
  settings: Settings;
  failoverEnabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onToggleFailover: (value: boolean) => void;
  onResetUsage: () => void;
  onClearModelCache: () => void;
}

const MAX_TOKENS = [512, 1024, 2048, 4096, 8192];

export function SettingsPanel(props: SettingsPanelProps): React.ReactElement {
  const { settings } = props;

  return (
    <>
      <div className="section-label" style={{ padding: '2px 0 0' }}>
        Effort
      </div>
      <div className="segmented" role="group" aria-label="Reasoning effort">
        {(['low', 'medium', 'high'] as Effort[]).map((effort) => (
          <button
            key={effort}
            className={`segment ${settings.effort === effort ? 'on' : ''}`}
            onClick={() => props.onChange({ effort })}
          >
            {EFFORT_LABELS[effort]}
          </button>
        ))}
      </div>
      <div className="hint">
        Low keeps answers short and cheap, high sends the provider's reasoning controls (and Ollama&apos;s
        <code> think</code> flag). Same idea as Codex&apos;s effort setting.
      </div>

      <div className="section-label" style={{ padding: '8px 0 0' }}>
        Context
      </div>
      <label className="field-label" htmlFor="context">
        History sent to the model
      </label>
      <select
        id="context"
        className="field"
        value={settings.contextTokens}
        onChange={(event) => props.onChange({ contextTokens: Number(event.target.value) })}
      >
        {CONTEXT_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset >= 1000 ? `${Math.round(preset / 1000)}K tokens` : `${preset} tokens`}
          </option>
        ))}
      </select>
      <div className="hint">
        Older turns are dropped before sending, so a long chat never turns into a 400 from the provider.
      </div>

      <div className="grid-2" style={{ marginTop: 8 }}>
        <div>
          <label className="field-label" htmlFor="max-tokens">
            Max reply
          </label>
          <select
            id="max-tokens"
            className="field"
            value={settings.maxTokens}
            onChange={(event) => props.onChange({ maxTokens: Number(event.target.value) })}
          >
            {MAX_TOKENS.map((value) => (
              <option key={value} value={value}>
                {value} tokens
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="temperature">
            Temperature · {settings.temperature.toFixed(1)}
          </label>
          <input
            id="temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onChange={(event) => props.onChange({ temperature: Number(event.target.value) })}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
        </div>
      </div>

      <div className="section-label" style={{ padding: '8px 0 0' }}>
        Behaviour
      </div>
      <div className="card">
        <div className="row">
          <div className="grow">
            <div className="card-title">Agent mode</div>
            <div className="card-note">Plan → act → verify preamble before your skills.</div>
          </div>
          <button
            className={`switch ${settings.agentMode ? 'on' : ''}`}
            onClick={() => props.onChange({ agentMode: !settings.agentMode })}
            aria-label="Toggle agent mode"
          />
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div className="grow">
            <div className="card-title">Automatic failover</div>
            <div className="card-note">Continue on the next provider at 90% budget or on 401/402/429/5xx.</div>
          </div>
          <button
            className={`switch ${props.failoverEnabled ? 'on' : ''}`}
            onClick={() => props.onToggleFailover(!props.failoverEnabled)}
            aria-label="Toggle failover"
          />
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div className="grow">
            <div className="card-title">Model logos</div>
            <div className="card-note">Show a vendor mark next to every model name.</div>
          </div>
          <button
            className={`switch ${settings.showLogos ? 'on' : ''}`}
            onClick={() => props.onChange({ showLogos: !settings.showLogos })}
            aria-label="Toggle model logos"
          />
        </div>
      </div>

      <div className="section-label" style={{ padding: '8px 0 0' }}>
        Data
      </div>
      <div className="row">
        <button className="btn tiny" onClick={props.onResetUsage}>
          Reset usage
        </button>
        <button className="btn tiny" onClick={props.onClearModelCache}>
          Clear model cache
        </button>
      </div>
      <div className="hint">
        Rllama has no account of its own: keys, chats and settings stay in this device&apos;s storage.
      </div>
    </>
  );
}
