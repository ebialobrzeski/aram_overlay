import type { Champion, SynergyHit } from './types';
import { COMBO_TIPS, comboKey } from './combo_tips';

/**
 * Kit / ultimate combos.
 *
 * Almost everything here is GENERIC and driven by the champion traits, so any champion pairing that fits
 * the pattern is rewarded (Malphite + Yasuo is only one instance of "knock-up provider + Yasuo"):
 *   - knock-up / knock-back / pull providers set up Yasuo R (and a little for Samira's passive)
 *   - AoE lockdown enables channelled or stationary ultimates (Katarina, Miss Fortune, Nunu, Fiddlesticks...)
 *   - AoE hard CC + AoE damage = wombo combo
 *   - enchanters protect hypercarries; peel tanks protect hypercarries a bit
 *   - dive engage carries the Orianna ball
 *   - ally-targeted ultimates (Galio, Taric, Shen, Kayle, Zilean) follow a diver or save a hypercarry
 *   - Kalista R throws a hard-engage melee ally
 *
 * A short explicit list covers combos that are stronger than the generic pattern implies.
 * Every hit carries a `tip` that says how to execute it. Hand-written tips from combo_tips.ts replace the
 * generic text when the pair matches, and pairs no rule catches are added with a small bonus.
 */

interface ExplicitPair { a: string; b: string; points: number; label: string }

const EXPLICIT: ExplicitPair[] = [
  { a: 'Malphite', b: 'Yasuo', points: 5, label: 'Malphite R → Yasuo R' },
  { a: 'Malphite', b: 'Orianna', points: 3.5, label: 'Malphite R carries the Orianna ball' },
  { a: 'Taric', b: 'MasterYi', points: 3.5, label: 'Taric R makes Master Yi invulnerable' },
  { a: 'Lulu', b: 'KogMaw', points: 3.5, label: "Lulu W/R + Kog'Maw" },
  { a: 'Yuumi', b: 'MasterYi', points: 2.5, label: 'Yuumi on Master Yi' },
  { a: 'Renata', b: 'Twitch', points: 2, label: 'Renata W keeps Twitch R going' },
];

/** Bonus for a hand-written combo that no rule above already rewards. */
const CURATED_COMBO_POINTS = 2;

const AIRBORNE_POINTS = [0, 1.5, 2.5, 4];

function hasExplicit(a: Champion, b: Champion): boolean {
  return EXPLICIT.some(p => (p.a === a.alias && p.b === b.alias) || (p.a === b.alias && p.b === a.alias));
}

export function findSynergies(team: Champion[]): SynergyHit[] {
  const hits: SynergyHit[] = [];
  const byAlias = new Map(team.map(c => [c.alias, c]));
  const others = (c: Champion) => team.filter(o => o !== c && !hasExplicit(o, c));
  const byDesc = (key: (c: Champion) => number) => (x: Champion, y: Champion) => key(y) - key(x);

  // explicit pairs (their tips come from combo_tips.ts below)
  for (const p of EXPLICIT) {
    const a = byAlias.get(p.a); const b = byAlias.get(p.b);
    if (a && b) hits.push({ label: p.label, champions: [a.id, b.id], points: p.points });
  }

  // airborne setup for Yasuo (full) / Samira passive (partial)
  for (const receiver of team) {
    const factor = receiver.alias === 'Yasuo' ? 1 : receiver.alias === 'Samira' ? 0.3 : 0;
    if (!factor) continue;
    others(receiver)
      .filter(c => c.traits.airborne > 0)
      .sort(byDesc(c => c.traits.airborne))
      .slice(0, 2)
      .forEach((c, i) => hits.push(receiver.alias === 'Yasuo' ? {
        label: `${c.name} knock-up → Yasuo R`,
        champions: [c.id, receiver.id],
        points: round(AIRBORNE_POINTS[c.traits.airborne] * factor * (i === 0 ? 1 : 0.5)),
        tip: `Yasuo: hold Last Breath for ${c.name}'s knock-up and stay close enough to follow. ${c.name}: engage only when Yasuo can reach.`,
      } : {
        label: `${c.name} knock-up feeds Samira passive`,
        champions: [c.id, receiver.id],
        points: round(AIRBORNE_POINTS[c.traits.airborne] * factor * (i === 0 ? 1 : 0.5)),
        tip: `Samira: auto airborne targets after ${c.name}'s CC for quick style stacks, then dash in for Inferno Trigger.`,
      }));
  }

  // lockdown enables channelled / stationary ultimates
  for (const ch of team.filter(c => c.traits.channelUlt)) {
    const locker = others(ch).filter(c => c.traits.aoeCC >= 2).sort(byDesc(c => c.traits.aoeCC))[0];
    if (locker) hits.push({
      label: `${locker.name} lockdown covers ${ch.name} R`, champions: [locker.id, ch.id],
      points: locker.traits.aoeCC >= 3 ? 2.5 : 1.5,
      tip: `${ch.name}: don't open with your ult. Wait for ${locker.name}'s AoE CC to land, then channel into the stuck group.`,
    });
  }

  // wombo: AoE hard CC + AoE damage
  let womboPts = 0;
  for (const a of team.filter(c => c.traits.aoeCC >= 3)) {
    for (const b of others(a).filter(c => c.traits.aoeDmg >= 3 && !c.traits.channelUlt)) {
      if (womboPts >= 6) break;
      womboPts += 2;
      hits.push({
        label: `${a.name} AoE CC + ${b.name} AoE damage`, champions: [a.id, b.id], points: 2,
        tip: `${b.name}: hold your big AoE until ${a.name}'s CC hits 2+ enemies, then dump everything on the clump.`,
      });
    }
  }

  // enchanter / peel tank × hypercarry
  let pairs = 0;
  for (const h of team.filter(c => c.traits.hypercarry)) {
    for (const e of others(h).filter(c => c.traits.enchanter)) {
      if (pairs++ >= 2) break;
      hits.push({
        label: `${e.name} protects ${h.name}`, champions: [e.id, h.id], points: 2.5,
        tip: `${e.name}: stick to ${h.name}, put buffs and shields on them first. ${h.name}: stay next to ${e.name}, not ahead of them.`,
      });
    }
    const peeler = others(h).filter(c => !c.traits.enchanter && c.traits.frontline >= 3 && c.traits.cc >= 2).sort(byDesc(c => c.traits.cc))[0];
    if (peeler) hits.push({
      label: `${peeler.name} peels for ${h.name}`, champions: [peeler.id, h.id], points: 1.5,
      tip: `${peeler.name}: when they dive, stay in front of ${h.name} and CC whoever jumps on them instead of chasing.`,
    });
  }

  // Orianna ball delivery
  const ori = byAlias.get('Orianna');
  if (ori) {
    const carrier = others(ori).filter(c => c.traits.dive && c.traits.engage >= 2).sort(byDesc(c => c.traits.engage))[0];
    if (carrier) hits.push({
      label: `${carrier.name} carries the Orianna ball`, champions: [carrier.id, ori.id], points: 2,
      tip: `Orianna: E the ball onto ${carrier.name} right before they go in, then Shockwave the moment they land.`,
    });
  }

  // ally-targeted ultimates follow a diver (or land on a hypercarry)
  for (const g of team.filter(c => c.traits.allyUlt)) {
    const diver = others(g).filter(c => c.traits.dive && c.traits.engage >= 3).sort(byDesc(c => c.traits.engage))[0];
    if (diver) hits.push({
      label: `${g.name} R follows ${diver.name} engage`, champions: [g.id, diver.id], points: 1.5,
      tip: `${g.name}: ult onto ${diver.name} right after they commit, so their engage becomes a 2-man engage.`,
    });
    else {
      const carry = others(g).filter(c => c.traits.hypercarry && !g.traits.enchanter)[0];
      if (carry) hits.push({
        label: `${g.name} R saves ${carry.name}`, champions: [g.id, carry.id], points: 1.5,
        tip: `${g.name}: keep your ult up for ${carry.name}. Use it when they get dove, not to start fights.`,
      });
    }
  }

  // Kalista R throws a hard-engage melee ally
  const kal = byAlias.get('Kalista');
  if (kal) {
    const target = others(kal).filter(c => c.traits.rng === 'melee' && c.traits.engage >= 3 && c.traits.aoeCC >= 2).sort(byDesc(c => c.traits.aoeCC))[0];
    if (target) hits.push({
      label: `Kalista R throws ${target.name} in`, champions: [kal.id, target.id], points: 3,
      tip: `Kalista: bind ${target.name} with the Black Spear early, then R them into the enemy backline. ${target.name}: chain your CC on landing.`,
    });
  }

  // hand-written combo tips: sharpen matching hits, add the pairs no rule caught
  const seen = new Set<string>();
  for (const combo of COMBO_TIPS) {
    const a = byAlias.get(combo.pair[0]); const b = byAlias.get(combo.pair[1]);
    if (!a || !b) continue;
    const key = comboKey(a.alias, b.alias);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = hits.find(h => h.champions.includes(a.id) && h.champions.includes(b.id));
    if (hit) hit.tip = combo.tip;
    else hits.push({ label: combo.label, champions: [a.id, b.id], points: CURATED_COMBO_POINTS, tip: combo.tip });
  }

  return hits;
}

export function synergyPoints(hits: SynergyHit[]): number {
  return hits.reduce((s, h) => s + h.points, 0);
}

function round(n: number): number { return Math.round(n * 100) / 100; }
