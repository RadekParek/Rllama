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

/* ----------------------------------------------------------------- terminal */

/** id -> child process, so a running command can be stopped from the UI. */
const terminalProcesses = new Map();
const daemonProcesses = [];

function shellInvocation(command) {
  if (process.platform === 'win32') {
    return { file: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }
  return { file: process.env.SHELL || '/bin/sh', args: ['-lc', command] };
}

function registerTerminalBridge() {
  ipcMain.on('rllama:term:run', (event, payload) => {
    const { id, command } = payload || {};
    const send = (channel, body) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(channel, body);
      }
    };

    if (typeof command !== 'string' || !command.trim()) {
      send('rllama:term:exit', { id, code: 1 });
      return;
    }

    const { file, args } = shellInvocation(command);
    let child;
    try {
      child = spawn(file, args, { cwd: os.homedir(), env: process.env, windowsHide: true });
    } catch (error) {
      send('rllama:term:data', { id, chunk: `${error.message}\n`, stream: 'err' });
      send('rllama:term:exit', { id, code: 1 });
      return;
    }

    terminalProcesses.set(id, child);
    child.stdout.on('data', (buffer) => send('rllama:term:data', { id, chunk: buffer.toString(), stream: 'out' }));
    child.stderr.on('data', (buffer) => send('rllama:term:data', { id, chunk: buffer.toString(), stream: 'err' }));
    child.on('error', (error) => {
      send('rllama:term:data', { id, chunk: `${error && error.message ? error.message : error}\n`, stream: 'err' });
    });
    child.on('close', (code) => {
      terminalProcesses.delete(id);
      send('rllama:term:exit', { id, code: typeof code === 'number' ? code : 1 });
    });
  });

  ipcMain.on('rllama:term:kill', (_event, id) => {
    const child = terminalProcesses.get(id);
    if (child) {
      child.kill('SIGTERM');
      terminalProcesses.delete(id);
    }
  });
}

/* -------------------------------------------------------------- LAN scanning */

/** Every non-internal IPv4 address with its /24 base, e.g. 192.168.1.0. */
function localSubnets() {
  const interfaces = [];
  const subnets = new Set();
  const networks = os.networkInterfaces();
  for (const addresses of Object.values(networks)) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) {
        continue;
      }
      interfaces.push(`${address.address}/${address.netmask}`);
      const [a, b, c] = address.address.split('.').map(Number);
      subnets.add(`${a}.${b}.${c}`);
    }
  }
  return { interfaces, subnets: [...subnets] };
}

function canConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function scanLan(port) {
  const { interfaces, subnets } = localSubnets();
  const targets = [];
  for (const base of subnets) {
    // 254 hosts per subnet, capped so a machine with many interfaces stays quick.
    for (let host = 1; host <= 254 && targets.length < 1024; host += 1) {
      targets.push(`${base}.${host}`);
    }
  }

  const hosts = [];
  const queue = [...targets];
  const workers = Array.from({ length: Math.min(64, queue.length || 1) }, async () => {
    for (;;) {
      const host = queue.shift();
      if (!host) {
        return;
      }
      if (await canConnect(host, port, 350)) {
        hosts.push(host);
      }
    }
  });
  await Promise.all(workers);
  return { hosts, interfaces };
}

/* ---------------------------------------------------------- starting Ollama */

/** Starts `ollama serve` detached, so the daemon outlives the window. */
function startOllama() {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        started: false,
        message:
          error && error.code === 'ENOENT'
            ? 'Ollama is not installed on this computer. Install it from ollama.com, then try again.'
            : `Could not start Ollama: ${error.message}`,
      });
    });

    child.once('spawn', () => {
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      daemonProcesses.push(child);
      resolve({ started: true, message: 'Started `ollama serve` in the background.' });
    });
  });
}

app.whenReady().then(() => {
  registerHttpBridge();
  registerTerminalBridge();
  ipcMain.handle('rllama:lan:scan', async (_event, payload) => scanLan(payload && payload.port ? payload.port : 11434));
  ipcMain.handle('rllama:ollama:start', async () => startOllama());
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
