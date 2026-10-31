import type { ChampForm, Champion, NumericTrait, Settings, SynergyHit, TeamScore, Weights } from './types';
import { NUMERIC_TRAITS } from './types';
import { findSynergies, synergyPoints } from './synergies';

export interface Profile { label: string; description: string; weights: Weights }

const base = (w: Partial<Weights>): Weights => ({
  cc: 0.4, aoeCC: 0.3, engage: 0.4, poke: 0.4, frontline: 0.5, sustain: 0.4, burst: 0.3, dps: 0.5, waveclear: 0.5, aoeDmg: 0.3,
  dmgBalance: 0.6, rangeMix: 0.5, rangedCount: 0, hasTank: 0.6, synergy: 1, mastery: 1,
  ...w,
});

/** The weights every profile shares; a profile's identity is what it adds on top of these. */
export const BASE_WEIGHTS: Weights = base({});

export const PROFILES: Record<string, Profile> = {
  balanced: {
    label: 'Balanced',
    description: 'A bit of everything: CC, frontline, damage mix, sustain, waveclear.',
    weights: base({ cc: 1, aoeCC: 0.5, engage: 0.7, poke: 0.6, frontline: 0.9, sustain: 0.6, burst: 0.5, dps: 0.7, waveclear: 0.6, aoeDmg: 0.5, dmgBalance: 0.8, rangeMix: 0.6, hasTank: 0.8 }),
  },
  cc: {
    label: 'Max CC',
    description: 'Chain crowd control, engage and wombo potential.',
    weights: base({ cc: 2, aoeCC: 1.5, engage: 1, frontline: 0.8, aoeDmg: 0.5, synergy: 1.2 }),
  },
  poke: {
    label: 'Poke / Range',
    description: 'Long range harass, waveclear and sustain; prefers ranged champions.',
    weights: base({ poke: 2, waveclear: 1, sustain: 0.8, cc: 0.5, rangedCount: 1, rangeMix: 0, hasTank: 0.3, frontline: 0.3 }),
  },
  frontline: {
    label: 'Frontline / Tank',
    description: 'Durable engage comp that wins extended fights.',
    weights: base({ frontline: 2.2, hasTank: 1, engage: 1, cc: 1, sustain: 0.6 }),
  },
  wombo: {
    label: 'Wombo Combo',
    description: 'AoE crowd control into AoE damage; ultimate combos weigh the most.',
    weights: base({ aoeCC: 2, aoeDmg: 2, engage: 1, cc: 0.8, synergy: 1.6 }),
  },
  carry: {
    label: 'Protect the Carry',
    description: 'Sustained damage with peel, shields and heals.',
    weights: base({ dps: 2.2, sustain: 1.5, cc: 0.8, frontline: 0.6, hasTank: 0.8 }),
  },
};

export const DEFAULT_SETTINGS: Settings = {
  profile: 'auto',
  badges: {
    enabled: true, scale: 1,
    // rough guesses for the ARAM champion select layout; "Calibrate" in the settings matches them to the client
    benchFirst: { x: 0.335, y: 0.905 }, benchLast: { x: 0.665, y: 0.905 },
    teamFirst: { x: 0.115, y: 0.215 }, teamLast: { x: 0.115, y: 0.655 },
  },
  weights: PROFILES.balanced.weights,
  includeNonPartyTrades: false,
  assumePartyOwnsAll: true,
  comfortOverrides: '',
  topPlans: 5,
  opacity: 0.96,
  compact: false,
};

const TRAIT_LABELS: Record<NumericTrait, string> = {
  cc: 'CC', aoeCC: 'AoE CC', engage: 'Engage', poke: 'Poke', frontline: 'Tank', sustain: 'Heal/Shield',
  burst: 'Burst', dps: 'DPS', waveclear: 'Waveclear', airborne: 'Knock-up', aoeDmg: 'AoE dmg',
};

export function traitLabel(t: NumericTrait): string { return TRAIT_LABELS[t]; }

/** Short descriptor chips for a champion. */
export function championTags(c: Champion): string[] {
  const ranked = NUMERIC_TRAITS
    .filter(t => c.traits[t] >= 2)
    .sort((a, b) => c.traits[b] - c.traits[a])
    .slice(0, 3)
    .map(t => TRAIT_LABELS[t]);
  return [c.traits.dmg, c.traits.rng === 'ranged' ? 'Ranged' : 'Melee', ...ranked];
}

/**
 * 0..1 value from recent ARAM games on a champion: needs a few games to be trusted, then scales with win rate
 * (shrunk towards 50% for small samples) and a little with KDA.
 */
export function formScore(f: ChampForm | undefined): number {
  if (!f || f.games <= 0) return 0;
  const trust = Math.min(1, f.games / 4); // only ~20 recent games are visible, so 4 on one champion is a strong signal
  const winRate = (f.wins + 1) / (f.games + 2);
  const kda = (f.kills + f.assists) / Math.max(1, f.deaths);
  const perf = 0.55 + 0.9 * (winRate - 0.5) + Math.min(0.15, kda / 40);
  return Math.max(0, Math.min(1, trust * perf));
}

/** Blend mastery (any queue) with ARAM form when history is available. */
export function comfortScore(masteryPoints: number, form: ChampForm | undefined, hasHistory: boolean): number {
  const m = masteryNorm(masteryPoints);
  if (!hasHistory) return m;
  return Math.max(0.4 * m, 0.35 * m + 0.65 * formScore(form));
}

/** 0..1 comfort value from mastery points. */
export function masteryNorm(points: number): number {
  if (!points || points <= 0) return 0;
  return Math.sqrt(Math.min(points, 200_000) / 200_000);
}

function diminishing(sum: number, max: number): number {
  return 10 * Math.sqrt(Math.max(0, sum) / max);
}

export const WEIGHT_LABELS: Record<keyof Weights, string> = {
  cc: 'CC', aoeCC: 'AoE CC', engage: 'Engage', poke: 'Poke', frontline: 'Frontline', sustain: 'Heal/Shield', burst: 'Burst', dps: 'DPS',
  waveclear: 'Waveclear', aoeDmg: 'AoE damage', dmgBalance: 'AD/AP mix', rangeMix: 'Range mix', rangedCount: 'Prefer ranged', hasTank: 'Has a tank',
  synergy: 'Ult combos', mastery: 'Comfort picks',
};

/** Weight-independent evaluation of a team: raw 0..10 terms plus the explanatory data. */
export interface Terms {
  raw: Record<keyof Weights, number>;
  synergies: SynergyHit[];
  aggregates: Record<NumericTrait, number>;
  warnings: string[];
}

/**
 * Compute the raw terms of a team. `comfort` holds a 0..1 value for every player we control (undefined for others).
 */
export function computeTerms(team: Champion[], comfort: (number | undefined)[] = []): Terms {
  const n = Math.max(team.length, 1);
  const aggregates = {} as Record<NumericTrait, number>;
  for (const t of NUMERIC_TRAITS) aggregates[t] = team.reduce((s, c) => s + c.traits[t], 0);

  const raw = {} as Record<keyof Weights, number>;
  for (const t of NUMERIC_TRAITS) {
    if (t === 'airborne') continue; // only matters through synergies
    raw[t] = diminishing(aggregates[t], 3 * n);
  }

  // damage type balance
  let ad = 0, ap = 0;
  for (const c of team) { if (c.traits.dmg === 'AD') ad++; else if (c.traits.dmg === 'AP') ap++; else { ad += 0.5; ap += 0.5; } }
  raw.dmgBalance = 10 * (1 - Math.abs(ad - ap) / n);

  // range mix
  const ranged = team.filter(c => c.traits.rng === 'ranged').length;
  raw.rangeMix = ranged >= 2 && ranged <= 4 ? 10 : ranged === 1 || ranged === 5 ? 5 : 0;
  raw.rangedCount = 10 * ranged / n;

  // a real frontliner
  const maxFront = Math.max(0, ...team.map(c => c.traits.frontline));
  raw.hasTank = [0, 2, 6, 10][maxFront];

  // synergies
  const synergies = findSynergies(team);
  raw.synergy = Math.min(15, synergyPoints(synergies));

  // comfort picks
  const comfortVals = comfort.filter((v): v is number => v !== undefined);
  raw.mastery = 10 * (comfortVals.length ? comfortVals.reduce((a, b) => a + b, 0) / comfortVals.length : 0);

  const warnings: string[] = [];
  if (team.length >= 4) {
    if (maxFront === 0) warnings.push('No frontline at all');
    else if (maxFront === 1) warnings.push('No real tank');
    if (ad >= n - 0.5) warnings.push('Full AD');
    if (ap >= n - 0.5) warnings.push('Full AP');
    if (ranged <= 1) warnings.push('Almost all melee');
    if (ranged === n) warnings.push('No melee presence');
    if (aggregates.cc <= 3) warnings.push('Very little hard CC');
    if (aggregates.waveclear <= 5) warnings.push('Weak waveclear');
    if (aggregates.sustain === 0) warnings.push('No heals or shields');
  }

  return { raw, synergies, aggregates, warnings };
}

/** Fast weighted total without building the breakdown (used inside the optimizer loop). */
export function totalOf(terms: Terms, weights: Weights): number {
  let total = 0;
  for (const k in weights) total += (terms.raw[k as keyof Weights] ?? 0) * weights[k as keyof Weights];
  return total;
}

export function weightSum(weights: Weights): number {
  let s = 0;
  for (const k in weights) s += weights[k as keyof Weights];
  return s || 1;
}

/** Total divided by the weight sum: a 0..10-ish "average term quality" comparable across profiles. */
export function normalizedTotal(total: number, weights: Weights): number { return total / weightSum(weights); }

/**
 * How well a team fits a goal: the average quality (0..10) of the terms the goal emphasises beyond the shared
 * base weights. Comfort picks are ignored because they say nothing about the pool.
 */
export function fitScore(terms: Terms, weights: Weights): number {
  let num = 0, den = 0;
  for (const k in weights) {
    if (k === 'mastery') continue;
    const w = Math.max(0, weights[k as keyof Weights] - BASE_WEIGHTS[k as keyof Weights]);
    num += w * (terms.raw[k as keyof Weights] ?? 0); den += w;
  }
  return den ? num / den : 0;
}

export function applyWeights(terms: Terms, weights: Weights): TeamScore {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const k in weights) { const v = (terms.raw[k as keyof Weights] ?? 0) * weights[k as keyof Weights]; breakdown[k] = v; total += v; }
  return { total: round(total), breakdown, synergies: terms.synergies, aggregates: terms.aggregates, warnings: terms.warnings };
}

export function scoreTeam(team: Champion[], weights: Weights, comfort: (number | undefined)[] = []): TeamScore {
  return applyWeights(computeTerms(team, comfort), weights);
}

export function round(n: number): number { return Math.round(n * 10) / 10; }
