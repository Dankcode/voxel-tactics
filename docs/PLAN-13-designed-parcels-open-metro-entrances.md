# PLAN-13: Designed parcels and open metro entrances

Status: implemented 2026-10-19 (not committed). Full suite green: 74/74 test files (new `shared/mapgen/plan13.test.js`). Content contract re-synced.

## What was wrong

- **Random boxes.** The generated maps placed outdoor props with a weighted bay-level wave-function-collapse (WFC) solver. Every open lot and yard drew from a weighted pool, so the maps filled up with lone pieces. Those pieces were:
  - dumpsters, which render as black boxes;
  - vending machines (`appliance` voxels, 2 tall);
  - wheelie bins;
  - rubble cubes;
  - two-cell chain-link and barrier stubs;
  - sandbags.

  The cover-gap repair loop added more of the same.
- **Roof arch in the street.** The subway stair entrance was wrapped in a "street-underpass-portal". That was a 5-wide concrete box with a `roof` slab, and the renderer draws `roof` as an orange tiled hip roof. The line of play cut away any wall standing on its path, so the result was a tiled roof on two posts in the middle of the street. The manhole had the same kind of "service headhouse".

## References

- **XCOM 2 plots and parcels** ([80.lv, *Environment storytelling in XCOM 2*](https://80.lv/articles/environment-storytelling-in-xcom-2/); [GDC, *Plot and Parcel Procedural Level*](https://gdcvault.com/play/1025213/Plot-and-Parcel-Procedural-Level)).
  - Parcels are authored layouts that slot into a plot's sockets.
  - Cover along streets comes from plot cover parcels (PCPs): cover and decoration *sets* 8–16 tiles long, laid along the roadway.
  - Decoration follows grid lines and never blocks pathing on neighbouring tiles.
- **Open metro stair entrances.** NYC zoning standards for subway stair entrances ([zr.planning.nyc.gov](https://zr.planning.nyc.gov/node/18187)) say an entrance sits directly beside the sidewalk and keeps the entrance area clear of obstructions. The common street form is an open stair well behind waist-high railings, not a roofed box.

## Changes

| Change | Where |
|---|---|
| **Designed parcel layouts** in frontage-local bay coordinates, rotated to each lot's street side (see the table below) | `shared/mapgen/ParcelTemplates.js` (new) |
| **Building yards** dress only their parcel boundary. Gardens get a hedge on the street edge and a fence on the other edges, with gaps. Industrial yards get chain-link on the boundary. Paved yards get planters at the street corners. | `planParcelPins` |
| **Street trees** on a fixed rhythm (every fourth sidewalk bay) | `planStreetTrees` |
| **Pools carry no scatter.** Lots and yards are open ground plus their layout. Sidewalks are open ground plus bus stops. Lanes and parking have cars. Container yards keep containers. | `LotCatalogue.PIECE_POOLS` |
| **New full-cover piece `tall_planter`**: a raised, planted concrete planter, two cells high. It replaces vending machines as full cover in repairs and shields. | `LotCatalogue.BAY_PIECES` |
| **`vending` added to `CLUTTER_BASES`**, so the existing `noClutter` gate rejects it | `LotCatalogue` |
| **Pockets are one run of cover.** Each line-of-play pocket is a single run of the same cover across the advance (low wall, planter row, hedge, tall planter, barrier, fence or bench), up to three bays long. Previously it was single pieces dotted around a point. | `ExteriorSolver.planPockets` |
| **Pins never contradict each other.** Before collapsing a lot, any pair of fixed bays that would touch releases the weaker pin. Priority is already-solved neighbours, then pocket and repair pins, then parcel-layout pins. Before this, one conflict sent the whole lot to the "open ground" fallback. | `ExteriorSolver.solveBays` (`soft` pin set), `Generator`, `Repair.resolveLots` |
| **Repair cover is real street cover**: planter, low wall, hedge, barrier, bench, tall planter. No more vending machines, bins or sandbags. | `Repair.pinCoverNear`, `shieldDrop` |
| **Open metro entrance.** No roof and no walls. Steel railings stand at street level along both sides of the upper well, beside the top flights. The deep end stays open on three sides as a drop-in, which keeps the `flankLength` budget. The manhole keeps only its shaft and ladder. | `ConnectingParcels.finishConnectionParcel` |

### Parcel layouts

| Lot | Layout |
|---|---|
| Vacant lot | Chain-link along the street with a gate |
| Construction site | Hoarding with a site gate, side fences and a staging line of barriers |
| Depot yard | Barrier lane down one side; fenced back boundary with a gate |
| Container yard | Two container aisles; fenced street edge with a gate |
| Plaza | Corner planters, two trees with benches facing them, tall planters at the back corners |
| Subway plaza | Planters and benches |
| Pocket park | Hedged on three sides, open to the street; trees and a bench inside |
| Backyard | Fenced on the back and sides; hedge on the street edge; one tree |
| Alley | Kept clear |

## Verification

- **Gates:** downtown, industrial and suburb seeds 1–4 pass every gate. Some seeds need one deterministic re-seed for cover.
- **Outdoor checks:** no `roof` or `appliance` voxels outside building footprints, and no dumpsters, bins, vending machines, rubble or sandbags in any layout. `plan13.test.js` enforces both.
- **Live check:** before the final tweaks, downtown seed 1 and industrial seed 1 looked right on the dev server: open stair with railings, planter rows, a fenced lot, container aisles, no floating roof. The depot/alley layouts and the railing layout changed after that check. Suburb was not checked live because the dev server stopped responding at the end of the session.

## Notes

- Generated layouts change for every seed (operation fixtures are generated, not stored).
- Picture-mode (image-to-map) lots now also get no random scatter, only pockets and repairs. The image-map tests pass.
