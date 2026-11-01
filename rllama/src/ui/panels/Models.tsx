import React, { useEffect, useState } from 'react';
import {
  GGUF_DIRECTORIES,
  isAndroid,
  listGguf,
  termuxStatus,
  type DeviceFile,
  type GgufScan,
  type TermuxStatus,
} from '../../core/native';
import { huggingFaceRepo, searchHuggingFace, type HfRepo, type HfRepoDetail } from '../../core/huggingface';
import { importGgufCommand, runCommand, terminalInfo, type TerminalInfo } from '../../core/terminal';
import { formatTokens } from '../../core/usage';
import { IconDownload, IconFolder, IconSearch } from '../Icons';

/**
 * Local models.
 *
 * Two routes to the same place — the Ollama daemon:
 *
 *  - **On this device**: GGUF files on shared storage, which is where PocketPal
 *    exports and Hugging Face downloads land. Ollama has no HTTP endpoint for
 *    importing a file, so the import goes through the shell (Termux on Android,
 *    the desktop shell otherwise) and the panel shows the exact command first.
 *  - **Hugging Face**: modern Ollama pulls GGUFs straight from the Hub, so a
 *    repository is downloaded with the ordinary `/api/pull`, using the
 *    `hf.co/<repo>:<quant>` reference. No file handling needed at all.
 *
 * PocketPal's own storage is private to PocketPal (`/data/data/com.pocketpal.ai`)
 * and cannot be read by another app on Android 11+. Files it saved to
 * `Download/` or that you exported do show up in the device scan.
 */
export interface ModelsPanelProps {
  /** Pulls `hf.co/<repo>:<quant>` into the local daemon. */
  onPullRef: (ref: string) => void;
  pullState: Record<string, { status: string; percent?: number; error?: string }>;
  onOpenLocal: () => void;
}

export function ModelsPanel(props: ModelsPanelProps): React.ReactElement {
  const [tab, setTab] = useState<'device' | 'hub'>('hub');
  const [shell, setShell] = useState<TerminalInfo | null>(null);
  const [termux, setTermux] = useState<TermuxStatus | null>(null);

  /* device */
  const [scan, setScan] = useState<GgufScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importName, setImportName] = useState<Record<string, string>>({});
  const [importLog, setImportLog] = useState<Record<string, string>>({});

  /* hugging face */
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<HfRepo[]>([]);
  const [searching, setSearching] = useState(false);
  const [repo, setRepo] = useState<HfRepoDetail | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(false);

  useEffect(() => {
    void terminalInfo().then(setShell);
    if (isAndroid()) {
      void termuxStatus().then(setTermux);
    }
  }, []);

  const scanDevice = async () => {
    setScanning(true);
    try {
      setScan(await listGguf());
    } finally {
      setScanning(false);
    }
  };

  const importFile = async (file: DeviceFile) => {
    const name = importName[file.path]?.trim() || file.name.replace(/\.gguf$/i, '').toLowerCase();
    const command = importGgufCommand(file.path, name);
    setImportLog((previous) => ({ ...previous, [file.path]: `$ ${command}` }));
    if (!shell?.canRun) {
      setImportLog((previous) => ({
        ...previous,
        [file.path]: `${command}\n\nNo shell on this build — copy the command and run it where Ollama runs.`,
      }));
      return;
    }
    const result = await runCommand(command, (chunk) =>
      setImportLog((previous) => ({ ...previous, [file.path]: (previous[file.path] ?? '') + chunk })),
    );
    if (result.message) {
      setImportLog((previous) => ({
        ...previous,
        [file.path]: `${previous[file.path] ?? ''}\n${result.message}`,
      }));
    }
  };

  const search = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setSearching(true);
    setRepo(null);
    setRepoError(null);
    try {
      setRepos(await searchHuggingFace(trimmed));
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : String(error));
      setRepos([]);
    } finally {
      setSearching(false);
    }
  };

  const openRepo = async (id: string) => {
    setLoadingRepo(true);
    setRepoError(null);
    try {
      setRepo(await huggingFaceRepo(id));
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingRepo(false);
    }
  };

  return (
    <>
      <div className="tabs">
        <button className={`tab ${tab === 'hub' ? 'on' : ''}`} onClick={() => setTab('hub')}>
          Hugging Face
        </button>
        <button className={`tab ${tab === 'device' ? 'on' : ''}`} onClick={() => setTab('device')}>
          On this device
        </button>
      </div>

      {tab === 'hub' ? (
        <>
          <div className="hint">
            Ollama downloads GGUFs straight from the Hub, so a repository goes into your local daemon with the same
            pull as any other model. Nothing is stored twice.
          </div>
          <div className="row">
            <div style={{ position: 'relative', flex: 1 }}>
              <IconSearch
                width={12}
                height={12}
                style={{ position: 'absolute', left: 9, top: 10, color: 'var(--text-faint)' }}
              />
              <input
                type="text"
                style={{ paddingLeft: 26, width: '100%' }}
                placeholder="Search GGUF repositories, e.g. qwen2.5 coder"
                value={query}
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void search();
                  }
                }}
              />
            </div>
            <button className="btn tiny" onClick={() => void search()} disabled={searching || !query.trim()}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>

          {repoError ? <div className="hint danger">{repoError}</div> : null}

          {repos.length > 0 && !repo ? (
            <div className="card-list">
              {repos.map((item) => (
                <button key={item.id} className="hub-row" onClick={() => void openRepo(item.id)}>
                  <span className="hub-name">{item.id}</span>
                  <span className="hub-meta">
                    {formatTokens(item.downloads)} downloads · ♥ {item.likes}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {loadingRepo ? <div className="hint">Reading repository…</div> : null}

          {repo ? (
            <>
              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn ghost tiny" onClick={() => setRepo(null)}>
                  ← results
                </button>
                <code className="grow">{repo.id}</code>
              </div>
              {repo.files.length === 0 ? (
                <div className="hint danger">No .gguf files in this repository.</div>
              ) : (
                <div className="card-list">
                  {repo.refs.map(({ file, ref }) => {
                    const state = props.pullState[ref];
                    return (
                      <div key={file.name} className="model-row">
                        <div className="grow">
                          <div className="model-row-name">{file.name}</div>
                          <div className="model-row-note">
                            {file.size ? `${Math.round(file.size / 1024 / 1024)} MB` : 'size unknown'} ·{' '}
                            <code>{ref}</code>
                          </div>
                          {state ? (
                            <div className={`model-row-status ${state.error ? 'bad' : ''}`}>
                              {state.error ?? `${state.status}${state.percent ? ` ${state.percent}%` : ''}`}
                            </div>
                          ) : null}
                        </div>
                        <button
                          className="btn tiny"
                          onClick={() => props.onPullRef(ref)}
                          disabled={Boolean(state && !state.error && state.status !== 'success')}
                        >
                          <IconDownload width={12} height={12} />
                          Pull
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          <div className="hint">
            Looks for <code>.gguf</code> files in the usual shared folders
            {isAndroid() ? ' on this phone' : ''}, then imports the one you pick into Ollama. PocketPal keeps its
            models inside its own private storage, which Android does not let another app read — export or copy a
            model to <code>Download/</code> and it will appear here.
          </div>

          <div className="row">
            <button className="btn tiny" onClick={() => void scanDevice()} disabled={scanning}>
              <IconFolder width={12} height={12} />
              {scanning ? 'Scanning…' : 'Scan this device'}
            </button>
            <button className="btn ghost tiny" onClick={props.onOpenLocal}>
              Local backend
            </button>
          </div>

          {!isAndroid() ? (
            <div className="hint">
              Device scanning is Android-only. On desktop, Ollama reads files from its own machine — use Hugging
              Face or <code>ollama create</code> in the terminal.
            </div>
          ) : null}

          {termux && !termux.canRun ? (
            <div className="hint danger">
              {termux.message ??
                'Termux must allow external commands before Rllama can import a file. Set allow-external-apps=true in ~/.termux/termux.properties and restart Termux.'}
            </div>
          ) : null}

          {scan ? (
            <>
              <div className="hint">
                Checked {scan.scanned.length} folders
                {scan.denied.length > 0 ? `, ${scan.denied.length} unreadable` : ''} · {scan.files.length} GGUF
                {scan.files.length === 1 ? '' : 's'}
              </div>
              {scan.files.length === 0 ? (
                <div className="hint">
                  Nothing found. Copy a model into <code>Download/</code> (or run{' '}
                  <code>termux-setup-storage</code> in Termux so it can reach shared storage), then scan again.
                </div>
              ) : (
                <div className="card-list">
                  {scan.files.map((file) => {
                    const log = importLog[file.path];
                    const fallback = file.name.replace(/\.gguf$/i, '').toLowerCase();
                    return (
                      <div key={file.path} className="model-row stacked">
                        <div className="row">
                          <div className="grow">
                            <div className="model-row-name">{file.name}</div>
                            <div className="model-row-note">
                              {Math.round(file.size / 1024 / 1024)} MB · <code>{file.path}</code>
                            </div>
                          </div>
                          <button className="btn tiny" onClick={() => void importFile(file)}>
                            Import
                          </button>
                        </div>
                        <input
                          type="text"
                          value={importName[file.path] ?? fallback}
                          spellCheck={false}
                          onChange={(event) =>
                            setImportName((previous) => ({ ...previous, [file.path]: event.target.value }))
                          }
                          placeholder="name in Ollama"
                        />
                        {log ? <pre className="snippet small">{log}</pre> : null}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="hint">
                Folders scanned: {GGUF_DIRECTORIES.join(', ')}
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
