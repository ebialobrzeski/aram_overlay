import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURATED, CURATED_BY_ALIAS } from '../src/shared/champion_data';
import { findSynergies } from '../src/shared/synergies';
import { buildGamePlan } from '../src/shared/game_plan';
import { CHAMP_TIPS } from '../src/shared/champ_tips';
import { COMBO_TIPS } from '../src/shared/combo_tips';
import { analyze } from '../src/shared/analysis';
import { DEFAULT_SETTINGS, PROFILES } from '../src/shared/scoring';
import type { Player, TeamState } from '../src/shared/types';

const C = (alias: string) => { const c = CURATED_BY_ALIAS.get(alias.toLowerCase()); if (!c) throw new Error(`unknown ${alias}`); return c; };
const plan = (aliases: string[], me = 0) => { const team = aliases.map(C); return buildGamePlan(team, me, findSynergies(team)); };

test('every synergy hit explains how to execute it', () => {
  const teams = [
    ['Malphite', 'Yasuo', 'Orianna', 'MissFortune', 'Lulu'],
    ['Amumu', 'Katarina', 'Milio', 'Jinx', 'Kalista'],
    ['Galio', 'JarvanIV', 'Taric', 'MasterYi', 'Samira'],
  ];
  for (const t of teams) for (const h of findSynergies(t.map(C))) assert.ok(h.tip && h.tip.length > 10, `${h.label} has no tip`);
});

test('hand-written combo tip replaces the generic one and uncaught pairs are added', () => {
  const yas = findSynergies([C('Alistar'), C('Yasuo')]);
  assert.match(yas[0].tip!, /W→Q/);
  const poke = findSynergies([C('Ashe'), C('Ezreal')]);
  assert.equal(poke.length, 1);
  assert.equal(poke[0].label, 'Ashe arrow → Ezreal poke');
});

test('combo and champion tip tables only reference real champions', () => {
  for (const c of COMBO_TIPS) for (const a of c.pair) assert.ok(CURATED_BY_ALIAS.has(a.toLowerCase()), `combo uses unknown ${a}`);
  for (const a of Object.keys(CHAMP_TIPS)) assert.ok(CURATED_BY_ALIAS.has(a.toLowerCase()), `tip for unknown ${a}`);
  const missing = CURATED.filter(c => !CHAMP_TIPS[c.alias]).map(c => c.alias);
  assert.ok(missing.length <= 3, `champions without tips: ${missing.join(', ')}`);
});

test('roles follow the team: tank engages, enchanter protects the carry', () => {
  const team = ['Malphite', 'Jinx', 'Lulu', 'Lux', 'Yasuo'];
  assert.equal(plan(team, 0).role, 'Main tank / initiator');
  const lulu = plan(team, 2);
  assert.equal(lulu.role, 'Enchanter / protector');
  assert.match(lulu.roleTip, /Jinx/);
  const yas = plan(team, 4);
  assert.ok(yas.combos.some(c => c.label.includes('Yasuo R') && c.partners.includes(C('Malphite').id)));
});

test('team plan and warnings reflect the comp', () => {
  const poke = plan(['Xerath', 'Ziggs', 'Jayce', 'Lux', 'Ezreal']);
  assert.ok(poke.teamPlan.some(t => t.startsWith('Poke comp')));
  assert.ok(poke.watchOut.some(t => t.startsWith('No real tank')));
  const wombo = plan(['Amumu', 'Orianna', 'Malphite', 'Kennen', 'MissFortune'], 1);
  assert.ok(wombo.teamPlan.some(t => t.startsWith('Wombo comp')));
});

test('analysis attaches a game plan to every pick option', () => {
  const players: Player[] = ['Lux', 'Ezreal', 'Garen', 'Annie', 'Sona'].map((a, i) => ({
    cellId: i, name: `P${i}`, championId: C(a).id, isLocal: i === 0, isParty: i === 0, mastery: {},
    ...(i === 0 ? { owned: [C('Lux').id, C('Yasuo').id, C('Malphite').id] } : {}),
  }));
  const state: TeamState = { phase: 'ChampSelect', isAram: true, players, bench: [C('Yasuo').id, C('Malphite').id], rerollsRemaining: 0, connected: true, source: 'demo' };
  const lookup = (id: number) => CURATED.find(c => c.id === id);
  const a = analyze({ state, lookup, settings: { ...DEFAULT_SETTINGS, weights: PROFILES.balanced.weights } });
  assert.ok(a.myPicks.length >= 3);
  for (const o of a.myPicks) {
    assert.equal(o.gamePlan?.championId, o.championId);
    assert.ok(o.gamePlan!.teamPlan.length > 0);
  }
  const malph = a.myPicks.find(o => o.championId === C('Malphite').id)!;
  assert.equal(malph.gamePlan!.role, 'Main tank / initiator');
});
