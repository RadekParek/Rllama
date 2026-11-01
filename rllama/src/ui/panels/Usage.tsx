import React from 'react';
import { formatTokens, usageLevel, usageOf, usageRatio, type UsageMap } from '../../core/usage';
import type { Provider } from '../../core/types';

export interface UsagePanelProps {
  providers: Provider[];
  usage: UsageMap;
  failoverEnabled: boolean;
  onToggleFailover: (value: boolean) => void;
  onSetLimit: (providerId: string, limit: number | undefined) => void;
  onReset: (providerId: string) => void;
}

/**
 * The ledger behind automatic failover: per provider tokens, an optional
 * budget, and the 75% / 90% thresholds that move the session to the next key.
 */
export function UsagePanel(props: UsagePanelProps): React.ReactElement {
  return (
    <>
      <div className="card">
        <div className="row">
          <div className="grow">
            <div className="card-title">Automatic failover</div>
            <div className="card-note">
              At 90% of a provider's budget (or on 401/402/429/5xx), the next enabled provider continues the same
              message. At 75% the chat warns you first.
            </div>
          </div>
          <button
            className={`switch ${props.failoverEnabled ? 'on' : ''}`}
            onClick={() => props.onToggleFailover(!props.failoverEnabled)}
            aria-label="Toggle failover"
          />
        </div>
      </div>

      {props.providers.length === 0 ? <div className="hint">No providers yet.</div> : null}

      {props.providers.map((provider) => {
        const entry = usageOf(props.usage, provider.id);
        const ratio = usageRatio(entry);
        const level = usageLevel(entry);
        const total = entry.promptTokens + entry.completionTokens;
        return (
          <div className="card" key={provider.id}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <div className="grow">
                <div className="card-title">{provider.name}</div>
                <div className="card-note">
                  {entry.requests} requests · {formatTokens(total)} tokens
                  {entry.limitTokens ? ` of ${formatTokens(entry.limitTokens)}` : ''}
                </div>
              </div>
              <span className={`badge ${level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : 'accent'}`}>
                {entry.limitTokens ? `${Math.round(ratio * 100)}%` : 'no budget'}
              </span>
            </div>

            {entry.limitTokens ? (
              <div className="progress" style={{ marginTop: 8 }}>
                <span
                  style={{
                    width: `${Math.min(100, Math.round(ratio * 100))}%`,
                    background: level === 'warn' ? 'var(--warn)' : level === 'ok' ? undefined : 'var(--danger)',
                  }}
                />
              </div>
            ) : null}

            <div className="row" style={{ marginTop: 9 }}>
              <input
                type="number"
                min={0}
                step={1000}
                placeholder="token budget (optional)"
                value={entry.limitTokens ?? ''}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  props.onSetLimit(provider.id, Number.isFinite(value) && value > 0 ? value : undefined);
                }}
              />
              <button className="btn tiny" onClick={() => props.onReset(provider.id)}>
                Reset
              </button>
            </div>

            {entry.lastError ? <div className="hint" style={{ marginTop: 6 }}>last error: {entry.lastError}</div> : null}
          </div>
        );
      })}

      <div className="hint">
        Usage is counted from the tokens providers report, or estimated at 4 characters per token when a gateway does
        not report usage. The ledger lives on this device.
      </div>
    </>
  );
}
