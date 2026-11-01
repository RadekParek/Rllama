'use strict';

/**
 * Bridge between the renderer and the main process.
 *
 * `request()` performs the HTTP call in the main process and returns a real
 * `Response`, streaming the body chunk by chunk, so `client.ts` can keep using
 * fetch semantics (response.ok, response.body.getReader(), response.text())
 * without knowing it crossed a process boundary.
 */

const { contextBridge, ipcRenderer } = require('electron');

function request(payload) {
  return new Promise((resolve, reject) => {
    const { id } = payload;
    let streamController = null;
    let settled = false;

    const cleanup = () => {
      ipcRenderer.removeListener('rllama:http:meta', onMeta);
      ipcRenderer.removeListener('rllama:http:chunk', onChunk);
      ipcRenderer.removeListener('rllama:http:end', onEnd);
      ipcRenderer.removeListener('rllama:http:error', onError);
    };

    const body = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        ipcRenderer.send('rllama:http:abort', id);
      },
    });

    function onMeta(_event, meta) {
      if (meta.id !== id || settled) {
        return;
      }
      settled = true;
      const headers = new Headers();
      for (const [key, value] of meta.headers || []) {
        try {
          headers.append(key, value);
        } catch {
          // Hop-by-hop headers cannot be reconstructed; ignore them.
        }
      }
      resolve(
        new Response(body, {
          status: meta.status,
          statusText: meta.statusText,
          headers,
        }),
      );
    }

    function onChunk(_event, chunk) {
      if (chunk.id !== id || !streamController) {
        return;
      }
      streamController.enqueue(new TextEncoder().encode(chunk.text));
    }

    function onEnd(_event, end) {
      if (end.id !== id) {
        return;
      }
      try {
        streamController?.close();
      } catch {
        // Already closed.
      }
      cleanup();
    }

    function onError(_event, error) {
      if (error.id !== id) {
        return;
      }
      cleanup();
      if (error.aborted) {
        try {
          streamController?.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          // Stream already finished.
        }
        if (!settled) {
          settled = true;
          reject(new DOMException('Aborted', 'AbortError'));
        }
        return;
      }
      try {
        streamController?.error(new Error(error.message));
      } catch {
        // Stream already finished.
      }
      if (!settled) {
        settled = true;
        reject(new Error(error.message));
      }
    }

    ipcRenderer.on('rllama:http:meta', onMeta);
    ipcRenderer.on('rllama:http:chunk', onChunk);
    ipcRenderer.on('rllama:http:end', onEnd);
    ipcRenderer.on('rllama:http:error', onError);

    ipcRenderer.send('rllama:http:start', payload);
  });
}

let terminalCounter = 0;

/**
 * Runs a shell command in the main process and streams its output back.
 * Resolves when the command exits, with its status code.
 */
function exec(command, onChunk) {
  return new Promise((resolve) => {
    const id = `term-${Date.now()}-${terminalCounter++}`;

    const onData = (_event, payload) => {
      if (payload && payload.id === id && typeof onChunk === 'function') {
        try {
          onChunk(payload.chunk, payload.stream);
        } catch {
          // A renderer-side rendering error must not kill the command.
        }
      }
    };
    const onExit = (_event, payload) => {
      if (!payload || payload.id !== id) {
        return;
      }
      cleanup();
      resolve({ code: payload.code, aborted: false, id });
    };
    function cleanup() {
      ipcRenderer.removeListener('rllama:term:data', onData);
      ipcRenderer.removeListener('rllama:term:exit', onExit);
    }

    ipcRenderer.on('rllama:term:data', onData);
    ipcRenderer.on('rllama:term:exit', onExit);
    ipcRenderer.send('rllama:term:run', { id, command });
  });
}

contextBridge.exposeInMainWorld('rllama', {
  isDesktop: true,
  platform: process.platform,
  request,
  abort: (id) => ipcRenderer.send('rllama:http:abort', id),
  exec,
  killTerminal: (id) => ipcRenderer.send('rllama:term:kill', id),
  scanLan: (port) => ipcRenderer.invoke('rllama:lan:scan', { port }),
  startOllama: () => ipcRenderer.invoke('rllama:ollama:start'),
});
