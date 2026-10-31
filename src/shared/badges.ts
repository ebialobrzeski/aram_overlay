import type { Analysis, Badge, BadgeSettings, TeamState } from './types';

export const BENCH_SLOTS = 10; // ARAM bench holds up to 10 champions
export const TEAM_ROWS = 5;

export function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Badges for the client overlay: my delta per bench slot (best highlighted) and plan hints per team row. */
export function buildBadges(state: TeamState, analysis: Analysis | null, s: BadgeSettings): Badge[] {
  if (!analysis) return [];
  const badges: Badge[] = [];
  const name = (id: number) => analysis.champions[id]?.name ?? `#${id}`;
  const fmt = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}`;

  const bestBench = analysis.myPicks.filter(p => p.source === 'bench' && p.delta > 0.05).sort((a, b) => b.delta - a.delta)[0];
  state.bench.forEach((champ, i) => {
    if (i >= BENCH_SLOTS) return;
    const pos = lerp(s.benchFirst, s.benchLast, i / (BENCH_SLOTS - 1));
    const pick = analysis.myPicks.find(p => p.championId === champ);
    if (!pick) { badges.push({ ...pos, text: '✕', kind: 'zero', title: `${name(champ)}: not available to you` }); return; }
    if (pick.owned === false) { badges.push({ ...pos, text: '✕', kind: 'zero', title: `${name(champ)}: not owned` }); return; }
    const kind = bestBench && bestBench.championId === champ ? 'best' : pick.delta > 0.05 ? 'pos' : pick.delta < -0.05 ? 'neg' : 'zero';
    badges.push({ ...pos, text: fmt(pick.delta), kind, title: `${name(champ)}: ${fmt(pick.delta)} for the team` });
  });

  // the client lists the team in cell order
  const plan = analysis.plans[0];
  const sorted = [...state.players].sort((a, b) => a.cellId - b.cellId);
  sorted.forEach((p, i) => {
    const pos = lerp(s.teamFirst, s.teamLast, i / (TEAM_ROWS - 1));
    if (p.isLocal) {
      const best = analysis.myPicks[0];
      if (best && best.source !== 'current' && best.delta > 0.05) {
        const how = best.source === 'bench' ? 'bench' : best.source === 'trade' ? 'trade' : 'ask';
        badges.push({ ...pos, text: `→ ${name(best.championId)} ${fmt(best.delta)} (${how})`, kind: 'self' });
      } else {
        badges.push({ ...pos, text: 'keep', kind: 'zero', title: 'Your current pick is the best option' });
      }
      return;
    }
    if (!plan) return;
    const step = plan.steps.find(st => st.cellId === p.cellId);
    if (step) badges.push({ ...pos, text: `→ ${name(step.championId)}${step.needsAsk ? ' (ask)' : ''}`, kind: 'hint', title: `Plan 1 (+${plan.delta})` });
  });

  return badges;
}
