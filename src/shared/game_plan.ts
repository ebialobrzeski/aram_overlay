import type { Champion, GamePlan, SynergyHit } from './types';
import { CHAMP_TIPS } from './champ_tips';

/**
 * Coaching for one champion inside one specific team: what your job is, how to execute your combos with the
 * teammates you actually have, and how the whole team should play. Pure and deterministic, built from the
 * traits table, so it works offline and updates instantly as picks change.
 */
export function buildGamePlan(team: Champion[], meIdx: number, synergies: SynergyHit[]): GamePlan {
  const me = team[meIdx];
  const allies = team.filter((_, i) => i !== meIdx && team[i].id > 0);
  const t = me.traits;
  const names = (cs: Champion[]) => joinNames(cs.map(c => c.name));

  const bestCarry = [...allies].sort((a, b) => carryValue(b) - carryValue(a))[0];
  const tanks = allies.filter(c => c.traits.frontline >= 2).sort((a, b) => b.traits.frontline - a.traits.frontline);
  const engagers = allies.filter(c => c.traits.engage >= 3);
  const iAmTopFront = t.frontline >= 2 && allies.every(a => a.traits.frontline <= t.frontline);
  const iAmTopCarry = carryValue(me) >= 5 && (!bestCarry || carryValue(me) >= carryValue(bestCarry));

  // ---------- role ----------
  let role: string; let roleTip: string;
  if (t.enchanter) {
    role = 'Enchanter / protector';
    roleTip = bestCarry
      ? `Your win condition is ${bestCarry.name}. Stay next to them, spend shields/heals on them first and peel anyone who dives them.`
      : 'Keep the whole team topped up; spread shields on whoever is being focused.';
  } else if (iAmTopFront && t.engage >= 2) {
    role = 'Main tank / initiator';
    roleTip = `You start the fights. Engage only when ${bestCarry ? bestCarry.name : 'your damage'} is in range to follow, and stand between their divers and your backline.`;
  } else if (t.frontline >= 2) {
    role = tanks.length ? 'Second frontline' : 'Frontline';
    roleTip = tanks.length
      ? `${tanks[0].name} goes first; you follow up and soak damage. Peel for ${bestCarry?.name ?? 'your carries'} if they get jumped.`
      : 'You are the only real frontline: take the first hits, and don\'t chase so far that your backline is left alone.';
  } else if (t.engage >= 3 && t.dive) {
    role = 'Engage / diver';
    roleTip = tanks.length
      ? `Start fights together with ${tanks[0].name}, or follow right behind them onto the backline.`
      : 'You are the engage: go in when your follow-up is close, and look for clumped enemies.';
  } else if (iAmTopCarry) {
    role = t.rng === 'ranged' ? 'Main carry (backline)' : 'Main carry (skirmisher)';
    roleTip = t.rng === 'ranged'
      ? `You are the damage. Stay behind ${tanks[0]?.name ?? 'your front'}, hit the closest target and move back when divers come.`
      : 'You are the damage. Let your team engage first, then go in once their key CC is used.';
  } else if (t.poke >= 2 && t.rng === 'ranged') {
    role = 'Poke / artillery';
    roleTip = 'Whittle them down before fights. Fight from max range, then switch to protecting your team when they engage.';
  } else if (t.burst >= 3 && t.dive) {
    role = 'Assassin';
    roleTip = `Wait for ${engagers[0]?.name ?? 'your team'} to start the fight, then go after their carry once their CC is spent.`;
  } else if (t.dive && t.dps >= 3 && t.rng === 'melee') {
    const opener = [...engagers, ...tanks][0];
    role = 'Skirmisher / follow-up';
    roleTip = opener
      ? `Go in right behind ${opener.name}'s engage and hit whatever they lock down; don't be the first one in.`
      : 'Wait for their key cooldowns, then dive the target your team is already hitting.';
  } else if (t.burst >= 2 && t.rng === 'ranged') {
    role = 'Burst mage';
    roleTip = 'Hold your combo for the target who steps up or gets CC\'d; don\'t blow it on the tank.';
  } else if (t.rng === 'melee') {
    role = 'Bruiser';
    roleTip = 'Fight right behind the frontline and hit whoever is in reach; switch to protecting the backline if they dive.';
  } else {
    role = 'Damage';
    roleTip = 'Deal damage from behind your team and avoid getting caught first.';
  }

  // ---------- combos with the actual teammates ----------
  const combos = synergies
    .filter(s => s.champions.includes(me.id))
    .sort((a, b) => b.points - a.points)
    .map(s => ({ label: s.label, tip: s.tip ?? s.label, partners: s.champions.filter(id => id !== me.id) }));

  // ---------- team win condition ----------
  const full = team.filter(c => c.id > 0);
  const sum = (k: 'poke' | 'aoeCC' | 'engage' | 'frontline' | 'sustain' | 'waveclear' | 'cc') => full.reduce((s, c) => s + c.traits[k], 0);
  const ranged = full.filter(c => c.traits.rng === 'ranged').length;
  const hypercarries = full.filter(c => c.traits.hypercarry);
  const divers = full.filter(c => c.traits.dive);
  const teamPlan: string[] = [];

  if (sum('poke') >= 8 && ranged >= 3) teamPlan.push('Poke comp: chip them down at range and fight only when they are low. Don\'t take even all-ins at full HP.');
  if (sum('aoeCC') >= 7) {
    const opener = [me, ...allies].filter(c => c.traits.engage >= 3 && c.traits.aoeCC >= 2).sort((a, b) => b.traits.aoeCC - a.traits.aoeCC)[0];
    teamPlan.push(`Wombo comp: fight grouped and chain AoE CC${opener ? `; ${opener.id === me.id ? 'you open' : `${opener.name} opens`}, everyone follows on the same clump` : ''}.`);
  }
  if (hypercarries.length) {
    const carry = hypercarries.sort((a, b) => carryValue(b) - carryValue(a))[0];
    const protectors = full.filter(c => c !== carry && (c.traits.enchanter || (c.traits.frontline >= 3 && c.traits.cc >= 2)));
    if (protectors.length) teamPlan.push(`Protect the carry: play around ${carry.id === me.id ? 'you' : carry.name}. ${cap(names(protectors.map(p => p.id === me.id ? { ...p, name: 'you' } : p)))} stay close and peel.`);
  }
  if (divers.length >= 3 && sum('engage') >= 8) teamPlan.push('Dive comp: go in together on their backline, all at once. A staggered dive loses.');
  if (sum('frontline') >= 7 && sum('sustain') >= 4) teamPlan.push('Long fights favour you: you out-sustain them, so don\'t back off after the first trade.');
  if (!teamPlan.length) teamPlan.push(sum('engage') >= 6
    ? 'Teamfight comp: group up, look for an engage on clumped enemies, and focus whoever is in front.'
    : 'Skirmish comp: punish whoever walks too far forward and avoid 5v5 fights into bad angles.');

  // ---------- weaknesses ----------
  const watchOut: string[] = [];
  const maxFront = Math.max(0, ...full.map(c => c.traits.frontline));
  if (full.length >= 4) {
    if (maxFront <= 1) watchOut.push('No real tank: kite backwards, don\'t face-check bushes, and don\'t let them engage on you.');
    if (sum('engage') <= 3) watchOut.push('Little engage: let them come to you and punish their engage instead of forcing one.');
    if (sum('cc') <= 3) watchOut.push('Very little CC: focus the same target so kills actually happen.');
    if (sum('waveclear') <= 5) watchOut.push('Weak waveclear: don\'t let waves crash into your tower before fights.');
    if (sum('sustain') === 0) watchOut.push('No heals or shields: take the health relics, and take them in turn.');
    const ad = full.filter(c => c.traits.dmg === 'AD').length; const ap = full.filter(c => c.traits.dmg === 'AP').length;
    if (ad >= full.length - 0.5) watchOut.push('Full AD: they will stack armor; build armor penetration early.');
    if (ap >= full.length - 0.5) watchOut.push('Full AP: they will stack magic resist; build magic penetration early.');
  }
  if (t.rng === 'ranged' && !t.frontline && !tanks.length && !t.enchanter) watchOut.push('You are squishy with nobody in front: keep your escape for divers.');

  return {
    championId: me.id,
    role, roleTip,
    champTips: CHAMP_TIPS[me.alias] ?? [],
    combos,
    teamPlan,
    watchOut,
  };
}

/** How much a champion wants to be the team's damage focus (0..~9). */
function carryValue(c: Champion): number {
  return c.traits.dps + c.traits.burst + (c.traits.hypercarry ? 3 : 0) - (c.traits.enchanter ? 4 : 0) - (c.traits.frontline >= 3 ? 2 : 0);
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function joinNames(n: string[]): string {
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
