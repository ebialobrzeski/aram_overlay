import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { Analysis, BadgeModel, BadgeSettings, TeamState } from '../shared/types';
import { buildBadges, BENCH_SLOTS, TEAM_ROWS } from '../shared/badges';
import { findLeagueClient, hwndOf, available as win32Available } from './win32';
import { log } from './log';


/**
 * Transparent, click-through window laid over the League client's client area. It shows one badge per bench
 * champion (my delta) and per team row (what the best plan asks of that player). Positions are fractions of the
 * client area, interpolated between two anchors per row; a calibration mode lets the user drag the anchors.
 */
export class BadgeWindow {
  private win: BrowserWindow | null = null;
  private ownHwnds = new Set<bigint>();
  private lastBounds = '';
  private shown = false;
  calibrating = false;

  constructor(private preload: string, private html: string) {}

  registerOwnWindow(w: BrowserWindow) { try { this.ownHwnds.add(hwndOf(w.getNativeWindowHandle())); } catch { /* ignore */ } }

  private ensure(): BrowserWindow {
    if (this.win) return this.win;
    this.win = new BrowserWindow({
      show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false,
      resizable: false, movable: false, hasShadow: false, title: 'ARAM Comp Overlay badges',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.setMenuBarVisibility(false);
    this.win.loadFile(this.html);
    this.win.on('closed', () => { this.win = null; });
    this.registerOwnWindow(this.win);
    return this.win;
  }

  /** Call once per tick. */
  update(state: TeamState, analysis: Analysis | null, settings: BadgeSettings, frozen: boolean) {
    if (!win32Available()) return;
    const client = findLeagueClient();
    const wantVisible = !!client && client.visible && !client.minimized && (settings.enabled || this.calibrating)
      && (this.calibrating || (state.phase === 'ChampSelect' && !frozen && state.players.length > 0))
      && (client.foreground === client.hwnd || this.ownHwnds.has(client.foreground) || this.calibrating);

    if (!wantVisible) { this.hide(); return; }

    const w = this.ensure();
    const dip = screen.screenToDipRect(null, client!.rect);
    const key = JSON.stringify(dip);
    if (key !== this.lastBounds) { this.lastBounds = key; w.setBounds({ x: Math.round(dip.x), y: Math.round(dip.y), width: Math.round(dip.width), height: Math.round(dip.height) }); }
    if (!this.shown) { w.showInactive(); this.shown = true; }

    const model: BadgeModel = {
      badges: this.calibrating ? [] : buildBadges(state, analysis, settings),
      calibrating: this.calibrating,
      anchors: { benchFirst: settings.benchFirst, benchLast: settings.benchLast, teamFirst: settings.teamFirst, teamLast: settings.teamLast },
      slots: BENCH_SLOTS, rows: TEAM_ROWS, scale: settings.scale,
    };
    w.webContents.send('badges', model);
  }

  startCalibration() {
    this.calibrating = true;
    const w = this.ensure();
    w.setIgnoreMouseEvents(false);
    w.setFocusable(true);
    log.info('badge calibration started');
  }

  endCalibration() {
    this.calibrating = false;
    if (this.win) { this.win.setIgnoreMouseEvents(true, { forward: true }); this.win.setFocusable(false); }
    log.info('badge calibration ended');
  }

  private hide() {
    if (this.win && this.shown) { this.win.hide(); this.shown = false; this.lastBounds = ''; }
  }

  destroy() { this.win?.destroy(); this.win = null; }
}

export const BADGES_HTML = path.join('renderer', 'badges.html');
