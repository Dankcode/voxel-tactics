# Real places (Geo-voxel → game)

Real places are built in **Geo-voxel** (github.com/Dankcode/Geo-voxel), not in this repo. Geo-voxel fetches
OpenStreetMap, the USGS terrain and Wikidata, frames and straightens the place, rasterises the footprints and
exports the result as `geo-voxels/layers@1`. This folder imports those layers into the game; the game then makes
the place its own (game building types, generated interiors, parcels on the open land, cover, pods).

## Import a place

1. Get the place out of Geo-voxel, either
   - a **source**: the app's *Export → source.json*, `node bin/geo-voxels.mjs fetch --lat … --lon … --out dir`, or a
     Blender export — the import below runs Geo-voxel's `build` on it for you; or
   - its **layers**: `node bin/geo-voxels.mjs build <source.json> --out dir` → `dir/layers.json`.

   (The app's *map.json* is a finished voxel map from Geo-voxel's town engine — no layers — so it is not imported;
   export the source.json next to it.)
2. Here:

   ```sh
   node tools/places/places.mjs import ../Geo-voxel/out/<id>/source.json \
     --id <id> --name "Name · City" --theme Downtown --objective "Building name" \
     [--text "Briefing line"] [--reference <screenshot.png>] [--geo-voxel ../Geo-voxel]
   ```

   `--geo-voxel` defaults to a `Geo-voxel` checkout next to this repo; it is only needed for a source.
   This copies the layers to `client/public/places/<id>/layers.json` (floats rounded to 3 decimals), adds or
   refreshes the entry in `places.json`, regenerates `shared/mission/generated/PlaceCatalog.js` and
   `shared/mapgen/geo/PlaceProfiles.generated.js`, audits the place and bakes it.
3. `npm run content:sync`, then play it: `http://localhost:2567/?play=<id>&fixture=1&seed=1`.

## Other stages

| Command | What it does |
|---|---|
| `node tools/places/places.mjs list` | the catalog |
| `node tools/places/places.mjs catalog` | regenerate `PlaceCatalog.js` from `places.json` |
| `node tools/places/places.mjs profiles` | regenerate the PLAN-15 place profiles (heights, footprint ratios) |
| `node tools/places/places.mjs audit [<id>]` | build with the district and mission gates and report |
| `node tools/places/places.mjs bake [<id>]` | `baked-s<seed>.json` packages + the real buildings as prefabs (`client/public/assets/buildings/`) |

Re-bake after changing `PlaceImport.js`, the parcel mixes or the building programmes, and bump
`PLACE_GENERATOR_VERSION` when an old bake must not be used any more (a bake is only checked against the generator
version and the place's own data).

## `places.json` options (`build`)

| Option | Default | Meaning |
|---|---|---|
| `programs` | `{}` | `{ "<building id>": "<program>" }` — what the game makes of a building (overrides `gameProgram`) |
| `newBuildings` | `"auto"` | small buildings the parcel fill may add on open land (≤ 6); `0` keeps the place as mapped |
| `openLand` | by theme | `"parcels"` (the game's parcel mixes) or `"park"` (lawn beyond the yards stays lawn; Landmark default) |
| `lotsToParcels` | `[]` | lot ids (or `true`) handed to the parcel fill instead of being striped as car parks |
| `family` | by theme | district mix family: `urban`, `suburban`, `retail`, `industrial`, `roadside`, `mixed` |
| `timeOfDay`, `maxStoreys` | `dusk`, `3` | |

Themes: `Downtown`, `Landmark` (urban parcels), `Suburbs` (suburban), `Strip centre` (retail), `Industrial`,
`Roadside`.

## What the importer reads from layers@1

`frame` (width, depth, cell), `heightfield`, `landUse.codes` (R road, K kerb, S sidewalk, L lot, B building,
W storefront walk, `.` open), `roads` (centrelines in cells), `lots` (cells), `buildings` (program, storeys, baseZ,
front, wings, tenants with OSM tags, Wikidata facts, landmark) and `paint` (quads and junctions).

Read when present (not exported by Geo-voxel yet): a building's `footprint` cells, `heightM`, `observedStoreys`
and `osmParts`; top-level `furniture` (`[{ kind, at }]`, e.g. real trees, signals); land-use codes `G` lawn,
`P` plaza and `p` path. Without them, a building's cells are its wing rectangles plus the nearest `B` land, untagged
storeys count as observed in the profiles, and all open land is one kind.
