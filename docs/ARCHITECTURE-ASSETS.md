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

## Building era and authored curves

Era and edge treatment are independent. Buildings use square edges by default, including modern buildings.
`era` selects the material/design era; `edgeStyle: 'curved'` or legacy `rounded: true` explicitly enables curves.
`edgeStyle: 'square'` overrides the legacy flag. Legacy `rounded: false` still implies an old era when no era is set.

Square footprints populate `VoxelStore.squareCorners`, use square wall/collision pieces and suppress floor and
furniture bevels. A square building sharing a party wall keeps that wall square. Explicit landmark curves use
`VoxelStore.curveCells`: four clipped modules across a 2×2 footprint share a 1.5-tile-radius wall centreline and a
2-tile floor arc. The same polygons drive rendering, ray hits, standing surfaces and curved cover samples.
Doorways and stairs retain their existing corners when a larger arc would remove circulation space.

Use `m.curve({x,y,turn,height:1,wall:'concrete_wall',floor:'paving'})` for low curved cover; height 2 provides a
full-height wall. NW/NE/SE/SW use turns 0/1/2/3. Snapshots, baked maps and rotated/mirrored prefabs retain shapes.
See [the visual audit and authoring details](AIMING-HUD-AUDIT.md).

Tests: `shared/voxel/DoubleTileCurves.test.js`, `shared/mission/building-era.test.js`, and
`client/src/render/kit/building-era.test.js`.

## Playable test map

Open `http://localhost:2567/?play=architecture-yard&fixture=1&seed=1` or choose **Architecture Yard** from the map list.

- Reyes starts at (12,35,1), facing the full-glass lane at y=33. Move to (8,32,1) to walk through glass.
- Kowalski starts at (19,35,1), facing the sill-backed lane. Move to (19,32,1) to vault the solid sill.
- Residential sash and factory grid samples occupy the adjacent apron at y=26.
- The northern buildings show stucco/sash and metal/factory treatments. The southeast pavilion shows concrete
  panels, stacked glazing, and authored rounded glass corners. Use the Buildings control and floor arrows to inspect.

The map and its facade hints serialize through the same mission snapshot as co-op missions.

### Automatic window entry

Half-window sills now register a crossing axis in `VoxelStore.windowOpenings`. Ordinary move searches automatically include a crouched vault through that aperture beneath the ceiling; other low obstacles retain full-height vault clearance. Both building generators reserve the interior landing from furniture. Movement breaks the glass, keeps the sill as half cover, reveals the room entered and emits a crouched vault animation. Opening metadata survives cloning and compiled mission snapshots, so broken windows remain traversable in both directions and online peers agree. Solidly filled apertures, occupied landing tiles and wide units still block entry. Training Facility's outdoor cover pass uses a three-tile target gap to preserve the existing cover gates with the revised furniture layout.

Ground-level curves carry an `underlay` material; their complementary apron covers the outside of the arc.
This keeps the terrain complete while raised floors and road/curb heights follow the curved boundary.
`roundRoadCorners` applies this to junction curbs during map finishing; `m.roadCurve` authors one explicitly.

Building corner stamping preserves the material of every existing floor tile and roof tile instead of applying a
default floor finish across the arc. Curves therefore retain room-specific flooring, including wet-room tiles.
