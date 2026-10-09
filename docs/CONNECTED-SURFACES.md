# Connected surfaces and physical cover

The game keeps a deterministic movement/destruction grid, but the default presentation does not outline that grid. Characters remain animated 2D sprite billboards. Movement overlays have a continuous translucent fill and a perimeter, rather than separate highlighted squares. The optional debug grid and ledge rims start disabled.

## Wall modules

`shared/voxel/ConnectedShapes.js` owns the footprint shared by the baked kit, projectile/sight rays and cover sampling. Walls are 0.4 cells thick. The 16 E/S/W/N masks cover posts, end caps, straight runs, L corners, T junctions and crossings. Stucco, brick, concrete, siding and legacy structural walls can join one another and doors/windows. Only face neighbours connect; diagonal proximity never seals an intended gap.

Exposed footprint corners use five-segment quadratic curves with a maximum 0.12-cell radius. Joined boundaries remain exact and their internal side faces are omitted. Renderer caps follow the same curved footprint. Adding, removing or burning a neighbour changes the mask; adjacent render chunks are dirtied by VoxelStore. Regenerate the distributable kit with `npm run kit:bake` after geometry changes.

Movement still reserves a wall's grid cell, so a unit cannot path through the thin visual margins. Those margins are open to bullets and sight rays. This deliberately separates movement occupancy from projectile geometry. Furniture and vehicle collision remains its existing voxel envelope; this change does not claim mesh-exact collision for decorative legs, handles or plants.

## Cover and ballistics

Ray traversal first finds a candidate voxel, then intersects its connected polygon prism. Grenade arcs use segment rays too. Window/door planes share their orientation with the renderer; small opening frames are represented by the plane's conservative thickness rather than separate decorative meshes. Open door leaves are cosmetic and provide no cover.

Directional shields sample five rays across a 0.76-cell body-width band at lower and upper body height. At least four hits in both bands means full cover; at least two in either band means half. A narrow isolated post or wall end cannot grant full protection. Cover remains a directional tactical rating; individual projectiles use the actual polygon. Destroyed sections immediately lose their cover and obstruction. Window cover remains fragile: a projectile crossing the pane stops there and destroys it; later projectiles
pass through the new opening.

## Grouped cover

Hedges, planters, sandbags and dry-stone field walls use the same post-and-arm silhouettes at their own thickness
(`BANDS` in `ConnectedShapes.js`: hedge 0.86, planter 0.8, sandbags and field walls 0.62; barriers, fences and
chain-link have bands for collision too). A lone piece is a rounded post; face neighbours of the same family join into
one run with rounded outside corners, so a line of sandbags or a box hedge reads as one object. The renderer draws
exactly the collision polygon (`joined_<family>_<mask>_top|full` in `ConnectedPieces.js`; planters add soil and
planting per cell). Consequences: a lone two-high sandbag stack is **half** cover (shots pass its sides), a joined run
is full; hedges stay concealment only.

**Standing and vaulting.** Walls and low cover are not walkable (`walkable: false`): a unit can no longer stand on a
0.4-thick wall or a sandbag. Instead it vaults one-high cover in a straight line (`canVault` in
`shared/world/PathSearch.js`, cost 2.6 for the two cells, a hop in the move animation); two-high walls are gone round.

**Oblique fire.** `coverAgainst` (hit chance, flanking, AI) samples its five-ray body band along the actual line of
fire through the face neighbour, not straight on, so a shot that comes round a wall end or corner post is rated by
what it crosses. The HUD's per-face shields still use the straight-on rating. An audit of every third reachable tile on
all five maps against 16 shooter bearings (rays from 7 cells, 9 body points each) found the rating and the geometry
disagree in 4 of ~18,000 cases (diagonal neighbours); full cover blocked 100 % of those rays, half 62 %, none 0 %.

## Ground and water

Ground keeps continuous world-space UVs, shared vertex colours and four-segment rounding on exposed top edges. Adjoining coplanar cells are not individually bevelled. The small terrain edge bevel is cosmetic; terrain movement and structural support stay voxel-based.

Grouped terrain (raised beds, berms, tiers, kerbs) rounds like building-game blocks: wherever a terrain voxel faces
open space its top edge gets a quarter-round fillet, its exposed vertical corners become quarter cylinders, and a
sphere octant joins them; faces against other terrain stay flush, so touching blocks merge into one smooth mass.

Water and ice lie 0.2 below the bank top, so a pond reads as a recess with banks, not a raised slab; a wading unit
stands knee deep (render drop 0.45), units on ice stand on the ice. Ice over deep water is its own material
(`deep_ice`) and melts back into deep water — a frozen crossing doesn't leave a wadeable shallow behind. Cooled lava
becomes stone floor (ground), not a wall module.

Shallow and deep water share a single surface material with continuous UVs, blended depth shading, no internal vertical faces and rounded outside shoreline corners. Ice uses the same shoreline footprint, including when adjacent water has not frozen. Liquid water supplies no cover and bullets pass through it. Shallows remain wadable, deep water remains blocked; the existing elemental system freezes water into walkable physical ice and melts it back. An elevated ice volume can supply cover; ground-level ice is simply a surface beneath the unit's feet. Lava is its own connection family.

## Mobile graphics (default)

`client/src/render/Quality.js` picks **mobile** unless `?quality=high` or Options ⚙ → Graphics → High (stored per
browser, reloads). Mobile uses `assets/textures/mobile/` (256 px painted albedo, 128 px softened normals, ~1 MB for
the whole set vs 8.7 MB; `python3 tools/art/make_mobile_textures.py`), a 2048 shadow map, render scale ≤ 1.25,
anisotropy 2 and no ambient-occlusion pass.

## Verification

Run `npm test` and `npm run build`. New tests cover all wall masks, rendered/collision boundary parity, triangle winding, cross-chunk joins and removal, rays through empty wall margins, vertical rays, cover changes, glass misses, water/ice elemental transitions, seamless water depth joins, shared terrain colours and disabled grid defaults. The existing map suite checks deterministic builds, all five maps' design gates across four seeds, room/exit reachability, and co-op lockstep.
