import type { Anchor, Analysis, Badge, BadgeSettings, TeamState } from './types';

export const BENCH_SLOTS = 10; // ARAM bench holds up to 10 champions
export const TEAM_ROWS = 5;

export function lerp(a: Anchor, b: Anchor, t: number): Anchor {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Where bench slot `i` of `count` champions sits. The anchors describe the first and last slot of a bench of
 * `benchRef` champions; from that the spacing is known, and the row is either left-aligned (slot 0 fixed) or
 * centred (the row grows symmetrically around its middle).
 */
export function benchSlot(s: BadgeSettings, i: number, count: number): Anchor {
  const ref = Math.max(2, s.benchRef || BENCH_SLOTS);
  const spacing = { x: (s.benchLast.x - s.benchFirst.x) / (ref - 1), y: (s.benchLast.y - s.benchFirst.y) / (ref - 1) };
  if (s.benchAlign === 'center') {
    const center = { x: (s.benchFirst.x + s.benchLast.x) / 2, y: (s.benchFirst.y + s.benchLast.y) / 2 };
    const off = i - (count - 1) / 2;
    return { x: center.x + spacing.x * off, y: center.y + spacing.y * off };
  }
  return { x: s.benchFirst.x + spacing.x * i, y: s.benchFirst.y + spacing.y * i };
}

export function teamRow(s: BadgeSettings, i: number): Anchor {
  return lerp(s.teamFirst, s.teamLast, i / (TEAM_ROWS - 1));
}

/** Badges for the client overlay: my delta per bench slot (best highlighted) and plan hints per team row. */
export function buildBadges(state: TeamState, analysis: Analysis | null, s: BadgeSettings): Badge[] {
  if (!analysis) return [];
  const badges: Badge[] = [];
  const name = (id: number) => analysis.champions[id]?.name ?? `#${id}`;
  const fmt = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}`;

  const bestBench = analysis.myPicks.filter(p => p.source === 'bench' && p.delta > 0.05).sort((a, b) => b.delta - a.delta)[0];
  const count = Math.min(state.bench.length, BENCH_SLOTS);
  state.bench.forEach((champ, i) => {
    if (i >= BENCH_SLOTS) return;
    const pos = benchSlot(s, i, count);
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
    const pos = teamRow(s, i);
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
