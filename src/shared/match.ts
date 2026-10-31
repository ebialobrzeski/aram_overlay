/**
 * Pure image matching used for auto-calibration of the client badges: find champion icons (known templates)
 * in a grayscale screenshot of the League client, then turn the found positions into bench / team anchors.
 * No Node or Electron dependencies so it can run in a worker thread and in unit tests.
 */
import type { Anchor, BadgeAnchors } from './types';

export interface Gray { width: number; height: number; data: Float32Array }
export interface Template { key: string; size: number; data: Float32Array } // square, size*size
export interface Region { x: number; y: number; width: number; height: number }
export interface Match { key: string; x: number; y: number; size: number; score: number } // center, pixels

/** BGRA (or RGBA) bytes -> grayscale float image. */
export function toGray(bytes: Uint8Array, width: number, height: number, order: 'bgra' | 'rgba' = 'bgra'): Gray {
  const data = new Float32Array(width * height);
  const [ri, gi, bi] = order === 'bgra' ? [2, 1, 0] : [0, 1, 2];
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = 0.299 * bytes[p + ri] + 0.587 * bytes[p + gi] + 0.114 * bytes[p + bi];
  return { width, height, data };
}

/** Area-averaging resize (good enough for downscaling icons and screenshots). */
export function resizeGray(src: Gray, width: number, height: number): Gray {
  const out = new Float32Array(width * height);
  const sx = src.width / width, sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < src.height; yy++) for (let xx = x0; xx < x1 && xx < src.width; xx++) { s += src.data[yy * src.width + xx]; n++; }
      out[y * width + x] = n ? s / n : 0;
    }
  }
  return { width, height, data: out };
}

export function crop(src: Gray, r: Region): Gray {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const w = Math.min(src.width - x0, Math.floor(r.width)), h = Math.min(src.height - y0, Math.floor(r.height));
  const data = new Float32Array(Math.max(0, w) * Math.max(0, h));
  for (let y = 0; y < h; y++) data.set(src.data.subarray((y0 + y) * src.width + x0, (y0 + y) * src.width + x0 + w), y * w);
  return { width: Math.max(0, w), height: Math.max(0, h), data };
}

interface MaskedTemplate { key: string; size: number; idx: Int32Array; dx: Int32Array; dy: Int32Array; vals: Float32Array; mean: number; std: number }

/** Keep only the inscribed circle of the icon (the client shows icons in round frames), normalised. */
function prepare(t: Template): MaskedTemplate | null {
  const c = (t.size - 1) / 2, r = t.size * 0.42;
  const dx: number[] = [], dy: number[] = [], vals: number[] = [];
  for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
    if ((x - c) ** 2 + (y - c) ** 2 > r * r) continue;
    dx.push(x); dy.push(y); vals.push(t.data[y * t.size + x]);
  }
  const n = vals.length;
  if (n < 16) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (std < 1e-3) return null;
  return { key: t.key, size: t.size, idx: new Int32Array(n), dx: Int32Array.from(dx), dy: Int32Array.from(dy), vals: Float32Array.from(vals.map(v => (v - mean) / std)), mean, std };
}

/** Normalised cross-correlation of one masked template at (x, y) top-left. */
function ncc(img: Gray, t: MaskedTemplate, x: number, y: number): number {
  const n = t.vals.length;
  let sum = 0, sq = 0;
  for (let i = 0; i < n; i++) { const v = img.data[(y + t.dy[i]) * img.width + x + t.dx[i]]; sum += v; sq += v * v; }
  const mean = sum / n;
  const variance = sq / n - mean * mean;
  if (variance < 1e-3) return 0;
  const inv = 1 / Math.sqrt(variance);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += ((img.data[(y + t.dy[i]) * img.width + x + t.dx[i]] - mean) * inv) * t.vals[i];
  return dot / n;
}

/**
 * Best position of every template inside `region` of `img` (coarse stride, then refined). Templates may be
 * provided at several sizes with the same key; the best size wins.
 */
export function matchTemplates(img: Gray, templates: Template[], region: Region): Match[] {
  const sub = crop(img, region);
  const best = new Map<string, Match>();
  for (const raw of templates) {
    const t = prepare(raw);
    if (!t || sub.width < t.size || sub.height < t.size) continue;
    const stride = Math.max(1, Math.round(t.size / 6));
    // coarse grid: keep the best few candidates, then refine each one at full resolution
    const coarse: { x: number; y: number; s: number }[] = [];
    for (let y = 0; y + t.size <= sub.height; y += stride) for (let x = 0; x + t.size <= sub.width; x += stride) {
      const s = ncc(sub, t, x, y);
      if (coarse.length < 5 || s > coarse[coarse.length - 1].s) {
        coarse.push({ x, y, s }); coarse.sort((p, q) => q.s - p.s); if (coarse.length > 5) coarse.pop();
      }
    }
    let bx = 0, by = 0, bs = -1;
    for (const c of coarse)
      for (let y = Math.max(0, c.y - stride); y <= Math.min(sub.height - t.size, c.y + stride); y++)
        for (let x = Math.max(0, c.x - stride); x <= Math.min(sub.width - t.size, c.x + stride); x++) {
          const s = ncc(sub, t, x, y);
          if (s > bs) { bs = s; bx = x; by = y; }
        }
    const m: Match = { key: t.key, x: region.x + bx + t.size / 2, y: region.y + by + t.size / 2, size: t.size, score: bs };
    const prev = best.get(t.key);
    if (!prev || m.score > prev.score) best.set(t.key, m);
  }
  return [...best.values()];
}

export interface AnchorFit { anchors: BadgeAnchors; benchMatches: number; teamMatches: number; benchScore: number; teamScore: number; notes: string[] }

function fitLine(points: { i: number; v: number }[]): { a: number; b: number } {
  const n = points.length;
  if (n === 1) return { a: points[0].v, b: 0 };
  const mi = points.reduce((s, p) => s + p.i, 0) / n, mv = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.i - mi) * (p.v - mv); den += (p.i - mi) ** 2; }
  const b = den ? num / den : 0;
  return { a: mv - b * mi, b };
}

/**
 * Turn icon matches into anchors (fractions of the image). `bench` gives the slot index of each bench key,
 * `team` the row index of each team key. Matches below `minScore` are ignored.
 */
export function deriveAnchors(
  img: { width: number; height: number }, matches: Match[],
  bench: Map<string, number>, team: Map<string, number>, slots: number, rows: number,
  prev: BadgeAnchors, minScore = 0.5,
): AnchorFit {
  const notes: string[] = [];
  const good = matches.filter(m => m.score >= minScore);
  const fx = (v: number): number => v / img.width, fy = (v: number): number => v / img.height;
  const anchors: BadgeAnchors = JSON.parse(JSON.stringify(prev));

  // bench: x grows with the slot index; if the order does not match, fall back to left-to-right rank
  let b = good.filter(m => bench.has(m.key));
  let benchScore = 0;
  if (b.length >= 2) {
    const ys = b.map(m => m.y).sort((p, q) => p - q);
    const medianY = ys[Math.floor(ys.length / 2)];
    b = b.filter(m => Math.abs(m.y - medianY) < img.height * 0.03);
  }
  if (b.length >= 2) {
    const byIndex = b.map(m => ({ i: bench.get(m.key)!, v: m.x }));
    const byRank = [...b].sort((p, q) => p.x - q.x).map((m, i) => ({ i, v: m.x }));
    const resid = (pts: { i: number; v: number }[]) => { const f = fitLine(pts); return pts.reduce((s, p) => s + Math.abs(f.a + f.b * p.i - p.v), 0) / pts.length; };
    const pts = resid(byIndex) <= resid(byRank) * 1.5 ? byIndex : (notes.push('bench order differs from the list; used left-to-right rank'), byRank);
    const fxl = fitLine(pts), fyl = fitLine(b.map(m => ({ i: bench.get(m.key)!, v: m.y })));
    if (fxl.b > img.width * 0.02) {
      anchors.benchFirst = { x: fx(fxl.a), y: fy(fyl.a) };
      anchors.benchLast = { x: fx(fxl.a + fxl.b * (slots - 1)), y: fy(fyl.a + fyl.b * (slots - 1)) };
      benchScore = b.reduce((s, m) => s + m.score, 0) / b.length;
    } else notes.push('bench matches too close together; ignored');
  } else notes.push(`only ${b.length} bench icon(s) found`);

  // team rows: y grows with the row index (cell order)
  const t = good.filter(m => team.has(m.key));
  let teamScore = 0;
  if (t.length >= 2) {
    const fyl = fitLine(t.map(m => ({ i: team.get(m.key)!, v: m.y })));
    const fxl = fitLine(t.map(m => ({ i: team.get(m.key)!, v: m.x })));
    if (fyl.b > img.height * 0.03) {
      anchors.teamFirst = { x: fx(fxl.a), y: fy(fyl.a) };
      anchors.teamLast = { x: fx(fxl.a + fxl.b * (rows - 1)), y: fy(fyl.a + fyl.b * (rows - 1)) };
      teamScore = t.reduce((s, m) => s + m.score, 0) / t.length;
    } else notes.push('team matches not stacked vertically; ignored');
  } else notes.push(`only ${t.length} team icon(s) found`);

  const clamp = (a: Anchor): Anchor => ({ x: Math.min(1, Math.max(0, a.x)), y: Math.min(1, Math.max(0, a.y)) });
  anchors.benchFirst = clamp(anchors.benchFirst); anchors.benchLast = clamp(anchors.benchLast);
  anchors.teamFirst = clamp(anchors.teamFirst); anchors.teamLast = clamp(anchors.teamLast);
  return { anchors, benchMatches: benchScore ? b.length : 0, teamMatches: teamScore ? t.length : 0, benchScore, teamScore, notes };
}
