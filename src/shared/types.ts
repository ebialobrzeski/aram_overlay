export type DamageType = 'AD' | 'AP' | 'mixed';
export type RangeType = 'melee' | 'ranged';

/** Hand-curated composition traits, each 0..3. */
export interface ChampionTraits {
  cc: number;        // hard crowd control amount / reliability
  aoeCC: number;     // multi-target hard CC (teamfight)
  engage: number;    // ability to start a fight
  poke: number;      // long range harass
  frontline: number; // durability / tankiness
  sustain: number;   // team healing / shielding (self-sustain counts a little)
  burst: number;     // one-shot potential
  dps: number;       // sustained damage
  waveclear: number; // important in ARAM
  airborne: number;  // provides knock-ups / knock-backs / pulls (Yasuo R setup)
  aoeDmg: number;    // teamfight AoE damage
  dmg: DamageType;
  rng: RangeType;
  hypercarry: boolean; // scales hard with protection
  enchanter: boolean;  // buffs / protects an ally
  dive: boolean;       // reaches the backline (Orianna ball carrier, Galio/Taric R target)
  channelUlt: boolean; // channelled / stationary ultimate that wants lockdown (Katarina, Miss Fortune, Nunu...)
  allyUlt: boolean;    // ally-targeted follow-up ultimate (Galio, Taric, Shen, Kayle, Zilean)
}

export const NUMERIC_TRAITS = [
  'cc', 'aoeCC', 'engage', 'poke', 'frontline', 'sustain', 'burst', 'dps', 'waveclear', 'airborne', 'aoeDmg',
] as const;
export type NumericTrait = typeof NUMERIC_TRAITS[number];

export interface Champion {
  id: number;
  alias: string; // Data Dragon id, e.g. "MonkeyKing"
  name: string;
  traits: ChampionTraits;
  /** false when traits were derived from tags only (champion missing from the curated table) */
  curated: boolean;
}

/** Per-champion record from recent ARAM games. */
export interface ChampForm { games: number; wins: number; kills: number; deaths: number; assists: number }

export interface Player {
  cellId: number;
  name: string;
  championId: number;
  isLocal: boolean;
  /** true for me and the people in my pre-made party: the only people who will coordinate */
  isParty: boolean;
  puuid?: string;
  summonerId?: number;
  /** championId -> mastery points (empty when unknown) */
  mastery: Record<number, number>;
  /** owned champion ids; undefined = unknown */
  owned?: number[];
  /** championId -> recent ARAM record; undefined = history not available */
  form?: Record<number, ChampForm>;
  /** how many recent games were scanned and how many of them were ARAM */
  historyGames?: number;
  aramGames?: number;
}

export interface TeamState {
  phase: string;           // LCU gameflow phase: ChampSelect, Lobby, InProgress, None...
  isAram: boolean;
  players: Player[];       // my team, in cell order (up to 5)
  bench: number[];         // championIds currently on the shared bench
  rerollsRemaining: number;
  timerMs?: number;
  connected: boolean;
  source: 'lcu' | 'demo';
  message?: string;
}

export interface Weights {
  cc: number; aoeCC: number; engage: number; poke: number; frontline: number; sustain: number;
  burst: number; dps: number; waveclear: number; aoeDmg: number;
  dmgBalance: number;  // reward AD/AP mix
  rangeMix: number;    // reward 2-4 ranged
  rangedCount: number; // reward more ranged (poke comps)
  hasTank: number;     // reward having at least one real frontliner
  synergy: number;     // ultimate / kit combos
  mastery: number;     // comfort picks of party members
}

export interface Settings {
  profile: string;
  weights: Weights;
  includeNonPartyTrades: boolean;
  assumePartyOwnsAll: boolean;
  /** lines "Name: Champ, Champ" used when mastery for a party member cannot be fetched */
  comfortOverrides: string;
  topPlans: number;
  opacity: number;
  compact: boolean;
}

export interface SynergyHit {
  label: string;      // e.g. "Malphite R → Yasuo R"
  champions: number[];
  points: number;
}

export interface TeamScore {
  total: number;
  breakdown: Record<string, number>; // term -> weighted contribution
  synergies: SynergyHit[];
  aggregates: Record<NumericTrait, number>;
  warnings: string[];
}

export type PickSource = 'current' | 'bench' | 'trade' | 'ask';

export interface PickOption {
  championId: number;
  source: PickSource;
  fromCellId?: number;      // for trade/ask: who holds it now
  score: number;
  delta: number;            // vs. current team
  owned: boolean | undefined;
  masteryPoints: number;
  form?: ChampForm;         // my recent ARAM record on this champion
  partnerForm?: ChampForm;  // for trades: the partner's record on the champion they would receive (mine)
  synergies: SynergyHit[];
  tags: string[];           // short descriptors: "CC", "Poke", ...
}

export interface PlanStep {
  cellId: number;
  kind: 'bench' | 'trade';
  championId: number;        // what the player ends up with after this step
  withCellId?: number;       // trade partner
  needsAsk?: boolean;        // partner is not in the party
}

export interface Plan {
  assignment: number[];      // championId per player index
  score: TeamScore;
  delta: number;
  steps: PlanStep[];
  unverifiedOwnership: number[]; // cellIds whose ownership of the assigned champ is assumed
}

export interface GoalSuggestion {
  profile: string;
  label: string;
  fit: number;         // 0..10-ish: how well the reachable pool supports this goal
  bestDelta: number;   // improvement available under this goal vs the current picks
  highlights: string[]; // the terms that carry the fit, e.g. ["Poke", "Waveclear"]
}

export interface FormEntry { championId: number; comfort: number; mastery: number; form?: ChampForm }
export interface TeamFormEntry {
  cellId: number; name: string; isLocal: boolean; isParty: boolean;
  historyGames: number; aramGames: number; hasHistory: boolean;
  top: FormEntry[];
}

export interface Analysis {
  current: TeamScore;
  teamForm: TeamFormEntry[];
  myPicks: PickOption[];
  plans: Plan[];
  goalSuggestions: GoalSuggestion[]; // sorted best fit first
  effectiveProfile: string;          // profile actually used (resolved when profile is "auto")
  champions: Record<number, { name: string; alias: string; curated: boolean }>;
  computedAt: number;
}

export interface UpdatePayload {
  state: TeamState;
  analysis: Analysis | null;
  settings: Settings;
  icons: Record<number, string>;
  lcuStatus: string;
  demo: boolean;
  /** true while showing the final champion select of a game that is already running (actions disabled) */
  frozen: boolean;
}
