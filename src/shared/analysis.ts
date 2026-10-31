import type { Analysis, Champion, FormEntry, GoalSuggestion, PickOption, Plan, PlanStep, Player, Settings, SynergyHit, TeamFormEntry, TeamScore, TeamState, Weights } from './types';
import { applyWeights, championTags, comfortScore, computeTerms, fitScore, PROFILES, round, totalOf, WEIGHT_LABELS, type Terms } from './scoring';
import { traitsFromTags } from './champion_data';

export type ChampionLookup = (id: number) => Champion | undefined;
export const AUTO_PROFILE = 'auto';

export interface AnalysisInput {
  state: TeamState;
  lookup: ChampionLookup;
  settings: Settings;
  /** cellId -> champion ids the player is known to be comfortable on (manual overrides) */
  comfort?: Map<number, Set<number>>;
}

type Ownership = 'yes' | 'no' | 'assumed';
interface Tracker { key: string; weights: Weights; top: { assignment: number[]; total: number }[]; bestFit?: { assignment: number[]; fit: number } }

const MAX_NODES = 3_000_000;
/** small tie-breaker so "Balanced" wins when no goal clearly stands out */
const BALANCED_BIAS = 0.25;

function unknownChampion(id: number): Champion {
  if (id <= 0) return { id, alias: 'None', name: 'not picked yet', traits: traitsFromTags([]), curated: true };
  return { id, alias: `Champion${id}`, name: `Champion ${id}`, traits: traitsFromTags(['fighter']), curated: false };
}

export function analyze(input: AnalysisInput): Analysis {
  const { state, settings } = input;
  const lookup = (id: number) => (id > 0 ? input.lookup(id) : undefined) ?? unknownChampion(id);
  const players = state.players;
  const n = players.length;
  const current = players.map(p => p.championId);
  const comfortOverrides = input.comfort ?? new Map<number, Set<number>>();
  const auto = settings.profile === AUTO_PROFILE;

  const ownership = (p: Player, champ: number): Ownership => {
    if (champ === p.championId) return 'yes';
    if (p.owned) return p.owned.includes(champ) ? 'yes' : 'no';
    if (p.mastery[champ] > 0) return 'yes';
    if (comfortOverrides.get(p.cellId)?.has(champ)) return 'yes';
    if (p.isLocal) return 'no';
    return settings.assumePartyOwnsAll ? 'assumed' : 'no';
  };

  const hasHistory = (p: Player) => p.form !== undefined && (p.aramGames ?? 0) >= 2;
  const comfortAny = (p: Player, champ: number): number => {
    const override = comfortOverrides.get(p.cellId)?.has(champ) ? 0.85 : 0;
    return Math.max(comfortScore(p.mastery[champ] ?? 0, p.form?.[champ], hasHistory(p)), override);
  };
  const comfortOf = (p: Player, champ: number): number | undefined => {
    if (!p.isParty) return undefined;
    const hasData = Object.keys(p.mastery).length > 0 || hasHistory(p) || (comfortOverrides.get(p.cellId)?.size ?? 0) > 0;
    if (!hasData) return undefined;
    return comfortAny(p, champ);
  };

  // what every teammate is good at (shown in the UI; party members' values also drive the comfort term)
  const teamForm: TeamFormEntry[] = players.map(p => {
    const ids = new Set<number>([...Object.keys(p.mastery), ...Object.keys(p.form ?? {})].map(Number));
    const top: FormEntry[] = [...ids]
      .map(id => ({ championId: id, comfort: comfortAny(p, id), mastery: p.mastery[id] ?? 0, form: p.form?.[id] }))
      .filter(e => e.comfort > 0.12)
      .sort((a, b) => b.comfort - a.comfort || (b.form?.games ?? 0) - (a.form?.games ?? 0))
      .slice(0, 6);
    return { cellId: p.cellId, name: p.name, isLocal: p.isLocal, isParty: p.isParty, historyGames: p.historyGames ?? 0, aramGames: p.aramGames ?? 0, hasHistory: hasHistory(p), top };
  });

  const termsOf = (assignment: number[]): Terms =>
    computeTerms(assignment.map(lookup), players.map((p, i) => comfortOf(p, assignment[i])));

  const currentTerms = termsOf(current);

  // ---------- trackers: one per goal profile, plus the user's active weights ----------
  const trackers: Tracker[] = Object.entries(PROFILES).map(([key, p]) => ({ key, weights: p.weights, top: [] }));
  const activeTracker: Tracker = { key: '__active', weights: settings.weights, top: [] };
  if (!auto) trackers.push(activeTracker);
  const K = Math.max(1, settings.topPlans);

  // ---------- candidate options per player ----------
  const partyIdx = players.map((p, i) => (p.isParty ? i : -1)).filter(i => i >= 0);
  const nonPartyIdx = players.map((p, i) => (!p.isParty ? i : -1)).filter(i => i >= 0);
  const holder = new Map<number, number>(current.map((c, i) => [c, i]));

  const options: number[][] = players.map((p, i) => {
    if (!p.isParty) {
      const opts = [p.championId];
      if (settings.includeNonPartyTrades) for (const j of partyIdx) opts.push(current[j]);
      return opts;
    }
    const opts = new Set<number>([p.championId]);
    for (const b of state.bench) if (ownership(p, b) !== 'no') opts.add(b);
    for (const j of partyIdx) if (j !== i) opts.add(current[j]);
    if (settings.includeNonPartyTrades) for (const j of nonPartyIdx) opts.add(current[j]);
    return [...opts];
  });

  // ---------- enumerate assignments once, score for every tracker ----------
  let nodes = 0;
  const used = new Set<number>();
  const assignment = new Array<number>(n);

  const valid = (): boolean => {
    for (const j of nonPartyIdx) {
      if (assignment[j] === current[j]) continue;
      const k = holder.get(assignment[j]);
      if (k === undefined || !players[k].isParty || assignment[k] !== current[j]) return false;
    }
    for (const i of partyIdx) {
      const k = holder.get(assignment[i]);
      if (k !== undefined && !players[k].isParty && k !== i && assignment[k] !== current[i]) return false;
    }
    return true;
  };

  const consider = () => {
    if (!valid()) return;
    if (assignment.every((c, i) => c === current[i])) return;
    const terms = termsOf(assignment);
    for (const t of trackers) {
      const total = totalOf(terms, t.weights);
      if (t.top.length < K || total > t.top[t.top.length - 1].total) {
        t.top.push({ assignment: [...assignment], total });
        t.top.sort((a, b) => b.total - a.total);
        if (t.top.length > K) t.top.pop();
      }
      if (t.key !== '__active') {
        const fit = fitScore(terms, t.weights);
        if (!t.bestFit || fit > t.bestFit.fit) t.bestFit = { assignment: [...assignment], fit };
      }
    }
  };

  const rec = (i: number) => {
    if (nodes++ > MAX_NODES) return;
    if (i === n) { consider(); return; }
    for (const c of options[i]) {
      if (used.has(c)) continue;
      used.add(c); assignment[i] = c;
      rec(i + 1);
      used.delete(c);
    }
  };
  if (n > 0) rec(0);

  // ---------- goal suggestions: how well does the reachable pool fit each goal? ----------
  const goalSuggestions: GoalSuggestion[] = Object.entries(PROFILES).map(([key, p]) => {
    const t = trackers.find(x => x.key === key)!;
    const currentTotal = totalOf(currentTerms, p.weights);
    const bestTotal = Math.max(currentTotal, t.top[0]?.total ?? -Infinity);
    // fit = what this goal could reach with the pool, measured on the goal's own emphasised terms
    const currentFit = fitScore(currentTerms, p.weights);
    const bestTerms = t.bestFit && t.bestFit.fit > currentFit ? termsOf(t.bestFit.assignment) : currentTerms;
    const fit = Math.max(currentFit, t.bestFit?.fit ?? 0) + (key === 'balanced' ? BALANCED_BIAS : 0);
    const highlights = Object.entries(p.weights)
      .filter(([k]) => k !== 'mastery')
      .map(([k, w]) => ({ k: k as keyof Weights, contribution: (bestTerms.raw[k as keyof Weights] ?? 0) * w }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 2)
      .map(h => WEIGHT_LABELS[h.k]);
    return { profile: key, label: p.label, fit: round(fit), bestDelta: round(bestTotal - currentTotal), highlights };
  }).sort((a, b) => b.fit - a.fit);

  const effectiveProfile = auto ? goalSuggestions[0]?.profile ?? 'balanced' : settings.profile;
  const weights = auto ? PROFILES[effectiveProfile].weights : settings.weights;
  const effective = auto ? trackers.find(t => t.key === effectiveProfile)! : activeTracker;

  const scoreAssignment = (a: number[]): TeamScore => applyWeights(a === current ? currentTerms : termsOf(a), weights);
  const currentScore = applyWeights(currentTerms, weights);

  const plans: Plan[] = effective.top
    .map(t => ({ assignment: t.assignment, score: scoreAssignment(t.assignment) }))
    .filter(t => t.score.total > currentScore.total + 0.05)
    .map(t => ({
      assignment: t.assignment,
      score: t.score,
      delta: round(t.score.total - currentScore.total),
      steps: planSteps(players, current, t.assignment, state.bench),
      unverifiedOwnership: players
        .map((p, i) => (t.assignment[i] !== current[i] && ownership(p, t.assignment[i]) === 'assumed' ? p.cellId : -1))
        .filter(c => c >= 0),
    }));

  // ---------- my picks (everyone else keeps their champion) ----------
  const myPicks: PickOption[] = [];
  const meIdx = players.findIndex(p => p.isLocal);
  if (meIdx >= 0) {
    const me = players[meIdx];
    const candidates: { champ: number; source: PickOption['source']; from?: number }[] = [
      { champ: me.championId, source: 'current' },
      ...state.bench.filter(b => b !== me.championId).map(b => ({ champ: b, source: 'bench' as const })),
      ...players.filter((p, i) => i !== meIdx && p.isParty).map(p => ({ champ: p.championId, source: 'trade' as const, from: p.cellId })),
      ...(settings.includeNonPartyTrades
        ? players.filter((p, i) => i !== meIdx && !p.isParty).map(p => ({ champ: p.championId, source: 'ask' as const, from: p.cellId }))
        : []),
    ];
    const seen = new Set<number>();
    for (const cand of candidates) {
      if (seen.has(cand.champ) || (cand.champ <= 0 && cand.source !== 'current')) continue;
      seen.add(cand.champ);
      const own = ownership(me, cand.champ);
      if (own === 'no' && cand.source === 'bench') continue;
      const a = [...current];
      a[meIdx] = cand.champ;
      if (cand.from !== undefined) {
        const j = players.findIndex(p => p.cellId === cand.from);
        a[j] = me.championId;
      }
      const score = cand.source === 'current' ? currentScore : scoreAssignment(a);
      const champ = lookup(cand.champ);
      myPicks.push({
        championId: cand.champ,
        source: cand.source,
        fromCellId: cand.from,
        score: score.total,
        delta: round(score.total - currentScore.total),
        owned: own === 'assumed' ? undefined : own === 'yes',
        masteryPoints: me.mastery[cand.champ] ?? 0,
        form: me.form?.[cand.champ],
        partnerForm: cand.from !== undefined ? players.find(p => p.cellId === cand.from)?.form?.[me.championId] : undefined,
        synergies: score.synergies.filter(s => s.champions.includes(cand.champ)),
        tags: championTags(champ),
      });
    }
    myPicks.sort((a, b) => b.score - a.score);
  }

  const champions: Analysis['champions'] = {};
  const all = new Set<number>([...current, ...state.bench, ...plans.flatMap(p => p.assignment), ...teamForm.flatMap(t => t.top.map(e => e.championId))]);
  for (const id of all) { const c = lookup(id); champions[id] = { name: c.name, alias: c.alias, curated: c.curated }; }

  return { current: currentScore, teamForm, myPicks, plans, goalSuggestions, effectiveProfile, champions, computedAt: Date.now() };
}

/** Turn a target assignment into an ordered list of bench swaps and trades. */
export function planSteps(players: Player[], current: number[], target: number[], benchIn: number[]): PlanStep[] {
  const cur = [...current];
  const bench = new Set(benchIn);
  const steps: PlanStep[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const pending = players.map((_, i) => i).filter(i => cur[i] !== target[i]);
    if (!pending.length) break;
    const fromBench = pending.find(i => bench.has(target[i]));
    if (fromBench !== undefined) {
      const i = fromBench;
      bench.delete(target[i]); bench.add(cur[i]); cur[i] = target[i];
      steps.push({ cellId: players[i].cellId, kind: 'bench', championId: target[i] });
      continue;
    }
    const i = pending.find(idx => players[idx].isParty) ?? pending[0];
    const k = cur.indexOf(target[i]);
    if (k < 0) break;
    [cur[i], cur[k]] = [cur[k], cur[i]];
    steps.push({ cellId: players[i].cellId, kind: 'trade', championId: target[i], withCellId: players[k].cellId, needsAsk: !players[k].isParty || !players[i].isParty });
  }
  return steps;
}

export function synergiesInvolving(hits: SynergyHit[], championId: number): SynergyHit[] {
  return hits.filter(h => h.champions.includes(championId));
}
