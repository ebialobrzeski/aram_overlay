import type { Player, TeamState } from '../shared/types';
import { CURATED } from '../shared/champion_data';

/** Fake champion select so the overlay can be developed and tested without the League client running. */
export class DemoState {
  private seed = 7;
  private state: TeamState;

  constructor() { this.state = this.generate(); }

  get(): TeamState { return this.state; }
  shuffle(): TeamState { this.seed += 1; this.state = this.generate(); return this.state; }

  /** Mimic a bench swap for the local player. */
  benchSwap(championId: number) {
    const me = this.state.players.find(p => p.isLocal)!;
    const idx = this.state.bench.indexOf(championId);
    if (idx < 0) throw new Error('Champion is not on the bench');
    this.state.bench.splice(idx, 1, me.championId);
    me.championId = championId;
    this.state = { ...this.state };
  }

  /** Mimic an accepted trade. */
  trade(cellId: number) {
    const me = this.state.players.find(p => p.isLocal)!;
    const other = this.state.players.find(p => p.cellId === cellId);
    if (!other) throw new Error('No such player');
    [me.championId, other.championId] = [other.championId, me.championId];
    this.state = { ...this.state };
  }

  private generate(): TeamState {
    const rnd = mulberry32(this.seed);
    const pool = [...CURATED].sort(() => rnd() - 0.5).map(c => c.id);
    const take = () => pool.pop()!;
    const names = ['You', 'Duo buddy', 'Teammate 1', 'Teammate 2', 'Teammate 3'];
    const players: Player[] = names.map((name, i) => ({
      cellId: i, name, championId: take(), isLocal: i === 0, isParty: i <= 1, mastery: {},
    }));
    const bench = Array.from({ length: 6 }, take);
    // give the two party members mastery on some bench/team champions so comfort picks matter
    for (const p of players.filter(p => p.isParty)) {
      for (const id of [...bench, ...players.map(x => x.championId)]) if (rnd() < 0.4) p.mastery[id] = Math.floor(rnd() * 150_000);
      p.mastery[p.championId] = Math.floor(rnd() * 60_000);
    }
    for (const p of players) {
      p.form = {}; p.historyGames = 20; p.aramGames = 0;
      for (const id of [...bench, ...players.map(x => x.championId), ...pool.slice(0, 8)]) {
        if (rnd() < 0.35) continue;
        const games = 1 + Math.floor(rnd() * 4);
        const wins = Math.round(games * (0.3 + rnd() * 0.5));
        p.form[id] = { games, wins, kills: games * Math.floor(2 + rnd() * 10), deaths: games * Math.floor(2 + rnd() * 6), assists: games * Math.floor(5 + rnd() * 15) };
        p.aramGames += games;
      }
    }
    players[0].owned = [...bench.filter(() => rnd() < 0.85), ...players.map(p => p.championId)];
    return { phase: 'ChampSelect', isAram: true, players, bench, rerollsRemaining: 2, timerMs: 60_000, connected: false, source: 'demo', message: 'Demo data (League client not connected)' };
  }
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
