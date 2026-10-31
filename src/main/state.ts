import type { ChampForm, Player, TeamState } from '../shared/types';
import type { Lcu } from './lcu';
import { log } from './log';

interface Session {
  benchEnabled?: boolean;
  benchChampions?: { championId: number }[];
  myTeam?: { cellId: number; championId: number; summonerId?: number; puuid?: string; nameVisibilityType?: string; gameName?: string; summonerName?: string }[];
  localPlayerCellId?: number;
  rerollsRemaining?: number;
  timer?: { adjustedTimeLeftInPhase?: number };
  trades?: { id: number; cellId: number; state: string }[];
}
interface Lobby { members?: { puuid?: string; summonerId?: number; gameName?: string; summonerName?: string }[]; gameConfig?: { queueId?: number } }
interface Summoner { summonerId: number; puuid: string; gameName?: string; displayName?: string }
interface Mastery { championId: number; championPoints: number }
interface HistoryGame {
  gameId?: number; queueId?: number; gameMode?: string;
  participants?: { participantId?: number; championId: number; stats?: { win?: boolean; kills?: number; deaths?: number; assists?: number } }[];
  participantIdentities?: { participantId?: number; player?: { puuid?: string } }[];
}
interface History { games?: { games?: HistoryGame[]; gameCount?: number } }
interface FormResult { form: Record<number, ChampForm>; historyGames: number; aramGames: number }

// The client only exposes a player's 20 most recent games (begIndex/endIndex are ignored), so one request per player.
const HISTORY_TARGET = 20;
const HISTORY_PAGE = 20;

const ARAM_QUEUES = new Set([450, 100, 2400, 1300]); // ARAM, Butcher's Bridge, ARAM mayhem-ish, Nexus Blitz (bench)

/** Pulls everything the analysis needs from the League client, with light caching for slow-changing data. */
export class StateBuilder {
  private me: Summoner | null = null;
  private masteryCache = new Map<string, { at: number; data: Record<number, number> }>();
  private formCache = new Map<string, { at: number; data: FormResult | null }>();
  private pickable: { at: number; ids: number[] } | null = null;
  lastSession: Session | null = null;
  /** last raw client responses, dumped to the debug snapshot */
  raw: Record<string, unknown> = {};

  constructor(private lcu: Lcu) {}

  async build(): Promise<TeamState> {
    const phase = (await this.lcu.getOrNull<string>('/lol-gameflow/v1/gameflow-phase')) ?? 'None';
    this.raw.phase = phase;
    const empty: TeamState = { phase, isAram: false, players: [], bench: [], rerollsRemaining: 0, connected: true, source: 'lcu' };
    if (phase !== 'ChampSelect') { this.lastSession = null; return empty; }

    const session = await this.lcu.getOrNull<Session>('/lol-champ-select/v1/session');
    if (!session?.myTeam) return { ...empty, message: 'Champion select session not readable yet' };
    this.lastSession = session;
    this.raw.session = session;

    const [me, lobby] = await Promise.all([this.currentSummoner(), this.lcu.getOrNull<Lobby>('/lol-lobby/v2/lobby')]);
    this.raw.lobby = lobby; this.raw.me = me;
    const queueId = lobby?.gameConfig?.queueId ?? -1;
    const isAram = !!session.benchEnabled || ARAM_QUEUES.has(queueId);
    const partyPuuids = new Set((lobby?.members ?? []).map(m => m.puuid).filter(Boolean) as string[]);
    const lobbyKnown = !!lobby?.members;
    log.debug(`party detection: lobby ${lobbyKnown ? `has ${partyPuuids.size} member(s)` : 'not readable'}; myTeam visibility: ${session.myTeam.map(m => `${m.cellId}=${m.nameVisibilityType ?? '?'}`).join(' ')}`);
    const partyNames = new Map((lobby?.members ?? []).map(m => [m.puuid ?? '', m.gameName || m.summonerName || '']));

    let hiddenIdx = 1;
    const players: Player[] = [];
    for (const m of session.myTeam) {
      const isLocal = m.cellId === session.localPlayerCellId;
      // The lobby lists exactly the premade group. Visible names are only a fallback, because some queues show every name.
      const isParty = isLocal || (!!m.puuid && partyPuuids.has(m.puuid)) || (!lobbyKnown && m.nameVisibilityType === 'VISIBLE');
      const name = isLocal ? (me?.gameName || me?.displayName || 'You')
        : (m.puuid && partyNames.get(m.puuid)) || m.gameName || m.summonerName || (isParty ? `Party ${m.cellId}` : `Teammate ${hiddenIdx++}`);
      const player: Player = { cellId: m.cellId, name, championId: m.championId, isLocal, isParty, puuid: m.puuid, summonerId: m.summonerId, mastery: {} };
      // mastery and recent ARAM form for everyone: party members drive comfort picks, strangers inform trades
      player.mastery = await this.mastery(m.puuid, m.summonerId);
      if (m.puuid) {
        const f = await this.aramForm(m.puuid);
        if (f) { player.form = f.form; player.historyGames = f.historyGames; player.aramGames = f.aramGames; }
      }
      if (isLocal) player.owned = await this.pickableIds(me?.summonerId);
      players.push(player);
    }

    return {
      phase, isAram, players,
      bench: (session.benchChampions ?? []).map(b => b.championId).filter(id => id > 0),
      rerollsRemaining: session.rerollsRemaining ?? 0,
      timerMs: session.timer?.adjustedTimeLeftInPhase,
      connected: true, source: 'lcu',
      message: isAram ? undefined : 'Not an ARAM-style queue (no bench)',
    };
  }

  private async currentSummoner(): Promise<Summoner | null> {
    if (!this.me) this.me = await this.lcu.getOrNull<Summoner>('/lol-summoner/v1/current-summoner');
    return this.me;
  }

  private async mastery(puuid?: string, summonerId?: number): Promise<Record<number, number>> {
    const key = puuid || (summonerId ? `sid:${summonerId}` : '');
    if (!key) return {};
    const cached = this.masteryCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.data;
    let list: Mastery[] | null = null;
    if (puuid) list = await this.lcu.getOrNull<Mastery[]>(`/lol-champion-mastery/v1/${puuid}/champion-mastery`);
    if (!list && summonerId) list = await this.lcu.getOrNull<Mastery[]>(`/lol-collections/v1/inventories/${summonerId}/champion-mastery`);
    this.raw[`mastery:${key}`] = list === null ? 'unavailable' : `${list.length} entries`;
    const data: Record<number, number> = {};
    for (const m of list ?? []) data[m.championId] = m.championPoints;
    this.masteryCache.set(key, { at: Date.now(), data });
    return data;
  }

  /** Recent ARAM record per champion from the client's own match history (works for any player). */
  private async aramForm(puuid: string): Promise<FormResult | null> {
    const cached = this.formCache.get(puuid);
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.data;
    const form: Record<number, ChampForm> = {};
    let historyGames = 0, aramGames = 0, ok = false;
    for (let beg = 0; beg < HISTORY_TARGET; beg += HISTORY_PAGE) {
      const res = await this.lcu.getOrNull<History>(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=${beg}&endIndex=${beg + HISTORY_PAGE - 1}`);
      const games = res?.games?.games;
      if (!games) break;
      ok = true;
      for (const g of games) {
        historyGames++;
        if (!(g.gameMode === 'ARAM' || ARAM_QUEUES.has(g.queueId ?? -1))) continue;
        const pid = g.participantIdentities?.find(i => i.player?.puuid === puuid)?.participantId;
        const p = (pid !== undefined ? g.participants?.find(x => x.participantId === pid) : undefined) ?? g.participants?.[0];
        if (!p?.championId) continue;
        aramGames++;
        const f = form[p.championId] ?? (form[p.championId] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 });
        f.games++; if (p.stats?.win) f.wins++;
        f.kills += p.stats?.kills ?? 0; f.deaths += p.stats?.deaths ?? 0; f.assists += p.stats?.assists ?? 0;
      }
      if (games.length < HISTORY_PAGE) break;
    }
    const data = ok ? { form, historyGames, aramGames } : null;
    this.raw[`history:${puuid.slice(0, 8)}`] = ok ? `${historyGames} games, ${aramGames} ARAM, ${Object.keys(form).length} champions` : 'unavailable';
    log.debug(`ARAM form ${puuid.slice(0, 8)}: ${this.raw[`history:${puuid.slice(0, 8)}`]}`);
    this.formCache.set(puuid, { at: Date.now(), data });
    return data;
  }

  /** What the local player is allowed to pick (owned + free rotation), straight from champ select. */
  private async pickableIds(summonerId?: number): Promise<number[] | undefined> {
    if (this.pickable && Date.now() - this.pickable.at < 60_000) return this.pickable.ids;
    let ids = await this.lcu.getOrNull<number[]>('/lol-champ-select/v1/pickable-champion-ids');
    if (!ids && summonerId) {
      const inv = await this.lcu.getOrNull<{ id: number; ownership?: { owned?: boolean }; freeToPlay?: boolean }[]>(`/lol-champions/v1/inventories/${summonerId}/champions-minimal`);
      if (inv) ids = inv.filter(c => c.ownership?.owned || c.freeToPlay).map(c => c.id);
    }
    this.raw.pickable = ids ? `${ids.length} ids` : null;
    if (!ids) return undefined;
    this.pickable = { at: Date.now(), ids };
    return ids;
  }

  /** Actions on the live champ select. */
  benchSwap(championId: number) { return this.lcu.post(`/lol-champ-select/v1/session/bench/swap/${championId}`); }

  async requestTrade(cellId: number) {
    const trades = this.lastSession?.trades ?? (await this.lcu.getOrNull<Session['trades']>('/lol-champ-select/v1/session/trades')) ?? [];
    const trade = trades.find(t => t.cellId === cellId);
    if (!trade) throw new Error('No trade slot for that player');
    return this.lcu.post(`/lol-champ-select/v1/session/trades/${trade.id}/request`);
  }
}
