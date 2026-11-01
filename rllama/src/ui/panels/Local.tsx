import React, { useEffect, useState } from 'react';
import type { Provider } from '../../core/types';
import { daemonBase, probeDaemon, type DaemonProbe } from '../../core/ollama';
import {
  isAndroid,
  openTermux,
  scanLan,
  termuxStatus,
  type TermuxStatus,
} from '../../core/native';
import { startLocalDaemon, terminalInfo, type TerminalInfo } from '../../core/terminal';
import { IconCheck, IconPlay, IconRefresh, IconSearch } from '../Icons';

export interface LocalPanelProps {
  providers: Provider[];
  testStatus: Record<string, string>;
  probes: DaemonProbe[];
  onDiscover: () => Promise<void>;
  onProbes: (probes: DaemonProbe[]) => void;
  onUpdate: (providerId: string, patch: Partial<Provider>) => void;
  onTest: (providerId: string) => void;
}

const TERMUX_SETUP = [
  'pkg update',
  'pkg install ollama',
  'ollama serve &',
  'ollama pull treyleo16/claude-oss',
].join('\n');

const ALLOW_EXTERNAL = 'echo "allow-external-apps=true" >> ~/.termux/termux.properties';

/**
 * Local backend.
 *
 * The panel is written around one idea: the daemon is either running or it is
 * not, and both cases get a button instead of a paragraph.
 *
 *  - not running yet → **Start Ollama**, which runs `ollama serve` through the
 *    desktop shell or through Termux;
 *  - running somewhere unreachable → **Scan network**, a real subnet scan with
 *    the platform's own sockets, then tap the address that answered.
 *
 * Pulls only ever go to a local daemon: Ollama Cloud answers `/api/pull` with an
 * HTML 403 page, which is exactly the error this panel used to produce.
 */
export function LocalPanel(props: LocalPanelProps): React.ReactElement {
  const local = props.providers.find((provider) => provider.protocol === 'ollama');
  const [url, setUrl] = useState(local?.baseUrl ?? 'http://127.0.0.1:11434');
  const [copied, setCopied] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [termux, setTermux] = useState<TermuxStatus | null>(null);
  const [shell, setShell] = useState<TerminalInfo | null>(null);

  useEffect(() => {
    if (isAndroid()) {
      void termuxStatus().then(setTermux);
    }
    void terminalInfo().then(setShell);
  }, []);

  if (!local) {
    return (
      <div className="banner">
        <span className="grow">No Ollama provider configured yet — add one in API providers.</span>
      </div>
    );
  }

  const status = props.testStatus[local.id];

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(key),
      () => setCopied(null),
    );
  };

  const start = async () => {
    setBusy(true);
    setAction('Starting Ollama…');
    const result = await startLocalDaemon();
    setAction(result.message || result.output || 'Asked the shell to start Ollama.');
    // Give the daemon a moment to bind its port before probing.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await props.onDiscover();
    setBusy(false);
  };

  const scan = async () => {
    setBusy(true);
    setAction('Scanning your network for port 11434…');
    const result = await scanLan(11434);
    if (result.hosts.length === 0) {
      props.onProbes([]);
      setAction(result.message ?? 'No daemon answered on this network.');
      setBusy(false);
      return;
    }
    const probes = await Promise.all(
      result.hosts.map((host) => probeDaemon(`http://${host}:11434`, 1500)),
    );
    const sorted = probes.sort((a, b) => Number(b.ok) - Number(a.ok));
    props.onProbes(sorted);
    const reachable = sorted.filter((probe) => probe.ok);
    setAction(
      reachable.length > 0
        ? `Found ${reachable.length} daemon${reachable.length === 1 ? '' : 's'}. Tap the one you want.`
        : `${result.hosts.length} host(s) answered on port 11434 but none spoke the Ollama API.`,
    );
    setBusy(false);
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
          onClick={() =>
            props.onUpdate(local.id, { baseUrl: daemonBase(url) || 'http://127.0.0.1:11434', enabled: true })
          }
        >
          Save
        </button>
      </div>

      <div className="row wrap">
        <button className="btn tiny accent" onClick={() => void start()} disabled={busy}>
          <IconPlay width={12} height={12} />
          Start Ollama
        </button>
        <button className="btn tiny" onClick={() => void scan()} disabled={busy}>
          <IconSearch width={12} height={12} />
          Scan network
        </button>
        <button className="btn tiny" onClick={() => void props.onDiscover()} disabled={busy}>
          <IconRefresh width={12} height={12} />
          Find daemon
        </button>
        <button className="btn tiny" onClick={() => props.onTest(local.id)}>
          <IconCheck width={12} height={12} />
          Test
        </button>
      </div>

      {action ? <div className="hint">{action}</div> : null}
      {status ? <div className="hint">{status}</div> : null}

      {props.probes.length > 0 ? (
        <div className="probe-list">
          {props.probes.map((probe) => (
            <button
              key={probe.url}
              className={`probe ${probe.ok ? 'ok' : ''}`}
              onClick={() => {
                props.onUpdate(local.id, { baseUrl: daemonBase(probe.url), enabled: true });
                setUrl(daemonBase(probe.url));
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

      <div className="section-label" style={{ padding: '12px 0 0' }}>
        Where commands run
      </div>
      <div className="hint">
        {shell?.canRun ? `${shell.label} — ${shell.detail}.` : shell?.detail ?? 'Checking…'}
        {isAndroid() ? (
          <>
            {' '}
            Termux is {termux?.installed ? 'installed' : 'not installed'}
            {termux?.installed ? (termux.canRun ? ' and allows external commands.' : ' but blocks external commands.') : '.'}
          </>
        ) : null}
      </div>
      {isAndroid() && termux && !termux.canRun ? (
        <div className="row">
          <button className="btn tiny" onClick={() => void openTermux()}>
            Open Termux
          </button>
          <button className="btn tiny" onClick={() => copy(ALLOW_EXTERNAL, 'allow')}>
            {copied === 'allow' ? 'Copied' : 'Copy the allow-external-apps line'}
          </button>
        </div>
      ) : null}

      <div className="section-label" style={{ padding: '12px 0 0' }}>
        Ollama on this phone (Termux)
      </div>
      <pre className="snippet">{TERMUX_SETUP}</pre>
      <div className="row">
        <button className="btn tiny" onClick={() => copy(TERMUX_SETUP, 'termux')}>
          {copied === 'termux' ? 'Copied' : 'Copy commands'}
        </button>
      </div>
      <div className="hint">
        With Termux the app and the daemon share the device, so <code>127.0.0.1:11434</code> is right. Rllama can ask
        Termux to run <code>ollama serve</code> for you — that is what Start Ollama does on Android.
      </div>

      <div className="section-label" style={{ padding: '12px 0 0' }}>
        Ollama on your computer
      </div>
      <pre className="snippet">{'OLLAMA_HOST=0.0.0.0:11434 ollama serve'}</pre>
      <div className="hint">
        Then tap <strong>Scan network</strong>: Rllama scans your subnet for port 11434 and lists what answers. Addresses
        look like <code>http://192.168.1.20:11434</code>; allow the port through the firewall.
      </div>

      <div className="section-label" style={{ padding: '12px 0 0' }}>
        Pulls
      </div>
      <div className="hint">
        Downloads always go to the local daemon at <code>/api/pull</code>. Cloud-only models (anything tagged{' '}
        <code>-cloud</code>) are never downloaded — those belong on an Ollama Cloud provider, and Ollama Cloud will
        answer a pull with an HTML 403 page, which is why Rllama refuses before trying.
      </div>
    </>
  );
}
