import { app, BrowserWindow, ipcMain, protocol, screen } from 'electron';
import path from 'node:path';
import type { Settings, TeamState, UpdatePayload, Analysis } from '../shared/types';
import { analyze } from '../shared/analysis';
import { ChampionRegistry, normalize } from './champions';
import { DemoState } from './demo';
import { discover, Lcu } from './lcu';
import { StateBuilder } from './state';
import { Store } from './store';
import { BadgeWindow } from './badges';
import { autoCalibrate } from './autocal';
import type { Gray } from '../shared/match';
import type { BadgeAnchors } from '../shared/types';
import { log, safeJson } from './log';
import { writeFileSync } from 'node:fs';

protocol.registerSchemesAsPrivileged([{ scheme: 'lcu', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }]);

let win: BrowserWindow | null = null;
let badges: BadgeWindow | null = null;
let store: Store;
let registry: ChampionRegistry;
let lcu: Lcu | null = null;
let builder: StateBuilder | null = null;
let demo = process.argv.includes('--demo');
const debug = process.argv.includes('--aram-debug') || process.env.ARAM_DEBUG === '1';
const demoState = new DemoState();
let lcuStatus = 'Looking for the League client…';
let lastDiscover = 0;
let registryLoadedFrom: 'none' | 'offline' | 'lcu' = 'none';
let settingsVersion = 0;
let lastKey = '';
let lastAnalysis: Analysis | null = null;
let ticking = false;
/** final champion select of the running game, kept on screen until the next lobby */
let frozenState: TeamState | null = null;
let frozenAnalysis: Analysis | null = null;
let frozenPhaseLogged = '';
let lastState: TeamState = { phase: 'None', isAram: false, players: [], bench: [], rerollsRemaining: 0, connected: false, source: 'lcu' };
let lastFrozenFlag = false;
const iconGrayCache = new Map<number, Gray>();
let autoCalKey = '';      // champion select for which auto-calibration already ran
let autoCalRunning = false;
let autoCalAttempts = 0;
let autoCalBenchSeen = 0;  // bench size at the last successful run (more icons = better fit, so re-run)
let autoCalLastAt = 0;

/** Screenshot-based calibration: once per champion select, as soon as a few icons are on the table. */
async function maybeAutoCalibrate(state: TeamState, force = false): Promise<string> {
  if (autoCalRunning) return 'already running';
  if (!lcu || demo) return 'needs the League client';
  if (state.phase !== 'ChampSelect' || !state.players.length) return 'no champion select';
  const picked = state.players.filter(p => p.championId > 0).length;
  if (state.bench.length + picked < 3) return 'not enough champions on screen yet';
  const key = state.players.map(p => `${p.cellId}:${p.puuid ?? ''}`).join(',');
  const done = key === autoCalKey && state.bench.length <= autoCalBenchSeen;
  if (!force && (!store.settings.badges.auto || done || autoCalAttempts >= 4 || badges?.calibrating || Date.now() - autoCalLastAt < 4000)) return 'skipped';
  autoCalLastAt = Date.now();
  autoCalRunning = true;
  try {
    const res = await autoCalibrate(lcu, state, iconGrayCache, debug);
    if (!res) { autoCalAttempts++; return 'client could not be captured'; }
    const { fit } = res;
    const okBench = !!fit.bench && fit.bench.matches >= 2 && fit.bench.score >= 0.5;
    const okTeam = !!fit.team && fit.team.matches >= 2 && fit.team.score >= 0.5;
    if (!okBench && !okTeam) { autoCalAttempts++; return `icons not found (${fit.notes.join('; ')})`; }
    const next = { ...store.settings.badges, calibratedBy: 'auto' as const };
    if (okBench && fit.bench) { next.benchFirst = fit.bench.first; next.benchLast = fit.bench.last; next.benchRef = fit.bench.count; next.benchAlign = fit.bench.align; }
    if (okTeam && fit.team) { next.teamFirst = fit.team.first; next.teamLast = fit.team.last; }
    store.updateSettings({ badges: next });
    settingsVersion++;
    autoCalKey = key; autoCalAttempts = 0;
    if (okBench) autoCalBenchSeen = state.bench.length; else autoCalBenchSeen = Math.max(autoCalBenchSeen, 0);
    const msg = `auto-calibrated: bench ${okBench && fit.bench ? `${fit.bench.matches} icons (${fit.bench.align})` : 'kept'}, team ${okTeam && fit.team ? `${fit.team.matches} icons` : 'kept'} (${res.ms}ms)`;
    log.info(msg);
    return msg;
  } catch (e) {
    log.warn('auto-calibration failed', e);
    return `failed: ${(e as Error).message}`;
  } finally { autoCalRunning = false; }
}
const IN_GAME_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame']);

const DISCONNECTED: TeamState = { phase: 'None', isAram: false, players: [], bench: [], rerollsRemaining: 0, connected: false, source: 'lcu' };

function createWindow() {
  const b = store.data.bounds;
  const display = b ? screen.getDisplayMatching(b) : screen.getPrimaryDisplay();
  const inside = b && b.x >= display.bounds.x - 50 && b.y >= display.bounds.y - 50 && b.x < display.bounds.x + display.bounds.width && b.y < display.bounds.y + display.bounds.height;
  win = new BrowserWindow({
    width: b?.width ?? 560, height: b?.height ?? Math.min(980, display.workAreaSize.height - 40),
    x: inside ? b!.x : undefined, y: inside ? b!.y : undefined,
    frame: false, alwaysOnTop: true, backgroundColor: '#0f1319', resizable: true, minWidth: 420, minHeight: 420,
    title: 'ARAM Comp Overlay',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setOpacity(store.settings.opacity);
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) log.warn('[renderer]', message); else log.debug('[renderer]', message); });
  let saveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => win && store.setBounds(win.getBounds()), 400); };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  win.on('closed', () => { win = null; });
  badges?.registerOwnWindow(win);
}

function comfortOverrides(state: TeamState): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const line of store.settings.comfortOverrides.split(/\r?\n/)) {
    const [who, list] = line.split(':');
    if (!who || !list) continue;
    const player = state.players.find(p => normalize(p.name) === normalize(who));
    if (!player) continue;
    const set = new Set<number>();
    for (const part of list.split(',')) { const c = registry.find(part.trim()); if (c) set.add(c.id); }
    map.set(player.cellId, set);
  }
  return map;
}

async function connectLcu(): Promise<void> {
  if (lcu || Date.now() - lastDiscover < 4000) return;
  lastDiscover = Date.now();
  const creds = await discover();
  if (!creds) { if (lcuStatus !== 'League client not running') log.info('League client not found (no LeagueClientUx.exe process, no lockfile)'); lcuStatus = 'League client not running'; return; }
  log.info(`League client found on port ${creds.port}`);
  lcu = new Lcu(creds);
  builder = new StateBuilder(lcu);
  lcuStatus = `Connected (${creds.port})`;
  try { await registry.load(lcu); registryLoadedFrom = 'lcu'; log.info(`Champion list loaded from ${registry.source}: ${registry.all().length} champions`); } catch (e) { log.warn('Champion list load failed', e); }
}

async function currentState(): Promise<TeamState> {
  if (demo) return demoState.get();
  await connectLcu();
  if (!builder) return DISCONNECTED;
  try {
    return await builder.build();
  } catch (e) {
    lcu = null; builder = null; lastDiscover = 0;
    lcuStatus = `Lost connection: ${(e as Error).message}`;
    log.warn('Lost connection to the client', e);
    return DISCONNECTED;
  }
}

async function tick() {
  if (ticking || !win) return;
  ticking = true;
  try {
    if (registryLoadedFrom === 'none') { await registry.load(null); registryLoadedFrom = 'offline'; }
    const liveState = await currentState();
    if (!lcu) registry.loadDdragonVersion().catch(() => undefined);

    // keep the last champion select visible while the game runs; drop it once we are back in a lobby / queue
    let frozen = false;
    let state = liveState;
    if (liveState.phase === 'ChampSelect' && liveState.players.length) {
      frozenState = null; frozenAnalysis = null;
    } else if (IN_GAME_PHASES.has(liveState.phase) && frozenState) {
      if (!frozen && liveState.phase !== frozenPhaseLogged) { frozenPhaseLogged = liveState.phase; log.info(`phase=${liveState.phase}: keeping the final champion select on screen`); }
      frozen = true;
      state = { ...frozenState, phase: liveState.phase, timerMs: undefined, message: 'Game in progress: showing the final champion select' };
    } else if (!IN_GAME_PHASES.has(liveState.phase)) {
      frozenState = null; frozenAnalysis = null;
    }

    const key = JSON.stringify([
      settingsVersion, state.source, state.phase,
      state.players.map(p => [p.cellId, p.championId, p.isParty, Object.keys(p.mastery).length, p.owned?.length ?? -1]),
      state.bench,
    ]);
    if (frozen) {
      lastAnalysis = frozenAnalysis;
    } else if (key !== lastKey) {
      lastKey = key;
      const t0 = Date.now();
      lastAnalysis = state.players.length
        ? analyze({ state, lookup: id => registry.get(id), settings: store.settings, comfort: comfortOverrides(state) })
        : null;
      logStateChange(state, Date.now() - t0);
    }
    if (!frozen && state.phase === 'ChampSelect' && state.players.length) { frozenState = state; frozenAnalysis = lastAnalysis; }
    lastState = state; lastFrozenFlag = frozen;
    if (state.phase !== 'ChampSelect') { autoCalKey = ''; autoCalAttempts = 0; autoCalBenchSeen = 0; }
    else if (!frozen) void maybeAutoCalibrate(state);

    const icons: Record<number, string> = {};
    const ids = new Set<number>([...state.players.map(p => p.championId), ...state.bench, ...(lastAnalysis?.plans.flatMap(p => p.assignment) ?? []), ...(lastAnalysis?.teamForm.flatMap(t => t.top.map(e => e.championId)) ?? [])]);
    for (const id of ids) icons[id] = registry.iconUrl(id, !!lcu && !demo);

    const payload: UpdatePayload = { state, analysis: lastAnalysis, settings: store.settings, icons, lcuStatus: (demo ? 'Demo mode' : lcuStatus) + (debug ? ' [debug]' : ''), demo, frozen, calibrating: badges?.calibrating ?? false };
    win.webContents.send('update', payload);
    try { badges?.update(state, lastAnalysis, store.settings.badges, frozen); } catch (e) { log.warn('badge window update failed', e); }
  } catch (e) {
    log.error('tick failed', e);
  } finally {
    ticking = false;
  }
}

function logStateChange(state: TeamState, analysisMs: number) {
  const name = (id: number) => registry.get(id)?.name ?? `#${id}`;
  log.info(`state: phase=${state.phase} aram=${state.isAram} source=${state.source} rerolls=${state.rerollsRemaining}${state.message ? ` msg="${state.message}"` : ''}`);
  for (const p of state.players) {
    log.info(`  ${p.isLocal ? 'YOU  ' : p.isParty ? 'PARTY' : 'other'} cell=${p.cellId} ${p.name}: ${name(p.championId)} mastery=${Object.keys(p.mastery).length} owned=${p.owned ? p.owned.length : 'unknown'} history=${p.historyGames ?? 'n/a'} aram=${p.aramGames ?? 'n/a'}`);
  }
  log.info(`  bench: ${state.bench.map(name).join(', ') || '(empty)'}`);
  if (lastAnalysis) {
    const a = lastAnalysis;
    log.info(`analysis (${analysisMs}ms): profile=${a.effectiveProfile}${store.settings.profile === 'auto' ? ' (auto)' : ''} score=${a.current.total} warnings=[${a.current.warnings.join('; ')}] combos=[${a.current.synergies.map(s => s.label).join('; ')}]`);
    log.info(`  goal fit: ${a.goalSuggestions.map(g => `${g.label} ${g.fit} [${g.highlights.join('+')}]`).join(', ')}`);
    log.info(`  top picks: ${a.myPicks.slice(0, 5).map(p => `${name(p.championId)} ${p.delta >= 0 ? '+' : ''}${p.delta} (${p.source})`).join(', ')}`);
    for (const t of a.teamForm) log.info(`  form ${t.name}: ${t.top.slice(0, 4).map(e => `${name(e.championId)} ${(e.comfort * 100).toFixed(0)}%${e.form ? ` (${e.form.wins}/${e.form.games})` : ''}`).join(', ') || '-'}`);
    log.info(`  plans: ${a.plans.length}${a.plans[0] ? `, best +${a.plans[0].delta}: ${a.plans[0].steps.map(s => `${s.cellId}->${name(s.championId)}`).join(', ')}` : ''}`);
  }
  if (debug && state.players.length) { // only champion select is worth keeping; later phases would overwrite it
    const file = path.join(app.getPath('userData'), 'debug-lcu-snapshot.json');
    try { writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), state, analysis: lastAnalysis, raw: builder?.raw ?? null }, null, 2)); } catch (e) { log.warn('snapshot write failed', e); }
  }
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  registry = new ChampionRegistry(app.getPath('userData'));
  log.init(app.getPath('userData'), debug);
  log.info(`ARAM overlay starting: electron=${process.versions.electron} node=${process.versions.node} demo=${demo} debug=${debug} userData=${app.getPath('userData')}`);
  log.debug('settings', safeJson(store.settings));

  protocol.handle('lcu', async req => {
    const m = /champion-icon\/(\d+)/.exec(req.url);
    if (!m || !lcu) return new Response('', { status: 404 });
    try {
      const { body, type } = await lcu.getBuffer(`/lol-game-data/assets/v1/champion-icons/${m[1]}.png`);
      return new Response(new Uint8Array(body), { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' } });
    } catch { return new Response('', { status: 404 }); }
  });

  ipcMain.handle('settings:get', () => store.settings);
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    log.debug('settings:set', safeJson(patch));
    const s = store.updateSettings(patch);
    settingsVersion++;
    if (patch.opacity !== undefined && win) win.setOpacity(s.opacity);
    void tick();
    return s;
  });
  ipcMain.handle('action:benchSwap', async (_e, championId: number) => {
    log.info(`action: bench swap to ${registry.get(championId)?.name ?? championId}`);
    try {
      if (demo) demoState.benchSwap(championId); else if (builder) await builder.benchSwap(championId); else throw new Error('Not connected');
    } catch (e) { log.error('bench swap failed', e); throw e; }
    lastKey = ''; void tick();
  });
  ipcMain.handle('action:trade', async (_e, cellId: number) => {
    log.info(`action: trade request with cell ${cellId}`);
    try {
      if (demo) demoState.trade(cellId); else if (builder) await builder.requestTrade(cellId); else throw new Error('Not connected');
    } catch (e) { log.error('trade request failed', e); throw e; }
    lastKey = ''; void tick();
  });
  ipcMain.handle('demo:toggle', () => { demo = !demo; lastKey = ''; void tick(); return demo; });
  ipcMain.handle('demo:shuffle', () => { demoState.shuffle(); lastKey = ''; void tick(); });
  ipcMain.handle('badges:calibrate:start', () => { badges?.startCalibration(); void tick(); });
  ipcMain.handle('badges:calibrate:save', (_e, anchors: BadgeAnchors) => {
    // the markers were placed on the bench as it is right now: remember how many champions that was
    const count = Math.max(2, Math.min(10, lastState.bench.length || 10));
    const centerX = (anchors.benchFirst.x + anchors.benchLast.x) / 2;
    store.updateSettings({ badges: { ...store.settings.badges, ...anchors, calibratedBy: 'manual', benchRef: count, benchAlign: Math.abs(centerX - 0.5) < 0.06 ? 'center' : 'left' } });
    log.info('badge anchors saved', safeJson(anchors));
    badges?.endCalibration(); settingsVersion++; void tick();
  });
  ipcMain.handle('badges:calibrate:cancel', () => { badges?.endCalibration(); void tick(); });
  ipcMain.handle('badges:auto', async () => { const r = await maybeAutoCalibrate(lastState, true); void tick(); return r; });
  ipcMain.on('window:close', () => app.quit());
  ipcMain.on('window:minimize', () => win?.minimize());

  badges = new BadgeWindow(path.join(__dirname, 'preload.js'), path.join(__dirname, 'renderer', 'badges.html'));
  createWindow();
  // the badge window follows the client window: cheap Win32 calls, so poll faster than the client API
  setInterval(() => { try { badges?.update(frozenState && !lastFrozenFlag ? frozenState : lastState, lastAnalysis, store.settings.badges, lastFrozenFlag); } catch { /* ignore */ } }, 250);
  setInterval(() => void tick(), 1000);
  void tick();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => badges?.destroy());
