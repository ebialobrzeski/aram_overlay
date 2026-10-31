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

## Badges on the League client

Besides its own window, the overlay draws small score badges directly over the League client during champion
select: one per bench champion (your delta, the best one highlighted) and one per team row (what the best plan asks
of that player, or your own best move). This is a transparent, click-through window that follows the client
window, so nothing is injected into the client.

The badge positions are found automatically: at the start of every champion select the overlay takes a
screenshot of the client window, locates the bench and team champion icons in it (template matching against the
icons from the client, in a worker thread, about a second) and derives the positions from where they are. The
result is remembered, so the badges are right from the first second of later champion selects, and it adapts if
Riot moves things. ⚙ has **Auto-calibrate now**, the per-champion-select toggle, a badge size slider, and
**Calibrate by hand** (drag *Bench 1* / *Bench 10* and *Row 1* / *Row 5* onto the client) as a fallback.
In debug mode the log reports how many icons were found and with what confidence.

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

## Download

Prebuilt Windows packages are on the [Releases page](https://github.com/ebialobrzeski/aram_overlay/releases):

- `ARAM Comp Overlay-<version>-win-x64.exe` – installer (creates a Start menu and desktop shortcut)
- `ARAM Comp Overlay-<version>-portable.exe` – single file, no installation

The executables are not code-signed, so Windows SmartScreen will warn on first launch; choose "More info" →
"Run anyway". Settings and logs live in `%APPDATA%\aram-overlay\`.

## Releasing

Bump the version in `package.json`, commit, then tag and push:

```bash
git tag v0.2.0 && git push origin main --tags
```

`.github/workflows/release.yml` runs on the **self-hosted runner on the NAS** (GitHub-hosted runners are not
available for this account): it installs dependencies, runs the tests, cross-builds the Windows installer and the
portable exe with electron-builder, and attaches both to the GitHub release of the tag.

Fallback when the runner is down: `make release TAG=v0.2.0` builds on the NAS over SSH and publishes the same
files (setup in [deploy/nas/README.md](deploy/nas/README.md)). Local build only: `npm run package` → `release/`.
