import { desktopCapturer, nativeImage } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { BadgeAnchors, TeamState } from '../shared/types';
import { deriveAnchors, resizeGray, toGray, type AnchorFit, type Gray, type Match, type Template } from '../shared/match';
import { BENCH_SLOTS, TEAM_ROWS } from '../shared/badges';
import { findLeagueClient, windowRectOf } from './win32';
import type { Lcu } from './lcu';
import { log } from './log';

const WORK_HEIGHT = 400;                 // screenshot is downscaled to this height before matching
const ICON_SIZES = [22, 26, 30, 34, 38, 44, 50]; // candidate icon sizes at the working resolution

export interface AutoCalResult { fit: AnchorFit; ms: number; capture: { width: number; height: number } }

/**
 * Screenshot the League client, find the bench and team champion icons in it and derive the badge anchors.
 * Returns null when the client could not be captured. Icon templates come from the client itself.
 */
export async function autoCalibrate(lcu: Lcu, state: TeamState, prev: BadgeAnchors, iconCache: Map<number, Gray>): Promise<AutoCalResult | null> {
  const client = findLeagueClient();
  if (!client || client.minimized) { log.debug('auto-calibration: client not visible'); return null; }
  const winRect = windowRectOf(client.hwnd);
  if (!winRect) return null;

  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: winRect.width, height: winRect.height }, fetchWindowIcons: false });
  const src = sources.find(s => s.name === 'League of Legends');
  if (!src || src.thumbnail.isEmpty()) { log.debug('auto-calibration: no capture source for the client'); return null; }
  const thumb = src.thumbnail;
  const size = thumb.getSize();
  const full = toGray(new Uint8Array(thumb.toBitmap()), size.width, size.height, 'bgra');

  // the capture covers the window rect; badges are fractions of the client rect: map through pixel offsets
  const capScale = size.width / winRect.width;
  const clientInCap = { x: (client.rect.x - winRect.x) * capScale, y: (client.rect.y - winRect.y) * capScale, width: client.rect.width * capScale, height: client.rect.height * capScale };

  const f = WORK_HEIGHT / size.height;
  const img = resizeGray(full, Math.round(size.width * f), WORK_HEIGHT);

  // templates: every bench and team champion, at several sizes
  const benchKeys = new Map<string, number>(); const teamKeys = new Map<string, number>();
  state.bench.forEach((id, i) => benchKeys.set(`c${id}`, i));
  [...state.players].sort((a, b) => a.cellId - b.cellId).forEach((p, i) => { if (p.championId > 0) teamKeys.set(`c${p.championId}`, i); });
  const ids = new Set<number>([...state.bench, ...state.players.map(p => p.championId).filter(id => id > 0)]);
  const templates: Template[] = [];
  for (const id of ids) {
    const icon = await iconGray(lcu, id, iconCache);
    if (!icon) continue;
    for (const s of ICON_SIZES) templates.push({ key: `c${id}`, size: s, data: resizeGray(icon, s, s).data });
  }
  if (!templates.length) return null;

  const regions = {
    bench: { x: 0, y: Math.round(img.height * 0.62), width: img.width, height: img.height - Math.round(img.height * 0.62) },
    team: { x: 0, y: Math.round(img.height * 0.08), width: Math.round(img.width * 0.42), height: Math.round(img.height * 0.84) },
  };

  const started = Date.now();
  const matches = await runWorker({ img, templates, regions, benchKeys: [...benchKeys.keys()], teamKeys: [...teamKeys.keys()] });

  // matches are in working pixels of the capture; convert to client-rect fractions
  const toClient = (m: Match): Match => ({ ...m, x: (m.x / f - clientInCap.x) / clientInCap.width * img.width, y: (m.y / f - clientInCap.y) / clientInCap.height * img.height });
  const fit = deriveAnchors({ width: img.width, height: img.height }, matches.map(toClient), benchKeys, teamKeys, BENCH_SLOTS, TEAM_ROWS, prev);
  const ms = Date.now() - started;
  log.info(`auto-calibration: bench ${fit.benchMatches} icons (score ${fit.benchScore.toFixed(2)}), team ${fit.teamMatches} icons (score ${fit.teamScore.toFixed(2)}) in ${ms}ms${fit.notes.length ? '; ' + fit.notes.join('; ') : ''}`);
  log.debug('auto-calibration matches', JSON.stringify(matches.map(m => ({ k: m.key, x: Math.round(m.x), y: Math.round(m.y), s: m.size, score: Math.round(m.score * 100) / 100 }))));
  return { fit, ms, capture: size };
}

async function iconGray(lcu: Lcu, id: number, cache: Map<number, Gray>): Promise<Gray | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const { body } = await lcu.getBuffer(`/lol-game-data/assets/v1/champion-icons/${id}.png`);
    const img = nativeImage.createFromBuffer(body);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const g = toGray(new Uint8Array(img.toBitmap()), size.width, size.height, 'bgra');
    cache.set(id, g);
    return g;
  } catch (e) { log.debug(`icon ${id} unavailable`, e); return null; }
}

function runWorker(job: { img: Gray; templates: Template[]; regions: unknown; benchKeys: string[]; teamKeys: string[] }): Promise<Match[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'match_worker.js'), { workerData: job });
    w.once('message', (m: { matches: Match[] }) => { resolve(m.matches); void w.terminate(); });
    w.once('error', reject);
    w.once('exit', code => { if (code !== 0) reject(new Error(`matcher exited with ${code}`)); });
  });
}
