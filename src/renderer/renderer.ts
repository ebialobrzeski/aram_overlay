import type { Analysis, ChampForm, NumericTrait, Plan, Settings, TeamState, UpdatePayload, Weights } from '../shared/types';
import { PROFILES, traitLabel, WEIGHT_LABELS } from '../shared/scoring';
import type { Api } from '../preload';

declare global { interface Window { api: Api } }
const api = window.api;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const BAR_TRAITS: NumericTrait[] = ['cc', 'engage', 'frontline', 'poke', 'dps', 'burst', 'sustain', 'waveclear', 'aoeDmg'];
const WEIGHT_KEYS: (keyof Weights)[] = ['cc', 'aoeCC', 'engage', 'poke', 'frontline', 'sustain', 'burst', 'dps', 'waveclear', 'aoeDmg', 'dmgBalance', 'rangeMix', 'rangedCount', 'hasTank', 'synergy', 'mastery'];

let last: UpdatePayload | null = null;
let frozen = false;
let settingsOpen = false;
const sectionKeys: Record<string, string> = {};

function setSection(id: string, key: string, html: () => string) {
  if (sectionKeys[id] === key) return;
  sectionKeys[id] = key;
  $(`#${id}`).innerHTML = html();
}

function fmtDelta(d: number): string {
  const cls = d > 0.05 ? 'pos' : d < -0.05 ? 'neg' : 'zero';
  return `<span class="delta ${cls}">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>`;
}
function fmtPoints(p: number): string { return p >= 1000 ? `${Math.round(p / 1000)}k` : String(p); }
function fmtForm(f: ChampForm | undefined, prefix = 'ARAM'): string {
  if (!f || !f.games) return '';
  const wr = Math.round(100 * f.wins / f.games);
  const kda = ((f.kills + f.assists) / Math.max(1, f.deaths)).toFixed(1);
  return `<span class="chip form ${wr >= 55 ? 'good' : wr < 45 ? 'bad' : ''}" title="${f.wins}W ${f.games - f.wins}L, KDA ${kda}">${prefix} ${f.games}g ${wr}%</span>`;
}
function img(id: number, icons: Record<number, string>, cls = ''): string {
  const url = id > 0 ? icons[id] : '';
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" />` : `<span class="${cls} noimg"></span>`;
}
function champName(a: Analysis | null, id: number): string { return a?.champions[id]?.name ?? `Champion ${id}`; }
function playerName(state: TeamState, cellId: number): string { return state.players.find(p => p.cellId === cellId)?.name ?? `Player ${cellId}`; }
/** Verb agreement for the local player, whose name is shown as "You". */
function verb(state: TeamState, cellId: number, third: string, second: string): string { return state.players.find(p => p.cellId === cellId)?.isLocal ? second : third; }

function render(p: UpdatePayload) {
  last = p;
  const { state, analysis, settings, icons } = p;
  frozen = p.frozen;
  const status = $('#status');
  status.textContent = p.lcuStatus;
  status.classList.toggle('ok', p.lcuStatus.startsWith('Connected'));

  renderInfo(state, settings, p.demo, analysis);
  renderTeam(state, analysis, icons);
  renderPicks(state, analysis, icons);
  renderForm(state, analysis, icons);
  renderPlans(state, analysis, icons);
  syncSettings(settings);
}

function profileLabel(key: string): string { return key === 'auto' ? 'Auto (suggested)' : key === 'custom' ? 'Custom weights' : PROFILES[key]?.label ?? key; }

function renderInfo(state: TeamState, settings: Settings, demo: boolean, analysis: Analysis | null) {
  const timer = state.timerMs !== undefined ? `${Math.max(0, Math.round(state.timerMs / 1000))}s` : '';
  const key = JSON.stringify([state.phase, timer, state.rerollsRemaining, settings.profile, state.message, demo, state.connected, analysis?.computedAt, frozen]);
  setSection('info', key, () => {
    const keys = ['auto', ...Object.keys(PROFILES), ...(settings.profile === 'custom' ? ['custom'] : [])];
    const profileOpts = keys.map(k => `<option value="${k}" ${k === settings.profile ? 'selected' : ''}>${esc(profileLabel(k))}</option>`).join('');
    const goals = analysis?.goalSuggestions.length ? `<div class="chips goals"><span class="muted">Pool fits:</span>${analysis.goalSuggestions.map((g, i) => `<button class="chip goal ${g.profile === analysis.effectiveProfile ? 'active' : ''}" data-goal="${g.profile}" title="${esc(g.highlights.join(' + '))}; best plan +${g.bestDelta}">${i === 0 ? '★ ' : ''}${esc(g.label)} ${g.fit.toFixed(1)}</button>`).join('')}</div>` : '';
    const using = settings.profile === 'auto' && analysis ? `<div class="note">Auto → using <b>${esc(profileLabel(analysis.effectiveProfile))}</b> (${esc(analysis.goalSuggestions[0]?.highlights.join(' + ') ?? '')})</div>` : '';
    const parts = [
      `<span>Phase <b>${esc(state.phase)}</b></span>`,
      timer ? `<span>Time <b>${timer}</b></span>` : '',
      state.players.length ? `<span>Rerolls <b>${state.rerollsRemaining}</b></span>` : '',
      `<span>Comp goal <select id="profile-quick">${profileOpts}</select></span>`,
    ];
    const msg = state.message ? `<div class="note ${frozen ? 'frozen' : ''}">${esc(state.message)}</div>` : '';
    const idle = !state.players.length && !demo
      ? `<div class="note">${state.connected ? 'Waiting for an ARAM champion select…' : 'Start the League client, or use demo mode from ⚙ to try the overlay.'}</div>` : '';
    return `<div class="info">${parts.join('')}</div>${using}${goals}${msg}${idle}`;
  });
  const sel = document.getElementById('profile-quick') as HTMLSelectElement | null;
  if (sel && !sel.dataset.bound) { sel.dataset.bound = '1'; sel.onchange = () => void api.setSettings({ profile: sel.value }); }
  document.querySelectorAll<HTMLElement>('#info [data-goal]:not([data-bound])').forEach(b => { b.dataset.bound = '1'; b.onclick = () => void api.setSettings({ profile: b.dataset.goal }); });
}

function renderTeam(state: TeamState, analysis: Analysis | null, icons: Record<number, string>) {
  const key = JSON.stringify([state.players.map(p => [p.cellId, p.championId, p.isParty, p.name]), state.bench, analysis?.computedAt, Object.keys(icons).length]);
  setSection('team', key, () => {
    if (!state.players.length) return '<h2>Team</h2><div class="empty">No champion select in progress</div>';
    const members = state.players.map(p => `
      <div class="member ${p.isLocal ? 'local' : p.isParty ? 'party' : ''}" title="${esc(p.name)}">
        ${p.isLocal ? '<span class="badge">YOU</span>' : p.isParty ? '<span class="badge">PARTY</span>' : ''}
        ${img(p.championId, icons)}
        <div class="champ">${esc(champName(analysis, p.championId))}</div>
        <div class="name">${esc(p.name)}</div>
      </div>`).join('');
    const score = analysis ? `<span class="score">${analysis.current.total.toFixed(1)}</span>` : '';
    const bars = analysis ? `<div class="bars">${BAR_TRAITS.map(t => {
      const v = analysis.current.aggregates[t];
      const max = 3 * state.players.length;
      return `<div class="bar"><span>${traitLabel(t)}</span><div class="track"><div class="fill" style="width:${Math.min(100, 100 * v / max)}%"></div></div><span class="val">${v}</span></div>`;
    }).join('')}</div>` : '<div></div>';
    const syn = (analysis?.current.synergies ?? []).map(s => `<span class="chip syn" title="+${s.points}">${esc(s.label)}</span>`).join('');
    const warn = (analysis?.current.warnings ?? []).map(w => `<span class="chip warn">${esc(w)}</span>`).join('');
    const bench = state.bench.length
      ? `<div class="bench"><span class="muted">Bench</span>${state.bench.map(id => `<span title="${esc(champName(analysis, id))}">${img(id, icons)}</span>`).join('')}</div>`
      : '<div class="bench muted">Bench empty</div>';
    return `<h2>Current team ${score}</h2><div class="teamgrid">${members}</div>${bars}<div class="teamfoot">${syn}${warn}${bench}</div>`;
  });
}

function renderPicks(state: TeamState, analysis: Analysis | null, icons: Record<number, string>) {
  const key = JSON.stringify([analysis?.computedAt, Object.keys(icons).length, 'picks', frozen]);
  setSection('picks', key, () => {
    if (!analysis || !state.players.some(p => p.isLocal)) return '<h2>Your best picks</h2><div class="empty">Nothing to rank yet</div>';
    const rows = analysis.myPicks.map(o => {
      const src = o.source === 'current' ? 'current pick'
        : o.source === 'bench' ? 'from bench'
        : o.source === 'trade' ? `trade with ${esc(playerName(state, o.fromCellId!))}`
        : `ask ${esc(playerName(state, o.fromCellId!))} to trade`;
      const action = frozen ? '' : o.source === 'bench' ? `<button class="primary" data-swap="${o.championId}">Swap</button>`
        : o.source === 'trade' || o.source === 'ask' ? `<button data-trade="${o.fromCellId}">Trade</button>` : '';
      const tags = o.tags.slice(0, 4).map(t => `<span class="chip ${t === 'AD' || t === 'AP' || t === 'mixed' ? t : ''}">${esc(t)}</span>`).join('');
      const syn = o.synergies.slice(0, 2).map(s => `<span class="chip syn">${esc(s.label)}</span>`).join('');
      const owned = o.owned === false ? '<span class="chip warn">not owned</span>' : o.owned === undefined ? '<span class="chip">ownership unknown</span>' : '';
      const mastery = o.masteryPoints ? `<span class="chip" title="mastery points">★ ${fmtPoints(o.masteryPoints)}</span>` : '';
      const form = fmtForm(o.form);
      const partner = o.fromCellId !== undefined && o.partnerForm ? fmtForm(o.partnerForm, `${esc(playerName(state, o.fromCellId))} on ${esc(champName(analysis, state.players.find(p => p.isLocal)!.championId))}:`) : '';
      const curated = analysis.champions[o.championId]?.curated === false ? '<span class="chip warn" title="no curated data, traits guessed from role">approx.</span>' : '';
      return `<div class="pick ${o.source === 'current' ? 'current' : ''} ${o.owned === false ? 'unavailable' : ''}">
        ${img(o.championId, icons)}
        <div class="body">
          <div class="title"><b>${esc(champName(analysis, o.championId))}</b><span class="src ${o.source}">${src}</span></div>
          <div class="meta">${tags}${mastery}${form}${partner}${owned}${curated}${syn}</div>
        </div>
        ${fmtDelta(o.delta)}
        ${action}
      </div>`;
    }).join('');
    return `<h2>Your best picks <span class="sub">(others keep their champion)</span></h2>${rows || '<div class="empty">No options</div>'}`;
  });
}

function renderForm(state: TeamState, analysis: Analysis | null, icons: Record<number, string>) {
  const key = JSON.stringify([analysis?.computedAt, Object.keys(icons).length, 'form']);
  setSection('form', key, () => {
    if (!analysis || !state.players.length) return '<h2>Teammates\' best</h2><div class="empty">Nothing to show yet</div>';
    const onTable = new Set<number>([...state.bench, ...state.players.map(p => p.championId)]);
    const rows = analysis.teamForm.map(t => {
      const tops = t.top.map(e => {
        const avail = onTable.has(e.championId) ? 'avail' : '';
        const f = e.form;
        const sub = f && f.games ? `${f.games}g ${Math.round(100 * f.wins / f.games)}%` : e.mastery ? `★${fmtPoints(e.mastery)}` : '';
        return `<span class="formpick ${avail}" title="${esc(champName(analysis, e.championId))}: comfort ${(e.comfort * 100).toFixed(0)}%${f ? `, ${f.wins}W ${f.games - f.wins}L` : ''}${e.mastery ? `, mastery ${fmtPoints(e.mastery)}` : ''}">${img(e.championId, icons)}<span>${sub}</span></span>`;
      }).join('');
      const src = t.hasHistory ? `${t.aramGames} ARAM of last ${t.historyGames}` : t.historyGames ? `only ${t.aramGames} ARAM in last ${t.historyGames}, mastery used` : 'mastery only';
      return `<div class="formrow ${t.isLocal ? 'local' : t.isParty ? 'party' : ''}"><div class="who"><b>${esc(t.name)}</b><span class="note">${src}</span></div><div class="formpicks">${tops || '<span class="muted">no data</span>'}</div></div>`;
    }).join('');
    return `<h2>Teammates\' best <span class="sub">(last 20 games + mastery, green = on the table)</span></h2>${rows}`;
  });
}

function renderPlans(state: TeamState, analysis: Analysis | null, icons: Record<number, string>) {
  const key = JSON.stringify([analysis?.computedAt, Object.keys(icons).length, 'plans']);
  setSection('plans', key, () => {
    const partyCount = state.players.filter(p => p.isParty).length;
    const head = `<h2>Team plans <span class="sub">(you + ${partyCount - 1} in party)</span></h2>`;
    if (!analysis) return `${head}<div class="empty">Nothing to plan yet</div>`;
    if (!analysis.plans.length) return `${head}<div class="empty">Current picks are already the best your party can arrange</div>`;
    const plans = analysis.plans.map((plan, i) => renderPlan(plan, i, state, analysis, icons)).join('');
    return head + plans;
  });
}

function renderPlan(plan: Plan, i: number, state: TeamState, analysis: Analysis, icons: Record<number, string>): string {
  const steps = plan.steps.map(s => {
    const who = esc(playerName(state, s.cellId));
    const champ = esc(champName(analysis, s.championId));
    if (s.kind === 'bench') return `<div class="step">${img(s.championId, icons)}<span><b>${who}</b> ${verb(state, s.cellId, 'takes', 'take')} <b>${champ}</b> from the bench</span></div>`;
    const partner = esc(playerName(state, s.withCellId!));
    const ask = s.needsAsk ? '<span class="ask">(not in party — ask)</span>' : '';
    return `<div class="step">${img(s.championId, icons)}<span><b>${who}</b> ${verb(state, s.cellId, 'trades', 'trade')} with <b>${partner}</b> for <b>${champ}</b> ${ask}</span></div>`;
  }).join('');
  const result = state.players.map((p, idx) => `<span title="${esc(p.name)}: ${esc(champName(analysis, plan.assignment[idx]))}">${img(plan.assignment[idx], icons, plan.assignment[idx] !== p.championId ? 'changed' : '')}</span>`).join('');
  const syn = plan.score.synergies.slice(0, 3).map(s => `<span class="chip syn">${esc(s.label)}</span>`).join('');
  const warn = plan.score.warnings.slice(0, 2).map(w => `<span class="chip warn">${esc(w)}</span>`).join('');
  const own = plan.unverifiedOwnership.length
    ? `<div class="note">Assumes ${plan.unverifiedOwnership.map(c => esc(playerName(state, c))).join(', ')} own${plan.unverifiedOwnership.length === 1 ? 's' : ''} the champion.</div>` : '';
  return `<div class="plan">
    <div class="rank">${i + 1}</div>
    <div class="body">
      <div class="steps">${steps}</div>
      <div class="planfoot"><div class="result">${result}</div>${syn}${warn}</div>${own}
    </div>
    <div><div class="delta pos">+${plan.delta.toFixed(1)}</div><div class="note">${plan.score.total.toFixed(1)}</div></div>
  </div>`;
}

// ---------------- settings panel ----------------
let settingsBuilt = false;
let weightTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWeights: Partial<Weights> = {};

function buildSettings() {
  if (settingsBuilt) return;
  settingsBuilt = true;
  $('#profiles').innerHTML = [`<button class="chip" data-profile="auto" title="Pick the goal the current pool supports best">Auto</button>`, ...Object.entries(PROFILES).map(([k, v]) => `<button class="chip" data-profile="${k}" title="${esc(v.description)}">${esc(v.label)}</button>`)].join('');
  $('#profiles').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-profile]') as HTMLElement | null;
    if (b) void api.setSettings({ profile: b.dataset.profile });
  });
  $('#weights').innerHTML = `<div class="weights">${WEIGHT_KEYS.map(k => `
    <div class="weight"><span>${WEIGHT_LABELS[k]}</span><input type="range" min="0" max="2.5" step="0.1" data-weight="${k}" /><span class="wv" data-wv="${k}"></span></div>`).join('')}</div>`;
  $('#weights').addEventListener('input', e => {
    const input = e.target as HTMLInputElement;
    const k = input.dataset.weight as keyof Weights | undefined;
    if (!k) return;
    pendingWeights[k] = Number(input.value);
    $(`[data-wv="${k}"]`).textContent = input.value;
    if (weightTimer) clearTimeout(weightTimer);
    weightTimer = setTimeout(() => { void api.setSettings({ weights: { ...pendingWeights } as Weights }); }, 250);
  });
  ($('#opt-nonparty') as HTMLInputElement).onchange = e => void api.setSettings({ includeNonPartyTrades: (e.target as HTMLInputElement).checked });
  ($('#opt-assume-owned') as HTMLInputElement).onchange = e => void api.setSettings({ assumePartyOwnsAll: (e.target as HTMLInputElement).checked });
  ($('#opt-comfort') as HTMLTextAreaElement).onchange = e => void api.setSettings({ comfortOverrides: (e.target as HTMLTextAreaElement).value });
  ($('#opt-plans') as HTMLInputElement).onchange = e => void api.setSettings({ topPlans: Math.max(1, Math.min(10, Number((e.target as HTMLInputElement).value) || 5)) });
  ($('#opt-opacity') as HTMLInputElement).oninput = e => void api.setSettings({ opacity: Number((e.target as HTMLInputElement).value) });
  $('#btn-demo').onclick = () => void api.demoToggle();
  $('#btn-shuffle').onclick = () => void api.demoShuffle();
}

function syncSettings(s: Settings) {
  buildSettings();
  document.querySelectorAll<HTMLElement>('[data-profile]').forEach(b => b.classList.toggle('active', b.dataset.profile === s.profile));
  $('#profile-desc').textContent = s.profile === 'auto' ? 'The goal with the best fit for the reachable pool is used; sliders below show the last preset.' : s.profile === 'custom' ? 'Your own weights.' : PROFILES[s.profile]?.description ?? '';
  const active = document.activeElement as HTMLElement | null;
  for (const k of WEIGHT_KEYS) {
    const input = $<HTMLInputElement>(`[data-weight="${k}"]`);
    if (input !== active) { input.value = String(s.weights[k]); $(`[data-wv="${k}"]`).textContent = String(s.weights[k]); }
  }
  ($('#opt-nonparty') as HTMLInputElement).checked = s.includeNonPartyTrades;
  ($('#opt-assume-owned') as HTMLInputElement).checked = s.assumePartyOwnsAll;
  const ta = $('#opt-comfort') as HTMLTextAreaElement; if (ta !== active) ta.value = s.comfortOverrides;
  const pl = $('#opt-plans') as HTMLInputElement; if (pl !== active) pl.value = String(s.topPlans);
  const op = $('#opt-opacity') as HTMLInputElement; if (op !== active) op.value = String(s.opacity);
}

// ---------------- wiring ----------------
$('#btn-settings').onclick = () => { settingsOpen = !settingsOpen; ($('#settings') as HTMLElement).hidden = !settingsOpen; };

// click a card title to fold it; the choice is remembered in this browser profile
const COLLAPSE_KEY = 'collapsedCards';
function loadCollapsed(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]')); } catch { return new Set(); } }
for (const id of loadCollapsed()) document.getElementById(id)?.classList.add('collapsed');
document.addEventListener('click', e => {
  const h = (e.target as HTMLElement).closest('.card > h2') as HTMLElement | null;
  if (!h || (e.target as HTMLElement).closest('button, select, input')) return;
  const card = h.parentElement as HTMLElement;
  if (card.id === 'settings') return;
  card.classList.toggle('collapsed');
  const set = loadCollapsed();
  if (card.classList.contains('collapsed')) set.add(card.id); else set.delete(card.id);
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
});
$('#btn-min').onclick = () => api.minimize();
$('#btn-close').onclick = () => api.closeWindow();

document.addEventListener('click', async e => {
  const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!t) return;
  try {
    if (t.dataset.swap) { t.disabled = true; await api.benchSwap(Number(t.dataset.swap)); }
    else if (t.dataset.trade) { t.disabled = true; t.textContent = 'Sent'; await api.requestTrade(Number(t.dataset.trade)); }
  } catch (err) {
    t.disabled = false; t.textContent = 'Failed';
    console.error('action failed', String(err));
  }
});

api.onUpdate(render);
void api.getSettings().then(syncSettings);
