# Levels and themes (2026-10-08)

Fireteam's battlefields are present-day places. There are no aliens yet: the opposing force is the **Syndicate**, a
human crime organisation (Gunman, Lookout, Arsonist, Enforcer, Riot Guard). The squad is an XCOM-style fireteam
(Assault, Grenadier, Sharpshooter, Breacher) with call signs Reyes, Kowalski, Okafor, Tanaka …

Every map is still a **voxel grid**: movement, cover, line of sight, ballistics, fire and destruction run on it,
one voxel ≈ 0.9 m, a storey = slab + 2 voxels of headroom. What changed is everything on top of the grid:
buildings are generated from room programs, props are real objects, and the renderer draws them with rounded,
modern tile-set pieces (see `docs/TILESET.md` and `docs/RENDERING.md`).

## The maps

| Theme | Map (id) | Size | Setting | Time of day |
|---|---|---|---|---|
| Suburbs | **Cedar Close** (`cedar-close`) | 48 × 40 | Two modern homes after `docs/design/cedar-close-concept.png`: glass-walled living rooms, furnished interiors, front gardens with paths and planters, a shared driveway, fenced back gardens with a gate, a tree-lined street with parked cars | day |
| Downtown | **Main Street** (`main-street`) | 52 × 42 | A grocer, a diner and a two-storey office block on a main road; roadworks barriers, benches, planters, a pocket park with a fountain, a news kiosk, a parking lot | dusk |
| Industrial | **Harbor Yard** (`harbor-yard`) | 54 × 44 | A container yard on the quay: containers (some stacked) forming lanes, a corrugated warehouse with roller doors and an office, a site office, pallets and fuel drums, a chain-link fence along the road | night |
| Roadside | **Route 9 Stop** (`route-9`) | 52 × 42 | A gas station (forecourt canopy on steel columns, fuel pumps that **explode**), its shop, a one-storey motel with a door per room, the motel lot, the highway | dusk |
| Training | **Training Facility** (`proving-grounds`) | 60 × 46 | The systems test map, restyled: a firing range with a section of each wall type, a two-storey command bunker, a fuel store with a pitched roof, a concrete watchtower with roof access, a townhouse, a pond with ice, an earth berm | day |

Objectives: Cedar Close and the Training Facility are **eliminate**; Main Street is **hold** (the junction in front of
the diner, 4 rounds); Harbor Yard is **extract** (fight through to the boat on the quay, at least 2 out; ladders lead up
the container stacks); Route 9 is **recover** (a cash bag in a motel room, carried back to the arrival area). Every
character has 30 HP and gun damage comes from the round; rules in `docs/mechanics/`.

Every map passes the design gates on seeds 1–4 (tested in `shared/mission/maps.test.js`): cover density, outdoor
cover ≥ 20 %, **no outdoor tile more than 6 moves from cover**, full-cover share, no open square bigger than 14,
median sightline 5–22, at least two lanes to the enemy, most rooms with two ways in, mostly destructible cover,
and **spawn safety** (no enemy starts with a clear line of sight to the squad within 24 tiles). `npm run
mission:report` prints the metrics for every map and seed.

## How a map is made

A map file builds the grid with `shared/mission/modern/MapKit.js`:

```js
const m = createMap({ id, width, depth, height, seed, ground: 'lawn' });
m.roadX(32, 36);                                   // asphalt with a dashed centre line and kerbs
m.ground(0, 28, W - 1, 29, 'concrete');             // sidewalk
const home = m.building({ id: 'home-12', program: 'house', x0: 3, y0: 9, w: 16, d: 13, front: 's', entryAt: 0.3 });
m.car(9, 33, 'x', 1);                              // 4 × 2 car: body (half cover) + cabin (full cover)
m.tree(6, 30, 'round');                            // trunk + canopy voxels, drawn as one tree
m.hedge(x, 27, 6, 'x');                            // clipped hedge: concealment only, bullets pass
m.line(x, y, 2, 'x', 'planter');                   // any material in a line, h voxels tall
m.decorAt('streetlight', 12, 29, { yaw });         // visual only
m.reserve(1, 37, 9, 39);                           // keep the spawn clear of scattered cover
m.scatter(SUBURB_PROPS, { maxGap: 4, targetShare: 0.3 });
return m.finish({ name, spawns, objective, meta: { theme, defaultCut: 4, lighting: 'day' } });
```

`finish` resolves spawn specs (`at`, `room: { building, kind, storey }`, `roof`), checks reachability, **moves any
enemy that could see the squad at the start** to the nearest hidden tile (same room or same indoor / outdoor status),
measures the map and returns the mission with `visual: { hints, decor }` for the renderer. Register the map in
`shared/mission/Maps.js` (id, name, theme, one-line text, build function); the menu, the debug panel, the server,
the balance sim and the report pick it up from there.

## Buildings: programs

`shared/mission/modern/ModernBuilder.js` turns a footprint and a **program** into a hollow, furnished building:
rows of rooms from the street front to the back, 1-voxel partitions, doors chosen as a spanning tree over room
adjacency from the entrance plus extra doors until most rooms have two ways in, open-plan openings (living ↔
kitchen), exterior doors (entry, back, side), stairs between storeys (and to the roof when asked), glazing chosen
by the room behind each outer wall, then furniture placed with a connectivity guard (furniture never cuts a floor
in two, door fronts and stair landings stay clear).

| Program | Walls | Rooms (front → back) | Notes |
|---|---|---|---|
| `house` | stucco | living + kitchen (open plan) / bedroom, bathroom, study | floor-to-ceiling glass in the living room |
| `bungalow` | brick | living, bedroom / kitchen, bathroom | |
| `townhouse` | brick | living / kitchen, bathroom; upstairs bedroom, study, bathroom | stairs in the living room |
| `shop` | brick | sales floor / storeroom, office | storefront glass, aisles, checkout, drinks coolers |
| `diner` | stucco | dining / galley, restroom | booths, counter with stools |
| `station` | concrete | sales / storeroom, restroom | gas-station shop |
| `warehouse` | metal siding | office, loading / warehouse | roller shutters, clerestory windows, metal roof |
| `garage` | metal siding | workshop, storeroom | |
| `motel` | brick | a row of units, each with its own front door / their bathrooms | one window beside each door |
| `office` | concrete | lobby, office / meeting, hall, office; upstairs open office | two storeys, stairs in the hall |
| `bunker`, `tower` | concrete | Training Facility buildings | |

Glazing per room kind: `full` (living, dining, sales, lobby, open office: floor-to-ceiling, a pier every 4th cell),
`band` (kitchen, study, office: a window band over a sill wall), `punched` (bedrooms, units, halls), `clerestory`
(warehouses), `none` (bathrooms, storerooms). Glass is aesthetic: no cover, shots and sight pass, and a pane a bullet
crosses breaks.

Furniture recipes (`ITEMS`, `ROOM_FURNITURE`) give each item a material (gameplay: `sofa`, `cabinet`, `bed`, `desk`,
`appliance`, `shelving`, `pallet`, `crate`, fuel drums …), a footprint along a wall or the room's long axis, a height
(tall items are full cover) and the tile-set piece for each cell, plus decor around it (rugs, coffee tables,
lamps, stools, chairs, TVs, monitors, toilets, showers, plants, wall art).

## Cover catalogues per theme

`shared/mission/PropCatalog.js`: `SUBURB_PROPS` (planters, low brick walls, cedar privacy fences — full cover, thin —
wheelie bins, benches), `DOWNTOWN_PROPS` (jersey barriers, planters, benches, bins, vending machines),
`DOCKS_PROPS` (crate stacks, pallet stacks, fuel drums, barriers, sandbags), `FORECOURT_PROPS`. Placed vehicles
(cars, containers, dumpsters), trees and the theme's hand-placed lines come first; the cover pass then fills gaps
until no outdoor tile is more than ~4 moves from cover, never touching door approaches, spawns or building
surrounds.

Hazards: **fuel pumps** and **fuel drums** explode when hit; **water drums** douse fire; fences, benches, pallets and
furniture burn; glass shatters.

## Resource requirements

What the game needs to look finished, in the order it pays off. Everything has a working placeholder today; real
assets drop in without code changes.

| Resource | Where | Count | Notes |
|---|---|---|---|
| Tile-set art | `client/public/assets/kit/tileset-art.glb` | 150 pieces (list: `tileset.json`) | One node per piece, named as in `docs/TILESET.md`, pivot at the cell-floor centre, runs along +X, furniture backs toward −Z, materials named after the slots. Priority: modern walls / glazing / doors (12), furniture (40), vehicles + trees (6), street furniture (10), decor (35). Budget ~1,200 triangles per piece; whole objects (car, container, tree) up to ~3,000. |
| Textures | `client/public/assets/textures/pbr/<name>.jpg` + `_n.jpg` | 59 | Seamless, power-of-two, albedo in sRGB and a tangent-space normal map. Present-day set: lawn, paving, concrete, asphalt, road_mark, deck, gravel, oak_floor, ceramic, tile_dark, carpet, stucco, brick, concrete_wall, siding, roof_metal, container, upholstery, linen, worktop. |
| Characters | `client/public/assets/characters/<id>/` | 9 (4 squad, 5 Syndicate) | Field atlas 8 facings × 15 frames at 128 × 192, back-shot layers, portrait; see `tools/art/make_placeholders.py` and the manifests. `worldHeight` 2.4 (Enforcer 2.55). |
| Weapons / FX | — | — | Muzzle flashes, tracers, explosions and fire are procedural (`client/src/render/Fx.js`). |
| Audio | — | none yet | |

Runtime cost (headless Chromium, SwiftShader — native GPUs are much faster): 820–1,300 draw calls including the
shadow and ambient-occlusion passes, 210k–360k triangles, 2,000–3,400 tile-set instances; a full rebuild (changing
the cutaway level) takes 75–150 ms. The tile set is instanced per 16³ chunk; merging instances across chunks is the
next step if draw calls become the bottleneck.
