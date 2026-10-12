# Test ground and after-action reports

Admin tooling for trying battle scenarios: run any map with a chosen squad and hostile roster, then read a
structured report of what happened. Everything is deterministic from the scenario descriptor, so a setup replays
identically, can be shared as a link, hosted online, or rerun headless in the sim.

## Scenario descriptor

The menu, links, online rooms and the sim all produce the same descriptor (`shared/session/Scenarios.js`):

```js
{ scenario: 'main-street' | 'operation' | …, seed, squad: ['vanguard', 'marksman', …] | 'standard',
  operation?: { plot, objective, timeOfDay },            // generated operations only
  test?: {                                               // shared/session/TestGround.js
    enemies: [{ type: 'cultist', count: 4 }, …] | null,  // null keeps the map's own pods
    podSize: 1–4, alerted: bool, objective: 'map' | 'eliminate',
    rounds: 3–60 | null,                                  // deadline: the mission fails at the end of that round
    timeOfDay: 'day' | 'dawn' | 'dusk' | 'overcast' | 'night' | 'night-ops' | null } }
```

`sanitizeDesc` validates it (unknown types, more than 12 of a type, more than 24 hostiles or none are refused;
pod size and deadline are clamped). `createBattle` applies the test settings to the compiled mission on every peer
and on the server, so co-op hashes still agree; the map itself is never rebuilt.

## Hostile placement

Rosters are dealt round-robin across types into mixed pods of `podSize`. Pod anchors, in order: the map's own pod
positions, then engagement pockets and gameplay rooms (shuffled by the seed), then the reachable cells farthest from
the squad. Members take the nearest free cells around their anchor (same storey first). Every hostile stands on a
cell the squad can reach, at least 10 tiles from every squad spawn, never on a doorway or ladder, never sharing a
cell, facing the squad. *Alerted* hostiles start awake and skip the first-contact scatter. When a map cannot hold
the roster the setup is refused with the number that fits.

## After-action report

`battleReport(battle, desc)` (`shared/session/BattleReport.js`) derives everything from the battle's event log and
final unit state, with no clock or DOM, so the client, the sim and the tests share it.

| Block | Contents |
|---|---|
| `outcome` | winner, reason, rounds, first-contact round |
| `objective` | kind, live status line, deadline, hold/extract/recover progress |
| `totals.player` / `totals.enemy` | units, standing, losses, kills, shots and shots that hit, accuracy, damage dealt / taken, friendly fire, HP left, reaction shots |
| `squad[]` / `hostiles[]` | per unit: status (unhurt, wounded, down, killed, extracted), HP, kills and who killed it in which round, shots / projectiles hit, melee, reactions, damage dealt / taken / friendly / environmental, moves and tiles, overwatch, reloads, doors kicked, breaches, heals, abilities and items used, statuses, disabled limbs |
| `enemyTypes[]` | per hostile type: count, down, standing, damage dealt and taken |
| `weapons[]` | per side and weapon: shots, shots that hit, projectiles hit, damage, kills |
| `environment` | voxels destroyed, fires, breaches, doors kicked, collapses, reaction shots, drops, underground and flank steps |
| `timeline[]` | first contact, breaches, disabled limbs, every death with killer and weapon or grenade, objective events, the outcome |

Accuracy counts a shot as a hit when any projectile struck an opposing unit; projectile hits are listed
separately (a shotgun blast is one shot of eight projectiles). Damage is the amount after armour, so a killing blow
can exceed the HP that was left. Friendly fire includes self-inflicted damage (an Arsonist caught in its own fire).

The client shows the report after every battle, saves the last 20 in the browser (`localStorage`, best effort) and
offers *Copy summary* (`reportText`) and *Download JSON*. A downloaded report can be rerun headless with
`npm run sim -- --setup report.json`.
