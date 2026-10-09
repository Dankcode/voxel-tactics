# Fireteam mechanics reference

How the game actually plays, written from the code (2026-10-08). Where a number or rule here disagrees with another
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

## Quirks found while writing this (code behaviour, verified)

Documented on their pages; listed here so they are easy to find and fix or keep on purpose.

1. `burning` never expires: its damage tick re-applies it ([06](06-elements.md#statuses)).
2. *Resolved*: glass used to rate as cover in the readout while never stopping a projectile. It is now cosmetic
   (`projectile: 'pass'`, `shatters`): no cover, and readout and ballistics agree ([03](03-cover-and-sight.md#glass-is-cosmetic)).
3. Suppressive Fire from the HUD is a `shoot` intent with `suppress: true`: no Will is spent, and any shot can carry
   the flag ([07](07-units-and-classes.md#abilities)).
4. Shots do not require line of sight ([03](03-cover-and-sight.md#line-of-sight-battlesees-sightline)).
5. Fuel drums burn away without exploding ([05](05-destruction.md#explosive-materials)).
6. A Breaching Charge stuns (and can wound) the breaching stack ([08](08-interiors-and-breaching.md#breach)).
7. `panicked` is removed at the start of the turn it should affect, so it only halves AP
   ([06](06-elements.md#statuses)).
8. The squad autopilot's `formations: true` policy has no effect; only the sim forms up ([10](10-ai.md)).
9. Online rooms drop the `debug` flag, so debug intents are always refused online ([12](12-co-op-and-determinism.md#debug-intents)).
10. Formation declare can drive a member's AP to −1 ([09](09-formations.md#declaring-formationsvalidate-declare)).
11. Every room is lit, so the dim-room modifier never applies ([03](03-cover-and-sight.md#other-modifiers-tied-to-position)).
