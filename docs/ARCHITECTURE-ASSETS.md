# Architectural tile assets and traversal

The tile set includes 63 new facade pieces: three window families, 48 material-specific connected wall modules,
and 12 curved glazing/trim modules. Existing curtain-glass modules join these pieces without the legacy masonry
window surround. The baked GLB and manifest are regenerated with `npm run kit:bake`.

## Free repository references

The following CC0 packs were downloaded, their included License.txt files checked, and their Sample.png previews
inspected while recreating these architectural treatments for the tactical grid:

| Source | Version | Treatments used as references |
| --- | --- | --- |
| [Kenney City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial) | 2.1 | Dark continuous ribbon glazing, pale recessed sash frames, rounded commercial facade corners |
| [Kenney City Kit (Industrial)](https://kenney.nl/assets/city-kit-industrial) | 2.0 | Steel factory-window grids, concrete panel joints, metal facade courses |

Both packs identify their license as [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
Kenney permits personal, educational and commercial use without required attribution; credit is retained here.
These are new procedural, tile-scale re-creations, not whole imported buildings or Phoenix Point game assets.
Reference downloads remain outside the repository. No third-party textures or raw meshes are redistributed.

## Window and wall families

- Curtain glass: slim dark mullions; full-height runs choose this consistently even far from masonry.
- Sash: pale aluminium frame and fine crossbars; no brick/quoin surround.
- Ribbon: dark perimeter glazing above a solid sill.
- Factory: three bays and two lights in a steel grid.
- Curved glass: tangent quarter-circle corner panes, matching continuous head and sill rails.
- Precast concrete: recessed horizontal expansion joints.
- Rendered stucco: smooth wall with a pale thin course.
- Metal cassette: horizontal panel seams, retaining the siding finish.

Modern builders record `windowStyle` per pane, so neighboring internal partitions cannot change the facade family.
Generated storefront/glazing panels use curtain glass, bands use ribbon glass, and punched windows use sash frames.
Unhinted stacked glass also chooses curtain glass. Wall material still controls the opaque facade's finish.

## Gameplay

All glass panes are non-solid, non-standable, transparent and non-covering. Full glass walls admit ordinary walking
at the same movement cost as empty floor, and floor selection passes through them. Bullets retain the existing
pane-crossing shatter behavior. Walking itself does not break the pane or consume an extra action.

Sill-backed windows keep a one-voxel solid, non-walkable wall beneath the pane. That wall supplies half cover and
requires the ordinary vault action (2.6 movement points); it cannot be stepped onto. Destroying the sill removes
that barrier. A two-voxel opaque wall remains a full-height obstacle.

L-shaped wall connections use a 12-segment quarter-circle bend instead of a square elbow. Its endpoints stay
exactly on the adjoining tile runs. Wall meshes, caps, curved panes, projectile ray tests and cover share this
footprint, following the same tangent-corner principle as rounded terrain. Movement still reserves the wall tile;
rounding the visual corner does not allow diagonal movement through an occupied wall cell.

## Building era: rounded (modern) vs straight (old) edges

Every building has an era (`shared/mission/BuildingEra.js`, `building.era`):

| Era | Edges | What it covers |
|---|---|---|
| `modern` | rounded | curved outside L corners, softened wall ends, filleted slab and floor edges, soft-edged furniture |
| `old` | straight | square wall corners, ends and junctions (outer walls **and** interior partitions), sharp slab and floor edges, straight-edged furniture |

- **Where it comes from.** A spec's `era` wins; the older `rounded` flag still works (`rounded: false` → old,
  `true` → modern). Present-day builders (`buildModern`, `compileBuilding`) default to modern; the classic
  stone/plaster/timber `buildBuilding` defaults to old. District mixes keep their authored choices (offices, depots,
  garages, motels are `rounded: false` → old; the showroom is modern), the rest are mixed by seed, and the Test Ground
  remix's **Building era** control can force modern or old for every building (the share-link key is still `corners`).
- **Per cell, so merges keep both looks.** An old building marks its whole footprint in `VoxelStore.squareCorners`
  (the name predates eras; snapshots and the battle hash carry it). When an old and a modern parcel merge, the old
  footprint draws straight and the modern one rounded. A cell both footprints share (the party wall) belongs to the
  old building.
- **Same rule for rendering and gameplay.** Walls in straight cells use the `square_wall` / `square_cap` pieces, whose
  silhouette (`wallFootprint(mask, false)`, no fillet) is also the collision, ray and cover shape. The chunk mesher
  skips the rounded-mass path for straight cells, and `KitView` asks for `<piece>@sharp` there: `KitLibrary` rebuilds
  the piece with `softBox` and profile bevels made straight (`withSharpEdges` in `Geo.js`), sharing the ordinary
  geometry when a piece has no bevel.
- Tests: `shared/mission/building-era.test.js`, `client/src/render/kit/building-era.test.js`.

## Playable test map

Open `http://localhost:2567/?play=architecture-yard` or choose **Architecture Yard** from the map list.

- Reyes starts at (12,35,1), facing the full-glass lane at y=33. Move to (8,32,1) to walk through glass.
- Kowalski starts at (19,35,1), facing the sill-backed lane. Move to (19,32,1) to vault the solid sill.
- Residential sash and factory grid samples occupy the adjacent apron at y=26.
- The northern buildings show stucco/sash and metal/factory treatments. The southeast pavilion shows concrete
  panels, stacked glazing, and four rounded glass corners. Use the Buildings control and floor arrows to inspect.

The map and its facade hints serialize through the same mission snapshot as co-op missions.

### Automatic window entry

Half-window sills now register a crossing axis in `VoxelStore.windowOpenings`. Ordinary move searches automatically include a crouched vault through that aperture beneath the ceiling; other low obstacles retain full-height vault clearance. Both building generators reserve the interior landing from furniture. Movement breaks the glass, keeps the sill as half cover, reveals the room entered and emits a crouched vault animation. Opening metadata survives cloning and compiled mission snapshots, so broken windows remain traversable in both directions and online peers agree. Solidly filled apertures, occupied landing tiles and wide units still block entry. Training Facility's outdoor cover pass uses a three-tile target gap to preserve the existing cover gates with the revised furniture layout.
