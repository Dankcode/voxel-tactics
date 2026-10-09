# 11 · Maps and level design

How maps are built and what they must satisfy. The authoring guide (MapKit API, building programs, glazing,
furniture, resource requirements) is `docs/LEVELS.md`; this page covers the rules and numbers the code enforces or
measures. Code: `shared/mission/Maps.js`, `modern/MapKit.js`, `modern/ModernBuilder.js`, `CoverScatter.js`,
`PropCatalog.js`, `MissionCommon.js`, `MissionMetrics.js`, `shared/session/Scenarios.js`.

## Registry

`Maps.MAPS` lists every playable map (id, name, theme, one-line text, build function); the menu, the server
(`Scenarios.scenarioId` falls back to `DEFAULT_MAP` = `cedar-close`), the sim and `npm run mission:report` read it.
A map is rebuilt from `(id, seed)` on every peer; its RNG is `createRng(hashString(`${id}:${seed}`))`.

Measured on seed 1:

<!-- generated:maps -->
| id | name | theme | size W×D×H | buildings | rooms | enemies | pods | lighting | cover density | cover gap | killing field | sightline median | lanes | breachability | spawn safe | gates (seed 1) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `cedar-image` | Cedar Close · Image Study | Suburbs | 48×40×12 | 2 | 8 | 4 | 2 | dusk | 45% | 5 | 4 | 9.8 | 4 | 100% | yes | PASS |
| `cedar-close` | Cedar Close | Suburbs | 48×40×12 | 2 | 8 | 7 | 4 | day | 47% | 4 | 5 | 6.3 | 4 | 100% | yes | PASS |
| `main-street` | Main Street | Downtown | 52×42×14 | 4 | 17 | 8 | 4 | dusk | 46% | 4 | 6 | 8.4 | 4 | 94% | yes | PASS |
| `harbor-yard` | Harbor Yard | Industrial | 54×44×14 | 2 | 5 | 8 | 4 | night | 36% | 6 | 6 | 7.0 | 2 | 100% | yes | PASS |
| `route-9` | Route 9 Stop | Roadside | 52×42×12 | 2 | 6 | 7 | 4 | dawn | 35% | 5 | 5 | 10.5 | 4 | 100% | yes | PASS |
| `proving-grounds` | Training Facility | Training | 60×46×16 | 4 | 17 | 9 | 5 | overcast | 39% | 5 | 5 | 8.5 | 4 | 76% | yes | PASS |
<!-- /generated:maps -->

Every map fights the Syndicate. `lighting` and `defaultCut` (storey cutaway 4) in `meta` are presentation only.

## Objectives

Each builder passes an `objective` spec to `finish`; rules and outcomes are in
[01](01-turn-flow.md#objectives-and-outcome).

| Map | Kind | Spec |
|---|---|---|
| Cedar Close | `eliminate` | clear the safehouse |
| Main Street | `hold` | zone x 22–29, y 17–22 (the junction in front of the diner, any height), `rounds: 4` |
| Harbor Yard | `extract` | zone x 21–30, y 4–5 (the quay, any height), `needed: 2` |
| Route 9 Stop | `recover` | item `Cash bag` in `room: { building: 'motel', kind: 'unit', index: 3 }` (the last of the motel's four units; the Riot Guard and Gunman of pod 2 start in units 2 and 3); `zone: 'spawn'` (x 1–8, y 35–39: carry it back to the arrival area on the highway) |
| Training Facility | `eliminate` | live-fire exercise |

Spec format (`Objectives.js`, resolved by `MissionCommon.resolveObjective`):
`{ kind, text, zone?, item?, rounds?, needed?, turns? }`.

- `zone`: `{ x0, y0, x1, y1, z?, dz? }` (inclusive), or `'spawn'`: the bounding box of the squad spawn points grown by
  one cell, no `z`. A zone must contain at least one cell the squad can reach from its first spawn point, or the
  build throws.
- `item`: `{ x, y, z?, label }` (snapped to the surface; must be reachable) or `{ room: { building, kind?, index?,
  storey? }, label }`: a random reachable free floor cell of that room (picked with the map RNG; the resolved item
  also records `building` and `roomId`). The build throws when no such cell exists. The item's cell is marked
  occupied, so no enemy spawns on it. `label` defaults to `Package`.
- Specs with kind `eliminate` (or none) pass through unchanged.

## Build pipeline (`MapKit.createMap` → `finish`)

1. Bedrock at z = 0, the theme ground at z = 1 (`ground`), roads, kerbs, paths.
2. Buildings (`m.building` → `ModernBuilder.buildModern`): a **program** (house, townhouse, bungalow, shop, diner,
   station, warehouse, garage, motel, office, bunker, tower) laid out as rows of rooms from the front to the back,
   1-voxel partitions, storeys of 3 (slab + 2), up to 3 storeys. Door rules: an exterior entry (+ back and side
   doors from the program's lists); interior doors along a spanning tree over room adjacency, then extra doors until
   rooms have two ways in; open-plan pairs get a 2-wide air opening; no door on a partition junction. Stairs:
   straight rise-3 runs keeping both floors connected. Furniture is capped at 38 % of a room's cells and may never
   split the floor into more pieces (`components` guard); door fronts and stair landings stay clear. Glazing per
   room kind. Each building's door approaches (2 cells out) are reserved from scattered cover.
3. Hand-placed objects: cars (4 × 2 `car_body`, `car_cabin` on the middle two rows: half cover at the ends, full in
   the middle), containers (5 × 2 × 2, hp 20, walkable on top), dumpsters, trees (trunk + leaves), hedges, lines of
   any material, fuel drums and pumps, ladders (`m.ladder`: a `ladder` column against a ledge at least 2 high,
   3×3 reserved from the cover pass; [02](02-movement.md#ladders)). Harbor Yard has three, up container stacks at
   (15, 24), (19, 26) and (45, 30).
4. **Cover pass** (`m.scatter` → `CoverScatter.scatterCover`), see below.
5. `finish` → `MissionCommon.finalizeMission`: spawns, reachability, spawn safety, metrics.

## Outdoor cover pass (`CoverScatter.scatterCover`)

Defaults as every map calls it: `maxGap` 4, `targetShare` 0.3 (Main Street 0.28), budget W × D ÷ 32 props,
margin 1.

- **Outdoor tile**: inside the margin, not reserved, not within 1 tile of a building footprint (`MapKit.scatter`),
  top surface with headroom ≥ 3, not liquid, not in a room.
- **Covered**: its best face is at least HALF (`coverAt`). The gap is the BFS distance (4-neighbour, ±1 voxel) to the
  nearest covered outdoor tile.
- Loop until the largest gap ≤ 4 and the covered share ≥ target, or the budget runs out: pick a random tile from the
  farthest 8 % (at least 6) of tiles with gap ≥ 2, pick a prop from the theme catalogue weighted by `w` and matching
  the ground context, and place it on one side of the tile, laid perpendicular to that side.
- A prop is placed only if every cell is outdoor at the target's height and has **1-tile clearance**: nothing solid at
  z+1..z+2 in the 8 neighbours (its own cells excepted), no door within 1 tile, no stair under a neighbour. So
  scattered cover never touches walls or other props, and never seals a street, alley or doorway.

<!-- generated:props -->
**PROP_CATALOG (generic; not used by the present-day maps)**

| key | name | cover | layout | length | weight | context | materials | note |
|---|---|---|---|---|---|---|---|---|
| `sandbag_line` | Sandbag line | half | line | 2–4 | 3 | any | `sandbag` | Half cover. Sandbags soak blasts (6 hp per voxel). |
| `field_wall` | Dry-stone field wall | half | line | 3–5 | 3 | field | `drystone` | Half cover. Tough (8 hp per voxel); leaves rubble. |
| `plank_fence` | Plank fence | half | line | 2–4 | 2 | field | `fence` | Half cover. Burns; a blunderbuss chews through it. |
| `hay_bales` | Hay bales | half | line | 1–2 | 2 | field | `hay` | Half cover. Highly flammable. |
| `crate` | Crate | half | single | 1–1 | 2 | street | `crate` | Half cover. Breaks easily. |
| `crate_stack` | Stacked crates | full | line | 1–2 | 2 | street | `crate` | Full cover until it is shot apart. |
| `barrels` | Barrels | half | line | 1–2 | 1.5 | street | `barrel_powder`, `barrel_water` | Half cover. Powder kegs explode when hit; water barrels douse fire and soak units. |
| `cart` | Cart | half | line | 2–2 | 2 | any | `cart` | Half cover. Wooden, burns. |
| `market_stall` | Market stall | half | line | 2–2 | 1.5 | street | `stall` | Half cover behind the counter. Wooden, burns. |
| `boulder` | Boulder | full | line | 1–2 | 1.5 | field | `rock` | Full cover. Very tough (14 hp per voxel). |

**SUBURB_PROPS (Cedar Close)**

| key | name | cover | layout | length | weight | context | materials | note |
|---|---|---|---|---|---|---|---|---|
| `planter` | Concrete planter | half | line | 2–3 | 3 | any | `planter` | Half cover. Tough concrete (8 hp). |
| `garden_wall` | Low brick wall | half | line | 3–4 | 2 | yard | `brick` | Half cover. Brick (9 hp). |
| `privacy_fence` | Cedar privacy fence | full | line | 2–4 | 1.5 | yard | `privacy_fence` | Full cover. Thin timber: shots and fire go through it fast. |
| `bins` | Wheelie bins | half | line | 1–2 | 1.5 | street | `bin` | Half cover. Flimsy (2 hp). |
| `bench` | Bench | half | line | 2–2 | 1 | any | `bench` | Half cover. Timber, burns. |

**DOWNTOWN_PROPS (Main Street)**

| key | name | cover | layout | length | weight | context | materials | note |
|---|---|---|---|---|---|---|---|---|
| `jersey` | Concrete barrier | half | line | 2–3 | 3 | street | `jersey` | Half cover. Very tough (14 hp). |
| `planter` | Concrete planter | half | line | 2–3 | 3 | any | `planter` | Half cover. Tough concrete (8 hp). |
| `bench` | Bench | half | line | 2–2 | 1 | any | `bench` | Half cover. Timber, burns. |
| `bins` | Wheelie bins | half | line | 1–2 | 1.5 | street | `bin` | Half cover. Flimsy (2 hp). |
| `newsstand` | Vending machines | full | line | 1–2 | 1 | street | `appliance` | Full cover. Metal (7 hp). |

**DOCKS_PROPS (Harbor Yard, Training Facility)**

| key | name | cover | layout | length | weight | context | materials | note |
|---|---|---|---|---|---|---|---|---|
| `crate_stack` | Crate stack | full | line | 1–2 | 2 | any | `crate` | Full cover until it is shot apart. |
| `pallets` | Pallet stack | half | line | 1–2 | 2.5 | any | `pallet` | Half cover. Burns. |
| `drums` | Fuel drums | half | line | 1–2 | 1.2 | any | `barrel_powder`, `barrel_water` | Half cover. Fuel drums explode when hit. |
| `jersey` | Concrete barrier | half | line | 2–3 | 3 | street | `jersey` | Half cover. Very tough (14 hp). |
| `sandbags` | Sandbag line | half | line | 2–3 | 1 | any | `sandbag` | Half cover. Soaks blasts. |

**FORECOURT_PROPS (Route 9 Stop)**

| key | name | cover | layout | length | weight | context | materials | note |
|---|---|---|---|---|---|---|---|---|
| `jersey` | Concrete barrier | half | line | 2–3 | 3 | street | `jersey` | Half cover. Very tough (14 hp). |
| `bins` | Wheelie bins | half | line | 1–2 | 1.5 | street | `bin` | Half cover. Flimsy (2 hp). |
| `pallets` | Pallet stack | half | line | 1–2 | 2.5 | any | `pallet` | Half cover. Burns. |
| `planter` | Concrete planter | half | line | 2–3 | 3 | any | `planter` | Half cover. Tough concrete (8 hp). |
| `drums` | Fuel drums | half | line | 1–2 | 1.2 | any | `barrel_powder`, `barrel_water` | Half cover. Fuel drums explode when hit. |
<!-- /generated:props -->

Prop `cover` is the catalogue's intent; the real rating comes from the voxels and their connected shapes
([03](03-cover-and-sight.md)), e.g. a lone sandbag post rates HALF, and hedges rate none.

## Spawns (`MissionCommon.finalizeMission`)

- Squad spawn points snap to the nearest surface; the first one seeds a full reachability search.
- Enemy specs: `pos` (exact), `at` (snapped to the surface), `room: { building, kind?, storey?, index? }` (a random
  reachable free cell of that room), `roof: buildingId` (the reachable roof cell nearest the roof's centre).
- Room choice (`roomFor`): among the building's rooms on that storey (default 0), filtered by `kind` when given, take
  the `index`-th (default 0, modulo the count). Before this change `index` was ignored when `kind` was given, so
  Route 9's two motel-unit spawns (`index` 1 and 2) now start in different units than before (both used to resolve
  to the first unit).
- A spec that resolves to an unreachable or occupied cell falls back to the reachable free tile nearest the intended
  spot (or its building's centre), scored by horizontal distance + 2 × height difference. Enemies keep the spec's
  `group` (pod) and `facing` (default south).

### Spawn safety (`secureSpawns`, gate `spawnSafe`)

No enemy may start with a clear sight line to a squad member **within 24 tiles** (ray from enemy z+2.5 to squad
z+2, opaque voxels block). An enemy that could is moved to the nearest reachable free tile within 8 tiles and ±3
voxels, at least **10 tiles** from every squad member, that no squad member can see from there, preferring the same
room (+0), then the same indoor/outdoor status (+2), else (+6), plus distance. If no such tile exists it stays.

## Design gates (`MissionMetrics.measureMission`, `DEFAULT_GATES`)

Measured over every tile the squad can reach from its first spawn point. A map passes when every metric lies in
its range; `maps.test.js` requires a pass on seeds 1–4 for every map. The gates are reported and tested, not
repaired (no `MapRepair` pass exists).

<!-- generated:gates -->
| gate | min | max |
|---|---|---|
| `coverDensity` | 0.18 | 0.6 |
| `outdoorCover` | 0.2 | 1 |
| `coverGap` | 0 | 6 |
| `fullCoverShare` | 0.05 | 1 |
| `killingField` | 0 | 14 |
| `sightlineMedian` | 5 | 22 |
| `lanes` | 2 | 99 |
| `breachability` | 0.5 | 1 |
| `destructibleCover` | 0.4 | 1 |
| `spawnSafe` | 1 | 1 |
<!-- /generated:gates -->

| Metric | Definition (code) |
|---|---|
| `coverDensity` | share of reachable tiles whose best face is ≥ HALF |
| `outdoorCover` | the same over outdoor reachable tiles |
| `coverGap` | the largest BFS distance (4-neighbour, ±1 voxel) from an outdoor tile to a covered outdoor tile (99 if unreachable) |
| `fullCoverShare` | share of reachable tiles with a FULL face |
| `killingField` | side of the largest square of outdoor tiles with no cover at all |
| `sightlineMedian` | median length of 16 horizontal sight rays (eye z+2.55, up to 40 or the map edge) from ~60 sampled tiles |
| `lanes` | routes to the tile nearest the enemy centroid: repeat up to 4 times, blocking a 3-wide corridor around the middle 60 % of the last route, while the cost stays ≤ 1.8 × the shortest |
| `breachability` | share of rooms touched by ≥ 2 doors (1 when there are no rooms) |
| `destructibleCover` | share of cover voxels next to reachable tiles (weight 1, at z+1) with hp ≤ 9 |
| `spawnSafe` | 1 if no enemy sees a squad spawn within 24 tiles (as above) |

Also reported, not gated: `reachableTiles`, `interiorShare`, `firstContact` (closest enemy–squad spawn distance),
`rooms`, `buildings`. `npm run mission:report` prints them for every map and seed.

These differ from PLAN-01 §13.1 (cover 25–45 %, killing field ≤ 12, sightline median 10–18, ≥ 3 lanes,
breachability ≥ 70 %, first contact 12–20); the code's `DEFAULT_GATES` are authoritative.

## Reference maps and visual presentation

[MAPGEN.md](../MAPGEN.md) describes image analysis, combat-flow adaptation, exact integer slates and offline packages. Each slate cell corresponds to one voxel; material boundaries, locked rooms and routes use those coordinates directly. Floors, roads, lawns and plaster use flat material colors with continuous world-space grain, including instanced wall pieces; they keep the destructible voxel matrix underneath.

Mission metadata `timeOfDay` selects day, dawn, dusk, overcast or night. Route 9 starts at dawn, Harbor Yard at night, and Training Facility under overcast light. A visual neighborhood backdrop and distance haze frame the battlefield without adding gameplay collision or cover.

Preparing a shot activates a close shoulder camera; committing shooting or a skill activates a lower, tighter back-shot camera through action playback. The camera checks voxel occupancy and the shoulder-to-lens ray, tries both shoulders, and returns to the tactical camera on cancellation or playback completion. Picking and target projections use the active camera. Character cut-in art can be disabled independently of these action angles.
