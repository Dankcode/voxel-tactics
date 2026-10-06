# Rendering (2026-10-06)

The voxels keep their block shapes; what changed is how they're drawn. Before this, every voxel face was
an unlit flat colour. Now it's a lit, textured surface, in the spirit of XCOM 2's tactical view.

## Pipeline

| Piece | File | What it does |
|---|---|---|
| Render table | `client/src/render/RenderTable.js` | Per voxel material: texture name, voxels per texture tile, world or per-face UVs, roughness / metalness, normal strength, opacity, emissive, side-face override (grass sides get the fringe texture), macro variation |
| Mesher | `client/src/render/ChunkMesher.js` | Face-culled 16³ chunks, one buffer per render material, world-space UVs (continuous across voxels) or per-face UVs (barrels, crates, hay, grass sides), vertex colours carrying corner AO, a little per-voxel jitter, large-scale brightness variation (hides tiling on big fields) and the fog-of-war tint. Storey cutaway: voxels at or above the cut are skipped and the exposed tops become dark section caps |
| Materials | `client/src/render/MaterialLibrary.js` | Loads `assets/textures/pbr/<name>.jpg` + `<name>_n.jpg`, builds one `MeshStandardMaterial` per render key (sRGB albedo, tangent-space normal map, anisotropic mip-mapped filtering), scrolls the water normals |
| Scene | `client/src/render/Scene.js` | ACES filmic tone mapping, sun with a 4096² shadow map fitted to the map, sky / ground hemisphere fill, `RoomEnvironment` reflections, gradient background, lighting presets `day` / `dusk` / `night` (Options ⚙ or the debug View tab) |
| Units | `client/src/units/UnitView.js` | Billboarded character quad with mip-mapped linear filtering (no more pixel look), sun shadow cast through the sprite's alpha, soft contact shadow, XCOM-style segmented health pips |
| Overlays | `client/src/render/Overlays.js` | Blue / yellow move-zone outlines with faint fills, path ribbon, destination marker, cover shield sprites, aim cone, throw arc and blast disc, overwatch wedges, debug tile and line layers |

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
