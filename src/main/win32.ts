/**
 * Minimal Win32 access through koffi (prebuilt FFI, no compiler needed): find the League client window and
 * read where its client area is on screen, so the badge window can sit exactly on top of it.
 */
import { log } from './log';

export interface ScreenRect { x: number; y: number; width: number; height: number }
export interface ClientWindow { hwnd: bigint; rect: ScreenRect; minimized: boolean; visible: boolean; foreground: bigint }

interface Api {
  FindWindowW: (cls: string | null, title: string | null) => unknown;
  GetClientRect: (hwnd: unknown, rect: { left: number; top: number; right: number; bottom: number }) => boolean;
  ClientToScreen: (hwnd: unknown, pt: { x: number; y: number }) => boolean;
  IsIconic: (hwnd: unknown) => boolean;
  IsWindowVisible: (hwnd: unknown) => boolean;
  GetForegroundWindow: () => unknown;
  GetWindowRect: (hwnd: unknown, rect: { left: number; top: number; right: number; bottom: number }) => boolean;
  address: (ptr: unknown) => bigint | number;
}

let api: Api | null | undefined;

function load(): Api | null {
  if (api !== undefined) return api;
  if (process.platform !== 'win32') { api = null; return api; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    koffi.struct('RECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' });
    koffi.struct('POINT', { x: 'int', y: 'int' });
    api = {
      FindWindowW: user32.func('void* __stdcall FindWindowW(str16 cls, str16 title)'),
      GetClientRect: user32.func('bool __stdcall GetClientRect(void* hwnd, _Out_ RECT* rect)'),
      ClientToScreen: user32.func('bool __stdcall ClientToScreen(void* hwnd, _Inout_ POINT* pt)'),
      IsIconic: user32.func('bool __stdcall IsIconic(void* hwnd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void* hwnd)'),
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void* hwnd, _Out_ RECT* rect)'),
      address: (p: unknown) => koffi.address(p),
    };
    log.info('win32 window tracking ready (koffi)');
  } catch (e) {
    log.warn('win32 window tracking unavailable', e);
    api = null;
  }
  return api;
}

export function available(): boolean { return load() !== null; }

/** Position of the League client's client area, in physical screen pixels. */
export function findLeagueClient(): ClientWindow | null {
  const a = load();
  if (!a) return null;
  const hwndPtr = a.FindWindowW('RCLIENT', 'League of Legends');
  const hwnd = BigInt(a.address(hwndPtr));
  if (hwnd === 0n) return null;
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!a.GetClientRect(hwndPtr, rect)) return null;
  const pt = { x: 0, y: 0 };
  if (!a.ClientToScreen(hwndPtr, pt)) return null;
  return {
    hwnd,
    rect: { x: pt.x, y: pt.y, width: rect.right - rect.left, height: rect.bottom - rect.top },
    minimized: a.IsIconic(hwndPtr),
    visible: a.IsWindowVisible(hwndPtr),
    foreground: BigInt(a.address(a.GetForegroundWindow())),
  };
}

/** Outer window rect (physical pixels) of the client window found earlier. */
export function windowRectOf(hwnd: bigint): ScreenRect | null {
  const a = load();
  if (!a) return null;
  const ptr = a.FindWindowW('RCLIENT', 'League of Legends');
  if (BigInt(a.address(ptr)) !== hwnd) return null;
  const r = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!a.GetWindowRect(ptr, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** HWND of an Electron window (getNativeWindowHandle returns the handle as a little-endian buffer). */
export function hwndOf(handle: Buffer): bigint {
  return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
}
