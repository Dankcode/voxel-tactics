# Compact districts and functional interiors

The aim is to spend movement on tactical choices: entering a shop, crossing a lane, taking a service exit or
changing floors. Character scale, AP, movement costs, weapon ranges, destruction and authored fixture maps stay
as they are. Smaller maps still run through the existing reachability, breach, cover, sightline and spawn gates.

## Shooter references and adaptation

- [Rainbow Six Siege — Map Rework Philosophy](https://www.ubisoft.com/en-au/game/rainbow-six/siege/news-updates/5jByh7fv1VJuvR3cwx2XmB/map-rework-philosophy):
  rotation opportunities and avoiding a single choke point. Here, retain front/back/side exits, room-door loops,
  stairs, fire escapes and underground flanks; commercial plans include public and service sides.
- [Modern Warfare III — Scrapyard](https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-modern-warfare-iii-play-maps-core-multiplayer-map-guide-scrapyard):
  warehouses and smaller intervening spaces create different combat distances. Here, tall storage racks,
  low packing benches and a connected packing room distinguish storage, shipping and loading.
- [Modern Warfare III — Meat](https://www.callofduty.com/guides/multiplayer-maps/call-of-duty-guide-modern-warfare-iii-multiplayer-map-meat):
  compact circulation with areas suited to different engagement ranges. Here, shorten the map footprint while
  retaining cover chains and open lanes, rather than changing the soldiers' movement economy.

These are design references, not copied layouts or assets. Tactical pacing still needs human playtesting.

## What changed

Operation themes use 48 × 40 cells instead of 56 × 48: 28.6% less area, aligned to the existing eight-cell lot
system. Objective parcels, road connections, underground routes and vertical access are generated within that
footprint. Imported catalog maps use a uniform 0.8 source-layout scale: approximately 20% shorter linear
traversals and 36% less area. The source window is retained instead of cropped or independently stretched.
Minimum room sizes and voxel rounding mean very small source features can still merge or drop; inspect reports.

Geo import classifies markets, hardware shops and supermarkets separately, including catalog tag overrides
when there is no context fetch. Vehicle-repair shops resolve to garages. A supermarket has grocery displays and
stockrooms; a market has vendor counters and packing/cold storage; hardware has parts bins, a workshop and
dispatch; a warehouse has loading, stock, packing and office space, with an open stock-to-packing connection.

Seven new one-cell render modules are composed into solid furniture clusters:

| Module | Purpose | Gameplay height |
| --- | --- | --- |
| Vendor counter | Market crates and striped frontage | 1 voxel |
| Bakery case | Glass display and bread trays | 1 voxel |
| Chest freezer | Low grocery/cold-store island | 1 voxel |
| Packing table | Shipping cartons and parcel scale | 1 voxel |
| Roller conveyor | Repeatable dispatch line | 1 voxel |
| Cable reel | Hardware/industrial round cover | 1 voxel |
| Parts bins | Wall-backed hardware sorting | 1 voxel |

Furniture remains voxel-backed and destructible, so the visible props and gameplay obstacles agree. Existing
shelving supplies tall cover. Operation center slots now fit three-cell gondolas and conveyors (previously they
were limited to two cells, excluding those pieces entirely).

Offices, bedrooms, living rooms, dining rooms, stockrooms and warehouses each have three seeded furniture
recipes shared by geo and operation furnishing. Large commercial/industrial rooms repeat working bays based
on room area, up to twelve kits, while retaining one checkout. Grocery kits exclude hardware pegboards. Door
clearance, window landings, stair reservations and the floor-connectivity guard remain in force.

## Tuning and verification

- `shared/mapgen/PlotCatalogue.js`: operation dimensions, in whole lots.
- Real places come from Geo-voxel (its own layout scale and straightening); `tools/places/places.json` holds the
  game-side options per place (`build`: theme parcels, programme overrides, open land). See `tools/places/README.md`.
- `shared/mission/modern/ModernBuilder.js`: furniture footprints, recipes, and area-based kit counts.
- `shared/mapgen/geo/GeoPrograms.js`: source tags and functional room plans.

Generator versions invalidate older bakes; rebake each catalog place with
`node tools/places/places.mjs bake <id>` to refresh both playable maps and reusable building prefabs.

Use the shared baseline `http://localhost:2567/?play=operation&plot=downtown&seed=1` and real-place fixtures such as
`http://localhost:2567/?play=baton-rouge-sherwood-florida&fixture=1&seed=1`. Compare multiple seeds for cover,
room access and subjective pacing. Map shrinking reduces nominal distances; it does not guarantee every
shortest path shrinks by exactly 20%, because rasterisation and route selection can change.

Validation for this change: 39 targeted map/interior/renderer regressions and 10 co-op/server tests passed;
all four catalog geo locations passed tactical and district gates across seeds 1–4, with every building entrance
reachable. Production build, content-contract check, bake fingerprints and whitespace checks passed. Desktop
visual checks covered the shared downtown baseline and the Sherwood supermarket. Mobile work is deferred.
