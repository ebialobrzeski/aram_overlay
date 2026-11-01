/**
 * Minimal Win32 access through koffi (prebuilt FFI, no compiler needed): find the League client window and
 * read where its client area is on screen, so the badge window can sit exactly on top of it.
 */
import { log } from './log';

export interface ScreenRect { x: number; y: number; width: number; height: number }
export interface ClientWindow { hwnd: bigint; rect: ScreenRect; minimized: boolean; visible: boolean; foreground: bigint }

interface Rect { left: number; top: number; right: number; bottom: number }
interface Api {
  FindWindowExW: (parent: unknown, after: unknown, cls: string | null, title: string | null) => unknown;
  GetClientRect: (hwnd: unknown, rect: Rect) => boolean;
  ClientToScreen: (hwnd: unknown, pt: { x: number; y: number }) => boolean;
  IsIconic: (hwnd: unknown) => boolean;
  IsWindowVisible: (hwnd: unknown) => boolean;
  GetForegroundWindow: () => unknown;
  GetWindowRect: (hwnd: unknown, rect: Rect) => boolean;
  address: (ptr: unknown) => bigint | number;
}

const CLIENT_CLASS = 'RCLIENT';
const CLIENT_TITLE = 'League of Legends';

let api: Api | null | undefined;
let lastChosen = 0n;

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
      FindWindowExW: user32.func('void* __stdcall FindWindowExW(void* parent, void* after, str16 cls, str16 title)'),
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

interface Candidate { ptr: unknown; hwnd: bigint; visible: boolean; minimized: boolean; area: number }

/**
 * Every top-level "League of Legends" window of class RCLIENT. The client process owns several: the real one
 * plus a pile of hidden 136x39 helper windows with the same class and title, and FindWindowW happily returns
 * whichever is first in Z-order. So enumerate them all and let the caller pick.
 */
function enumerateClientWindows(a: Api): Candidate[] {
  const out: Candidate[] = [];
  let after: unknown = null;
  for (let i = 0; i < 64; i++) {
    const ptr = a.FindWindowExW(null, after, CLIENT_CLASS, CLIENT_TITLE);
    const hwnd = BigInt(a.address(ptr));
    if (hwnd === 0n) break;
    after = ptr;
    const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    const area = a.GetClientRect(ptr, r) ? Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top) : 0;
    out.push({ ptr, hwnd, visible: a.IsWindowVisible(ptr), minimized: a.IsIconic(ptr), area });
  }
  return out;
}

/** The real client window: the visible one with the largest client area; a minimized one counts, hidden stubs do not. */
function pickClientWindow(a: Api): Candidate | null {
  const all = enumerateClientWindows(a);
  const real = all.filter(c => c.visible && (c.area >= 200 * 200 || c.minimized)).sort((x, y) => y.area - x.area);
  const chosen = real[0] ?? null;
  const hwnd = chosen?.hwnd ?? 0n;
  if (hwnd !== lastChosen) {
    lastChosen = hwnd;
    log.debug('league client window', chosen ? `${hwnd} (${all.length} candidates, area ${chosen.area}, minimized ${chosen.minimized})` : `none (${all.length} candidates, none visible)`);
  }
  return chosen;
}

/** Position of the League client's client area, in physical screen pixels. */
export function findLeagueClient(): ClientWindow | null {
  const a = load();
  if (!a) return null;
  const c = pickClientWindow(a);
  if (!c) return null;
  const rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!a.GetClientRect(c.ptr, rect)) return null;
  const pt = { x: 0, y: 0 };
  if (!a.ClientToScreen(c.ptr, pt)) return null;
  return {
    hwnd: c.hwnd,
    rect: { x: pt.x, y: pt.y, width: rect.right - rect.left, height: rect.bottom - rect.top },
    minimized: c.minimized,
    visible: c.visible,
    foreground: BigInt(a.address(a.GetForegroundWindow())),
  };
}

/** Outer window rect (physical pixels) of the client window found earlier. */
export function windowRectOf(hwnd: bigint): ScreenRect | null {
  const a = load();
  if (!a) return null;
  const c = enumerateClientWindows(a).find(w => w.hwnd === hwnd);
  if (!c) return null;
  const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!a.GetWindowRect(c.ptr, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** HWND of an Electron window (getNativeWindowHandle returns the handle as a little-endian buffer). */
export function hwndOf(handle: Buffer): bigint {
  return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
}
