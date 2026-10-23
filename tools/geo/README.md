# Geo import — real places at a tactical scale

Catalog maps use `build.layoutScale: 0.8`: 20% shorter distances on each axis and about 36% less ground area.
The full source extent, street network and relative building placement are retained; room walls, doors, stairs,
characters and furniture still compile at the regular gameplay grid scale. This is a tactical adaptation, with
voxel rounding and minimum room sizes, rather than a geometrically exact miniature. Use `layoutScale: 1` for
faithful comparisons (the default for direct `buildGeoDistrict` calls). Values below 0.65 are rejected.

Rebuild a real map section (OpenStreetMap buildings, streets and car parks plus a DEM) as a playable voxel district.
Building interiors are planned by the shared parcel interior system (ModernBuilder rooms, stairs, glazing, furniture);
the district generator fills only what the source leaves open.

```
Blender + BlenderGIS ──(tools/geo/blender_geo_import.py)──► blender-export.json + reference-topdown.png
        │  OSM (Overpass) + DEM (OpenTopography: USGS 3DEP bare earth, or SRTM)
        ▼
GeoDistrict (shared/mission/GeoDistrict.js) ──► mission (voxels, buildings, spawns, gates report)
        frame → terrain → streets → lots → buildings (wings) → fill (no new buildings) → dressing → gates
```

## 0. The pipeline (one command, every parameter in `tools/geo/places.json`)

```sh
node tools/geo/geo-pipeline.mjs blender <id>                       # prints the Blender MCP call (padded fetch)
node tools/geo/geo-pipeline.mjs all <id> --export <blender-export.json> --reference <png>
#   install → catalog (regenerates shared/mission/generated/GeoCatalog.js) → build (output/geo/<id>/) →
#   audit (design gates, seeds 1–4; exits 1 on a fail) → bake (baked map + building prefabs)
```

Any building, anywhere: `node tools/geo/geo-pipeline.mjs place <id> --lat <lat> --lon <lon> --name "<name>"` writes a
`places.json` entry centred on it (160 m window + 30 m padding), then `blender <id>` and `all <id>` as above.

**Context** (Blender stage, one Overpass + ≤ 2 Wikidata requests, no keys): tenants and amenities inside each outline,
OSM 3D building parts, street furniture, Wikidata facts (floors, height, style, inception, heritage). For an older
export: `ns['context_only'](out)` in Blender. In the build (`shared/mapgen/geo/GeoContext.js`, `GeoPrograms.js`,
`GeoLandmark.js`):
- **uses → interiors**: the building's own tags, its one tenant, or Wikidata "instance of" pick the program — the
  existing ones (shop, diner, station, motel, office, garage, warehouse, house …) or the civic/landmark plans passed
  as `programDef` (bank, museum, chapel, civic, school, library, clinic, hotel, supermarket; room kinds vault, gallery,
  nave, vestry, chamber, classroom, reading, ward are furnished in ModernBuilder.ROOM_FURNITURE);
- **several tenants in one outline** (a strip of shops) → one unit per tenant with a party wall between;
- **landmarks** (heritage, style, history, height, or OSM 3D parts): parts above the playable storeys at their real
  heights with their roof shapes; otherwise the style grammar — gothic battlements, corner turrets and entrance towers;
  Georgian clock tower and steeple when the real height says so; neoclassical portico (columns are cover), pediment,
  cornice. No rooftop plant on landmarks. Map height grows to fit (cap 60 voxels ≈ 54 m);
- **real open land**: parks/grass lawn, named plazas paved, footpaths straight paved walks, mapped trees where they stand;
  nothing invented by the district filler; cover on lawns is trees;
- **real street furniture**: signals only where mapped (when any are mapped), bus stops and hydrants where mapped;
- **car parks**: shopping-centre lots about a third full, a planted island every 6th stall in each row.

A new place is one entry in `places.json` (id, name, theme, objective, text, import lat/lon/window/pad/dem,
tagOverrides, build options, bakeSeeds). Never edit GeoCatalog.js by hand. The same method, engine-agnostic, is
published as **Geo-voxels** (github.com/Dankcode/Geo-voxels).

**Assets the bake stage writes**
- `client/public/geo/<id>/baked-s<seed>.json` — the finished map frozen (MissionSnapshot format + material palette +
  generator version + source fingerprint). The client preloads it (LocalSession), the server worker reads it from disk
  (server/src/BakedDisk.js); a stale bake (generator or place changed) is ignored and the map is generated live.
  Re-bake after changing the generator or a place.
- `client/public/assets/buildings/<id>/<building>.json` + `index.json` — one **building prefab** per real building
  (voxels, rooms, wing records, exits, doors, windows, stairs, hints, decor; palette). Stamp into any map with
  `stampPrefab(m, prefab, { x, y, z, rot, mirror })` or `placePrefabInLot(m, prefab, lot, { face })`
  (shared/mapgen/geo/BuildingPrefab.js, PrefabLibrary.js).

## 1. Export from Blender (Blender MCP or the Python console)

BlenderGIS must be enabled and the OpenTopography API key set in its preferences (never in the repo).

```python
ns = {}; exec(open('<repo>/tools/geo/blender_geo_import.py').read(), ns)
ns['start'](lat=30.4497, lon=-91.1874, extent=(-100, 42, -95, 70),          # metres east/north of lat/lon
            out='<repo>/output/geo-baton-rouge/third-street-3dep', scene='BR_ThirdSt_3DEP',
            save_blend='baton-rouge-third-st-3dep.blend', dem_step=3, dem='USGS10m')
# poll <out>/geo-status.json; after an Overpass outage:  ns['resume']('<out>', 'osm')
```

- `dem='USGS10m'` (3DEP 1/3″ bare earth, US only, open to any free key) is the faithful choice. `SRTMGL1` is global but
  a *surface* model: downtown towers bleed into it (Third Street read 21–46 m on SRTM against 14.5–16.1 m on 3DEP), so
  GeoDistrict opens it morphologically and the relief is still approximate.
- The extent must fit 192 × 192 cells (≈ 172 m at 0.9 m per cell).
- Overpass mirrors return 502/504 under load; the script retries every BlenderGIS mirror and sends a User-Agent
  (Overpass rejects requests without one with 406, which BlenderGIS's bundled overpy omits).

## 2. Build, review, install

```sh
node tools/geo/geo-build.mjs --export <out>/blender-export.json --id baton-rouge-third-street \
     --name "Third Street · Baton Rouge" --objective "Fuqua Hardware Store Building" --out <out>/geo
#  → slate.ppm (top-down materials + hill shade), report.json (fidelity, gates, reach)
node tools/geo/geo-slice.mjs --export <out>/blender-export.json --building helix-steam-mentorship-academy --storey 0 --out plan.ppm
```

To make it playable, copy the export to `client/public/geo/<id>/geo.json` (and a small `reference.png`) and add an
entry to `shared/mission/generated/GeoCatalog.js`. Play: `?play=<id>&fixture=1&seed=1`.

## How each layer stays faithful

| Layer | Rule |
|---|---|
| Frame | One uniform source scale (0.9 / layoutScale metres per cell); rotated by the street (length × class) and wall weighted 4θ mean; cropped to the export's `window` (the Blender stage fetches `pad` metres more on every side, so rotated corners hold data). |
| Straighten | (`straighten: 'grid'`, default) GeoRectify: centrelines simplified (junctions pinned), every segment snapped to an axis (30–60° diagonals → an L), shared coordinates solved as weighted least-squares means, parallel carriageways kept in order; buildings, areas and footways rubber-sheeted along; every outline and land-use ring squared to the grid. Streets are rasterised by box distance (square ends and corners), junction squares belong to the longer street, and each street segment is a level plateau, so no slanted edge or diagonal height step is left. The report's `straighten` block is the distortion budget (max/mean shift in cells). |
| Terrain | DEM → bare ground → whole voxels (1-voxel steps are walkable: `maxStep` 1). Footprints and lots are flattened to plateaus with a 2-cell apron; a relaxation pass keeps every 8-neighbour step ≤ 1. Relief over 6 voxels is compressed and reported. |
| Streets | OSM centrelines buffered by lanes (3.3 m per lane + 2 m kerb parking; service 3.6 m): carriageway, kerb, 2-cell sidewalk, dashed centre line on two-way streets. Kerb stalls, street trees and lamps follow the local ground. |
| Lots | `amenity=parking` → every rectangular section between the lot's real drive aisles gets the district's two-row stall module, tiled every 14 cells. A `landuse=retail/commercial` area with no mapped parking is a strip-centre car park: its open land (minus a 3-cell storefront walk) becomes the lot, its service roads are levelled with it, its stalls fill as `retail` (busy at dusk), and its row ends are raised planter islands. |
| Street props | Road paint is a plan from the road graph (`GeoRoadPaint`): centre/lane/edge lines, stop bars and crosswalks at junction mouths, OSM crossings. Props (`GeoStreetProps`): mast-arm signals where two named arterials cross (a divided-boulevard crossing is one intersection, four corners), stop/street signs, utility poles, CATS bus stops on primaries, awnings and storefront planters on shop fronts, carts and corrals in lots, a pylon on big lots, rooftop units. No kerb parking on primaries, divided arterials or slip lanes (`*_link` roads are modelled as one-lane turn lanes). |
| Buildings | Catalog `tagOverrides` fill what OSM leaves blank (a store's name and use). An untagged `building=yes` inside retail land is a shop unit; a shop with no height is one tall storey. Shops front their car park (the longest lot frontage), never the map edge. OSM outline → cell mask (centre-inside + 0.3 cell to close digitising slivers). Touching buildings share ONE party wall line (the larger claims the boundary). The mask is cut into wings at its reflex corners (largest rectangle first; wings share their wall line — after Camozzato et al., SIGGRAPH 2015). Each wing is a ModernBuilder building; shared wing walls are solid on every storey with a doorway each, parapets across one roof height are removed, slivers < 5 cells are solid wall mass, except outer slivers ≤ 2 cells deep (an outline a few degrees off the grid), which are pavement so they never wall up a door. Storeys from `building:levels`/`height` (ModernBuilder caps at 3). |
| Fill | `fillDistrict` with a building cap of zero: parcel mixes and strips cover the open land, nothing invented. Cover repair is batched (one path search per round, pieces ≥ 7 cells apart, the stock land-use pieces plus a stalled car on carriageways wider than a kerb lane can cover) against the gate's own limit (gap ≤ 6), then the same pieces until ≥ 21.5 % of outdoor tiles are in cover (the `outdoorCover` gate is 20 %), then the stock rule for what is left. Stopped cars sit along their lane; car-park gaps get cart corrals, not concrete blocks. |
| Audit | District gates (land use, prop origins, vehicles, road air) and reachability of every wing from the insertion; outline IoU against the OSM polygon and the roomed share of each footprint. Skipped at game load (`audit: false`). |

Third Street, Baton Rouge (3DEP): 158 × 183 × 18, 14 real buildings as 20 wings, outline IoU 0.92 mean (0.76 min),
98 % of footprints are rooms, 61 lot stalls, ≈ 75 repair cover pieces, all district gates and the `maps.test` design
gates pass on seeds 1–3 (cover gap 6, 4 lanes, spawn safe), every room and exit reachable; ≈ 9 s to build in Node.

Sherwood Forest Blvd × Florida Blvd (3DEP): 190 × 190, the Asian Supermarket / Dollar Tree building, the west strip
and the corner pad (outline IoU 0.90 mean), the Sherwood Plaza car park (implied), 2 signals (the crossing sits on the
map's north-east corner), all `maps.test` gates on seeds 1–4 (outdoor cover 0.22, gap 6). OSM maps only 3 buildings
and no parking here, so the catalog names the store and the car park is inferred.

## Known limits

- ModernBuilder plans rectangles: a wing is a rectangle, so curved or diagonal walls staircase after rotation.
- `building:part`, roof shapes and per-part heights are ignored; storeys above 3 are clamped (21-storey towers are
  outside this extent anyway).
- Bridges, tunnels (`tunnel=building_passage`) and footway networks are not modelled; the generator draws sidewalks.
- Build time is dominated by the district's path searches (cover repair, mission metrics), not by the geo stages.
- Wide real streets need repair cover (stalled cars, barriers) to pass the no-killing-fields gate; how much is a
  balance call — `batchCoverRepair` spacing, `maxGap` and `minShare` are the knobs. On six-lane boulevards this
  reads as heavy stopped traffic.
- A map is at most 192 cells (≈ 172 m) a side: a big-box store and the intersection in front of it may not both fit
  whole (Sherwood: the store's stock-room back is trimmed at the south edge).
