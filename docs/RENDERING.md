# Rendering (2026-10-06, updated 2026-10-07)

The voxels keep their block shapes; what changed is how they're drawn. Before this, every voxel face was
an unlit flat colour. Now it's a lit, textured surface, in the spirit of XCOM 2's tactical view.

## Pipeline

| Piece | File | What it does |
|---|---|---|
| Render table | `client/src/render/RenderTable.js` | Per voxel material: texture name, voxels per texture tile, world or per-face UVs, roughness / metalness, normal strength, opacity, emissive, side-face override (grass sides get the fringe texture), macro variation |
| Mesher | `client/src/render/ChunkMesher.js` | Terrain and slabs only; voxels the tile set draws are skipped and do not hide their neighbours' faces. Face-culled 16³ chunks, one buffer per render material, world-space UVs (continuous across voxels) or per-face UVs (barrels, crates, hay, grass sides), vertex colours carrying corner AO, a little per-voxel jitter, large-scale brightness variation (hides tiling on big fields) and the fog-of-war tint. Storey cutaway: voxels at or above the cut are skipped and the exposed tops become dark section caps |
| Materials | `client/src/render/MaterialLibrary.js` | Loads `assets/textures/pbr/<name>.jpg` + `<name>_n.jpg`, builds one `MeshStandardMaterial` per render key (sRGB albedo, tangent-space normal map, anisotropic mip-mapped filtering), scrolls the water normals |
| Scene | `client/src/render/Scene.js` | ACES filmic tone mapping, sun with a 4096² shadow map fitted to the map, sky / ground hemisphere fill, `RoomEnvironment` reflections, gradient background, lighting presets `day` / `dusk` / `night` (Options ⚙ or the debug View tab) |
| Units | `client/src/units/UnitView.js` | Billboarded character quad with mip-mapped linear filtering (no more pixel look), sun shadow cast through the sprite's alpha, soft contact shadow, XCOM-style segmented health pips |
| Overlays | `client/src/render/Overlays.js` | Blue / yellow move-zone outlines with faint fills, path ribbon, destination marker, cover shield sprites, aim cone, throw arc and blast disc, overwatch wedges, debug tile and line layers |

## Buildings and cover: the tile set

Structure and cover voxels are drawn with a pre-baked modular tile set instead of cubes: thin walls with timber
or quoins, framed windows and doors, real stair treads, sloped tiled roofs with eaves, and props that look like
the objects they are. See `docs/TILESET.md`. Terrain and floor slabs are still textured voxel cubes.

## Height and navigability cues

These follow vibe-game's PLAN 22 D6/D7, adapted:

| Cue | How |
|---|---|
| Tile grid | A thin light outline on every walkable top face, drawn in the terrain shader from world position (about 1.5 px at any zoom, no geometry). Not drawn on pitched roofs, wall tops or water. |
| Ledge rims | A warm rim on any walkable edge where the ground drops. It turns orange when the drop is 2 or more voxels. |
| Cliff seams | Side faces darken toward the bottom of each voxel row, so a cliff reads as a stack of steps, and higher ground is slightly brighter. |
| Drop line | Units standing 2+ voxels above the lowest ground in their column (roofs, upper floors) show a dashed line and a ring on the ground below. |
| Hover | The move tooltip says how many voxels up or down the tile is from the selected soldier. |
| Not walkable | Pitched roofs have no grid and never show in the move zones. |

Options (⚙) toggles the grid, the rims and ambient occlusion.

## Lighting

- Sun with a 4096² shadow map, a sky and ground hemisphere fill, and `RoomEnvironment` reflections.
- A cool **back light** without shadows. It keeps walls facing away from the sun readable and separates
  silhouettes.
- **GTAO ambient occlusion** through an `EffectComposer`. It runs at full resolution with a denoise pass, and leaves
  out overlays, sprites and transparent objects (`Scene.makeComposer`).
- **Lantern lights**: a pool of 8 warm point lights follows the lanterns nearest the camera's focus. They are
  brighter at dusk and night (`render/LanternLights.js`).
- Presets: day, dusk, night.

## Textures

`tools/art/make_textures.py` writes 39 seamless 512 × 512 textures, each with a normal map, plus
`docs/textures-contact-sheet.jpg`:

- From vibe-game's photographic atlas (`assets/materials/rustic-atlas.jpg`): **cobblestone, plaster, wood planks,
  grass**. Graded variants of these give timber walls, doors, furniture, shelves, wooden and stone stairs, crates
  (with a frame) and forest floor.
- Generated in the same painted-photo style (spectral noise, Voronoi stones, block and tile patterns): stone and
  city-wall ashlar, flagstones, bedrock, soil, road, sand, snow, roof tiles, bark, iron plate, sandbags, hedge,
  leaves, water, ice, rubble, ash, leaded glass, striped awning cloth, crystal, lava, barrels, lantern, hay, and
  the grass-side fringe.

To swap one: drop a seamless JPEG with the same name into `client/public/assets/textures/pbr/` (any power of
two). The normal map is optional. Scale and surface response are tuned in `RenderTable.js`.

## Costs

The Proving Grounds draws in about 170 calls and 17k triangles. Destruction rebuilds only the dirty chunks
(a few ms each). Changing the cutaway level rebuilds every chunk: 40–150 ms, depending on map size. If that
hitch matters on big burgs, the mesher is pure and can move into a worker.
