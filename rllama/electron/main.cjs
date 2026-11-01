'use strict';

/**
 * Rllama desktop shell (Electron).
 *
 * The renderer is the same bundle as the web and Android builds. The main
 * process exists for two reasons:
 *   1. HTTP requests run here, in Node, so provider CORS rules do not apply.
 *   2. Keys can later be stored with Electron safeStorage instead of
 *      localStorage.
 */

const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');

/** requestId -> AbortController for in-flight requests. */
const inFlight = new Map();

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0b0b0d',
    title: 'Rllama',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Links open in the real browser, never inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return window;
}

function registerHttpBridge() {
  ipcMain.on('rllama:http:start', async (event, payload) => {
    const { id, url, method, headers, body } = payload || {};
    const controller = new AbortController();
    inFlight.set(id, controller);

    try {
      const response = await fetch(url, {
        method: method || 'GET',
        headers: headers || {},
        body: body === undefined ? undefined : body,
        signal: controller.signal,
      });

      const responseHeaders = [];
      response.headers.forEach((value, key) => {
        responseHeaders.push([key, value]);
      });

      if (event.sender.isDestroyed()) {
        return;
      }
      event.sender.send('rllama:http:meta', {
        id,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (event.sender.isDestroyed()) {
            controller.abort();
            return;
          }
          event.sender.send('rllama:http:chunk', { id, text: decoder.decode(value, { stream: true }) });
        }
        const tail = decoder.decode();
        if (tail) {
          event.sender.send('rllama:http:chunk', { id, text: tail });
        }
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send('rllama:http:end', { id });
      }
    } catch (error) {
      const message =
        controller.signal.aborted
          ? 'Aborted'
          : (error && error.cause && error.cause.message) || (error && error.message) || String(error);
      if (!event.sender.isDestroyed()) {
        event.sender.send('rllama:http:error', { id, message, aborted: controller.signal.aborted });
      }
    } finally {
      inFlight.delete(id);
    }
  });

  ipcMain.on('rllama:http:abort', (_event, id) => {
    const controller = inFlight.get(id);
    if (controller) {
      controller.abort();
      inFlight.delete(id);
    }
  });
}

app.whenReady().then(() => {
  registerHttpBridge();
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
