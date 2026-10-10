# Deterministic map builder

The current priority is **mechanics**, per Leon's 2026-10-09 direction. Final visual design, new art assets, and briefing/gallery UI are deferred. The builder's saved data provides voxel test maps for vertical traversal, cover, destruction, objectives and co-op. Cedar Close is a reference fixture, not a template imposed on every mission.

## Build and play the offline mechanical fixtures

```sh
npm run mapgen -- --image docs/design/cedar-close-concept.png --site cedar --offline --out /tmp/mapgen --install
npm run mapgen -- --image docs/design/mapgen/signal-house-reference.png --site docs/design/mapgen/signal-house-site.json --offline --install
```

Play `?play=cedar-image&seed=1` (two two-storey houses), or `?play=signal-house&seed=1` (a four-storey office and recover objective). The Signal House input is an authored overhead **schematic**, not a reconstructed photograph. `--offline` produces clearly labelled schematic floor previews; it does not claim to generate or analyse AI concept art. Regenerate that reference with `node tools/mapgen/fixture.mjs`.

## Pipeline and packages

The authoring sequence is site read → level programme/objective/beats/pods → per-floor concept generation → vision read-back → three-layer parcel/floor/facade WFC → voxel compilation and validation → package installation. Each stage is cached, and a failed run preserves its intermediate JSON/PNG files without an installable manifest. Model outputs are checked against `tools/mapgen/schemas/*.json` plus semantic constraints. No model runs in the game or server.

`client/public/maps/<id>/` contains:

- `manifest.json`: identity, dimensions, seeds, generator version, provenance, checksums, repairs and gate results.
- `site.json`: source extents, buildings, explicit storeys, surfaces, insertion and flow.
- `design.json`: per-floor programmes, objective, located story beats and enemy groups.
- `concept/reference.*` and `concept/<building>-<floor>.png`: retained input and floor previews/art.
- `floorspec/<building>-<floor>.json`: normalized room and detail priors from read-back.
- `layout.json`: saved parcel assignment, building footprints, room-cell assignment, walls, doors, core and facade choices.
- `slate.svg`: a review preview of the compiled voxel matrix and actual outdoor paths.

Installation validates the selected seed and seeds 1–4 before replacing the map directory, then refreshes `shared/mission/generated/PackageCatalog.js`, an import-only index. It never writes map data into `GeneratedSites.js`. Both peers and the server compile the same saved layout and mission seed; runtime seeds vary furnishing and cover, not the saved architecture. The hand-built maps retain their identities.

## Geometry and mechanical guarantees

- A single scale applies to the reference's top-down source frame. Grid dimensions are derived from those extents plus a perimeter margin, within 64×64×18. The 48×40 frame is only a compatibility fallback for older recorded reads; fresh reads must provide a frame.
- Small footprints trigger a global resolution increase. Small overlaps are repaired by trimming the larger contact. Count, storeys and per-building footprint IoU ≥ .85 are checked after repair; unrepairable geometry fails explicitly without dropping buildings.
- Buildings have picture/design-driven 1–4 floors with three-voxel storey spacing. Parallel alternating stair flights share a fixed corridor/core; upper slab openings and stair headroom are carved explicitly. A supported steel switchback fire escape reaches every upper floor and roof; its attached drop ladder provides first-floor access. Single-storey buildings omit the escape.
- WFC assigns connected room regions within supported rectangular footprints. Required adjacencies constrain the assignment. Area tolerance starts at ±25% and relaxes to ±40% with a repair record. Windows align vertically and omit service-room stacks. The current vocabulary uses rectangular bays and a central hall; arbitrary polygon interiors, setbacks and bespoke facade modules are deferred.
- Bathroom/restroom/utility doors stay locked and opaque. Those rooms have no window openings, spawns, objectives or stair routes. Furniture is keyed by map/building/floor/seed, excludes door/core cells, and preserves floor connectivity.
- Outdoor flow is traced after architecture, reserved before cover scatter and checked again afterward. The design slate is copied directly from the material matrix: `index=x+y*width+z*width*depth`, one world unit per voxel.
- Validation covers the existing combat gates, all floors via indoor stairs, independent escapes, locked rooms, window lines, located beats/objective, enemy access/count, footprint fidelity, first-contact distance ≥12 cells, grid/height budgets and authoring build time ≤1.5 seconds. Failed layouts get at most eight deterministic reseeds and cannot be installed. A performance failure stops authoring rather than changing the layout seed.

## Optional live authoring, for the later design phase

```sh
# Keep credentials in the shell environment, never in browser code or the repo.
npm run mapgen -- --image /path/to/reference.png --id new-mission --out /tmp/mapgen
npm run mapgen -- --image /path/to/reference.png --id new-mission --out /tmp/mapgen --redo command/floor-3
```

`OPENAI_API_KEY` is required only for new model calls. Vision and design use configurable defaults `gpt-6.1-sol`; image generation uses `gpt-image-2.5-flare`. Override them with `MAPGEN_VISION_MODEL`, `MAPGEN_TEXT_MODEL` and `MAPGEN_IMAGE_MODEL`; `MAPGEN_MODEL` remains a vision compatibility alias. These are based on the [official model catalog](https://developers.openai.com/api/docs/models) and [image API contract](https://developers.openai.com/api/reference/resources/images/methods/generate).

`--redo` accepts `site`, `design`, `concepts`, `floorspec`, `building/<zero-based-floor>`, or `building/floor-<one-based-floor>`. Inputs, prompt versions, model settings and image hashes invalidate dependent caches; redoing one floor regenerates and rereads just that floor. Correct an extracted site in its saved JSON and supply it through `--site`; use `--offline` to exercise deterministic stages without model calls. Schema validation rejects invalid output before compilation.

The live-provider path is implemented and contract-tested with injected responses. No live API request was verified in this environment because a key is not configured. Final visual design and a genuine generated-art golden reference remain deferred; the offline previews are not a substitute for that acceptance check.

## Regression coverage

`npm test` includes WFC contradiction/determinism checks, 20 seeds × three programmes, uniform scaling, overlap repair, four-storey package rebuilding, alternate access, locked rooms, local collapse, recover completion, schema/checksum checks, cached stages and selective redo, plus real two-client lockstep on the four-storey package. The production build also checks shared package imports in the browser bundle. Runtime mechanics continue to use the existing collision, elemental and ballistic matrix.

The vertical-combat pass also fixes autopilot AP reservation on tall ladders. In the four-seed Signal House simulation, all four missions recovered the objective within the 40-round limit after the fix (the previous planner stalled in three). This is a traversal/completion regression check, not a claim that the provisional fixture is difficulty-balanced.


## Layered circulation (PLAN-03)

Generated maps use street datum **4**, underground floors at **1**, and storeys spaced three voxels apart. The five hand-built maps retain datum 1 and their original material hashes. A single parcel WFC graph joins underground, street and elevated layers with vertical socket constraints. Picture priors and a route search pin the building/tunnel/bridge sockets; WFC chooses the surrounding street fabric. Runtime compiles the saved result without another solve.

The corridor opens a covered flank between insertion and the objective approach. Two independent entrances (stairs and an attached manhole ladder), staggered sight baffles, a broken-slab drop beside a destructible grate and a guarding pod make it playable. Subway routes have light fixtures; storm drains add shallow water; underpasses add a raised bridge. Parcels remain 4×4, but real collision cells determine all route gates. The gates require reachable underground surfaces, two entrances, flank cost ≤1.6× the street-only route, most of the flank hidden from starting enemies, safe drop points and a pod on the flank. Sim reports `routeUseRate` from actual move steps/drops.

Play **`?play=subway-crossing&seed=1`** for the night-ops bridge/subway fixture. It reuses the authored Signal House reference with an explicit two-storey gameplay programme; it is not a new vision reconstruction. Its four-seed simulation used underground/drop routes in 75% of battles, with no draws. The fixture remains provisional and this is a mechanics check, not a balance claim.

`design.heights` can change observed storeys to played heights within the 1–4 / height-18 budget. The layout retains `observedStoreys`, the played `storeys`, `heightRole` and repair records. The offline designer gives one landmark the observed height and keeps filler buildings to at most two floors. Public ground floors and upper private/command programmes vary by use. Final facade/art direction is deferred.

The supported escape has 3×2 grate landings, a facade walkway to the hall, alternating steel stair flights, posts, brackets and low see-through railings. Every compiled ladder must have one continuous backing side. Escape feet reserve two cells against scatter. Losing both ground posts removes the escape surfaces before connectivity settling; the building keeps its normal support model. Large unsupported-span simulation remains deferred.

PgDn exposes **BELOW**, cutting away the street slab. The camera can focus on the lower layer. A floor breach costs one charge and 1 AP and opens a 2×2 slab hole onto a standable floor 2–4 voxels below; it does not automatically move the breacher.

`LightField` propagates integer light through air, stops at opaque voxels and recomputes dirty chunks within a radius of eight after geometry/source changes. Lamps, emissive voxels and fire contribute colored tints to chunk vertices and kit instances. The existing ten unshadowed point lights remain; the field adds no draw calls. Generated dark targets below level 4 receive spread ×1.25 at horizontal distance >4; near shots are unaffected. Move previews show a moon marker. Mission time selects the preset; new authoring defaults to night-ops. No API key is needed for these rules or offline fixtures.

## Generated operations and the v3 pipeline (PLAN-04)

**Play:** the menu's *Generated operation* card picks a plot family (Downtown grid, Industrial yard, Suburb close),
an objective (auto, recover, extract, hold or eliminate), a time of day and a
seed (dice). *Preview* draws the solved layout — buildings by storeys, cover, the line of play (blue), its flanks
(orange), engagement pockets (red rings), the tunnel (violet), insertion and objective — with the briefing, pod
count and critic score. Deep link: `?play=operation&plot=industrial&seed=7&objective=recover&time=night-ops`.
Every seed is a new map; the solved operation is cached per descriptor, so restarts and co-op peers compile the
same layout (the server sanitizes the descriptor before building the mission). The F1 debug builder uses the same
pipeline. `npm run sim -- --scenario operation [--plot downtown]` simulates generated operations.

**Pipeline (`GENERATOR_VERSION` 4.0.0, layout version 3).** `Generator.solveLayoutV3` runs:

1. **Plot** (`PlotCatalogue`): a family's road network, blocks, lots, insertion and an objective lot group. Picture
   reads become a plot whose buildings, surfaces and flow are pinned (`plotFromSite`).
2. **Fields** (`Fields.js`): picture prior, seeded fBm noise layers (district, lot, detail, interior, clutter, wear),
   the line of play (main route threaded through the picture's flow waypoints, left and right flanks), a
   sightline field and height intent. Fields weight every WFC below; WFC guarantees fit.
3. **Exterior** (`ExteriorSolver`): districts per 16×16 quad → lot WFC with multi-lot meta-tiles and
   street/walk/open/private sockets → per-lot 2×2 bay WFC whose tiles are the cover pieces (low walls, planters,
   jerseys, crates, cars, containers, trees …). Random cover scatter is retired on generated maps. Cover pockets
   are pinned along the line of play; spawn, routes, exits and access aprons are protected.
4. **Buildings**: footprints on the kit metric (bay 2, lot 8, storey 3), exits by lot sockets, district wall
   materials, per-storey facade WFC (`FacadeSolver.solveFacadeV3`), a stacked 3×2-bay core, interior plan WFC on
   the bay grid with interior noise and repairs (`InteriorPlanSolver`), and furnishing WFC with clutter noise,
   multiplicity caps and story-beat clusters (`FurnishSolver`).
5. **Access** (`AccessModules`): one uniform 6×2 switchback fire escape (steel stairs, 2×2 alternating landings,
   posts; no ladders) on every 3–4 storey building, a roof ladder on 1–2 storey flat roofs, the manhole, service
   and street stairs. The `accessTemplates` gate compares each structure cell-for-cell with its template.
6. **Layers**: a tunnel flank from near the insertion to the objective's flank side (never a side within 14 cells
   of the insertion), stairs + manhole, staggered baffles that never cut off a tunnel cell or the drop landing, a
   street drop and a guard.
7. **Design** (`OperationDesigner`): name, briefing, objective room, beats, building pods and pocket pods.
8. **Compile + repair** (`ExteriorCompiler`, `Repair`): compile to voxels, evaluate every gate, and repair locally
   — re-collapse the lots around a failing spot, add/thin cover, move the drop or guard, add a baffle, move a pod —
   for up to eight rounds per seed; a still-failing layout is reseeded (six times for operations, four for
   pictures). Picture packages are repaired against seeds 1–4 before installation.
9. **Critic** (`Critic.js`): rhythm, flank concealment, vertical use, interior breach, room and outdoor cover,
   sightlines and objective distance; the score lands in the manifest and the preview.

New gates for v3 layouts: `worldEdges` (map edges closed by world lots, edges and backdrop), `pockets` ≥ 2,
`flanksWalkable`, `accessTemplates` and `accessByHeight`, plus every combat, vertical and layer gate above.
The AI knows pockets (enemies prefer them) and flanks (every third player unit takes one in autopilot); the
sim reports `flankUseRate`.

**Measured (2026-10-10).** Generation: median 0.7–1.4 s, max 2.2 s per operation (10 seeds × 3 plots, no
failures). Simulation, 8 seeds per plot: flank use 100 %, tunnel/drop use 88–100 %, player wins 25–50 %. These are
mechanics checks; difficulty is not balanced yet.

**Limits.** The five hand-built maps (Cedar Close, Main Street, Harbor Yard, Route 9, Training Facility) stay
hand-built with their recorded hashes; only the three picture fixtures were rebuilt through v3. The street drop is
often closed by the `dropSafe` repair (enemies see it), so many maps have stairs + manhole only. v2 layouts
(`solveLayout(..., { version: 2 })`) remain for rollback.
