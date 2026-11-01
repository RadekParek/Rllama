import React, { useState } from 'react';
import type { Provider } from '../../core/types';
import type { DaemonProbe } from '../../core/ollama';
import { IconCheck, IconRefresh, IconSearch } from '../Icons';

export interface LocalPanelProps {
  providers: Provider[];
  testStatus: Record<string, string>;
  probes: DaemonProbe[];
  onDiscover: () => Promise<void>;
  onUpdate: (providerId: string, patch: Partial<Provider>) => void;
  onTest: (providerId: string) => void;
}

const TERMUX = [
  'pkg update',
  'pkg install ollama',
  'ollama serve &',
  'ollama pull treyleo16/claude-oss',
].join('\n');

/**
 * Local backend setup.
 *
 * Two honest cases:
 *  - Ollama on the same phone (Termux): 127.0.0.1:11434 is correct, because the
 *    app and the daemon share the device.
 *  - Ollama on a computer: the phone cannot see 127.0.0.1, it needs the LAN IP,
 *    and the daemon must listen on all interfaces.
 */
export function LocalPanel(props: LocalPanelProps): React.ReactElement {
  const local = props.providers.find((provider) => provider.protocol === 'ollama');
  const [url, setUrl] = useState(local?.baseUrl ?? 'http://127.0.0.1:11434');
  const [copied, setCopied] = useState(false);

  if (!local) {
    return (
      <div className="banner">
        <span className="grow">No Ollama provider configured yet — add one in API providers.</span>
      </div>
    );
  }

  const status = props.testStatus[local.id];

  const copy = () => {
    void navigator.clipboard?.writeText(TERMUX).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <>
      <div className="field-label">Daemon address</div>
      <div className="row">
        <input
          type="text"
          value={url}
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="http://127.0.0.1:11434"
        />
        <button
          className="btn tiny"
          onClick={() => props.onUpdate(local.id, { baseUrl: url.trim().replace(/\/+$/, ''), enabled: true })}
        >
          Save
        </button>
      </div>
      <div className="row">
        <button className="btn tiny" onClick={() => props.onTest(local.id)}>
          <IconCheck width={12} height={12} />
          Test connection
        </button>
        <button className="btn tiny" onClick={() => void props.onDiscover()}>
          <IconSearch width={12} height={12} />
          Find daemon
        </button>
        <button
          className="btn tiny"
          onClick={() => {
            props.onUpdate(local.id, { baseUrl: 'http://127.0.0.1:11434', enabled: true });
            setUrl('http://127.0.0.1:11434');
            props.onTest(local.id);
          }}
        >
          <IconRefresh width={12} height={12} />
          Same phone (Termux)
        </button>
      </div>
      {status ? <div className="hint">{status}</div> : null}

      {props.probes.length > 0 ? (
        <div className="probe-list">
          {props.probes.map((probe) => (
            <button
              key={probe.url}
              className={`probe ${probe.ok ? 'ok' : ''}`}
              onClick={() => {
                props.onUpdate(local.id, { baseUrl: probe.url, enabled: true });
                setUrl(probe.url);
              }}
              title={probe.ok ? 'Use this daemon' : probe.error}
            >
              <span className={`dot ${probe.ok ? 'ok' : 'danger'}`} />
              <code>{probe.url.replace('http://', '')}</code>
              <span className="probe-note">
                {probe.ok ? (probe.version ? `ollama ${probe.version}` : 'reachable') : 'no answer'}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="section-label" style={{ padding: '10px 0 0' }}>
        Run Ollama on this phone (Termux)
      </div>
      <pre className="snippet">{TERMUX}</pre>
      <div className="row">
        <button className="btn tiny" onClick={copy}>
          {copied ? 'Copied' : 'Copy commands'}
        </button>
      </div>
      <div className="hint">
        With Termux the app and the daemon are on the same device, so{' '}
        <code>127.0.0.1:11434</code> is correct. The first pull of{' '}
        <code>treyleo16/claude-oss</code> (1B) is small enough for a phone.
      </div>

      <div className="section-label" style={{ padding: '10px 0 0' }}>
        Ollama on your computer
      </div>
      <div className="hint">
        A phone cannot reach <code>127.0.0.1</code> on your PC — that address means “this phone”. Start the daemon
        so it listens on the network:
      </div>
      <pre className="snippet">{'OLLAMA_HOST=0.0.0.0:11434 ollama serve'}</pre>
      <div className="hint">
        Then enter your computer&apos;s LAN address above, for example{' '}
        <code>http://192.168.1.20:11434</code>, and allow port 11434 through the firewall.
      </div>

      <div className="section-label" style={{ padding: '10px 0 0' }}>
        Notes
      </div>
      <div className="hint">
        Cloud-only models (any id tagged “cloud”, such as <code>gemma4:31b-cloud</code>) run on ollama.com and are
        never downloaded, so pulling one is expected to fail. Add them to an Ollama Cloud provider instead.
      </div>
    </>
  );
}
