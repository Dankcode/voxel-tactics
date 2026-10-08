# Tile set (2026-10-07, present-day set 2026-10-08)

Buildings and cover are no longer drawn as cubes. Each structure or cover voxel is drawn with a piece from a
pre-baked tile set, picked from its material and its neighbours. Gameplay doesn't change: movement, cover, line
of sight, ballistics and destruction still run on the voxel grid.

## Pipeline

| Step | File |
|---|---|
| Piece definitions (three.js geometry, no DOM) | `client/src/render/kit/KitPieces.js` (legacy + walls), `ModernPieces.js` (present day), helpers in `Geo.js` |
| Bake to GLB + manifest | `npm run kit:bake` → `tools/kit/bake_tileset.mjs` → `client/public/assets/kit/tileset.glb`, `tileset.json` |
| Load, resolve material slots, world-space UVs | `client/src/render/kit/KitLibrary.js` |
| Autotile voxels into instanced pieces per chunk | `client/src/render/kit/KitView.js` |
| Sloped roofs from roof voxels | `client/src/render/kit/RoofBuilder.js` |
| Tests (bounds, coverage, cutaway, roofs) | `client/src/render/kit/kit.test.js` |

The contract is vibe-game's MeshKit contract (PLAN 19 §1.2–1.4), unchanged:
- one cell spans x, z ∈ [−0.5, 0.5] and y ∈ [0, 1], with the pivot at the centre of the cell floor;
- pieces that run in a line are authored along +X;
- meshes never define collision;
- a triangle budget applies (1,200 per piece; the whole set is about 20k triangles over 150 pieces);
- present-day furniture and objects face **+Z** (their back, against a wall, is −Z);
- whole objects (car, container, dumpster, trees) and tall decor are authored around their own footprint centre and
  may leave the cell (`meta.overhang`).

Each part names a **material slot**, not a texture:

| Slot | What it resolves to |
|---|---|
| `self` | the voxel's own material, e.g. a stone, plaster or timber wall |
| `trim` | dark timber |
| `quoin` | dressed stone |
| `wood`, `door`, `glass`, `iron`, `glow`, `cloth` | as named |
| `crate`, `barrel`, `hay`, `sandbag`, `drystone`, `rock` | the matching cover texture |
| `leaves`, `hedge`, `bark` | foliage textures |
| `cap` | the dark section cap used by the cutaway |
| `roof` | roof tiles |
| `frame` | dark aluminium / steel: window and door frames, wall caps, furniture legs |
| `plinth` | dark concrete skirting at the foot of walls, kerb-coloured bases |
| `leaf`, `chrome`, `lacquer`, `worktop`, `porcelain` | door leaves, handles, kitchen fronts, worktops, sanitaryware |
| `upholstery`, `linen`, `accent`, `self_dark` | sofas, bedding, throws and cushions, dark seats |
| `carpaint`, `glass_dark`, `tyre`, `lamp`, `tail` | vehicles (carpaint takes the per-car colour) |
| `screen`, `shade`, `pot`, `rug`, `canvas`, `canvas_white` | TVs and monitors, lamp shades, plant pots, rugs, prints, umbrellas and signs |
| `goods_a/b/c`, `cardboard`, `books` | stock on shelves, boxes on pallets, books |
| `mesh`, `post`, `lid`, `red`, `steel_yellow`, `needles`, `shutter`, `wreck`, `soil`, `flowers` | chain-link, fence posts, bin and dumpster lids, hydrants and pumps, crane steel, conifer needles, roller shutters, burnt-out wrecks, planter soil and flowers |

Wall, trim and stone slots use **world-space UVs**: the vertex shader projects them from world position, so a
wall built from many pieces reads as one continuous surface.

### Replacing pieces with real art

1. Export `client/public/assets/kit/tileset-art.glb`: one node per piece, named exactly as in the table below,
   pivoted and oriented by the contract above, with materials named after the slots.
2. Reload the game. `KitLibrary` loads `tileset-art.glb` after `tileset.glb`, and any piece found there replaces
   the placeholder.
3. Leave out any piece you haven't made yet; the placeholder stays.

## Pieces

| Group | Pieces |
|---|---|
| **wall** | `wall_core`, `wall_arm`, `wall_beam`, `wall_beam_core`, `wall_post`, `wall_quoin`, `wall_brace`, `coping_core`, `coping_arm` |
| **cutaway** | `cap_core`, `cap_arm` |
| **opening** | `window`, `door_lower`, `door_upper`, `door_open_lower`, `door_open_upper` |
| **light** | `sconce`, `lamp_post`, `lamp_base`, `lantern` |
| **stairs** | `stair_block`, `stair_step`, `stair_rail` |
| **cover** | `crate`, `barrel`, `sandbags`, `drystone`, `fence`, `hay`, `rock#0–2`, `rock_top`, `cart_body`, `cart_end`, `cart_wheels`, `cart_shaft`, `stall` |
| **foliage** | `hedge`, `foliage`, `trunk`, `trunk_base` |
| **interior** | `table`, `shelf` |
| **decor** | `banner`, `crystal` |
| **modern walls** | `mcap_core`, `mcap_arm` (dark metal cap on exposed tops), `plinth_core`, `plinth_arm` |
| **glazing** | `glaze` (full-width pane with half mullions), `glaze_sill`, `glaze_head` |
| **modern doors** | `mdoor_*` (flush timber), `gdoor_*` (glazed storefront), `roller_*` (roller shutter) — `lower`, `upper`, `open_lower`, `open_upper` |
| **furniture** | `sofa`, `sofa_end_l/r`, `booth`, `bed_head/foot(_single)`, `kitchen`, `kitchen_sink`, `kitchen_hob`, `island`, `fridge_lower/upper`, `washer`, `tv_unit`, `wardrobe_lower/upper`, `desk_end_l/r`, `desk_mid`, `workbench`, `bookcase_lower/upper`, `store_shelf_lower/upper`, `cooler_lower/upper`, `checkout`, `counter`, `vanity`, `pallet`, `pallet_top`, `locker_lower/upper` |
| **street / yard** | `planter`, `privacy_fence(_top)`, `chainlink(_top)`, `jersey`, `bench`, `bin`, `pump`, `hedge` (clipped), `column` |
| **whole objects** | `car` (4 × 2), `container` (5 × 2 × 2), `dumpster` (2 × 1), `tree_round`, `tree_conifer`, `wreck` |
| **decor (visual only)** | `rug`, `coffee_table`, `floor_lamp`, `plant`, `plant_tall`, `tv`, `wall_art`, `stool`, `nightstand`, `office_chair`, `monitor`, `toilet`, `shower`, `cafe_table`, `register`, `streetlight`, `floodlight`, `mailbox`, `hydrant`, `flowers`, `shrub`, `patio_set`, `umbrella`, `drain`, `bollard`, `bus_stop`, `gate_sign`, `crane_leg`, `price_sign`, `air_pump`, `motel_sign`, `canopy`, `stepping` |

## Autotiling rules (KitView)

- **Walls** (stone, plaster, timber) are 0.4 voxel thick, about the thickness of a real wall.
  - Each wall cell draws a post plus one arm toward each neighbouring wall, window, door or lantern at the same height.
  - Plaster and timber get dark corner posts and a storey beam under each floor. Stone gets dressed quoins.
  - Straight timber runs get occasional diagonal braces.
  - An exposed wall top (parapet, range wall) gets coping. A wall sliced by the storey cutaway gets a dark section cap, as in XCOM.
  - Floor slabs stay full cubes, so between storeys they show as a string course and a plinth.
- **Windows:** glass in a wall run becomes piers, a lintel, a frame, a pane and a sill, in the wall's material.
- **Doors:** framed doors two voxels tall. Open doors swing in.
- **Stairs:** the top stair voxel becomes two treads facing up the run. Stair voxels below it become solid blocks.
- **Roofs:** the stack of roof voxels becomes one continuous tiled surface.
  - Each grid corner takes the mean height of the four roof columns around it, so 1-voxel steps become 45° slopes.
  - Corners on the outline are pushed out and down into eaves.
  - A knee wall in the building's wall material closes the attic under the eaves.
  - Destroying a roof voxel lowers that part of the roof, or opens a hole.
  - **Pitched roofs are not walkable** (`Materials.roof.walkable = false`); flat roofs are.
- **Cover props** follow their line (sandbags, field walls, fences, hay, carts, stalls).
  - Carts get wheels on every cell, a tailboard at each end, and shafts at the front.
  - Boulders, crates, barrels and bushes get a stable random turn per tile.
  - A lone iron column is drawn as a lamp post.

## Present-day rules: hints, whole objects, decor

Missions built with `shared/mission/modern/` carry `mission.visual`:

- **hints** `'x,y,z' → { piece, yaw }`: the building generator knows which way a sofa faces and which bed cell is the
  head, so furniture is drawn exactly as placed. A voxel without a hint (e.g. placed in debug mode) falls back to
  autotiling (back to the nearest wall).
- **whole objects**: a car, container, dumpster or tree has an anchor hint listing its cells. While every cell is
  intact the anchor draws one piece (with the car's colour); once one is destroyed the rest are drawn as `wreck`
  fragments (trees: trunk and canopy blobs). `VoxelView` keeps a chunk dependency map so damage in one chunk
  redraws the anchor's chunk too.
- **decor** `[{ kind, x, y, z, yaw, w?, d? }]`: purely visual (no voxels, no hash). Drawn while its cell is empty and
  what it stands on still exists, so blowing up a floor takes the rug with it. Tall outdoor pieces (trees, street
  lights, the forecourt canopy) are not sliced by the storey cutaway.

Modern walls (`stucco`, `brick`, `concrete_wall`, `siding`) have no timber posts or quoins: a plinth at the floor,
a dark metal cap on exposed tops (parapets, garden walls) and the dark section cap where the cutaway slices them.
Glass stacked two high in a modern wall reads as floor-to-ceiling glazing. Doors pick their style from the wall:
roller shutters where the generator asked for one, glazed doors in a storefront, flush timber doors elsewhere.

## Cover catalogue

`shared/mission/PropCatalog.js` lists the only things the outdoor cover pass may place. Each is a real object with a
gameplay job:

| Prop | Cover | Where | Gameplay |
|---|---|---|---|
| Sandbag line | half | anywhere | soaks blasts (6 hp per voxel) |
| Dry-stone field wall | half | fields | tough (8 hp), leaves rubble |
| Plank fence | half | fields | burns; a blunderbuss chews through it |
| Hay bales | half | fields | highly flammable |
| Crate | half | streets | breaks easily |
| Stacked crates | full | streets | full cover until it is shot apart |
| Barrels | half | streets | about 30 % are powder kegs that explode when hit; water barrels douse fire and soak |
| Cart | half | anywhere | wooden, burns |
| Market stall | half | streets | counter cover; burns |
| Boulder | full | fields | very tough (14 hp) |

Hedges stay as concealment only: bullets pass through them.

Present-day catalogues (planters, privacy fences, low brick walls, jersey barriers, bins, benches, pallets, crate
stacks, fuel drums, vending machines) are listed in `docs/LEVELS.md`.

These are gone: random stone stubs and "ruins", stacked stone-cube "rocks", and building-wall material standing
in open fields. Building walls are now used only for buildings, and for the Proving Grounds' range targets, which
are deliberate sections of each wall type to shoot through.
