# ARAM Comp Overlay

Always-on-top window for League of Legends ARAM champion select. It reads the live champion select from the
League client, scores the team composition, and tells you:

- **Your best picks** – every champion you can get right now (your pick, the bench, trades with your party),
  ranked by how much it improves the team for the selected goal.
- **Team plans** – the best coordinated set of bench swaps and trades for you and the people in your pre-made
  party (solo / duo / any stack). Players outside the party are left alone, unless you enable "ask" trades.
- **Ultimate / kit combos** – generic rules reward any knock-up with Yasuo, any AoE lockdown with channelled or
  AoE ultimates, enchanters with hypercarries, engage with Orianna, Galio/Taric/Shen follow-ups, and so on.
- **Comfort picks** – mastery points of you and your party members are read from the client, so plans prefer
  champions each person is strong on.

## Run

```bash
npm install
npm start
```

Start it any time; it connects automatically when the League client is running and shows data in champion select.
To try it without the client:

```bash
npm run demo
```

Tests:

```bash
npm test
```

## How it works

| Piece | File |
| --- | --- |
| Champion traits (CC, engage, poke, frontline, sustain, burst, DPS, waveclear, knock-ups, AoE, AD/AP, range, flags) | `src/shared/champion_data.ts` |
| Combo rules | `src/shared/synergies.ts` |
| Composition score and goal profiles | `src/shared/scoring.ts` |
| Optimizer: enumerates what the party can arrange and ranks it | `src/shared/analysis.ts` |
| League client (LCU) discovery and REST calls | `src/main/lcu.ts` |
| Champ select / lobby / mastery / ownership reading | `src/main/state.ts` |
| Electron window, polling, IPC, icons | `src/main/main.ts` |
| UI | `src/renderer/` |

The team score is a weighted sum of team totals per trait (with diminishing returns), balance terms (AD/AP mix,
ranged/melee mix, having a real tank), combo points and comfort points. Goal profiles (Balanced, Max CC,
Poke / Range, Frontline / Tank, Wombo Combo, Protect the Carry) are just weight presets; every weight can be
adjusted with the sliders in ⚙.

**Auto goal (default).** ARAM is random, so the overlay does not assume a goal. For every goal profile it
evaluates the best composition you and your party could reach from the current team plus bench, and rates how well
that composition delivers the terms the goal emphasises (0..10 "fit"). The best fit is used for the rankings and
all fits are shown as chips under the goal selector; click a chip or pick a goal in the dropdown to override.
Touching a weight slider switches to custom weights.

Who counts as "party": you, everyone in your lobby, and any teammate whose name the client shows (the client only
reveals names of premades). Plans only reassign those players. Ownership of bench champions is known exactly for
you (from the client) and assumed for party members unless their mastery says otherwise; such plans are marked.

If a friend's mastery cannot be read, list their comfort picks in ⚙: `Name: Ahri, Lux, Morgana`.

**Teammates' best.** For every player on your team the overlay reads champion mastery and the 20 most recent
games from the client (that is all the client exposes per player, no Riot API key needed), keeps the ARAM games, and
builds a per-champion record: games, win rate, KDA. Comfort = mastery blended with that recent ARAM form. Party
members' comfort feeds the plans; everyone's top champions are shown in the "Teammates' best" card, with a green
border when the champion is currently on the bench or in the team. Trade rows also show what the other player has
done on the champion they would receive.

## Notes and limits

- The trait table is hand-curated and opinionated; tweak numbers in `champion_data.ts` to taste. Champions
  missing from the table get rough traits from their role tags and are marked "approx." in the UI.
- Trades with non-party teammates need their acceptance; they are off by default.
- The window is always on top and remembers its position. Drag it by the title bar.
- Settings live in `%APPDATA%/aram-overlay/settings.json`.

## Debug mode

```bash
npm run debug
```

Writes two files to `%APPDATA%\aram-overlay\` (the exact path is printed on startup):

- `debug.log` – every client request with status and timing, client discovery, each champion select state
  change with the party/ownership/mastery detection, the analysis summary, and every swap/trade action.
- `debug-lcu-snapshot.json` – the latest raw champion select session, lobby, summoner, mastery availability and
  pickable-champion responses next to the computed state and analysis. Share these two files to debug a wrong
  party detection, missing bench champion, or odd ranking.

## Troubleshooting

- **`Electron failed to install correctly`** – npm skipped Electron's install script, or the extractor failed.
  Run:

  ```bash
  powershell -ExecutionPolicy Bypass -File scripts/fix-electron.ps1
  ```

- **Overlay stays on "League client not running"** – the client is found through the `LeagueClientUx.exe`
  command line or the `lockfile` in the install folder. Set `LCU_LOCKFILE` to the lockfile path if the client
  is installed somewhere unusual.
- **Friends show no mastery** – the client does not always expose other players' mastery; use the comfort pick
  overrides in ⚙.
