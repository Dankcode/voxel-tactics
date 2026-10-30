# Aiming, architecture and material audit — 2026-10-30

Acceptance threshold: **7/10 in every category**. Scores below are an authored visual review, supported by the listed runtime and geometry checks; they are not automated measurements of aesthetic quality.

| Category | Score | Review evidence |
|---|---:|---|
| Shoulder attachment and weapon direction | 8 | Rigid stock seat, perspective foreshortening, and an independently checked bore ray for rifle, shotgun and sniper. Existing soldier artwork supplies the anatomy. |
| Reticle clarity | 9 | One spread-sized circle and target distance. No pellet diagrams, odds, precision labels or duplicate firing reticle. |
| Aiming/firing HUD | 8 | Back at the upper left; weapon, ammunition and Fire at the lower right; tactical panels leave the aiming view. Checked at 1280×720 and 1024×768. |
| Aiming camera clearance | 8 | Nearby allies are culled by projected size. Foreground geometry is cut away before the shoulder; complete anchored props follow the cut. Enemy targets and target-side cover remain present. |
| Ordinary building silhouettes | 8 | Modern construction no longer implies rounded geometry. Square footprints are the default, while authored landmarks can opt into curves. |
| Paired curve continuity | 8 | Four rotations of a shared two-tile-radius arc; clipped diagonal modules use identical boundary vertices. Floor edges follow a matching larger arc. |
| Curved-wall cover | 8 | Cover samples combine the protection of adjacent curved modules. Tests cover full/half cover, flanking, destruction, penetrable timber, and collision through empty corners. |
| Floor and surface textures | 7.5 | Continuous paving expansion joints, restrained grain, plank seams and checker ceramic floors. Rounded slabs use a smaller bevel; vertical slab faces avoid checker striping. |
| Lighting and material separation | 7.5 | Softer shadow filtering, lower direct sun, neutral ground bounce, more sky fill and less heavy ambient occlusion. Glass curve modules use the glazing material. |
| Interior/exterior readability | 7.5 | Existing room plans, windows, stair access and door approaches are preserved. Curves skip occupied circulation corners. Checker floors and crisp wall/floor borders draw from the interior references. |

## Reference decisions

The four supplied screenshots informed: broad continuous planter/wall arcs; narrow architectural trim rather than a rounded block at every voxel; checker wet-room flooring; and a limited number of curved landmark facades among ordinary buildings. They were used as visual references rather than copied floor plans.

The supplied rear aiming pose remains the anatomical reference. The gun is a rigid 3D assembly, seated at the shoulder and pointed toward the projected reticle. Camera projection follows the [Three.js PerspectiveCamera model](https://threejs.org/docs/pages/PerspectiveCamera.html). The sparse aiming HUD follows the information-reduction principle illustrated in Ubisoft's [Ghost Recon Breakpoint HUD discussion](https://news.ubisoft.com/en-us/article/7L1dHQznMJv54zcBM8K7Yi/7-things-were-excited-to-dig-into-in-ghost-recon-breakpoint).

## Validation

- Shared live baseline: `http://localhost:2567/?play=operation&plot=downtown&seed=1`.
- Architecture inspection: `http://localhost:2567/?play=architecture-yard&fixture=1&seed=1`.
- Rifle, shotgun and sniper aiming; an actual firing sequence; 1024×768 and 1280×720 framing; return to tactical controls.
- Blender MCP independently reconstructed all three gun assemblies. Maximum bore miss was approximately **0.00000003 m**; shoulder and target projection errors were below **0.001 px**. Results: `tools/art/sprites/ranger-01/shoulder-blender-audit.json`; editable scenes: `ranger-shoulder-alignment.blend` in the same directory.
- Geometry tests exercise different viewports, aiming positions and target distances; stock position, bore direction and rigid-transform determinant are checked independently.
- Shared curve tests cover ray hits, standing surfaces, diagonal cover, cloning, snapshots, cache invalidation and all eight prefab rotation/reflection combinations.
- Camera tests check projected ally clearance, restoration after exit, and retention of target-side cover.
- The broad 484-test run exposed four failures: an obsolete default-rounding fixture, obsolete deterministic map hashes, a curved stair landing and stale furnishing hints. The fixtures were updated for the intended square defaults; circulation and hint handling were corrected. Focused reruns cover each failure. A fresh complete broad run has not been repeated.
- Production build and whitespace validation are run after the final edits.

Browser testing used the drag/arrow-key fallback because the embedded browser does not grant pointer lock. Native pointer-lock operation was not verified. Aiming clearance is visual only: it does not remove ballistic cover or change world collision. The grid still reserves wall cells, including their curved margins; sub-tile walking around the curved edge is outside this change.

## Editing curves

Use `edgeStyle: 'curved'` (or legacy `rounded: true`) on a building. Use `edgeStyle: 'square'` to explicitly suppress curves. Era controls materials independently of edge style.

For a freestanding connected corner:

```js
m.curve({ x: 20, y: 6, turn: 0, height: 1,
  wall: 'concrete_wall', floor: 'paving' });
```

`turn` is 0 = NW, 1 = NE, 2 = SE, 3 = SW. The corner reserves a 2×2 footprint. `height: 1` creates low cover and `height: 2` creates full-height cover. The wall centreline radius is 1.5 tiles; the floor radius is 2 tiles. Explicit building curves retain existing stair and door corners when those would conflict.

Geometry, ray collision and cover share `shared/voxel/DoubleTileCurves.js`; the renderer must not approximate these with independent single-cell bevels. Curve metadata survives mission snapshots, baked-map material remapping and rotated/mirrored building prefabs.

## Follow-up: intact ground, curved roads and lower stocks

Ground-level curved floors now retain a complete terrain substrate. The arc and its complementary apron fill
one square tile together, at their respective material heights; the terrain mesher treats that substrate as a
full neighbour. Upper-storey floor edges retain their authored curved silhouette. This prevents both an actual
gap and the neighbouring ground's unwanted bevel from creating a cut-out.

Paved corners at road junctions use the same two-tile arc, with asphalt underneath and a raised curved curb.
The automatic pass preserves building footprints. `m.roadCurve({x,y,turn})` authors the same corner explicitly.
Road helpers preserve open asphalt where crossing streets meet rather than laying curbs across the junction.

The shotgun butt drops 45 mm and the sniper butt 55 mm, tapering to zero at the receiver. Barrel, muzzle,
forward grip and firing transform remain fixed; the rifle is unchanged. Mesh copies are per instance, so cached
models are not modified. `stock-drop-audit.json` records zero muzzle displacement and numerical bore checks.
The new exported layout includes the lowered rear geometry. Blender MCP was disconnected during this follow-up,
so the `.blend` and `shoulder-blender-audit.json` remain the earlier alignment reference until rebuilt with the
updated script. The current follow-up was checked through live previews, renderer tests and geometry tests.

Validation: 67 focused regression tests, 5 prefab tests, map-wide room-access/render-hint checks, a ground-seam
render regression, and a production build passed. The full broad suite was not repeated for this follow-up.
