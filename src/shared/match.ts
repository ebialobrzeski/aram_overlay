/**
 * Pure image matching used for auto-calibration of the client badges: find champion icons (known templates)
 * in a grayscale screenshot of the League client, then turn the found positions into bench / team anchors.
 * No Node or Electron dependencies so it can run in a worker thread and in unit tests.
 */
import type { Anchor } from './types';

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

interface MaskedTemplate { key: string; size: number; dx: Int32Array; dy: Int32Array; vals: Float32Array }

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
  return { key: t.key, size: t.size, dx: Int32Array.from(dx), dy: Int32Array.from(dy), vals: Float32Array.from(vals.map(v => (v - mean) / std)) };
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
 * Up to `k` well-separated candidate positions for every template key inside `region` (all sizes of a key
 * compete together). Coarse grid first, then full-resolution refinement of the best coarse spots.
 */
export function matchCandidates(img: Gray, templates: Template[], region: Region, k = 3): Match[] {
  const sub = crop(img, region);
  const perKey = new Map<string, Match[]>();
  for (const raw of templates) {
    const t = prepare(raw);
    if (!t || sub.width < t.size || sub.height < t.size) continue;
    const stride = Math.max(1, Math.round(t.size / 5));
    const coarse: { x: number; y: number; s: number }[] = [];
    for (let y = 0; y + t.size <= sub.height; y += stride) for (let x = 0; x + t.size <= sub.width; x += stride) {
      const s = ncc(sub, t, x, y);
      if (coarse.length < 8 || s > coarse[coarse.length - 1].s) {
        coarse.push({ x, y, s }); coarse.sort((p, q) => q.s - p.s); if (coarse.length > 8) coarse.pop();
      }
    }
    const refined: Match[] = [];
    for (const c of coarse) {
      let bx = c.x, by = c.y, bs = c.s;
      for (let y = Math.max(0, c.y - stride); y <= Math.min(sub.height - t.size, c.y + stride); y++)
        for (let x = Math.max(0, c.x - stride); x <= Math.min(sub.width - t.size, c.x + stride); x++) {
          const s = ncc(sub, t, x, y);
          if (s > bs) { bs = s; bx = x; by = y; }
        }
      refined.push({ key: t.key, x: region.x + bx + t.size / 2, y: region.y + by + t.size / 2, size: t.size, score: bs });
    }
    const list = perKey.get(t.key) ?? [];
    list.push(...refined);
    perKey.set(t.key, list);
  }
  // non-maximum suppression per key: keep the best, drop anything closer than half an icon
  const out: Match[] = [];
  for (const list of perKey.values()) {
    list.sort((a, b) => b.score - a.score);
    const kept: Match[] = [];
    for (const m of list) {
      if (kept.length >= k) break;
      if (kept.every(o => Math.hypot(o.x - m.x, o.y - m.y) > Math.max(o.size, m.size) * 0.6)) kept.push(m);
    }
    out.push(...kept);
  }
  return out;
}

/** Best single position per key (convenience for tests and simple uses). */
export function matchTemplates(img: Gray, templates: Template[], region: Region): Match[] {
  return matchCandidates(img, templates, region, 1);
}

export interface LineFit { a: number; b: number; resid: number }

function fitLine(points: { i: number; v: number }[]): LineFit {
  const n = points.length;
  if (n === 1) return { a: points[0].v, b: 0, resid: 0 };
  const mi = points.reduce((s, p) => s + p.i, 0) / n, mv = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.i - mi) * (p.v - mv); den += (p.i - mi) ** 2; }
  const b = den ? num / den : 0;
  const a = mv - b * mi;
  const resid = points.reduce((s, p) => s + Math.abs(a + b * p.i - p.v), 0) / n;
  return { a, b, resid };
}

/** Largest group of matches (distinct keys) whose `coord` values agree within `tol`. */
function bestCluster(ms: Match[], coord: (m: Match) => number, tol: number): Match[] {
  let best: Match[] = [];
  const scoreOf = (g: Match[]) => g.length + g.reduce((s, m) => s + m.score, 0) / 10;
  for (const seed of ms) {
    const byKey = new Map<string, Match>();
    for (const m of ms) {
      if (Math.abs(coord(m) - coord(seed)) > tol) continue;
      const p = byKey.get(m.key);
      if (!p || m.score > p.score) byKey.set(m.key, m);
    }
    const group = [...byKey.values()];
    if (scoreOf(group) > scoreOf(best)) best = group;
  }
  return best;
}

export interface BenchFit { first: Anchor; last: Anchor; count: number; align: 'center' | 'left'; matches: number; score: number }
export interface TeamFit { first: Anchor; last: Anchor; matches: number; score: number }
export interface AnchorFit { bench: BenchFit | null; team: TeamFit | null; notes: string[] }

/**
 * Turn icon candidates into anchors (fractions of the image). The bench is a horizontal evenly spaced row
 * (left-aligned or centred, decided from where the row sits); the team is a vertical column in cell order.
 * `bench` maps key -> slot index among the `benchCount` champions currently on the bench, `team` maps
 * key -> row index. Matches below `minScore` are ignored.
 */
export function deriveAnchors(
  img: { width: number; height: number }, candidates: Match[],
  bench: Map<string, number>, benchCount: number, team: Map<string, number>, rows: number, minScore = 0.45,
): AnchorFit {
  const notes: string[] = [];
  const good = candidates.filter(m => m.score >= minScore);
  const fx = (v: number): number => v / img.width, fy = (v: number): number => v / img.height;
  const clamp = (a: Anchor): Anchor => ({ x: Math.min(1, Math.max(0, a.x)), y: Math.min(1, Math.max(0, a.y)) });
  let benchFit: BenchFit | null = null, teamFit: TeamFit | null = null;

  // ---- bench: the row of icons on one horizontal line
  const b = bestCluster(good.filter(m => bench.has(m.key)), m => m.y, img.height * 0.025);
  if (b.length >= 2) {
    const byIndex = b.map(m => ({ i: bench.get(m.key)!, v: m.x }));
    const byRank = [...b].sort((p, q) => p.x - q.x).map((m, i) => ({ i, v: m.x }));
    let fit = fitLine(byIndex);
    const rank = fitLine(byRank);
    if (rank.resid < fit.resid * 0.7) { fit = rank; notes.push('bench order differs from the list; used left-to-right rank'); }
    const smallest = Math.min(...b.map(m => m.size));
    const spacing = fit.b;
    if (spacing > smallest * 0.8 && fit.resid < spacing * 0.2) {
      const fyl = fitLine(b.map(m => ({ i: bench.get(m.key)!, v: m.y })));
      const first = clamp({ x: fx(fit.a), y: fy(fyl.a) });
      const last = clamp({ x: fx(fit.a + spacing * (benchCount - 1)), y: fy(fyl.a + fyl.b * (benchCount - 1)) });
      const centerX = (first.x + last.x) / 2;
      const align: 'center' | 'left' = Math.abs(centerX - 0.5) < 0.06 ? 'center' : 'left';
      benchFit = { first, last, count: benchCount, align, matches: b.length, score: b.reduce((s, m) => s + m.score, 0) / b.length };
    } else notes.push(`bench row inconsistent (spacing ${spacing.toFixed(1)}px, residual ${fit.resid.toFixed(1)}px)`);
  } else notes.push(`only ${b.length} bench icon(s) on a common line`);

  // ---- team: a vertical column in cell order
  const t = bestCluster(good.filter(m => team.has(m.key)), m => m.x, img.width * 0.03);
  if (t.length >= 2) {
    const fyl = fitLine(t.map(m => ({ i: team.get(m.key)!, v: m.y })));
    const fxl = fitLine(t.map(m => ({ i: team.get(m.key)!, v: m.x })));
    if (fyl.b > img.height * 0.03 && fyl.resid < fyl.b * 0.2) {
      teamFit = {
        first: clamp({ x: fx(fxl.a), y: fy(fyl.a) }), last: clamp({ x: fx(fxl.a + fxl.b * (rows - 1)), y: fy(fyl.a + fyl.b * (rows - 1)) }),
        matches: t.length, score: t.reduce((s, m) => s + m.score, 0) / t.length,
      };
    } else notes.push('team column inconsistent');
  } else notes.push(`only ${t.length} team icon(s) in a common column`);

  return { bench: benchFit, team: teamFit, notes };
}
