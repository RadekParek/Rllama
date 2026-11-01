import React from 'react';
import type { Thread } from '../../core/types';
import { IconPlus, IconTrash } from '../Icons';

export type MenuTarget = 'settings' | 'skills' | 'mcp' | 'providers' | 'catalog' | 'cli';

export interface MenuPanelProps {
  threads: Thread[];
  activeThreadId: string;
  email?: string;
  onNewChat: () => void;
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onOpen: (target: MenuTarget) => void;
}

/**
 * The main navigation, opened from the top-left button.
 *
 * It replaces the old sidebar footer: every section the app has lives here, in
 * one list, on both phone and desktop.
 */
export function MenuPanel(props: MenuPanelProps): React.ReactElement {
  const items: Array<{ id: MenuTarget; label: string; hint: string }> = [
    { id: 'skills', label: 'Skills', hint: '3 on' },
    { id: 'mcp', label: 'MCP servers', hint: 'tools' },
    { id: 'providers', label: 'API providers', hint: 'keys' },
    { id: 'catalog', label: 'My models', hint: 'catalog' },
    { id: 'cli', label: 'Terminal CLI', hint: 'agents' },
    { id: 'settings', label: 'Settings', hint: 'effort, context' },
  ];

  return (
    <>
      <button className="menu-primary" onClick={props.onNewChat}>
        <IconPlus width={15} height={15} />
        New chat
      </button>

      <div className="section-label" style={{ padding: '4px 0 2px' }}>
        Sessions
      </div>
      <div className="menu-sessions">
        {props.threads.map((thread) => (
          <div
            className={`thread-row ${thread.id === props.activeThreadId ? 'active' : ''}`}
            key={thread.id}
          >
            <button className="thread-button" onClick={() => props.onSelectThread(thread.id)}>
              {thread.title || 'New chat'}
            </button>
            {props.threads.length > 1 ? (
              <button
                className="row-delete"
                onClick={() => props.onDeleteThread(thread.id)}
                aria-label="Delete chat"
                title="Delete chat"
              >
                <IconTrash width={12} height={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="section-label" style={{ padding: '10px 0 2px' }}>
        Workspace
      </div>
      {items.map((item) => (
        <button className="menu-item" key={item.id} onClick={() => props.onOpen(item.id)}>
          <span>{item.label}</span>
          <span className="menu-hint">{item.hint}</span>
        </button>
      ))}

      <div className="menu-footer">
        {props.email ? <div className="menu-account">{props.email}</div> : null}
        <div className="hint">
          Everything runs on this device. Keys are stored locally — there is no Rllama account and nothing is sent
          anywhere except the providers you configure.
        </div>
      </div>
    </>
  );
}
