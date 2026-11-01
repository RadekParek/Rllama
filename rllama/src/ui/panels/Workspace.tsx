import React, { useState } from 'react';
import { uid } from '../../core/store';
import type { McpServer } from '../../core/types';
import { IconPlus, IconTrash } from '../Icons';

/* ------------------------------------------------------------------- MCP */

export interface McpPanelProps {
  servers: McpServer[];
  onChange: (servers: McpServer[]) => void;
}

/**
 * MCP servers, stored as configuration.
 *
 * Honest state of play: the definitions are saved and can be exported, but the
 * app does not spawn stdio processes yet (a browser/webview cannot, and the
 * desktop bridge for it is not written). They are listed so a workspace can be
 * described and carried between machines.
 */
export function McpPanel(props: McpPanelProps): React.ReactElement {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');

  return (
    <>
      <div className="banner">
        <span className="grow">
          Saved here as configuration. Tool execution is not wired yet — a webview cannot spawn processes, and the
          desktop bridge for it is still to come.
        </span>
      </div>

      {props.servers.map((server) => (
        <div className="card" key={server.id}>
          <div className="row">
            <div className="grow">
              <div className="card-title">{server.name}</div>
              <div className="card-note">
                <code>{server.transport}</code> · <code>{server.target}</code>
              </div>
            </div>
            <button
              className={`switch ${server.enabled ? 'on' : ''}`}
              onClick={() =>
                props.onChange(
                  props.servers.map((item) =>
                    item.id === server.id ? { ...item, enabled: !item.enabled } : item,
                  ),
                )
              }
              aria-label={`Toggle ${server.name}`}
            />
            <button
              className="btn ghost tiny"
              onClick={() => props.onChange(props.servers.filter((item) => item.id !== server.id))}
              aria-label={`Remove ${server.name}`}
            >
              <IconTrash width={12} height={12} />
            </button>
          </div>
        </div>
      ))}

      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <div className="field-label">Add a server</div>
        <input type="text" placeholder="Name, e.g. filesystem" value={name} onChange={(event) => setName(event.target.value)} />
        <select className="field" value={transport} onChange={(event) => setTransport(event.target.value as 'stdio' | 'http')}>
          <option value="stdio">stdio command</option>
          <option value="http">http endpoint</option>
        </select>
        <input
          type="text"
          placeholder={transport === 'stdio' ? 'npx -y @modelcontextprotocol/server-filesystem ~' : 'https://example.com/mcp'}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
        <div className="row">
          <span className="spacer" />
          <button
            className="btn primary tiny"
            disabled={!name.trim() || !target.trim()}
            onClick={() => {
              props.onChange([
                ...props.servers,
                { id: uid('mcp'), name: name.trim(), target: target.trim(), transport, enabled: true },
              ]);
              setName('');
              setTarget('');
            }}
          >
            <IconPlus width={12} height={12} />
            Add server
          </button>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- terminal cli */

interface CliEntry {
  id: string;
  name: string;
  vendor: string;
  install: string;
  run: string;
  note: string;
}

const CLIS: CliEntry[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    install: 'npm install -g @anthropic-ai/claude-code',
    run: 'claude',
    note: 'Agentic terminal partner for a repository, with its own permission model.',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    install: 'npm install -g @openai/codex',
    run: 'codex',
    note: 'Wire-API compatible with Rllama: the config block below is exactly what the AgentRouter provider uses.',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    vendor: 'Nous Research',
    install: 'pipx install hermes-cli',
    run: 'hermes',
    note: 'Open-weight agent CLI; point it at the same gateway URL you use here.',
  },
];

const CODEX_SNIPPET = `model = "gpt-6.1-sol"
model_provider = "agentrouter"

[model_providers.agentrouter]
name = "AgentRouter"
base_url = "https://agentrouter.org/v1"
env_key = "AGENTROUTER_API_KEY"
wire_api = "responses"`;

/**
 * The agent CLIs people actually use, with the exact commands.
 *
 * Rllama does not launch them: that needs a process bridge that does not exist
 * in the webview build yet. What it can do is hand over a correct, copyable
 * configuration — which is the part people get wrong.
 */
export function CliPanel(): React.ReactElement {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(id),
      () => setCopied(null),
    );
  };

  return (
    <>
      <div className="banner">
        <span className="grow">
          Rllama keeps the provider setup that these tools need. It does not run them yet — a webview cannot spawn a
          terminal, and the desktop bridge for it is not written.
        </span>
      </div>

      {CLIS.map((cli) => (
        <div className="card" key={cli.id}>
          <div className="card-title">
            {cli.name} <span className="badge">{cli.vendor}</span>
          </div>
          <div className="card-note">{cli.note}</div>
          <pre className="snippet">{`${cli.install}\n${cli.run}`}</pre>
          <div className="row">
            <button
              className="btn tiny"
              onClick={() => copy(cli.id, `${cli.install}\n${cli.run}`)}
            >
              {copied === cli.id ? 'Copied' : 'Copy commands'}
            </button>
          </div>
        </div>
      ))}

      <div className="section-label" style={{ padding: '8px 0 0' }}>
        Codex + AgentRouter
      </div>
      <pre className="snippet">{CODEX_SNIPPET}</pre>
      <div className="row">
        <button className="btn tiny" onClick={() => copy('codex-config', CODEX_SNIPPET)}>
          {copied === 'codex-config' ? 'Copied' : 'Copy config'}
        </button>
      </div>
      <div className="hint">
        <code>wire_api = &quot;responses&quot;</code> is the mode Rllama now uses for AgentRouter by default.
      </div>
    </>
  );
}
