/**
 * Device bridges.
 *
 * The renderer is the same code on desktop, Android and the browser, so every
 * platform-specific capability is behind one small interface with a graceful
 * "not available here" answer. Nothing in the UI has to guess which shell it is
 * running in.
 *
 *  - Electron: the methods are exposed by the preload script (`window.rllama`).
 *  - Android: a tiny Capacitor plugin (`RllamaNative`) talks to the OS.
 *  - Web: nothing is available; the callers show an explanation instead.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { desktopBridge } from './transport';

export interface LanScan {
  hosts: string[];
  /** Addresses of this device, so the UI can say where it looked. */
  interfaces: string[];
  /** Present when the scan could not run at all. */
  message?: string;
}

export interface TermuxStatus {
  installed: boolean;
  /** True when Termux accepted external commands (allow-external-apps). */
  canRun: boolean;
  message?: string;
}

export interface TermuxResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  message?: string;
}

export interface DeviceFile {
  path: string;
  name: string;
  size: number;
}

export interface GgufScan {
  files: DeviceFile[];
  scanned: string[];
  /** Directories that exist but cannot be read (Android scoped storage). */
  denied: string[];
}

interface RllamaNativePlugin {
  scanLan(options: { port: number }): Promise<LanScan>;
  termuxStatus(): Promise<TermuxStatus>;
  termuxRun(options: {
    command: string;
    background?: boolean;
    timeoutMs?: number;
  }): Promise<TermuxResult>;
  openTermux(options: { command?: string }): Promise<void>;
  listGguf(options: { dirs: string[] }): Promise<GgufScan>;
}

const RllamaNative = registerPlugin<RllamaNativePlugin>('RllamaNative');

export function platform(): 'desktop' | 'android' | 'ios' | 'web' {
  if (desktopBridge()?.isDesktop) {
    return 'desktop';
  }
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.()) {
    const name = Capacitor.getPlatform();
    if (name === 'android' || name === 'ios') {
      return name;
    }
  }
  return 'web';
}

export function isAndroid(): boolean {
  return platform() === 'android';
}

/** Directories that usually hold GGUFs on an Android phone, PocketPal included. */
export const GGUF_DIRECTORIES = [
  '/storage/emulated/0/Download',
  '/storage/emulated/0/Downloads',
  '/storage/emulated/0/Models',
  '/storage/emulated/0/models',
  '/storage/emulated/0/PocketPal',
  '/storage/emulated/0/Android/data/com.pocketpal.ai/files/models',
  '/storage/emulated/0/Android/media/com.pocketpal.ai',
];

/**
 * Scans the local network for a daemon.
 *
 * A browser cannot enumerate LAN hosts, so this only does something where a
 * native layer exists: Electron scans subnets in the main process, Android does
 * it in the plugin. On the web it says so instead of hanging.
 */
export async function scanLan(port = 11434): Promise<LanScan> {
  const shell = desktopBridge();
  if (shell?.scanLan) {
    try {
      const result = await shell.scanLan(port);
      return { hosts: result.hosts ?? [], interfaces: result.interfaces ?? [] };
    } catch (error) {
      return {
        hosts: [],
        interfaces: [],
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (isAndroid()) {
    try {
      return await RllamaNative.scanLan({ port });
    } catch (error) {
      return {
        hosts: [],
        interfaces: [],
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    hosts: [],
    interfaces: [],
    message: 'A browser cannot scan the local network — run the desktop build, or type the address.',
  };
}

export async function termuxStatus(): Promise<TermuxStatus> {
  if (!isAndroid()) {
    return { installed: false, canRun: false, message: 'Termux integration is Android-only.' };
  }
  try {
    return await RllamaNative.termuxStatus();
  } catch (error) {
    return {
      installed: false,
      canRun: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function termuxRun(
  command: string,
  options: { background?: boolean; timeoutMs?: number } = {},
): Promise<TermuxResult> {
  if (!isAndroid()) {
    return { ok: false, message: 'Termux integration is Android-only.' };
  }
  try {
    return await RllamaNative.termuxRun({ command, ...options });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function openTermux(command?: string): Promise<void> {
  if (!isAndroid()) {
    return;
  }
  try {
    await RllamaNative.openTermux({ command });
  } catch {
    // Nothing to do: the UI already explains that Termux is missing.
  }
}

/** Lists `.gguf` files in the usual shared directories (Android only). */
export async function listGguf(dirs: string[] = GGUF_DIRECTORIES): Promise<GgufScan> {
  if (!isAndroid()) {
    return { files: [], scanned: [], denied: [] };
  }
  try {
    return await RllamaNative.listGguf({ dirs });
  } catch (error) {
    return {
      files: [],
      scanned: [],
      denied: [],
      ...{ message: error instanceof Error ? error.message : String(error) },
    };
  }
}
