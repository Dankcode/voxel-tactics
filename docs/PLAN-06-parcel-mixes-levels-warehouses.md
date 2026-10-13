# PLAN-06 — Parcel mixes, filled open space, terraced levels, warehouses and hold zones

Status: **implemented** (2026-10-13). Leon said "implement these changes to the game", and Claude implemented them directly with the §11 defaults. The implementation record is in §12. This follows Leon's workflow: Claude plans read-only,
Leon approves, Codex implements the approved steps test first, and Hermes verifies.

**Base.** The plan starts from the repo at `d31cd2d` ("map plans and auto generation"). It covers the current
district generator:
- `LargeDistricts.js`, `DistrictRemix.js` and `StreetDressing.js`;
- `ConnectingDistricts.js` (Sunken Junction, Sunken Boulevard, Freight Terraces);
- the remix lab in Test Ground.

It does not depend on the Project's PLAN-05 (road tiles and plots), which is not in the repo. Where the two
overlap, it reuses PLAN-05's ideas: the PCP gap classes, building unions and prop origins. Neither plan blocks the
other.

## 1. Leon's direction (2026-10-13)

1. **Less open space and no randomly placed cars.** Open areas get realistic land uses. Streets and car placement
   already make sense; the empty ground outside parcels is the problem.
2. **Parcel WFC mixes.** Parcels can sit **inside** other parcels or **merge** with them to fill open space. For
   example, a parking-lot parcel and a shopping parcel together make a store with its lot out front, and the
   **noise map predicts where the cover vehicles go**.
3. **Buildings never cover streets.** The one exception is a connector building that spans the street into the
   building opposite.
4. **Several elevated levels.** A map can start in a sunken area and climb to a top level a couple of heights above
   it. This uses the current level system, and the levels are generated and connected.
5. **Believable fill for empty space.** Parking lots, fences and the other things you see in suburbia, never empty
   white ground.
6. **A warehouse parcel**: open-floor CQB with varied cover.
7. **No more random boxes** anywhere.
8. **Hold zones.** Some modes have the squad capture a zone and hold it. Maps must be built around this, because
   cover can be destroyed.

## 2. What the code does today

Measured on the Mac with a read-only audit script (seed 27, default sizes). "Plain ground" means paving, concrete or
lawn with no parcel purpose, measured outside building footprints.

| Map | Buildings | Road | **Plain ground** | Crate voxels outdoors | Vehicles not on asphalt |
|---|---|---|---|---|---|
| Park District | 15 % | 15 % | **67 %** | 294 | 1 / 9 |
| Market Arcade | 25 % | 14 % | **58 %** | 198 | 0 / 7 |
| Drainage Quarter | 11 % | 10 % | **74 %** | 337 | 1 / 3 |
| Sunken Junction | 13 % | 30 % | **52 %** | 26 | 3 / 3 |
| Sunken Boulevard | 11 % | 23 % | **63 %** | 20 | 0 |
| Freight Terraces | 12 % | 16 % | **70 %** | 51 | (containers on the yard) |

Causes, from the code:

| Symptom | Cause (file) |
|---|---|
| Large empty paving | `buildLargeDistrict` picks from 8–12 **hard-coded building rectangles** (`candidates`), and everything else stays `ground:'paving'`. Nothing owns the space between buildings. |
| Random boxes | **Stray crates in four places.** `m.line(...,'crate')` runs appear in `raisedPark`, `drainage`, the bridge parcel, the map-edge rows (x 0, y 24/30; 50,34; 18,39), and the sunken streets in `ConnectingDistricts`. `m.scatter(...)` (CoverScatter) runs in all six maps. `dressDistrictStreets` also adds "pedestrian cover" (crates, lockers, cabinets, bike racks) every 8–12 cells on the fixed rows y 31 and 41. |
| Cars where they make no sense | `dressDistrictStreets` uses **fixed rows** (y 34/37 and the rear road at y 63) and fixed loading-court coordinates. When the layout changes, vehicles land on paving. Sunken Junction places `m.car` at fixed points on paving. |
| A structure over the street | The elevated bridge parcel's grate deck spans y 23–35, and its stair runs y 36–38. Both sit on `roadX(34,38)` rows, with no building on the far side. |
| Levels are hand-placed | Sunken streets, ramps, the raised park and the drainage banks are coordinate code per theme. There is no general level generator. |
| Hold mode is unused in districts | Every district map sets `objective:{kind:'eliminate'}`. `hold` exists in `Battle.js`/`Objectives.js`, but no map is designed for it. |

What already works and stays:
- Roads with curbs.
- `placeStreetVehicle`, which gives whole-object hints plus an exact footprint.
- Building merges (`mergeDistrictBuildings`).
- Connector sockets and the reachability check.
- `solveWaveFunctionCollapse`, the `Fields.js` noise (fbm, distance, sightline, line of play) and street lighting.
- Footprint shapes (rectangle, L, T), the remix lab and the topography debugger.

The audit run checking structures over the road air column did not finish (the Mac disconnected). The overhang
above was found by reading the code, and S0 re-measures it.

## 3. Goal

Every playable cell outside the roads belongs to a parcel or a connection strip with a real-world purpose:
- shop fronts with their lots;
- yards behind fences;
- loading aprons, warehouses, plazas and alleys.

Every prop and vehicle exists because a parcel, a strip or a street rule put it there. Maps can climb from a sunken
start through 2–3 generated levels. Warehouses give open-floor CQB. Hold zones sit where destructible cover can't
erase the fight.

## 4. Non-goals

- New final art. New pieces are placeholder meshes from code with existing textures and tints.
- Changes to combat, damage, lockstep or lighting. The only addition is that objectives now use `hold` in districts.
- PLAN-05's road-tile mesh and road grammar. Roads keep their current `roadX`/`roadY` placement here, read from one
  road list.
- Underground layers (PLAN-03). The terraces here are surface levels, and underground flanks keep working beside them.
- Converting the old hand-built maps (Cedar Close, Main Street and others), except removing their scatter (decision 1).

## 5. Design

### 5.1 Pipeline (replaces the body of `buildLargeDistrict`)

```
FOOTPRINT + LEVELS ──► ROADS ──► BLOCKS ──► PARCEL MIX WFC ──► SUB-PARCEL WFC ──► STRIPS (PCP) ──► VEHICLE NOISE ──► BUILDINGS ──► CONNECTORS ──► GATES
shape, 1–3 terrace    road list   land      mix templates,    lots, yards,       alleys, verges,   stalls, kerbs,    facade +      ramps, stairs,   land use, roads,
bands, retaining      + ramps    between   nesting, merging  aprons, plazas      fences, hedges    docks only        interiors     skybridges       vehicles, levels,
walls                            roads                                                                                                               hold zone
```

Every stage writes to a new **land-use map**: one tag per cell, such as `road`, `sidewalk`,
`parcel:<id>/<use>`, `strip:<kind>` or `wall`. The gates read it, and the topography debugger shows it.

### 5.2 Blocks

After the levels and roads are fixed, the playable footprint minus roads and sidewalks is split into **blocks**:
connected areas on one level, bounded by roads, retaining walls and the map edge. Blocks are snapped to 2-cell
bays, so parcels and fences line up. A block edge is tagged by what it touches (road, retaining-wall top or foot,
map edge, neighbour block), and those tags become the sockets the mix solver must satisfy.

### 5.3 Parcel mixes ("within" and "merging")

A **mix** is a compound parcel template: a parent area with **child slots**. Mixes are JSON under
`shared/mission/parcels/mixes/`, each with:
- a size range in bays;
- edge sockets;
- child slots with relative rectangles;
- program tags;
- weights per family.

| Mix | Children (nested = inside, merged = shares an edge socket) | Notes |
|---|---|---|
| **Strip mall** | 2–4 shop shells (merged: walkable union or party wall) · front **parking lot** (merged on `shop-front`↔`lot-front`) · cart corral · pylon sign · rear service alley with a dumpster enclosure | Leon's example: a shopping building with its lot outside |
| **Supermarket** | big shop · large lot (2–4 stall rows) · fenced garden-centre yard (nested) · loading dock + trucks | landmark |
| **Diner / fast food** | diner · drive-thru lane looping the building · small lot · menu board | lane is a vehicle-only strip |
| **Gas station** | kiosk shop · canopy over pump islands (existing explosive pumps) · air/water stand · 4–6 stalls | |
| **Office + plaza** | office (2–4 storeys) · landscaped plaza (planters, low walls, light-pole bases) · visitor lot | good hold-zone host |
| **House plot** (suburb) | house · driveway (vehicle noise) · front lawn + low wall · back yard: privacy fence, shed, patio, play set · side gate | rows share back fences (merged) |
| **Townhouse row** | 3–5 merged narrow houses · shared rear parking court | |
| **Warehouse yard** | warehouse (§5.6) · loading apron with dock doors + backed-in trucks · container stack · perimeter chain-link fence + gate + guard booth · staff lot | industrial anchor |
| **Auto repair** | garage · forecourt (cars waiting) · tyre stacks · fenced salvage yard (nested) | |
| **Self-storage** | 3–5 long, narrow unit blocks · gated drive aisles · office | narrow-lane CQB |
| **Utility** | fenced substation (transformers use the existing electrical hazard) or a water tower or a cell mast | small filler |
| **Pocket park / playground** | fenced play area, play structures, paths, trees | Leon retired benches and bushes; a play structure, low wall and trees take their place |
| **Construction site** | hoarding fence, scaffold, material piles, portacabin, excavator | for awkward leftover space |
| **Vacant lot** | chain-link, gravel, overgrowth, one dumped car | capped at 1 per map |

**Nesting.** A child slot is solved inside its parent's rectangle. Examples: the lot of a strip mall, the salvage
yard inside auto repair, the garden centre inside the supermarket.

**Merging.** Two mixes in one block can share an edge whose sockets match. Examples:
- a lot that serves two shop fronts;
- two lots that become one larger lot;
- back yards that share one fence line;
- a warehouse apron that continues into a neighbour's.

Merged children become one land-use area with one fence or kerb treatment, and nothing doubles at the seam.

**Solver (WFC over blocks).**
1. Each block is split into candidate rectangles by a seeded guillotine split on bays. The split is biased by the
   `lot` noise layer and by family weights.
2. WFC assigns a mix to each rectangle, with these constraints:
   - frontage sockets must face a road, or a lot that faces a road;
   - every lot reaches a road through a **dropped-kerb driveway** that is not on a junction or a crossing;
   - the same mix is never next to itself, except house plots and townhouses;
   - there is at most one landmark;
   - heights follow the existing rule that nearby parcels can't both take the tallest option.
3. Rectangles that no mix fits are offered to a merge with a neighbour. Whatever is still left goes to strips (§5.4).

The weights come from the existing noise and the picture prior. The result is deterministic from
`hash(mapId, blockId, seed)`. **This replaces the hard-coded `candidates` list.** Building positions come out of
the mix templates.

**Sub-parcel WFC (inside a mix).** This runs on 2×2 bays with per-kind tiles:
- **Parking lot:** stall rows (90°, 2×4 per stall, painted lines), a drive aisle (3 wide, always clear), end
  islands (kerbed planting, a light-pole base), wheel stops, a cart corral, and accessible stalls by the entrance.
- **Yard:** lawn, patio, shed, play set, garden bed, fence line and gate.
- **Apron:** dock bay (truck slot plus a dock door), turning area, drum store, pallet bay.
- **Plaza:** paving pattern, planter, low wall, tree pit, light-pole base, kiosk.

### 5.4 Strips: the gaps between mixes

Leftover land is decomposed into strips and classified as in PLAN-05 §5.5:

| Gap | Touches | Strip |
|---|---|---|
| 0 | two building shells | building merge (existing passage, or a party wall) |
| 2–4 | buildings on both sides | **alley**: tarmac, drain, back doors, bins, a dumpster, a gate at one end |
| 2–4 | parcel and road | sidewalk extension, grass verge, or a hedge or low-wall frontage |
| 2–4 | parcel and parcel, no buildings | **boundary path** with a fence on each side |
| ≥ 6 | anything | a mix gets another try at the smaller size. If it still fails: a vacant-lot, field or pocket-green strip (capped) |
| any | the map edge | world-edge strip: wall, tall fence or embankment |

**Boundary treatments.** Every parcel edge gets a treatment chosen from the pair of uses on either side, for
example:
- yard | yard → privacy fence;
- lot | road → kerb plus a low hedge;
- warehouse | anything → chain-link;
- plaza | road → bollards.

Fences are real cover: chain-link gives no cover but blocks movement; privacy fence and brick wall are half cover
and destructible. Each fence has gates where routes cross it.

### 5.5 Vehicles from the noise map

Vehicles go only on **vehicle cells**: stalls, driveways, kerb parking lanes, dock bays, the drive-thru queue, the
salvage yard and the forecourt. Each one is aligned to its cell's direction. The steps:

1. **Occupancy field:**
   ```
   V(x,y) = fbm(seed,'vehicles') × programBias(mix, timeOfDay) × entranceProximity × pocketWeight
   ```
   - `entranceProximity`: stalls near the store entrance fill first, as in a real lot.
   - `pocketWeight`: stalls on the line of play are preferred, so cars become cover where the fight needs it.
2. Each vehicle area fills its stalls in descending V until it reaches the mix's target occupancy:
   - shop lot: 35–70 % by time of day;
   - house driveway: 0–2 cars;
   - dock bays: 1 truck per 2 bays.
3. Vehicle type comes from the program (sedan or hatch at shops, vans and trucks at docks, a semitrailer only in a
   dock bay or on a service road). Abandoned cars come only from a story beat.
4. Drive aisles, the dropped kerbs and one walkable route along every road always stay clear.

`dressDistrictStreets` keeps `placeStreetVehicle` and the specs. Its fixed rows and court coordinates are replaced
by kerb-lane and dock cells read from the land-use map. The debugger gets a **vehicle-noise overlay**.

### 5.6 Warehouse parcel (open-floor CQB)

- **Shell:** 24×20 to 32×24 cells. One tall storey (6 voxels clear), with a mezzanine office on one side at +3.
  Roller doors (3 wide) along the dock side, personnel doors on two other sides, a fire escape to the roof, and
  skylights (glass, visual only).
- **Interior bay WFC** over these tiles:

| Tile | Cover | Notes |
|---|---|---|
| Pallet racking (2 long, 2 high) | full, blocks sight | steel, tough. Racks form aisles. |
| Aisle / cross-aisle | none | 2–3 wide |
| Bulk stack | half (pallets) or full (crates, 2 high) | in bulk zones, never in aisles |
| Container | full, very tough | 0–2 per warehouse, on the bulk floor |
| Forklift | half | in an aisle end or the bulk floor |
| Structural column | full, effectively indestructible | every 8 cells. These are the durable anchors. |
| Mesh cage | none, see-through | a secure store with a gate |
| Conveyor run | half, long | 0–1 per warehouse |
| Mezzanine stair + rail | elevation | the office overlooks the floor |
| Dock strip | open | inside the roller doors; trucks are outside |

- **Variants:** distribution (racking-heavy), workshop (benches, machines), cold store (cage rooms) and **gutted**
  (half empty, bulk only; used as a hold zone).
- **Constraints:**
  - aisles form loops, with no dead end longer than 6 cells;
  - the longest interior sightline is 14 cells or less;
  - every floor cell is within 2 moves of cover;
  - at least 3 entrances on at least 2 sides, plus the mezzanine or roof route;
  - no racking blocks a door landing.
- The warehouse furniture kit replaces the current crate lines and `pallet` furnishing in warehouse rooms.

### 5.7 Buildings stay off the street; skybridges are the exception

**Road ownership.** Road, sidewalk, kerb and ramp cells are owned by the road. Nothing solid may be placed in the
**air column** above them, from datum +1 up to the top of the map. This covers building footprints, decks,
stairs, platforms and signs. The only things allowed there are:
- street furniture (lights, signs, the bus shelter), on sidewalk cells only;
- vehicles in kerb lanes;
- **skybridges**.

**Skybridge (a connector building):**
- It needs a building of 2 or more storeys on **both** sides of the road, directly facing.
- Its floor is at storey 2 or higher (baseZ + 3), which leaves 2 voxels of tactical clearance and a believable
  truck clearance.
- It is 3–4 cells wide and spans the road plus both sidewalks.
- There are no supports in the carriageway.
- Doors are cut into both buildings with clear landings, using the same code path as `mergeDistrictBuildings`.
- Its interior is a corridor room, so it shows in cutaways, noise and the room graph.
- At most 1–2 per map.

**The current elevated bridge parcel** is re-anchored, so its deck and stair sit on a block instead of road rows
34–38. It may become a skybridge only if a building stands opposite.

### 5.8 Terraced levels: sunken start to high ground

**Levels.** A map has 1–3 surface levels:
- L0: z = 1 (sunken);
- L1: z = 4 (street);
- L2: z = 7 (high ground).

These match the existing 3-voxel storey and `cutLevels`.

**Height plan.**
1. The design chooses a climb direction: the insertion edge is at L0 and the objective or evac is at L1 or L2.
2. A smooth noise field (the `district` layer) is quantised into level bands.
3. Band boundaries are snapped to bays and pulled onto **block edges and road lines**, so each block, and every
   parcel in it, is flat on one level.
4. A road may cross a boundary only through a **road ramp** tile (the existing `roadRamp`, 4 cells long per
   3 voxels, generalised by direction and width).

**Boundary treatments:**
- **Retaining wall:** concrete, with a railing or fence on the upper edge. This gives ledge cover above, and the
  wall face is a hard flank below.
- **Embankment:** stepped planted terraces, like the existing raised park, for park and suburb families.
- **Building in the slope:** a **split-level building** with ground-floor doors on the lower level and
  storey-2 doors on the upper. This is the XCOM 2 classic, and it uses the existing door and floor code with two
  entrance levels.

**Connections.** Every pair of adjacent levels needs at least 2 routes that are at least 10 cells apart, and at
least 1 of them must not be a ladder. The route kinds are:
- road ramp;
- stair promenade (2–3 wide);
- split-level building;
- parking-deck ramp (a new mix: a 2-level open deck with a ramp, which suits a terrace);
- fire escape;
- ladder or drainpipe as an extra shortcut.

**Parcels and levels.** Parcels never straddle a boundary, except the split-level kinds (building, parking deck,
stair plaza). Building height is capped per level, so the top storey stays under the store height. Height grows
from 18 to 22 only on 3-level maps, and that height is checked against the existing performance gate.

**Presets.** Sunken Junction and Freight Terraces become **level presets** of the generator, with the same names and
ideas, solved instead of coordinate-coded. Drainage keeps its channels as a sunken L0 band.

### 5.9 Hold zones built around destructible cover

**Zone placement.** When the objective is `hold`, the zone is placed **before** mixes are chosen. It acts as a pin,
the way PLAN-04 pins the objective lot. Zones are 6×6 to 8×8 on one level, hosted by a hold-capable mix:
- office plaza;
- parking lot centre;
- gutted warehouse floor;
- loading apron;
- a rooftop deck on a 1–2 storey building with 2 access routes.

**Design rules (enforced by gates):**
1. **Approaches:** at least 3 corridors from at least 2 sides, plus a vertical one (a higher level overlooking the
   zone, or a stair onto it).
2. **Cover tiers inside the zone:** at least 4 **hard anchors**, meaning material hp ≥ 12 per voxel or structural:
   columns, retaining-wall edges, building corners, jersey barriers, concrete planter walls, containers. The rest
   is soft cover: cars, crates, fences.
3. **Durability test:** delete all soft-cover voxels. The zone must still have half cover within 1 move for at least
   50 % of its cells, and one full-cover position facing each approach.
4. **Blast test:** greedily apply 3 frag blasts at the worst positions, using the existing damage model. One cover
   position per approach must survive.
5. **Fallback ring:** cover 4–8 cells outside the zone on each approach, so a lost zone can be retaken.
6. **Spawns:** no zone cell is visible from the enemy spawn, and the spawn is at least 20 path cells from the zone.
7. **Interior zones** have at least 2 entrances and no single-door room.

**Objective in districts.** The remix lab and `OperationDesigner` can pick `hold`:
`{kind:'hold', zone, rounds:3–4, needed:1}`, using the existing `Battle.objectiveRoundEnd`. The debugger shows the
zone, the anchors and the durability-test result.

### 5.10 No random boxes

Removed:
- every `m.scatter(...)` call in `LargeDistricts.js` and `ConnectingDistricts.js`;
- every free `m.line(...,'crate'|'sandbag')` run outside a parcel, strip or street rule;
- the y 31/41 "pedestrian cover" rows in `dressDistrictStreets`.

**Street furniture by rule.** These are placed on sidewalks by `StreetDressing`, with origin `road:<rule>`:
- a bus shelter at a stop;
- bike racks and parcel lockers at shop entrances;
- utility cabinets at corners;
- hydrants near junctions;
- bins at alley mouths.

**Prop origins.** Every exterior prop and vehicle carries an origin: `mix:<id>/<child>`, `strip:<kind>`,
`road:<rule>`, `level:<connector>` or `story:<beat>`. When the cover gate fails, repair tries these in order:
1. swap a mix or sub-parcel variant;
2. raise lot occupancy in a pocket;
3. add a boundary wall where a fence was.

Repair never scatters.

`CoverScatter.js` stays in the repo for the old maps until decision 1 is answered.

### 5.11 Gates (new, in `shared/mapgen/DistrictGates.js`)

| Gate | Rule |
|---|---|
| Land use | every playable cell has a tag; untagged or plain ground ≤ 8 %; no empty square larger than 8×8 outside roads, lots and plazas |
| Prop origin | 100 % of exterior props and vehicles have an origin; no scatter path is reachable |
| Vehicles | every vehicle is on vehicle cells, aligned, and clear of aisles, driveways and crossings |
| Road air column | no solid above road, sidewalk or ramp cells, except allowed furniture, kerb vehicles and skybridges |
| Skybridge | buildings on both ends, both doors reachable, clearance ≥ 2 voxels, no carriageway support |
| Levels | parcels are flat; each level is reachable; ≥ 2 routes per adjacent pair with ≥ 1 non-ladder; no ledge drop without a route back within 12 cells |
| Warehouse | loops, sightline ≤ 14, cover ≤ 2 moves, ≥ 3 entrances |
| Hold zone | §5.9 rules 1–7 |
| Existing | connector sockets reachable, parcel graph, cover, sightlines, support, performance |

## 6. Files

```
shared/mapgen/district/LandUse.js          land-use map, tags, plain-ground and empty-square metrics
shared/mapgen/district/TerraceLevels.js    level bands, retaining walls, embankments, road ramps, routes
shared/mapgen/district/Blocks.js           block extraction and edge sockets
shared/mapgen/district/MixCatalogue.js     loader + validator for shared/mission/parcels/mixes/*.json
shared/mapgen/district/MixSolver.js        guillotine split + WFC over mixes, nesting, merging
shared/mapgen/district/SubParcels.js       lot, yard, apron, plaza bay WFC
shared/mapgen/district/Strips.js           gap classification + boundary treatments
shared/mapgen/district/VehicleNoise.js     occupancy field and vehicle placement
shared/mapgen/district/Warehouse.js        warehouse shell + interior bay WFC + variants
shared/mapgen/district/Skybridge.js        connector building across a road
shared/mapgen/district/HoldZone.js         zone pin, hosts, durability and blast tests
shared/mapgen/DistrictGates.js             §5.11
shared/mission/parcels/mixes/*.json        the ~14 mixes in §5.3, 2–3 variants each
shared/mission/LargeDistricts.js           pipeline §5.1; candidates, crate lines and scatter removed
shared/mission/ConnectingDistricts.js      level presets; scatter and crate lines removed
shared/mapgen/StreetDressing.js            vehicles from land use; furniture by rule; fixed rows removed
shared/mapgen/DistrictRemix.js             new controls: levels, mix density, family, objective, skybridges
shared/mission/PropCatalog.js, shared/voxel/Materials.js
                                           new pieces/materials where missing: wheel stop, cart corral, light-pole base,
                                           privacy fence (exists), chain-link (exists), racking, forklift, column,
                                           dock door, play structure, shed, scaffold, transformer
client/src/render/kit/*                    placeholder meshes for the new pieces
client/src/ui/TestGroundPanel.js, TopographyPreview.js
                                           controls + land-use, vehicle-noise, level and hold-zone overlays
tools/mapgen/district-audit.mjs            the §2 audit as a script (baseline and every step)
docs/LARGE-DISTRICTS.md, docs/MAPGEN.md, docs/mechanics/*   method, formats, gates
```

## 7. Steps (each its own commit, test first)

| # | Step | Accept when |
|---|---|---|
| S0 | `district-audit.mjs` + baseline report and screenshots for the 6 maps × seeds 1–4 (adds the road-air-column count) | report saved; no behaviour change |
| S1 | `LandUse` + `DistrictGates` in **report mode** (no failures yet) | the gates run on all 6 maps; numbers match S0 |
| S2 | Remove random boxes (§5.10): scatter, crate lines and pedestrian rows go; street furniture by rule | zero outdoor crate voxels without an origin; a scatter-reachability test passes; cover drop recorded (expected, fixed in S4) |
| S3 | Road ownership + re-anchor the bridge parcel + `Skybridge` | the road-air-column gate passes on all maps; a skybridge fixture builds with both doors reachable |
| S4 | `Blocks`, `MixCatalogue` (14 mixes), `MixSolver`, `SubParcels`, `Strips`; `buildLargeDistrict` uses them | plain ground ≤ 8 % on Park, Market and Drainage at both sizes and all 3 shapes, seeds 1–4; Leon reviews the mix previews; cover gate passes without scatter |
| S5 | `VehicleNoise`; `dressDistrictStreets` reads the land use | vehicle gate passes; the occupancy overlay shows; same seed gives the same cars |
| S6 | `Warehouse` parcel + warehouse-yard mix | warehouse gates pass on 20 seeds; screenshots of the 4 variants |
| S7 | `TerraceLevels` + split-level building + parking deck; Sunken Junction and Freight Terraces become presets | levels gate passes on 20 seeds per preset; a 3-level map (L0 → L2) builds within the performance gate |
| S8 | `HoldZone` + `hold` in districts and operations | hold-zone gates pass on 20 seeds; the sim runs 30 hold battles with no zone that becomes coverless after destruction |
| S9 | Remix lab controls + debugger overlays | browser QA of the controls and overlays; save/load and share links keep the new settings |
| S10 | Docs, full test suite, balance-sim run, before/after screenshots | all tests pass; byte-identical rebuilds; co-op hashes agree; Leon reviews against S0 |

S2 and S3 are small and can ship first. S4 is the main change.

## 8. Tests

- **Land use:** every cell tagged; fixtures that cross the plain-ground and empty-square thresholds.
- **Mixes:** schema; nesting inside the parent's rectangle; merge on matching sockets only; no identical neighbours;
  driveways off junctions; determinism.
- **Vehicles:** on vehicle cells only; aisles clear; occupancy targets; noise determinism; types by program.
- **Road ownership:** a deck planted over a road fails; a skybridge without an opposite building fails; skybridge
  clearance.
- **Levels:** flat parcels; route count and spacing; ramp geometry; split-level doors on two levels; height cap.
- **Warehouse:** aisle loops, sightline cap, cover distance, entrances, variants.
- **Hold zone:** each of rules 1–7 has a failing fixture; durability and blast tests are deterministic.
- **End to end:** 6 maps × seeds 1–4 × sizes and shapes; connector validation; byte-identical rebuilds; co-op
  lockstep; the sim completes.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Filled space makes maps cramped or slow to cross | lots and plazas stay open but purposeful; the line-of-play corridor is reserved; existing lane and sightline gates; strips keep alleys walkable |
| Fences fragment movement | gates where routes cross; boundary paths; a reachability test per parcel |
| Parking lots become car walls | occupancy targets, aisles always clear, pocket weighting places cars where cover is needed and nowhere else |
| 3-level maps exceed height or performance | per-level storey cap; height 22 only on 3-level maps; performance gate |
| Hold zones get too strong for defenders | the fallback ring and the vertical approach give attackers options; the sim measures the hold win rate |
| Mix templates feel samey | 2–3 variants per mix, sub-parcel WFC, merges; a variety test across seeds |

## 10. Rollback

- Each step is its own commit.
- The new pipeline sits behind `generatorVersion:'district-mix-v3'`. The remix lab keeps a "legacy layout" switch
  until S10, so v2 descriptors still rebuild.
- The scatter removal (S2) is one commit and can be reverted on its own.

## 11. Decisions

Recorded from Leon (2026-10-13): everything in §1.

Open (the default applies if unanswered):
1. **Old maps' scatter.** Cedar Close, Main Street, Harbor, Route 9 and the Training Facility also use
   `CoverScatter`. **Default: remove it from the district and split-level maps now (S2), and from the old maps only
   after they get parcel dressing.** Removing it there now would leave them low on cover.
2. **Level count.** **Default: up to 3 levels (L0 1 / L1 4 / L2 7)**, or cap at 2 for performance?
3. **Hold rules.** **Default: 6×6–8×8 zone, 3–4 rounds, 1 soldier needed**, using the existing hold rule (no
   hostile in the zone).
4. **Mix authoring.** **Default: Codex authors the 14 mixes as JSON and Leon reviews them in the debugger preview.**

## Codex brief (compact)

- **Owner:** Codex (implementation), Hermes (verification), Leon (approval per step).
- **Goal:** S0–S10, one step at a time after approval.
- **Non-goals:** §4; no edits outside the repo; no changes to combat, lockstep or lighting.
- **Inputs:** this plan, the repo at `d31cd2d` or later, `docs/LARGE-DISTRICTS.md`.
- **Acceptance:** the §7 column for each step; the §5.11 gates in enforcing mode from S4 on.
- **Evidence:** changed files, commands, test output, `district-audit` before/after numbers, screenshots (S0, S4,
  S6, S7, S10), gate reports, risks, rollback.
- **Secrets:** none in the repo or the handoff.

## 12. Implementation record (2026-10-13)

Leon approved the plan by asking for it to be implemented. Claude implemented it directly, test first per step, and
used the §11 defaults:
1. The old maps keep their scatter.
2. Up to 3 levels.
3. 7 × 7 zones, held for 4 rounds by 1 soldier.
4. Claude authored the mixes.

### Built

| Step | Where |
|---|---|
| S0 audit | `tools/mapgen/district-render.mjs` (isometric, roof-cut and land-use previews) plus the gate metrics in `meta.districtGates` |
| S1 land use + gates | `district/Core.js`, `DistrictGates.js` |
| S2 random boxes removed | scatter, crate lines and pedestrian rows are gone from `LargeDistricts.js`, `ConnectingDistricts.js` and `StreetDressing.js`; street furniture is placed by rule |
| S3 road ownership + skybridge | `district/Skybridge.js`; the bridge parcel became the `raised-market` mix |
| S4 blocks + mixes + strips | `district/MixSolver.js`, `district/MixCatalogue.js` (18 mixes), `district/Props.js` |
| S5 vehicle noise | `district/VehicleNoise.js`; kerb slots, bus stops and road sets in `StreetDressing.js` |
| S6 warehouse | `district/Warehouse.js` (4 variants) |
| S7 terraces | `district/TerraceLevels.js`, new map **Hillside Terraces** (`terrace-district`) |
| S8 hold zones | `district/HoldZone.js`; `hold` in the district builders |
| S9 lab + debugger | remix controls (mix family, objective, levels, skybridges); land-use and slot layers; `district.*` gates |
| S10 tests + docs | `shared/mapgen/parcel-mixes.test.js`, updated district tests, `docs/LARGE-DISTRICTS.md` |

### Differences from the plan

- **Mixes are a JS catalogue, not JSON.** Their layouts are procedural, sized to the parcel. Metadata (sizes,
  frontage, weights, caps, hold host) is declarative in `MixCatalogue.js`.
- **Four mixes were added:** `mainstreet-row` (frontage buildings and skybridge candidates), `surface-lot`, the
  `raised-market` covered market, and `community-garden`.
- **Two passes were added:**
  - curtilage strips, for rings around hand-placed buildings;
  - cover repair by land use (`district/CoverRepair.js`), so the existing cover-gap gate passes without scatter.
- **No warehouse mezzanine.** The 3-voxel storey rule makes halls one storey. A mezzanine needs a new tall-hall
  building kind.
- **The split-level maps were not fully regenerated.** Sunken Junction, Sunken Boulevard and Freight Terraces keep
  their skeletons and get the generator's fill. The fully generated multi-level map is the new Hillside Terraces.
- **Lanes goal.** `meta.lanesGoal` lets the lanes metric aim at the hold zone, or at the main enemy building's
  door, instead of the centroid of the enemy spawns.

### Evidence

- **Gates.** All mission gates and district gates pass on:
  - Park, Market and Drainage, seeds 1–7 and 27;
  - Hillside Terraces, seeds 1–5;
  - the three split-level maps, seeds 1, 3, 17 and 27;
  - hold missions on every district map.
- **Plain ground** is 0 % on every district (it was 52–74 %). There are no unregistered exterior solids, no
  vehicles outside slots, and nothing over the roads except skybridges.
- **Rooms and exits.** Every gameplay room and exit is reachable on 7 maps × 6 seeds.
- **Tests.** `npm run test:fast`: 237 / 238 pass. The one failure needs a concept PNG that was not in the review
  copy; it passes in the repo. Server tests: 10 / 10.
