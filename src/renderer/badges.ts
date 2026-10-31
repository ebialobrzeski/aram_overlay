import type { BadgeAnchors, BadgeModel } from '../shared/types';
import type { Api } from '../preload';

declare global { interface Window { api: Api } }
const api = window.api;

const layer = document.getElementById('layer') as HTMLElement;
const calib = document.getElementById('calib') as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

let model: BadgeModel | null = null;
let anchors: BadgeAnchors | null = null; // live copy while calibrating
let dragging: { key: keyof BadgeAnchors; el: HTMLElement } | null = null;

function px(frac: { x: number; y: number }) { return { left: `${frac.x * 100}%`, top: `${frac.y * 100}%` }; }

function renderBadges(m: BadgeModel) {
  layer.style.setProperty('--scale', String(m.scale));
  layer.innerHTML = m.badges.map(b => {
    const p = px(b);
    return `<div class="badge ${b.kind}" style="left:${p.left};top:${p.top}" title="${esc(b.title ?? '')}">${esc(b.text)}</div>`;
  }).join('');
}

const MARKERS: { key: keyof BadgeAnchors; label: string }[] = [
  { key: 'benchFirst', label: 'Bench 1' }, { key: 'benchLast', label: 'Bench last' },
  { key: 'teamFirst', label: 'Row 1' }, { key: 'teamLast', label: 'Row 5' },
];

function renderCalibration(m: BadgeModel) {
  if (!anchors) anchors = JSON.parse(JSON.stringify(m.anchors));
  const a = anchors!;
  const ghosts: string[] = [];
  for (let i = 1; i < m.benchCount - 1; i++) {
    const t = i / (m.benchCount - 1);
    const p = px({ x: a.benchFirst.x + (a.benchLast.x - a.benchFirst.x) * t, y: a.benchFirst.y + (a.benchLast.y - a.benchFirst.y) * t });
    ghosts.push(`<div class="ghost" style="left:${p.left};top:${p.top}"></div>`);
  }
  for (let i = 1; i < m.rows - 1; i++) {
    const t = i / (m.rows - 1);
    const p = px({ x: a.teamFirst.x + (a.teamLast.x - a.teamFirst.x) * t, y: a.teamFirst.y + (a.teamLast.y - a.teamFirst.y) * t });
    ghosts.push(`<div class="ghost" style="left:${p.left};top:${p.top}"></div>`);
  }
  const markers = MARKERS.map(mk => {
    const p = px(a[mk.key]);
    const label = mk.key === 'benchLast' ? `Bench ${m.benchCount}` : mk.label;
    return `<div class="marker" data-key="${mk.key}" style="left:${p.left};top:${p.top}"><span class="lbl">${label}</span></div>`;
  }).join('');
  layer.innerHTML = ghosts.join('') + markers;
}

layer.addEventListener('pointerdown', e => {
  const el = (e.target as HTMLElement).closest('.marker') as HTMLElement | null;
  if (!el || !anchors) return;
  dragging = { key: el.dataset.key as keyof BadgeAnchors, el };
  el.setPointerCapture(e.pointerId);
  e.preventDefault();
});
layer.addEventListener('pointermove', e => {
  if (!dragging || !anchors || !model) return;
  anchors[dragging.key] = { x: Math.min(1, Math.max(0, e.clientX / window.innerWidth)), y: Math.min(1, Math.max(0, e.clientY / window.innerHeight)) };
  renderCalibration(model);
});
layer.addEventListener('pointerup', () => { dragging = null; });

(document.getElementById('save') as HTMLButtonElement).onclick = () => { if (anchors) void api.calibrationSave(anchors); anchors = null; };
(document.getElementById('cancel') as HTMLButtonElement).onclick = () => { void api.calibrationCancel(); anchors = null; };

api.onBadges((m: BadgeModel) => {
  model = m;
  calib.hidden = !m.calibrating;
  if (m.calibrating) renderCalibration(m);
  else { anchors = null; renderBadges(m); }
});
