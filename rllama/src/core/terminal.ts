/**
 * Terminal bridge.
 *
 * The Terminal CLI panel and the `/run` command both need to execute shell
 * commands. Where that is possible depends on the shell:
 *
 *  - desktop: the Electron main process spawns the command and streams output;
 *  - Android: Termux does, through the RUN_COMMAND intent, so Rllama and Termux
 *    run side by side — Termux owns the shell, Rllama owns the interface;
 *  - web: nothing, and the panel says so instead of pretending.
 */
import { isAndroid, platform, termuxRun, termuxStatus } from './native';
import { desktopBridge } from './transport';

export type TerminalHost = 'desktop' | 'termux' | 'unavailable';

export interface TerminalInfo {
  host: TerminalHost;
  /** Where commands actually run, in the user's words. */
  label: string;
  detail: string;
  canRun: boolean;
}

export interface TerminalResult {
  ok: boolean;
  code?: number | null;
  output: string;
  host: TerminalHost;
  /** Set on desktop builds so a long-running command can be stopped. */
  id?: string;
  message?: string;
}

/** Stops a command previously returned by `runCommand`. */
export function stopCommand(id: string | undefined): void {
  if (!id) {
    return;
  }
  desktopBridge()?.killTerminal?.(id);
}

/** What the panel shows in its header. */
export async function terminalInfo(): Promise<TerminalInfo> {
  const bridge = desktopBridge();
  if (bridge?.isDesktop && bridge.exec) {
    return {
      host: 'desktop',
      label: 'This computer',
      detail: `${bridge.platform} · shell commands run on this machine`,
      canRun: true,
    };
  }

  if (isAndroid()) {
    const status = await termuxStatus();
    if (status.installed && status.canRun) {
      return {
        host: 'termux',
        label: 'Termux · this phone',
        detail: 'Commands run in Termux, side by side with Rllama',
        canRun: true,
      };
    }
    return {
      host: 'termux',
      label: 'Termux · not ready',
      detail: status.installed
        ? 'Termux is installed but blocks external commands. Open Termux, run `echo "allow-external-apps=true" >> ~/.termux/termux.properties`, then restart Termux.'
        : 'Install Termux (F-Droid) to run shell commands from Rllama.',
      canRun: false,
    };
  }

  return {
    host: 'unavailable',
    label: 'No shell here',
    detail:
      platform() === 'web'
        ? 'The browser build cannot run shell commands. Use the desktop or Android build.'
        : 'This platform has no shell bridge.',
    canRun: false,
  };
}

/**
 * Runs one command. Output is streamed through `onChunk` when the host supports
 * it; Termux returns its output in one piece when the intent completes.
 */
export async function runCommand(
  command: string,
  onChunk?: (chunk: string, stream: 'out' | 'err') => void,
): Promise<TerminalResult> {
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, output: '', host: 'unavailable', message: 'Nothing to run.' };
  }

  const bridge = desktopBridge();
  if (bridge?.isDesktop && bridge.exec) {
    const chunks: string[] = [];
    const { code, id } = await bridge.exec(trimmed, (chunk, stream) => {
      chunks.push(chunk);
      onChunk?.(chunk, stream);
    });
    return {
      ok: code === 0,
      code,
      id,
      output: chunks.join(''),
      host: 'desktop',
      message: code === 0 ? undefined : `Exited with code ${code}.`,
    };
  }

  if (isAndroid()) {
    const result = await termuxRun(trimmed, { timeoutMs: 120_000 });
    const output = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n');
    if (output) {
      onChunk?.(output, 'out');
    }
    return {
      ok: result.ok,
      code: result.exitCode,
      output,
      host: 'termux',
      message: result.message,
    };
  }

  return {
    ok: false,
    output: '',
    host: 'unavailable',
    message: 'No shell on this build — the terminal works in the desktop and Android apps.',
  };
}

/**
 * Starts the Ollama daemon where it can be started.
 *
 * Desktop: `ollama serve` detached. Android: the same command through Termux, so
 * Rllama really can bring the backend up instead of asking the user to do it.
 */
export async function startLocalDaemon(): Promise<TerminalResult> {
  const bridge = desktopBridge();
  if (bridge?.startOllama) {
    const result = await bridge.startOllama();
    return {
      ok: result.started,
      output: result.message ?? '',
      host: 'desktop',
      message: result.started ? undefined : result.message,
    };
  }
  if (isAndroid()) {
    const status = await termuxStatus();
    if (!status.canRun) {
      return {
        ok: false,
        output: '',
        host: 'termux',
        message:
          status.message ??
          (status.installed
            ? 'Termux blocks external commands. Allow them in ~/.termux/termux.properties and restart Termux.'
            : 'Install Termux first — Rllama starts the daemon through it.'),
      };
    }
    const result = await termuxRun('ollama serve', { background: true });
    return {
      ok: result.ok,
      output: [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n'),
      host: 'termux',
      message: result.ok ? 'Asked Termux to run `ollama serve`.' : result.message,
    };
  }
  return {
    ok: false,
    output: '',
    host: 'unavailable',
    message: 'This build cannot start a daemon. Run `ollama serve` yourself, then reconnect.',
  };
}

/** The commands worth one tap in the terminal panel. */
export const QUICK_COMMANDS: { label: string; command: string }[] = [
  { label: 'ollama serve', command: 'ollama serve' },
  { label: 'ollama list', command: 'ollama list' },
  { label: 'ollama ps', command: 'ollama ps' },
  { label: 'version', command: 'ollama --version' },
  { label: 'disk', command: 'du -sh ~/.ollama 2>/dev/null || df -h /data 2>/dev/null' },
  { label: 'models dir', command: 'ls -lagh ~/.ollama/models/manifests 2>/dev/null' },
];

/**
 * Builds the command that imports a GGUF (for example a model PocketPal already
 * downloaded) into the Ollama daemon. Ollama has no HTTP endpoint for this, so
 * it goes through the shell — Termux on Android, the desktop shell otherwise.
 * Paths with a single quote in them have to be quoted by hand; file names from
 * the device scan never contain one they did not ship with.
 */
export function importGgufCommand(filePath: string, name: string): string {
  const safeName = name.trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-') || 'imported-model';
  const source = filePath.trim();
  const modelfile = `$HOME/.rllama/${safeName}.Modelfile`;
  return [
    'mkdir -p "$HOME/.rllama"',
    `echo 'FROM ${source}' > "${modelfile}"`,
    `ollama create ${safeName} -f "${modelfile}"`,
  ].join('\n');
}
