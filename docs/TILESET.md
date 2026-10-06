# Tile set (2026-10-07)

Buildings and cover are no longer drawn as cubes. Each structure or cover voxel is drawn with a piece from a
pre-baked tile set, picked from its material and its neighbours. Gameplay doesn't change: movement, cover, line
of sight, ballistics and destruction still run on the voxel grid.

## Pipeline

| Step | File |
|---|---|
| Piece definitions (three.js geometry, no DOM) | `client/src/render/kit/KitPieces.js` |
| Bake to GLB + manifest | `npm run kit:bake` → `tools/kit/bake_tileset.mjs` → `client/public/assets/kit/tileset.glb`, `tileset.json` |
| Load, resolve material slots, world-space UVs | `client/src/render/kit/KitLibrary.js` |
| Autotile voxels into instanced pieces per chunk | `client/src/render/kit/KitView.js` |
| Sloped roofs from roof voxels | `client/src/render/kit/RoofBuilder.js` |
| Tests (bounds, coverage, cutaway, roofs) | `client/src/render/kit/kit.test.js` |

The contract is vibe-game's MeshKit contract (PLAN 19 §1.2–1.4), unchanged:
- one cell spans x, z ∈ [−0.5, 0.5] and y ∈ [0, 1], with the pivot at the centre of the cell floor;
- pieces that run in a line are authored along +X;
- meshes never define collision;
- a triangle budget applies (1,200 per piece; the whole set is about 4.1k).

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

These are gone: random stone stubs and "ruins", stacked stone-cube "rocks", and building-wall material standing
in open fields. Building walls are now used only for buildings, and for the Proving Grounds' range targets, which
are deliberate sections of each wall type to shoot through.
