# Screenshot/reference map authoring

Architecture comes from the supplied reference. Gameplay flow takes priority over reconstructing every room. Cedar Close is only a recorded regression image; industrial, downtown and roadside references use their own building programs and cover catalogs.

The authoring sequence is image analysis → footprints and combat flow → voxel placement → exact design slate → connectivity and combat-quality validation. The shared compiler places the buildings, partitions, cover and terrain, then records integer slate layers and the complete flattened 3D material matrix directly from the voxels (`index = x + y*width + z*width*depth`). One slate tile is one world unit and one voxel cell. No separately scaled overlay can drift from the placed tiles. The exported SVG uses the same coordinates, with walkable approach routes and locked-room labels over the placed floors and cover. Routes are traced through outdoor voxel cells after architecture and fixed props are placed, reserved from cover scatter, and verified again after scatter; preview lines follow these exact routes instead of passing through walls. In-game surface finishes use continuous world coordinates and omit repeated per-tile texture motifs.

## Run the recorded regression

```sh
npm run mapgen -- --image docs/design/cedar-close-concept.png --site cedar --out /tmp/cedar-image.json
```

This writes a JSON package (site analysis, exact slate, seed, metrics and analysis provenance) and `/tmp/cedar-image.svg`. The image hash must match the recorded analysis. Launch **Cedar Close · Image Study** from the mission menu, or use `?play=cedar-image&seed=1`. The ordinary Cedar Close mission remains separate.

## Analyze another reference

```sh
# Set OPENAI_API_KEY in the shell; never put credentials in browser code or committed files.
npm run mapgen -- --image /path/to/reference.png --out /tmp/reference-map.json
```

The authoring-only CLI sends the image to the [OpenAI vision API](https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat). `MAPGEN_MODEL` overrides the default `gpt-4.1`. Fresh image extraction needs a credential and network access; the saved-analysis compiler works offline. The recorded regression and rendered gameplay were tested locally; a live model call was not tested in this environment.

Inspect the JSON metrics and exact SVG slate. A fresh vision analysis is also saved as `<output>.analysis.json` before validation; if compilation rejects its geometry, repair that saved analysis and rerun offline. Edit the package's `site` when an inferred footprint or route is wrong, then recompile using `--site /tmp/reference-map.json`. Coordinates in the site are normalized top-down coordinates, not perspective image pixels. Buildings must leave space for combat rooms and approaches. Flow waypoints represent insertion, covered approach, flank and objective approach; blocked waypoints and inaccessible combat rooms reject compilation.

```sh
npm run mapgen -- --image /path/to/reference.png --site /tmp/reference-map.json --out /tmp/reviewed-map.json --install
```

`--install` adds a unique map ID to `shared/mission/generated/GeneratedSites.js`, making it available in the mission menu and shared co-op scenario registry. Installation rejects maps failing the existing cover, sightline, lanes, breachability and spawn-safety gates for the selected seed and regression seeds 1–4 before changing the registry. The exported package records each validated seed. Run the map tests after installation. Both client and server rebuild the same package with the same mission seed; neither runs a model during play.

## Room and layout rules

- Combat spaces form connected room routes with alternate entrances where adjacency allows them. Cover is placed around approaches, with two-cell outdoor lanes reserved from scatter.
- Bathrooms, baths, restrooms and utility rooms stay closed by default, with locked doors and opaque façades. They are excluded from enemy room selection, stair placement and combat-room connectivity metrics. Authors may explicitly promote a needed room kind with `gameplayRooms` or close other kinds with `closedRooms` in building specs.
- Material colors and continuous finishes preserve terrain identity. Cover, elemental reactions, destruction and navigation still read the exact voxel matrix.
- `timeOfDay` is saved per mission: day, dawn, dusk, overcast or night. The backdrop is visual context only.

This first compiler uses connected program layouts and seeded cover placement. It does not yet implement the proposed nested WFC solver, generated floor artwork or arbitrary 2–4-storey reconstruction from PLAN-02. The initial reference package is a single-storey combat study.

## Validation record

The full suite passed 82 tests, including deterministic/co-op rebuilding, multi-seed combat gates, inaccessible service rooms, exact slate/matrix identity, non-suburban programs and collision-safe camera frames. Production build passed. Saved-image compilation, package round-trip and registry installation/rebuild were exercised. Browser plugin not available; bundled Playwright checked the desktop mission, preparation, actual firing, skill cut-in, cancellation and console health. A 390×844 capture was also inspected; the existing HUD remains designed for desktop and overflows a narrow phone viewport.
