# PLAN-16: Real places come from Geo-voxel; new parcels with interiors

Status: implemented 2026-10-27 in the cloud workspace and copied into the local `voxel-tactics` folder (not committed).

## Request

> Remove the real world map generation tool from this repo. We already have one in the 3D map generator project
> (Geo-voxel) that should generate a map, then convert it over to this game, where this game further modifies the
> parcels to fit the gameplay theme. We also need new parcels: residential variety, service and back-of-house,
> commercial infill, interiors, garages, stuff you see in the real-world maps, and a generated interior.

## What changed

### Removed: the real-world generator

| Removed | What it was |
|---|---|
| `tools/geo/` (pipeline, Blender script, slicer, site converter, place-profile baker, `places.json`) | fetch → install → catalog → build → bake |
| `client/public/geo/<place>/` (`geo.json` BlenderGIS exports, old bakes) | source data |
| `shared/mission/GeoDistrict.js`, `GeoMaps.js`, `generated/GeoCatalog.js` | BlenderGIS export → mission |
| `shared/mapgen/GeoSite.js` (+ test), `geo/GeoFrame.js`, `geo/GeoRectify.js`, `geo/GeoContext.js` | framing, DEM terrain, straightening, OSM context |
| `GeoRoadPaint.planGeoRoadPaint` | street paint planner (Geo-voxel ships the plan now) |

Kept (the game still builds with them): `GeoBuildings` (footprint → wings, party walls), `GeoPrograms` (civic and
landmark plans), `GeoLandmark` (landmark dressing), `GeoStreetProps`, `GeoRoadPaint.lotStripesToPaint`,
`BuildingPrefab` / `PrefabLibrary`, and `PlaceProfile` (now fed from the imported layers).

### Added: the place importer

- **Format:** Geo-voxel's `geo-voxels/layers@1` (its `build` command's `layers.json`): frame, heightfield, land use
  (R/K/S/L/B/W/.), street centrelines, lots, buildings (programme, storeys, base, front, wings, tenants with OSM
  tags, Wikidata facts, landmark flag) and the road-paint plan.
- **`tools/places/places.mjs import <layers.json | source.json | blender-export.json>`** copies the layers to
  `client/public/places/<id>/layers.json`, updates `tools/places/places.json`, regenerates
  `shared/mission/generated/PlaceCatalog.js` and the place profiles, audits and bakes. A source file is built by
  Geo-voxel first (it runs `geo-voxels build` from a `Geo-voxel` checkout next to this repo, or `--geo-voxel <path>`).
  The app's `map.json` (`geo-voxels/map@1`, a finished voxel map) is refused with a message saying to export the
  source.json instead. `tools/places/README.md` has the steps and options.
- **`shared/mission/PlaceImport.js`** (`buildPlaceMission`, generator `place-import-1`) builds the mission:
  - kept from the place: terrain, streets (each R/K/S cell owned by its nearest centreline), car parks (striped,
    planted islands), every building (its wing rectangles, then the rest of its `B` land by nearest building), units
    per tenant, landmark dressing, Geo-voxel's street paint;
  - decided by the game: the building type (`gameProgram`: pub/bar → `bar`, laundry → `laundromat`, convenience →
    `corner_store`, small garage → `lockup`, big house → `walkup`; `build.programs` overrides per building) and the
    **open land**, which the district parcel fill takes with the theme's mixes (Downtown/Landmark → urban, Suburbs →
    suburban, Strip centre → retail, Industrial, Roadside). It may add up to six small buildings (≤ 2 storeys;
    `newBuildings: 0` keeps the place as mapped). Landmark places keep open lawn as their grounds (`openLand`).
    `lotsToParcels` hands mapped car parks to the fill. Objective, insertion, cover repair and pods are unchanged.
- **`shared/mission/PlaceMaps.js`**: the catalog as map definitions (bake first, live build otherwise);
  `LocalSession`, `server/src/BakedDisk.js` and `BakedMaps.preloadBaked` read `client/public/places/`.
- **Starter places** (same ids as before): Third Street (now Geo-voxel's live fetch: 21 buildings, was 15),
  Sherwood & Florida, Old State Capitol, Independence Hall — imported, audited (district and mission gates pass) and
  baked; building prefabs re-baked, stale ones removed.

### Added: new parcels and interiors

| Group | District mixes (`MixCatalogue`) | Building programmes (`ModernBuilder.PROGRAMS`) | Operation lot kinds (`LotCatalogue`) |
|---|---|---|---|
| Residential variety | `duplex-plot`, `trailer-park`, `garden-apartments`, `pool-backyard`, `garage-house` | `duplex` (a front and back door per home), `trailer` (one row of rooms), `walkup` (stair hall, four flats a floor) | `duplex`, `walkup`, `trailer` |
| Service and back of house | `loading-dock` (raised platform, canopy, truck bays), `service-alley` (dumpsters, grease bins, condensers, meters, van slot) | — | — |
| Commercial infill | `corner-store` (small lot, ice box, propane cage), `laundromat`, `bar-patio` (fenced deck patio, rear lot) | `corner_store` (flat above), `laundromat`, `bar` (was a house fallback) | `corner_store`, `laundromat` |
| Garages | `lockup-garages` (a court of single lock-ups), the detached garage in `garage-house` | `lockup` (one bay behind a roller door) | `lockups` |

New room kinds and their generated interiors: `laundry` (washer banks, dryer stacks, folding tables, vending),
`convenience` (checkout, coolers, aisles), `barroom` (bar counter, back bar, booths, pool table) and `garage_bay`
(workbench, tool chest, tyre stacks, drums, car lift), each with seeded recipes. Operation room programmes
(`OperationDesigner.PROGRAMMES`), wing programmes, facades and climax beats cover the new programmes; the operation
`bar` now opens with a `barroom`.

## Fixes found on the way

- **Skybridge into a closed room** (`district/Skybridge.js`): a bridge could land beside a closed bathroom and its
  doorway clearing opened it (downtown-district seed 5, two townhouse rows). A landing next to a closed room or a
  locked door now skips that bridge.
- **Tile hints on empty cells** in real places: a later wing's door approach could clear furniture an earlier wing
  placed; PlaceImport drops hints left on empty cells (Third Street had them before too).
- **Lanes gate on real places**: measured to the street in front of the objective (`meta.lanesGoal`) instead of the
  pods' centroid, which can fall inside a block (Third Street seed 2 had one lane by the old measure).
- `collapse.test.js` uses downtown seed 6 for the hold-zone collapse: since the new lot kinds, seed 5's objective
  block stands against the world-edge wall, which holds it up (the mechanic is unchanged).

## Verification

- `npm test`: 462 pass, 2 fail. Both failures predate this change (`terrace-district` render hint on an empty cell;
  hand-built map hashes in `vertical.test.js`). The room-access test that failed before on the old real-place maps
  now passes. `server/test/room.test.js` "lockstep … proving-grounds" is flaky on the old code too (1 in 4 runs).
- New tests: `shared/mission/place-import.test.js` (format, building types, a synthetic place built faithfully
  and deterministically, themed parcels, catalog bakes, Third Street and Sherwood) and
  `shared/mapgen/new-parcels.test.js` (each new mix alone: props registered, every room of every building it adds
  entered from the street, closed rooms still closed; programme plans; lot kinds). Updated: `plan15.test.js`
  (profiles from the place catalog), `geo/prefab.test.js` (5 pass; not in the `npm test` glob),
  `compact-interiors.test.js`, `collapse.test.js` (seed); `geo/geo.test.js` and `geo-site.test.js` removed with the
  code they tested.
- All four places pass the mission design gates on seeds 1–4 (`maps.test`), with every room reachable.
- Six large districts × five seeds: district and mission gates pass; every room of every new-programme building
  (duplex, trailer, walk-up, corner store, laundromat, bar, lock-up — 278 rooms) has the right access.
- Generated operations (downtown, industrial, suburb, seeds 1–4): all mission gates pass; the new lot kinds appear.
- `places.mjs import` of a Geo-voxel source.json, run on the Mac against the Geo-voxel checkout, builds the layers
  with `geo-voxels build`, imports and bakes.
- Headless browser: Third Street loads from its bake and plays; a suburb with a trailer park and a detached garage
  renders with furnished interiors. Production build passes; the four place layers are 1.3 MB of JSON in the content chunk (the BlenderGIS exports they replace were 0.44 MB).

## Geo-voxel impact (not changed)

Geo-voxel's `tools/sync-engine.mjs` copies `mission/GeoDistrict.js` and its imports (GeoFrame, GeoRectify,
GeoContext, GeoSite) from this repo into `engine/`. Those files are gone here, so the next sync fails. Geo-voxel's
current `engine/` copy (synced 2026-10-21) still works. Options: drop `GeoDistrict.js` from the sync `ENTRIES` and let
Geo-voxel own its copy (it is its real-place engine now), or sync from commit `8b6d210`.

Useful additions to layers@1 (the importer already reads them when present): each building's `footprint` cells,
`observedStoreys` (the export's storeys include the untagged default, which flattens the PLAN-15 height profiles),
`heightM` and `osmParts`; top-level `furniture` (real trees, signals); land-use codes for lawn / plaza / path.
