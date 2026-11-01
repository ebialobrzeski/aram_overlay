import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURATED_BY_ALIAS } from '../src/shared/champion_data';
import { findSynergies } from '../src/shared/synergies';
import { PROFILES, scoreTeam, DEFAULT_SETTINGS } from '../src/shared/scoring';
import { analyze, planSteps } from '../src/shared/analysis';
import type { Player, TeamState, Settings } from '../src/shared/types';

const C = (alias: string) => { const c = CURATED_BY_ALIAS.get(alias.toLowerCase()); if (!c) throw new Error(`unknown ${alias}`); return c; };
const lookup = (id: number) => [...CURATED_BY_ALIAS.values()].find(c => c.id === id);
const W = PROFILES.balanced.weights;

const player = (cellId: number, alias: string, extra: Partial<Player> = {}): Player => ({
  cellId, name: `P${cellId}`, championId: C(alias).id, isLocal: cellId === 0, isParty: cellId <= 1, mastery: {}, ...extra,
});
const state = (team: string[], bench: string[], patch: Partial<TeamState> = {}): TeamState => ({
  phase: 'ChampSelect', isAram: true, players: team.map((a, i) => player(i, a)), bench: bench.map(a => C(a).id),
  rerollsRemaining: 1, connected: true, source: 'demo', ...patch,
});
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, weights: W, ...patch });

import { buildBadges } from '../src/shared/badges';

test('generic knock-up rule rewards any airborne provider with Yasuo, not just Malphite', () => {
  for (const provider of ['Malphite', 'Alistar', 'Gragas', 'Ornn', 'Rell', 'JarvanIV', 'Janna']) {
    const hits = findSynergies([C(provider), C('Yasuo')]);
    assert.ok(hits.some(h => h.label.includes('Yasuo R')), `${provider} should set up Yasuo R`);
  }
  assert.equal(findSynergies([C('Lux'), C('Yasuo')]).length, 0);
});

test('lockdown + channelled ult and enchanter + hypercarry are detected generically', () => {
  const kat = findSynergies([C('Amumu'), C('Katarina')]);
  assert.ok(kat.some(h => h.label.includes('Katarina R')));
  const sej = findSynergies([C('Sejuani'), C('MissFortune')]);
  assert.ok(sej.some(h => h.label.includes('Miss Fortune R')));
  const prot = findSynergies([C('Milio'), C('Jinx')]);
  assert.ok(prot.some(h => h.label.includes('protects Jinx')));
  const wombo = findSynergies([C('Kennen'), C('Orianna'), C('Brand')]);
  assert.ok(wombo.some(h => h.label.includes('AoE CC')));
});

test('scoreTeam warns about full AD / no frontline and rewards a tank', () => {
  const allAd = scoreTeam(['Draven', 'Lucian', 'Zed', 'Talon', 'Caitlyn'].map(C), W);
  assert.ok(allAd.warnings.includes('Full AD'));
  assert.ok(allAd.warnings.some(w => w.toLowerCase().includes('frontline') || w.toLowerCase().includes('tank')));
  const withTank = scoreTeam(['Draven', 'Lucian', 'Zed', 'Talon', 'Malphite'].map(C), W);
  assert.ok(withTank.total > allAd.total);
});

test('my picks: Malphite from bench beats staying on a squishy pick when the party has Yasuo', () => {
  const s = state(['Lucian', 'Yasuo', 'Lux', 'Jinx', 'Zed'], ['Malphite', 'Teemo']);
  s.players[0].owned = s.bench.slice();
  const a = analyze({ state: s, lookup, settings: settings() });
  assert.equal(a.myPicks[0].championId, C('Malphite').id);
  assert.equal(a.myPicks[0].source, 'bench');
  assert.ok(a.myPicks[0].synergies.some(h => h.label.includes('Yasuo R')));
  assert.ok(a.myPicks[0].delta > 0);
});

test('non-owned bench champions are excluded for the local player', () => {
  const s = state(['Lucian', 'Yasuo', 'Lux', 'Jinx', 'Zed'], ['Malphite', 'Teemo']);
  s.players[0].owned = [C('Teemo').id];
  const a = analyze({ state: s, lookup, settings: settings() });
  assert.ok(!a.myPicks.some(p => p.championId === C('Malphite').id));
});

test('plans only move party members unless non-party trades are enabled', () => {
  const s = state(['Lucian', 'Yasuo', 'Lux', 'Jinx', 'Zed'], ['Malphite', 'Leona']);
  s.players[0].owned = s.bench.slice();
  const a = analyze({ state: s, lookup, settings: settings() });
  for (const plan of a.plans) {
    plan.assignment.forEach((c, i) => { if (!s.players[i].isParty) assert.equal(c, s.players[i].championId); });
  }
  const b = analyze({ state: s, lookup, settings: settings({ includeNonPartyTrades: true }) });
  assert.ok(b.plans.length >= a.plans.length);
  const askStep = b.plans.flatMap(p => p.steps).find(st => st.needsAsk);
  if (askStep) assert.equal(askStep.kind, 'trade');
});

test('planSteps resolves a 3-cycle of party trades and bench chains', () => {
  const players = ['A', 'B', 'C'].map((n, i) => ({ cellId: i, name: n, championId: i + 1, isLocal: i === 0, isParty: true, mastery: {} }));
  const steps = planSteps(players, [1, 2, 3], [2, 3, 1], [9]);
  assert.ok(steps.length <= 3 && steps.every(s => s.kind === 'trade'));
  const chain = planSteps(players, [1, 2, 3], [9, 1, 3], [9]);
  assert.deepEqual(chain.map(s => s.kind), ['bench', 'bench']);
  assert.equal(chain[1].championId, 1);
});

test('comfort picks raise the score of a mastered champion', () => {
  const s = state(['Lucian', 'Yasuo', 'Lux', 'Jinx', 'Zed'], ['Ahri', 'Syndra']);
  s.players[0].owned = s.bench.slice();
  const plain = analyze({ state: s, lookup, settings: settings() });
  s.players[0].mastery = { [C('Syndra').id]: 150_000 };
  const comfy = analyze({ state: s, lookup, settings: settings() });
  const score = (a: typeof plain, alias: string) => a.myPicks.find(p => p.championId === C(alias).id)!.score;
  assert.ok(score(comfy, 'Syndra') > score(plain, 'Syndra'));
});

test('goal suggestion follows the reachable pool', () => {
  const pokePool = state(['Xerath', 'Ziggs', 'Lux', 'Jayce', 'Garen'], ['Velkoz', 'Karma', 'Corki']);
  pokePool.players[0].owned = pokePool.bench.slice();
  const a = analyze({ state: pokePool, lookup, settings: settings({ profile: 'auto' }) });
  assert.equal(a.goalSuggestions[0].profile, 'poke', JSON.stringify(a.goalSuggestions));
  assert.equal(a.effectiveProfile, 'poke');

  const womboPool = state(['Amumu', 'MissFortune', 'Kennen', 'Lucian', 'Garen'], ['Orianna', 'Brand', 'Malphite']);
  womboPool.players[0].owned = womboPool.bench.slice();
  const b = analyze({ state: womboPool, lookup, settings: settings({ profile: 'auto' }) });
  assert.ok(['wombo', 'cc'].includes(b.goalSuggestions[0].profile), JSON.stringify(b.goalSuggestions));
  assert.ok(b.goalSuggestions.every(g => g.highlights.length === 2));
});

test('explicit profile is respected and suggestions are still reported', () => {
  const s = state(['Xerath', 'Ziggs', 'Lux', 'Jayce', 'Garen'], ['Velkoz', 'Karma']);
  const a = analyze({ state: s, lookup, settings: settings({ profile: 'frontline', weights: PROFILES.frontline.weights }) });
  assert.equal(a.effectiveProfile, 'frontline');
  assert.equal(a.goalSuggestions.length, Object.keys(PROFILES).length);
});

test('ARAM form raises comfort and is reported per teammate', () => {
  const s = state(['Lucian', 'Yasuo', 'Lux', 'Jinx', 'Zed'], ['Ahri', 'Syndra']);
  s.players[0].owned = s.bench.slice();
  const base = analyze({ state: s, lookup, settings: settings() });
  s.players[0].form = { [C('Syndra').id]: { games: 10, wins: 7, kills: 80, deaths: 40, assists: 100 } };
  s.players[0].historyGames = 100; s.players[0].aramGames = 40;
  const withForm = analyze({ state: s, lookup, settings: settings() });
  const score = (a: typeof base, alias: string) => a.myPicks.find(p => p.championId === C(alias).id)!.score;
  assert.ok(score(withForm, 'Syndra') > score(base, 'Syndra'));
  assert.ok(withForm.myPicks.find(p => p.championId === C('Syndra').id)!.form?.games === 10);
  const me = withForm.teamForm.find(t => t.isLocal)!;
  assert.equal(me.top[0].championId, C('Syndra').id);
  assert.ok(me.hasHistory);
});

test('badges: one per bench slot with my delta, best highlighted, team rows get plan hints', () => {
  const s = state(['Lucian', 'Yasuo', 'Lux', 'Jinx', 'Zed'], ['Malphite', 'Teemo']);
  s.players[0].owned = s.bench.slice();
  const a = analyze({ state: s, lookup, settings: settings() });
  const b = buildBadges(s, a, DEFAULT_SETTINGS.badges);
  const bench = b.filter(x => x.y === DEFAULT_SETTINGS.badges.benchFirst.y);
  assert.equal(bench.length, 2);
  assert.ok(bench.some(x => x.kind === 'best' && x.text.startsWith('+')));
  const self = b.find(x => x.kind === 'self');
  assert.ok(self && self.text.includes('Malphite'));
});

import { deriveAnchors, matchCandidates, resizeGray, type Gray, type Template } from '../src/shared/match';
import { benchSlot } from '../src/shared/badges';

function fakeIcon(seed: number, size: number): Gray {
  // deterministic texture so every icon is distinct
  const data = new Float32Array(size * size);
  let s = seed * 9301 + 49297;
  // smooth, icon-like texture: a few sinusoids with seed-dependent phases
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = 120 + 50 * Math.sin(x / 6 + seed) * Math.cos(y / 5 - seed / 3) + 40 * Math.sin((x + y) / 9 + seed * 1.7);
  void s;
  return { width: size, height: size, data };
}

test('matcher recovers bench and team anchors from a synthetic screenshot', () => {
  const W = 640, H = 360;
  const img: Gray = { width: W, height: H, data: new Float32Array(W * H).fill(60) };
  const paste = (icon: Gray, cx: number, cy: number) => { for (let y = 0; y < icon.height; y++) for (let x = 0; x < icon.width; x++) img.data[(cy - icon.height / 2 + y) * W + cx - icon.width / 2 + x] = icon.data[y * icon.width + x]; };
  const icons = new Map<string, Gray>();
  const benchKeys = new Map<string, number>(), teamKeys = new Map<string, number>();
  const shown = 30; // icon size on "screen"
  // a centred bench of 4 icons around x = 320, spacing 36
  for (let i = 0; i < 4; i++) { const k = `b${i}`; icons.set(k, fakeIcon(10 + i, 64)); benchKeys.set(k, i); paste(resizeGray(icons.get(k)!, shown, shown), 320 + (i - 1.5) * 36, 324); }
  for (let i = 0; i < 3; i++) { const k = `t${i}`; icons.set(k, fakeIcon(50 + i, 64)); teamKeys.set(k, i); paste(resizeGray(icons.get(k)!, shown, shown), 70, 90 + i * 48); }
  const templates: Template[] = [];
  for (const [k, g] of icons) for (const s of [24, 30, 36]) templates.push({ key: k, size: s, data: resizeGray(g, s, s).data });
  const cands = [
    ...matchCandidates(img, templates.filter(t => benchKeys.has(t.key)), { x: 0, y: 160, width: W, height: 200 }, 3),
    ...matchCandidates(img, templates.filter(t => teamKeys.has(t.key)), { x: 0, y: 20, width: 320, height: 320 }, 3),
  ];
  const fit = deriveAnchors({ width: W, height: H }, cands, benchKeys, 4, teamKeys, 5);
  assert.ok(fit.bench && fit.bench.matches === 4, JSON.stringify(fit));
  assert.equal(fit.bench!.align, 'center');
  assert.ok(Math.abs(fit.bench!.first.x * W - (320 - 1.5 * 36)) < 3 && Math.abs(fit.bench!.first.y * H - 324) < 3, JSON.stringify(fit.bench));
  assert.ok(Math.abs(fit.bench!.last.x * W - (320 + 1.5 * 36)) < 3);
  assert.ok(fit.team && fit.team.matches === 3, JSON.stringify(fit));
  assert.ok(Math.abs(fit.team!.first.y * H - 90) < 3 && Math.abs(fit.team!.last.y * H - (90 + 4 * 48)) < 6);

  // the badge model reproduces the slots for the current count and grows symmetrically for a bigger bench
  const s = { ...DEFAULT_SETTINGS.badges, benchFirst: fit.bench!.first, benchLast: fit.bench!.last, benchRef: 4, benchAlign: fit.bench!.align };
  assert.ok(Math.abs(benchSlot(s, 0, 4).x * W - (320 - 1.5 * 36)) < 3);
  assert.ok(Math.abs(benchSlot(s, 5, 6).x * W - (320 + 2.5 * 36)) < 3);
});

test('degenerate saved badge anchors fall back to the defaults', async () => {
  const { sanitizeBadges } = await import('../src/main/store');
  const d = DEFAULT_SETTINGS.badges;
  const broken = { ...d, calibratedBy: 'manual' as const, benchFirst: { x: 0, y: 0.87 }, benchLast: { x: 1, y: 0.83 }, teamFirst: { x: 0.11, y: 0.19 }, teamLast: { x: 0.15, y: 0.63 } };
  const fixed = sanitizeBadges(broken);
  assert.equal(fixed.calibratedBy, 'none');
  assert.deepEqual(fixed.benchFirst, d.benchFirst);
  assert.deepEqual(fixed.benchLast, d.benchLast);
  assert.deepEqual(fixed.teamFirst, broken.teamFirst, 'a sane team row survives');
  const fine = { ...d, calibratedBy: 'auto' as const, benchFirst: { x: 0.3, y: 0.9 }, benchLast: { x: 0.7, y: 0.9 } };
  assert.equal(sanitizeBadges(fine), fine);
});
