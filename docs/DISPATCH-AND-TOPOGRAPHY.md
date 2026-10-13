# Dispatch review and map diagnostics

Normal Play, Host, Join and test-ground launches now stop at a local dispatch review. The screen shows current characters, weapons/ammunition, skills and AP/Will costs, and their validated 6×5 backpacks. Equipment is configured in the existing preparation menu; this screen reviews the resulting loadout. Online room codes are visible before dispatch. This is not a party-ready gate.

The topography debugger reads the compiled mission used by the battle. Choose surface elevation, lower-level or material views; toggle lot/parcel outlines and route/socket overlays; click a cell to inspect its height, standing surfaces, clearance and owning building. Metrics show actual design-gate results, cover gaps, lane counts and sightlines. The expandable panel and JSON export include available compiled algorithm metadata, parcel assignments and repairs. PNG export saves the current view. The eight-cell grid is a planning-lot guide; outlined rectangles are actual building footprints.

Use `/?play=sunken-junction&seed=27&brief=1` to open the new linked-boulevard review directly. Existing `?play=...` links remain immediate tests; add `quick=1` to skip review on other launch paths.

Sunken Junction connects two lower streets through a shared-height T-junction, four broad road ramps and two covered upper-road crossings. Retail and diner corners are rounded; warehouse and garage corners are square. Square corner metadata is preserved in snapshots and used by both rendered silhouettes and ballistic collision. The earlier Sunken Boulevard now uses street barriers, vending machines, bins and pallets rather than park benches and bushes. Both upper crossings remain walkable and have guard rails.

Map ground and geometry stop at tactical bounds. The original vector image `client/public/assets/backgrounds/district.svg` supplies the 2D backdrop; the old extended ground apron and off-map 3D buildings are no longer created.
