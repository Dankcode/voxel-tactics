# Burger District: upper-left reference region

The supplied reference is a composite screenshot. Its lower aerial view supplies the road and lot relationships;
its upper game image helps interpret the central restaurant block. This is an approximation of the visible
commercial layout, not a survey or an import of the original game's level.

The user's narrower scope keeps three building anchors **west of the curved road**: the western retail building,
the northern diner, and the central restaurant. The lower western service parcel and all eastern buildings are
explicitly excluded. The region polygon follows the curved road, so the excluded land has no gameplay floor,
parcel fillers, or street furniture. Source coordinate extents are cropped before applying one uniform scale.

## Adapted parcel contracts

`tools/xcom/import-parcels.mjs` reads the user-supplied **XCOM 2 - More Maps Pack-302-13-1.zip** and records its active
INI definitions in `shared/mapgen/reference/more-maps-pack.json`, including the source archive SHA-256.
The archive contains **8 active parcel definitions, 3 plot definitions and 1 active cover-piece definition**.
Commented-out, cancelled facility definitions are excluded.

The mod's ReadMe describes the hierarchy:

1. Plots define roads, waterways and parcel slots.
2. Parcels are selected for slots by size, allowed plot types, zones, facing, entrances and objective tags.
3. Plot cover pieces fill the roads, corners, sidewalks and remaining gaps.

The archive provides those contracts and compiled Unreal maps, rather than XCOM's generator source code.
`ParcelFormula.js` adapts the exposed constraints using this game's own parcel prototypes and architectural
assets. Compatibility is mandatory; seeded selection balances repeated prototypes. Native-facing references
record the rotation into the observed road frontage. The medium retail/objective contract is traced to
`md_AdventSecurity_daz_01`; the large retail prototype is this game's extension of the same size/zone contract.
Native Unreal meshes or `.umap` geometry are not loaded into the runtime.

The source read and region formula live in `shared/mission/generated/BurgerDistrict.js` and
`shared/mapgen/ReferenceRegion.js`. Building positions stay pinned to the reference; the floor, facade, cover,
and furnishing solvers generate the playable contents. No generated layout JSON is hand-edited.

## Roads, parking, lights

Roads use sampled Catmull–Rom centerlines, continuous-width carriageways, curb strips, lane dividers, and
street-edge cover lanes. Building ownership outranks road paint. Parking parcels declare row direction, so
vehicle assemblies align with stalls rather than arbitrary pavement directions. Cropped-off road branches end
at the region boundary.

Streetlights are removed from random bay decoration. `StreetLighting.js` plans them after buildings and cover:

- Explicit road centerlines use cumulative distance, with a 12-cell cadence and staggered curb sides.
- Existing maps without vector roads use ordered curb runs detected from their ground matrix.
- Poles face the road and maintain at least 8 cells of separation.
- Road cells, buildings, door approaches and obstructed pole columns are excluded.
- The updated asset has a tapered mast, plinth, swept arm and compact downward-facing LED head.

The same lighting formula runs on generated, packaged, and hand-built maps. Failed cover repairs can now pin a
physically compatible module outside a decorative pool, while still enforcing surface and protected-cell rules.
This fixes the previously ignored corrective placements at reference-road and parcel boundaries.

## Generated package and results

Open `http://localhost:2567/?play=burger-district` or choose **Burger District · Upper-left Parcels** in the map list.
The generated package is in `client/public/maps/burger-district/`: source read, design, layout, floor schematics,
reference screenshot, tactical slate, validation metrics and checksums.

The installed map is **112×56×18**, with **3 single-storey buildings**. All generation and tactical gates pass on
seeds 1–4. The compiled matrix preserves each selected building's footprint with IoU ≥ 0.85. Interiors and roofs
remain playable. The camera's atmospheric fog now follows camera distance, keeping map-scale and orthographic
views readable while preserving the normal tactical-distance fog range.

Reproduce the import:

```sh
node tools/xcom/import-parcels.mjs '/path/to/XCOM 2 - More Maps Pack-302-13-1.zip' shared/mapgen/reference/more-maps-pack.json
```

Reproduce the map and install the validated package:

```sh
npm run mapgen -- --image '/path/to/reference.png' --site burger --id burger-district --offline --out /tmp/voxel-mapgen --install
```

The `burger` site shorthand selects the observed upper-left parcel read; the supplied screenshot is retained as
its reference. All generated files are produced by the solver and the package validation pipeline.
