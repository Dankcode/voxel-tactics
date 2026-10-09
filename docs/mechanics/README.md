# Fireteam mechanics reference

How the game actually plays, written from the code (2026-10-09). Where a number or rule here disagrees with another
doc, the code wins and this page should match it. Every rule cites where it lives as `file:function`.

## Design pillars

**XCOM 2 on top, Phoenix Point underneath.** Side phases, pods that wake on sight or noise, half / full cover shields,
flanking, overwatch, grenades and breaching come from XCOM 2; a 4-AP pool, free aim at body parts and real
ballistic rays inside an accuracy cone come from Phoenix Point. Cover is never a dice modifier: walls stop the rays
that hit them, and the hit chance is a Monte Carlo of the same tracer. **The destructible voxel grid is the
gameplay truth**: movement, line of sight, cover, ballistics, fire and collapse all run on it, while walls, low
cover and openings use thin *connected shapes* (0.4-wide wall modules, banded sandbags and hedges, glass panes) that
rays and the cover readout respect and the renderer draws exactly. **Elements** live on the voxels: fire spreads and
burns things down, water douses, cold freezes water into walkable ice, wind fans fire and clears smoke, concussion
cracks stone. **Interiors** are generated from room programs and fought through room by room with reveal, noise and
a group **breach**. **Formations** give a held shape a bonus at a cost, countered by the "clustered" blast rule.
**Co-op** is deterministic lockstep: a seed, a map id and an ordered intent list reproduce the whole battle.

## Pages

| File | Covers |
|---|---|
| [01-turn-flow.md](01-turn-flow.md) | sides and rounds, start-of-turn order, AP costs per intent, blue/yellow zones, end turn and auto end, pods, alerting and noise, reveal, objectives (eliminate / extract / recover / hold) and outcome reasons |
| [02-movement.md](02-movement.md) | grid and surfaces, path cost, step heights, vaulting, jumping down (stagger), ladders, step kinds, AP conversion, stairs, doors, wading, ice, deep water |
| [03-cover-and-sight.md](03-cover-and-sight.md) | cover readout per face and along the line of fire, half/full thresholds, flanking, connected shapes, glass (cosmetic), concealment, line of sight, fog of war, smoke, height |
| [04-ballistics-and-weapons.md](04-ballistics-and-weapons.md) | aiming and leaning, the spread formula, hitboxes, hit chance, damage and armour, overwatch, calibers (ammunition), weapon / melee / armour / throwable tables, grenade arcs and scatter, blast damage |
| [05-destruction.md](05-destruction.md) | voxel HP, damage sources, element multipliers, debris, explosions and chains, explosive materials, collapse, falling and knockback |
| [06-elements.md](06-elements.md) | element ids, what each element does, surfaces, the round tick, statuses and their real durations |
| [07-units-and-classes.md](07-units-and-classes.md) | squad classes and Syndicate stats (30 HP each), body parts, armour, abilities as coded, items, stress and breakdown, Will |
| [08-interiors-and-breaching.md](08-interiors-and-breaching.md) | rooms, doors, reveal, indoor noise, breach points, validation and resolution, surprise, charges |
| [09-formations.md](09-formations.md) | templates, declaring, cohesion tiers, bonuses and costs, static decay, group moves, dissolution, the clustered counter |
| [10-ai.md](10-ai.md) | who runs the AI, the decision order, squad objective handling, shot value, tile scoring, autoplay and sim formations |
| [11-maps-and-level-design.md](11-maps-and-level-design.md) | map registry, per-map objectives and the objective spec, build pipeline, ladders, cover pass and catalogues, spawns and spawn safety, design gates (links `docs/LEVELS.md`) |
| [12-co-op-and-determinism.md](12-co-op-and-determinism.md) | determinism contract, intents, the Colyseus room, seats, end-turn votes, hashes, debug intents, cheat-proofing |
| [13-materials.md](13-materials.md) | every material with its flags, cover class and connected shape |

## Where rules live

```
shared/battle/Battle.js        turn flow, AP, every intent, overwatch, breach, damage, stress, noise, reveal, falls, outcome, hash
shared/battle/Objectives.js    objective kinds, zones, HUD status line, squad AI goal
shared/battle/Ballistics.js    hitboxes, muzzle / lean, cone sampling, projectile trace, hit-chance Monte Carlo
shared/battle/Units.js         unit creation, accuracy and mobility multipliers, armour, status add rules
shared/battle/Formations.js    formation validation, cohesion, bonuses, clustered rule
shared/battle/Ai.js            enemy AI, squad autopilot, sim driver
shared/battle/DebugOps.js      debug intents
shared/content/*.js            calibers, weapons, throwables, armour, classes, enemies, abilities, formations, balance tunables (B.*)
shared/voxel/                  VoxelStore (grid, surfaces, rooms), Materials, ConnectedShapes, Raycast, Cover, Destruction
shared/world/                  PathSearch (Dijkstra, vaulting, jumps, ladders, step kinds), TraversalRules (steps, costs), StairRun
shared/elements/Elements.js    element field (fire, surfaces, smoke), statuses, element → status
shared/mission/                map registry and builders, MapKit, ModernBuilder, cover pass, spawns, metrics and gates
shared/session/Scenarios.js    descriptor → mission → battle
server/src/MissionRoom.js      lockstep room: ordering, seats, votes, server-side enemy turn
client/src/net/                LocalSession (hot-seat), OnlineSession (lockstep client)
client/src/Game.js             player-facing flow: zones, targeting, auto next / auto end, local AI turns, controls
```

## Generated tables

Tables marked `<!-- generated:<name> -->` (calibers, weapons, melee, throwables, armour, body parts, units, abilities,
squads, statuses, formations, element multipliers, materials, gates, prop catalogues, maps) come from
`tools/docs/gen_mechanics_tables.mjs`, which imports the shared modules:

```bash
node tools/docs/gen_mechanics_tables.mjs            # print every table
node tools/docs/gen_mechanics_tables.mjs weapons    # print one (--list for names)
node tools/docs/gen_mechanics_tables.mjs --write    # refresh every generated block in docs/mechanics/ in place
```

Re-run `--write` after changing `shared/content/*.js`, `Materials.js`, `ConnectedShapes.js`, the prop catalogues,
the gates or a map. The hand-written rule text around the tables is not regenerated; check it when rules change.

## Mechanics corrections (2026-10-09)

The eleven issues identified by the original mechanics audit are now addressed:

1. Burning damage ticks do not reapply burning; it expires after two own-turn ticks unless another fire refreshes it.
2. Glass is cosmetic: no cover, never stops shots, sight or arcs; a pane a bullet crosses still breaks ([03](03-cover-and-sight.md#glass-is-cosmetic)).
3. Suppressive Fire uses the ability intent and pays 2 AP, 2 Will and 3 rounds of ammunition.
4. Unit-targeted shots require squad sight. Free aim remains available for shooting terrain and cover.
5. Fuel drums destroyed by fire queue their material explosion, including chain reactions.
6. A charge breach protects its participants from the initial charge blast; defender reactions, falls and chained explosions remain dangerous.
7. Panic remains active throughout the affected own turn. Freezing and suppression also retain their final turn's effects.
8. Client autopilot and the simulator share the same pure formation-intent planner.
9. Online rooms preserve explicit debug opt-in; only their original host (P1) may submit debug intents.
10. Formation alignment requires AP whenever a member must relocate; duplicate members and invalid leaders are rejected.
11. Warehouse interiors can be dim; building specs can override lighting by room kind or for the whole building.

Co-op additionally checks ownership of every group-action participant, and its hash includes voxel HP,
ammo, items, Will, statuses, formations, turn state, reveal state and RNG state. Regression coverage is in
`shared/battle/mechanics.test.js` and `server/test/room.test.js`.
