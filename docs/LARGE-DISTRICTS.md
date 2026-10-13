# Large district playtest

Select **Park District**, **Market Arcade**, or **Drainage Quarter** under Large districts. Width (96–128), depth (72–96), and rectangle/L/T footprint controls appear below the map selection. Play opens the dispatch review and topography debugger; dispatch starts the battle. Seed 27 is the reference playtest.

- Park District: a limited mix of retail, industrial and office parcels, rounded planted elevation contours, two broad stair promenades, and an elevated path cross.
- Market Arcade: two 24 × 22 retail shells linked by a three-wide passage, large sales floors with counter islands, rear service rooms, neighboring shops, and a raised park. The default L footprint removes the southeast corner.
- Drainage Quarter: three turning open-channel parcels, dry walking banks, water using the existing Hydro/wading/freezing/electrical rules, three stair entrances, three shortcut ladders, and two surface bridges with lower-bank clearance. Default T footprint. Other themes do not excavate a compulsory sunken layer.

Dimensions, shape, and seed survive descriptor sanitation on local and online sessions (`district: {width, depth, shape}`). Cells outside the footprint are physically removed. Parcels that would cross the boundary are omitted, including their rooms and render hints. Extra east/south parcels are eligible in wider/deeper layouts, subject to the building limit. Seeded program and height choices vary the district parcels while reserved routes keep entrances and alley traversal open.

Topography debug JSON includes actual building assignments, merged neighbors, connector cells/sockets, footprint, connector validation, and a traversable parcel network with paths. Generation rejects an unreachable socket or network link. The graph describes playable routing between parcels, rather than claiming every pair shares a wall.

Sprites retain camera-facing artwork but use an upright depth plane with a small surface offset. Stairs no longer intersect the tilted billboard depth. Normal depth testing remains enabled for walls, and walkers retain their 3D geometry. The depth-plane regression test checks projected height and depth equivalence at a 45-degree camera angle.

This is a set of compositional playtest generators, rather than a conversion of every legacy map or the separate generated-operation plot solver. The arcade is a shared retail interior prototype; escalators, atriums, and multi-floor mall programs are future extensions.

## Remix lab

Open `/?tab=test`. **Collision lab** selects a few retail shells, half-cover windows, empty interiors, flat terrain, no traffic and no scattered pedestrian cover. Debug tools are enabled. **Chaotic district** restores mixed programs and an elevated bridge parcel. **Remix seed & preview** rebuilds the current configuration with another seed. Test launch skips the dispatch review; preview, save/load and share links preserve all district settings. Reports also retain the district descriptor for replay.

Controls include dimensions/shape, building limit, minimum/maximum infill floors, noise-weighted WFC or ordered placement, retail/industrial/mixed programs, wall kit, full/half/framed glazing, corner shape, terrain terraces, traffic amount, pedestrian cover, interior links, elevated parcels and furnishing. The footprint may accommodate fewer buildings than the limit. Large arcade anchors and the supported bridge have constrained recipe heights; the infill height range applies to WFC parcels.

WFC chooses program and storey count using coherent seeded noise priors. Nearby parcels cannot both take the tallest option, unless a single fixed height was requested. Eligible parcel footprints and reserved routes remain hard constraints. Noise varies frontage, parcel order and wall treatments. Bridge buildings opt out of solid foundations and stand on a supported grate platform with a compact stair entrance; the path beneath remains open.

Street dressing uses curb bays, a marked rear service road, loading courts and bus shelters. Cars, abandoned cars, trucks, buses, semitrailers and 18-wheelers have matching whole-object render hints and collision footprints. Pedestrian cover uses supply caches, utility cabinets, parcel lockers and bike racks. Light pedestrian mode caps the additional cover pass to roughly one group per 160 map cells; None disables it. The normal tactical preset keeps the cover pass for balanced missions. Collision presets expose their actual design metrics without filling empty space merely to satisfy cover gates.

Bench, planter-bush and hedge cover is retired at mission compilation and replaced with practical supply/low cover. Decorative plants are removed. Street barriers no longer enter the district scatter palette. Existing authored checkpoint barriers remain purposeful fixtures.

Stairs now have six mesh treads per tile. Park stairs are two tiles wide and three tiles long; drainage entrances remain inside their bank parcels. Unit feet use the actual centre-tread height. Whole street assemblies remember each member's material, so destroyed members correctly switch to fragment rendering.


Validation: the production build and 238 regression tests pass. Browser QA exercised presets, edits without focus replacement, preview PNG/debug JSON export, save/load, immediate launch and a 600-pixel viewport. The Browser plugin was unavailable, so QA used Playwright with installed Chrome. Initial support checks remove zero voxels on all three district presets.
