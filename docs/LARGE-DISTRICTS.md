# Large districts: parcel mixes, levels, warehouses and hold zones (PLAN-06)

Select a map under Large districts:

| Map | Theme | Roads | Character |
|---|---|---|---|
| **Civic District** | park | main street, cross street, service road | mixed street-level town: shop rows, lots and yards |
| **Market Arcade** | mall (L) | as park | merged arcade landmark, retail mixes |
| **Drainage Quarter** | drainage (T) | main street, cross street | industrial, channels with banks, ladders and bridges |
| **Hillside Terraces** | terraces | ramped street corridor | three levels from a sunken start |
| **Maple Heights** | suburb | main street, two avenues | houses, townhouses, fire station, sports courts; light traffic, max 2 storeys |
| **Downtown Core** | downtown | main street, centre avenue, service road | city blocks with rear alleys, office plazas, parking decks; 2–3 storeys, up to 13 buildings (denser fails the sightline gate), heavy traffic |
| **Dockside Yards** | docks | main street, quay road, yard road | deep water and a quay along the north edge, warehouse yards, scrapyards |
| **Interstate Strip** | highway | 10-lane interstate with a jersey median, frontage road, exit road | motels, dealerships, car washes, bus depot; no kerb parking on the interstate |

**Enemies (PLAN-07).** Every district (and Hillside Terraces) fields three pods, seven hostiles (`district/Pods.js`):
three in the farthest building, two in the second farthest, and a street pod of two toward the target end. The old
rosters had two hostiles, and the simulator showed 100 % squad wins.

Each theme is a row in `DISTRICT_THEMES` (`shared/mission/LargeDistricts.js`): its family, remix defaults and a
per-mix **bias** (docks triples warehouse yards, highway damps homes), plus a road skeleton in `districtRoads`.

- **Width** (96–128), **depth** (72–96) and **footprint** (rectangle, L or T) controls appear below the map
  selection. Hillside Terraces is always a rectangle.
- Play opens the dispatch review and the topography debugger; dispatch starts the battle.
- Seed 27 is the reference playtest.

## What a district is now

A district is a **skeleton** plus **parcel mixes**.

**The skeleton:**
- the footprint;
- the levels;
- the roads, as data: main street, cross street and rear service road;
- landmark features:
  - the merged arcade;
  - the drainage channels with their banks, stairs, ladders and bridges;
  - the insertion cordon.

**The fill.** Everything between the roads is solved by the generator in `shared/mapgen/district/`:

```
blocks → parcel partition → mix WFC → build pass → dress pass → strips → skybridges → street rules → vehicles → cover repair → gates
```

**Blocks.** Blocks are maximal rectangles of free land on a 2-cell bay grid, one level each.

**Partition.** Each block is split, depth first and then along its frontage, into parcels sized for the mixes.

**Mixes.** A mix is a compound parcel whose parts are **nested** (for example, a salvage yard inside an auto
repair) or **merged** across an edge socket (for example, a strip mall's shells and the lot in front of them). The
catalogue is `MixCatalogue.js`:

| Mix | Parts |
|---|---|
| strip-mall | 2–4 merged shells, a front lot with islands and light-pole bases, cart corral, rear service alley with a dumpster enclosure |
| supermarket | store, lot, garden centre (chain-link pen with plant benches), service alley; one landmark per map |
| mainstreet-row | 2–3 storey shops and offices on the frontage (skybridge candidates), rear staff stalls |
| office-plaza | office block, paved plaza with low walls, tree pits and a plinth, an optional visitor lot |
| diner-drive | diner, drive-thru lane looping behind it, menu board, small lot |
| gas-station | kiosk, two pump islands (explosive pumps) under a canopy on posts, air/water stand |
| house-plot | house or 2-storey home, driveway with car slots, picket front, privacy-fenced back yard, shed, patio, play set |
| townhouse-row | semi-detached units, front gardens, divided back yards, sheds |
| warehouse-yard | warehouse (CQB interior), apron with dock bays, container stack, pallet bay, drum store, chain-link perimeter with a vehicle gate, pedestrian gates and a guard booth |
| auto-repair | garage, forecourt waiting bays, tyre racks, parts shed, oil drums, fenced salvage yard with wrecks |
| self-storage | gated chain-link yard, office, rows of steel unit blocks with drive lanes |
| surface-lot | pay-and-display car park: bays, islands, pay booth, low-wall boundary (favoured on narrow parcels) |
| utility | fenced substation with transformers |
| community-garden | picket fence, raised beds, tool shed, water butts |
| construction | hoarding, a half-built concrete frame with a ladder up to the slab, material piles, portacabin, plant |
| vacant-lot | chain-link frontage, overgrowth, one dumped car (one per map) |
| city-block | street wall of 2–3 shops/offices, 2-cell passages to a rear service alley (dumpsters, bins, loading bay), and on deep blocks a back row of walk-ups facing the alley |
| car-dealership | glazed showroom, display rows of cars (high occupancy), customer lot, price pylon |
| fire-station | apparatus bays merged with an office, apron with engines nose-out, hose rack |
| police-compound | station, fenced vehicle pound, cruiser stalls |
| motel | single-storey motel row behind its lot, chain-link-fenced pool, sign, privacy fence at the back |
| sports-court | chain-link court with hoops and bleachers |
| car-wash | wash bays under a canopy with bay dividers, pay booth, vacuum stations, queue lane |
| parking-deck | two-level deck on columns, ramp on whichever side is clear of a neighbour's door, parapet, lift core and jersey dividers on the roof, stalls on both levels; falls back to a surface lot when neither side is clear |
| scrapyard | gravel yard, crushed-car bale stacks with lanes between, wrecks, container site office |
| bus-depot | garage, bus bays, fuel island under a canopy |

**WFC rules for choosing mixes:**
- fit by size, frontage and options;
- no identical neighbours, except repeatable homes;
- zoning: no warehouse yard beside homes;
- one landmark per map;
- per-mix caps;
- the building limit;
- the hold-zone host is pinned first.

The weights come from the family (Remix: *Parcel mix family*: mixed, retail, industrial, suburban, roadside, urban),
the theme's bias and seeded noise. The partition favours mixes with buildings (×1.5), and if the solve leaves fewer
than four buildings the largest open parcels take the best building mix they fit, so every district has rooms to
fight through.

**Build pass, then dress pass.** All buildings go up first, so every door approach is reserved before any fence,
lot or prop is placed.

**Strips.** Leftover land becomes:

| Strip | What it gets |
|---|---|
| frontage apron | paving, vending machines and bins against the wall |
| service yard | tarmac, bins, a delivery bay |
| curtilage | the land a building owns: customer stalls along its walls, a boundary with gates, planting |
| alley | bins |
| verge | street trees |
| green | lawn and trees |
| world edge | a brick boundary wall with gaps, and a tree belt |
| path | gravel |

**No random boxes.**
- The scatter pass, the crate lines and the fixed pedestrian-cover rows are gone from these maps.
- Every exterior voxel carries an origin (`mix:` / `strip:` / `road:` / `roadset:` / `level:` / `story:` /
  `vehicle:` / `repair:` / `skybridge:`), and the prop-origin gate fails anything unregistered.

## Vehicles and the noise map

Vehicles only stand in **slots** registered by:
- parcels: lot stalls, driveways, dock bays, drive-thru queues, pump bays, salvage yards, construction plant;
- streets: kerb lanes, service-road bays, bus stops;
- road sets.

Each slot group fills in descending
`V = fbm(seed) × (0.5 + priority) × pocketWeight`
until it reaches its target occupancy:
- **Occupancy** depends on the kind, the traffic setting and the time of day.
- **Priority** is real use: stalls near the shop door fill first.
- **pocketWeight** lifts slots on the line from the insertion to the target, so cars become cover where the fight
  goes.

**Road sets** are level design, not scatter:
- a jersey-barrier roadblock and a wreck at the insertion end of the main street, with a lane left through;
- stalled cars every ~30 cells of straight main street, as sightline breakers;
- on a divided road (`median: true`), a jersey-barrier median in runs of six with three-cell crossings;
- wrecks either side of each junction;
- a crash at the mouth of each cross street.

## Streets stay clear

Road, kerb, sidewalk and driveway cells own their air column. The only solids allowed above them are:
- vehicles and road sets in the lanes;
- street furniture on the sidewalk: bus shelters, junction cabinets, signal and sign posts, bike racks and parcel
  lockers at shop and office doors, street trees, driveway bollards;
- **skybridges**.

**Skybridges** span a road between two directly facing buildings of 2+ storeys:
- the floor is at storey 2;
- there are no supports in the carriageway;
- doorways are cut through both facades;
- the corridor is a room with two doors.

The raised park, the raised-market deck parcel and the playground mix are retired (Leon, 2026-10-14); nothing stands over road rows 34–38.

## Hillside Terraces (levels)

`TerraceLevels.js` builds 2–3 surface levels, sized to the 3-voxel storey:
- L0 at z 1 (sunken yards, where the squad inserts);
- L1 at z 4 (street terrace);
- L2 at z 7 (high ground, where the enemy holds).

The bands are snapped to the bay grid and jittered by noise, so every parcel is flat.

**Each retaining wall:**
- has a railing on its upper edge (ledge cover above, a hard flank below);
- is crossed by a **road ramp** (the whole street corridor, 1-voxel steps);
- is crossed by a **3-wide stair promenade**;
- is crossed by a **split-level building**: a street door below and a storey-2 door onto the terrace;
- has a **ladder** shortcut.

The level gate requires every level to be reachable and at least 2 routes per wall, at least 10 cells apart, at
least one of them not a ladder.

**Sunken Junction, Sunken Boulevard and Freight Terraces** keep their level skeletons. Their crate lines, sandbag
rows, scatter and fixed cars are gone. The open upper-level land is filled by the same generator: parcels where
blocks fit, curtilage around the existing buildings, and kerb slots on the sunken streets.

## Warehouses (open-floor CQB)

`Warehouse.js` lays out the hall of every warehouse-yard warehouse as one of four variants:

| Variant | Floor |
|---|---|
| distribution | double pallet racking with 3-wide aisles and a cross aisle |
| workshop | machine blocks, workbenches, drum stores |
| cold-store | see-through mesh cages and racking |
| gutted | 2×2 pallet and crate stacks on a storage grid; the hold-zone floor |

Every variant also gets structural steel columns on an 8-cell grid (the durable anchors), a container on big floors
and a forklift.

**The layout passes enforce, with a connectivity guard:**
- **Sightline breakers:** no straight open run longer than 14 cells.
- **Cover:** every open cell within 2 moves of cover.
- **Door landings:** kept clear.

The warehouse gate also checks dead ends (no blind slot longer than 6 cells; every prop placement is refused if it
would create one) and at least 3 entrances on at least 2 sides. Cold stores keep a 2-cell aisle in front of their cage
line.

**Catwalks.** Warehouse-yard warehouses are 2-storey shells. `addCatwalk` removes the storey-2 slab over the hall
except a 2-wide grate ring along the walls and a cross bridge at mid-hall, keeps slab around the building's own stair
(joined to the ring), and adds two 3-step steel stairs up from the floor (searching along the wall until the racking
leaves a gap). Railings line every edge that faces the void. Shooters on the catwalk see down onto the floor; the
floor sees them back through the railings. The gate checks that both stair tops are reachable.

## Trees

Trees are species, not voxel blobs. `plantTree` picks a species from the origin (park, verge, yard, plaza) and a
cell hash:

| Species | Piece | Shape |
|---|---|---|
| oak | `tree_oak` | broad, low crown (radius 2) |
| maple | `tree_round` | round crown |
| birch | `tree_birch` | tall, narrow, pale trunk |
| ornamental | `tree_ornamental` | small, for plazas and street pits |
| cypress | `tree_cypress` | tall column |
| conifer | `tree_conifer` | cone |

The voxels (trunk and a ragged crown) stay for line of sight, bullets and fire. The renderer draws the species piece
from the hint (`{piece, yaw, scale, tree: true, cells}`) and hides the leaf voxels (`NO_CLIP`).

## Hold zones

Remix: *Objective → Hold a zone*.

**Placement.** The zone (7 × 7) is pinned to the hold host farthest from the insertion: an office plaza, a lot
centre, a warehouse apron or a gutted floor. If no outdoor host fits (the dense arcade), the largest ground-floor
interior holds it, with concrete display plinths.

**Fortification.** The zone gets:
- 4 hard anchors (brick low walls and jersey barriers);
- a concrete plinth;
- a jersey fallback ring 5–9 cells out;
- a roof ladder onto the nearest 1–2 storey flat roof when no high ground overlooks it.

**The hold gate checks:**
- ≥ 3 approach corridors from ≥ 2 sides;
- high ground within 16 cells (not required for interior zones);
- ≥ 4 hard-cover cells;
- a **durability test**: with all soft cover deleted, ≥ 50 % of the zone still has half cover, and every approach
  side still has cover facing it;
- a **blast test**: three greedy frag grenades, after which every approach side still has cover;
- ≥ 2 fallback pieces;
- enemy spawns ≥ 20 cells away and blind to the zone.

**The objective** is `{kind:'hold', zone, rounds:4, needed:1}`. The lanes metric measures routes to the zone
(`meta.lanesGoal: 'objective'`).

## Cover repair

If a cell is still more than 5 moves from cover after the slots and street rules, `CoverRepair.js` places what that
land use would really have, nearest first and off the carriageway when possible:
- bins or cabinets on sidewalks;
- islands in lots;
- low walls on plazas and yards;
- pallets on aprons;
- trees on greens;
- a stalled car or roadworks barriers in a kerb lane as a last resort.

Each piece carries a `repair:` origin.

## Gates and debugging

`DistrictGates.js` adds the district gates to every district map:

| Gate | Rule |
|---|---|
| landUse | plain ground ≤ 8 %, no plain square over 8 × 8 |
| propOrigin | every exterior solid has an origin |
| vehicles | every vehicle is in a slot |
| roadAir | nothing over roads except the allowed set |
| skybridges | both ends reachable |
| warehouses | every hall passes its gate |
| levels | see Hillside Terraces |
| hold | see Hold zones |

Results are in `meta.districtGates`; the land-use map is `meta.landUse` (one code per cell).

District finalization now **enforces** these gates: a failure throws with the map id, seed and failing gate names;
the error carries the complete `districtGates` report. Explicit `{enforce:false}` is available to diagnostic callers.
Road ownership is recorded separately from land-use tags and ground snapshots, so placing a building cannot erase
the road's air-column check. Authored crossings register both road datums and retain two voxels of lower clearance;
their edge rails and checkpoint barriers carry road-set origins.

The hold report includes `details.softRemoved` and `details.blasts` (centres and destroyed voxel counts). Both indoor
and outdoor furniture participate in the destruction checks. Traffic **None** also applies to cover repair, which
uses roadworks barriers instead of cars. The debugger's vehicle list includes cars added by repair.

**Repeatable audit:**

```sh
npm run mapgen:audit -- --determinism --out /tmp/district-audit.json
npm run mapgen:audit -- --maps park-district,mall-district,drainage-district,terrace-district --seeds 1,27 --remix '{"objective":"hold"}' --out /tmp/district-hold.json
```

The default audit checks all seven district maps at seeds 1, 3, 17 and 27. It checks mission and district gates,
connector validation where supplied, and optionally compares full serialized mission snapshots across rebuilds.
Any failed case exits with status 1. Width, depth, shape and remix options allow targeted configuration checks.
This audits the current generator; it does not reconstruct the pre-PLAN-06 baseline or replace battle simulations.

Floor picking treats the displayed storey as a height band, keeping intermediate stair/ramp tops and soldiers
selectable while excluding the lower floor beneath it. An oblique click on a reachable raised surface takes
precedence over the nominal floor plane behind it.

**Topography debugger:**
- *Land use* layer: parcels, lots, yards, strips, fences, zones.
- *Vehicle slots & zones* layer: parcel outlines with their mix names, vehicles and the hold zone.
- The gate list includes `district.*`.

**Isometric preview without a browser:**

```sh
node tools/mapgen/district-render.mjs --map park-district --seed 27 --out park.png              # isometric
node tools/mapgen/district-render.mjs --map drainage-district --seed 2 --cut --out drain.png    # roofs cut away
node tools/mapgen/district-render.mjs --map park-district --seed 27 --landuse --out lu.png      # land-use map
node tools/mapgen/district-render.mjs --map terrace-district --seed 2 --remix '{"objective":"hold"}' --out hold.png
```

## Remix lab

Open `/?tab=test`.

**Presets:**
- **Collision lab:** a few shells, flat terrain, no traffic.
- **Chaotic district**.
- **Remix seed & preview**.

**Controls:**
- dimensions and shape;
- building limit (3–24);
- minimum and maximum floors;
- placement;
- **parcel mix family**;
- **objective**;
- **levels** (Hillside Terraces);
- wall kit, windows, corners;
- terrain, traffic, pedestrian props;
- interior links;
- covered market;
- **skybridges**;
- furnishing.

Preview, save/load, share links and reports keep every setting.

## Notes and limits

- Interiors keep the 3-voxel storey rule. Warehouse-yard halls get their height by removing most of the storey-2
  slab (the catwalk), not from a new tall-hall building kind.
- The builder only reaches upper floors on offices 14+ cells wide and 2-storey homes 10+ deep, so the mixes respect
  those sizes.
- Cedar Close, Main Street, Harbor Yard, Route 9 and the Training Facility still use the old cover scatter until they
  get parcel dressing (PLAN-06 decision 1).
