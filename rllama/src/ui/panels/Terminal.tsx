import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAndroid, openTermux, termuxStatus, type TermuxStatus } from '../../core/native';
import {
  QUICK_COMMANDS,
  runCommand,
  startLocalDaemon,
  stopCommand,
  terminalInfo,
  type TerminalInfo,
} from '../../core/terminal';
import { IconPlay, IconRefresh, IconTerminal, IconX } from '../Icons';

/**
 * Terminal CLI, built like a Codex session: one dark surface, a prompt, the
 * streamed output, and the commands you always need one tap away.
 *
 * Where the command runs is stated, never implied:
 *  - desktop build → this computer's shell, streamed;
 *  - Android build → Termux, through RUN_COMMAND, so Termux and Rllama run
 *    side by side and the daemon survives the app being backgrounded;
 *  - browser build → the panel explains that there is no shell.
 */
type LineKind = 'command' | 'out' | 'err' | 'info';

interface Line {
  id: string;
  kind: LineKind;
  text: string;
}

let lineCounter = 0;
const nextLine = (kind: LineKind, text: string): Line => ({ id: `l${lineCounter++}`, kind, text });

export interface TerminalPanelProps {
  /** Called after a command exits, so the app can refresh daemon state. */
  onAfterCommand?: (command: string) => void;
}

export function TerminalPanel(props: TerminalPanelProps): React.ReactElement {
  const [info, setInfo] = useState<TerminalInfo>({
    host: 'unavailable',
    label: 'Checking…',
    detail: '',
    canRun: false,
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runningId, setRunningId] = useState<string | undefined>(undefined);
  const [termux, setTermux] = useState<TermuxStatus | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const streamed = useRef(false);

  useEffect(() => {
    void terminalInfo().then((found) => {
      setInfo(found);
      setLines((previous) =>
        previous.length > 0
          ? previous
          : [
              nextLine('info', 'Rllama terminal'),
              nextLine('info', found.canRun ? `Runs on: ${found.label} — ${found.detail}` : found.detail),
              nextLine('info', found.canRun ? 'Type a command, or tap one below. ↑/↓ walks history.' : ''),
            ].filter((line) => line.text.length > 0),
      );
    });
    if (isAndroid()) {
      void termuxStatus().then(setTermux);
    }
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines]);

  const push = useCallback((kind: LineKind, text: string) => {
    setLines((previous) => [...previous, nextLine(kind, text)]);
  }, []);

  /** Appends streamed output to the last output block of this run. */
  const appendChunk = useCallback((chunk: string) => {
    setLines((previous) => {
      const last = previous[previous.length - 1];
      if (last && last.kind === 'out' && streamed.current) {
        return [...previous.slice(0, -1), { ...last, text: last.text + chunk }];
      }
      return [...previous, nextLine('out', chunk)];
    });
  }, []);

  const execute = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || running) {
        return;
      }
      streamed.current = false;
      setRunning(true);
      setRunningId(undefined);
      setCommand('');
      setHistoryIndex(null);
      setHistory((previous) => [...previous.filter((item) => item !== value), value]);
      push('command', value);

      const result = await runCommand(value, (chunk, stream) => {
        streamed.current = true;
        if (stream === 'err') {
          setLines((previous) => [...previous, nextLine('err', chunk)]);
          return;
        }
        appendChunk(chunk);
      });

      if (result.id) {
        setRunningId(result.id);
      }
      if (!result.output && result.message) {
        push('info', result.message);
      } else if (result.message) {
        push('info', result.message);
      }
      if (result.code !== undefined && result.code !== null && result.code !== 0) {
        push('err', `exit ${result.code}`);
      }
      setRunning(false);
      props.onAfterCommand?.(value);
      inputRef.current?.focus();
    },
    [appendChunk, props, push, running],
  );

  const stop = () => {
    stopCommand(runningId);
    push('info', 'Stop sent. If the command keeps running, Termux owns it — close its session there.');
    setRunning(false);
  };

  const runChip = (chip: string) => {
    setCommand(chip);
    void execute(chip);
  };

  const startDaemon = async () => {
    push('info', 'Starting Ollama…');
    const result = await startLocalDaemon();
    push(result.ok ? 'out' : 'err', result.message || result.output || 'No answer.');
    props.onAfterCommand?.('ollama serve');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void execute(command);
      return;
    }
    if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault();
      const index = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(index);
      setCommand(history[index] ?? '');
      return;
    }
    if (event.key === 'ArrowDown' && historyIndex !== null) {
      event.preventDefault();
      const index = historyIndex + 1;
      if (index >= history.length) {
        setHistoryIndex(null);
        setCommand('');
        return;
      }
      setHistoryIndex(index);
      setCommand(history[index] ?? '');
      return;
    }
    if (event.key === 'l' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      setLines([]);
    }
  };

  const prompt = useMemo(() => (info.host === 'termux' ? '~ $' : '$'), [info.host]);

  return (
    <div className="terminal">
      <div className="terminal-bar">
        <span className={`dot ${info.canRun ? 'ok' : 'warn'}`} />
        <span className="terminal-host">{info.label}</span>
        <span className="terminal-detail">{info.detail}</span>
        <span className="spacer" />
        {isAndroid() && termux?.installed ? (
          <button className="btn ghost tiny" onClick={() => void openTermux()} title="Open the Termux app">
            Termux
          </button>
        ) : null}
        <button className="btn ghost tiny" onClick={() => setLines([])} title="Clear (Ctrl+L)">
          Clear
        </button>
      </div>

      <div className="terminal-screen" ref={scrollRef} onClick={() => inputRef.current?.focus()}>
        {lines.map((line) => (
          <div key={line.id} className={`term-line ${line.kind}`}>
            {line.kind === 'command' ? <span className="term-prompt">{prompt}</span> : null}
            <span className="term-text">{line.text}</span>
          </div>
        ))}

        <div className="term-line input">
          <span className="term-prompt">{prompt}</span>
          <input
            ref={inputRef}
            className="term-input"
            value={command}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={info.canRun ? 'ollama list' : 'no shell on this build'}
            disabled={!info.canRun}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {running ? (
            <button className="term-action" onClick={stop} title="Stop">
              <IconX width={12} height={12} />
            </button>
          ) : (
            <button
              className="term-action"
              onClick={() => void execute(command)}
              disabled={!command.trim() || !info.canRun}
              title="Run"
            >
              <IconPlay width={12} height={12} />
            </button>
          )}
        </div>
      </div>

      <div className="terminal-chips">
        <button className="chip accent" onClick={() => void startDaemon()} disabled={running}>
          <IconTerminal width={12} height={12} /> Start Ollama
        </button>
        {QUICK_COMMANDS.slice(1).map((chip) => (
          <button key={chip.command} className="chip" onClick={() => runChip(chip.command)} disabled={running}>
            {chip.label}
          </button>
        ))}
        <button
          className="chip"
          onClick={() => void execute(QUICK_COMMANDS[0].command)}
          disabled={running}
          title="Runs until you stop it"
        >
          <IconRefresh width={12} height={12} /> serve (foreground)
        </button>
      </div>
    </div>
  );
}
