# 13 · Materials

Every voxel stores one material id (0 = air). Definitions: `shared/voxel/Materials.js` (`def`), connected shapes:
`shared/voxel/ConnectedShapes.js`. Ids are append-only so recorded maps and replays stay valid.

## Fields

| Field | Meaning | Default |
|---|---|---|
| `hp` | damage absorbed before destruction; ∞ = indestructible ([05](05-destruction.md)) | 4 |
| `solid` | blocks movement and the body; something to stand on if also walkable | true |
| `opaque` | blocks sight ([03](03-cover-and-sight.md)) | = solid |
| `projectile` | `block` stops bullets, grenade arcs and blast shielding; `pass` lets them through | `block` if solid, else `pass` |
| `shatters` | cosmetic: a live bullet crossing it sets it to air (glass; [03](03-cover-and-sight.md#glass-is-cosmetic)) | false |
| `walkable` | its top can be a standing surface ([02](02-movement.md)) | = solid |
| `moveCost` | path cost multiplier when standing on it | 1 |
| `liquid`, `traversal` | `wade` (shallow water: standable) or `blocked` (deep water, lava) | — |
| `flammable` | can be ignited and burn ([06](06-elements.md)) | false |
| `explosive` | `{ radius, power, damage, element }` blast when destroyed by damage | — |
| `burnTo` / `meltTo` / `freezeTo` | what fire, heat or cold turn it into | — |
| `debris` | what it leaves when destroyed on solid ground (2 cells in 3) | — |
| `structural` | collapses into rubble when unsupported (else vanishes) | = solid |
| `family` | element damage multipliers ([05](05-destruction.md)) and glass/ice handling | `earth` |
| `element` | vibe-game element id (traversal / flavour) | GEO |
| `concealment` | > 0 makes `coverWeight` 0.35 | 0 |
| `part` | vibe-game building part: 2 door, 4 stairs (traversal) | 0 |
| `light`, `render`, `color` | presentation only | — |

**Cover class** (`coverWeight`): 1 for `block` materials (they count in the cover readout), 0.35 for
concealment (`hedge`, `leaves`; the readout treats anything under 1 as no cover), 0 for the rest. **Connected
shape**: the footprint rays and the cover sampler see ([03](03-cover-and-sight.md#partial-connected-shapes)); a dash
means a full cell. Ground materials show "cover (1)" because a one-high step of soil beside a unit is cover like
anything else that stops bullets.

## Table

<!-- generated:materials -->
| id | key | label | hp | solid | opaque | projectile | walkable | move cost | liquid | flammable | explosive | transforms | structural | family | element | cover class (`coverWeight`) | connected shape |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `air` | air | 0 | — | — | pass | — | 1 | — | — | — | — | — | earth | void | none (0) | — |
| 1 | `bedrock` | Bedrock | ∞ | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | geo | cover (1) | — |
| 2 | `soil` | Soil | 5 | yes | yes | block | yes | 1 | — | — | — | debris→rubble | yes | earth | geo | cover (1) | — |
| 3 | `grass` | Grass | 5 | yes | yes | block | yes | 1 | — | — | — | debris→soil | yes | earth | geo | cover (1) | — |
| 4 | `forest_floor` | Forest floor | 5 | yes | yes | block | yes | 1 | — | — | — | debris→soil | yes | earth | geo | cover (1) | — |
| 5 | `sand` | Sand | 3 | yes | yes | block | yes | 1.15 | — | — | — | — | yes | earth | anemo | cover (1) | — |
| 6 | `snow` | Snow | 2 | yes | yes | block | yes | 1.2 | — | — | — | — | yes | earth | cryo | cover (1) | — |
| 7 | `road` | Road | 6 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | geo | cover (1) | — |
| 8 | `cobble` | Cobblestone | 7 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | geo | cover (1) | — |
| 9 | `stone` | Stone wall | 9 | yes | yes | block | — | 1 | — | — | — | debris→rubble | yes | stone | geo | cover (1) | wall 0.4 |
| 10 | `city_wall` | City wall | 14 | yes | yes | block | — | 1 | — | — | — | debris→rubble | yes | stone | geo | cover (1) | — |
| 11 | `plaster` | Plaster wall | 6 | yes | yes | block | — | 1 | — | — | — | debris→rubble | yes | stone | structure | cover (1) | wall 0.4 |
| 12 | `timber` | Timber wall | 4 | yes | yes | block | — | 1 | — | yes | — | burn→ash | yes | wood | structure | cover (1) | wall 0.4 |
| 13 | `plank` | Wood floor | 4 | yes | yes | block | yes | 1 | — | yes | — | burn→ash | yes | wood | structure | cover (1) | — |
| 14 | `stone_floor` | Stone floor | 8 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | structure | cover (1) | — |
| 15 | `roof` | Roof tiles | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | yes | wood | structure | cover (1) | — |
| 16 | `glass` | Window | 1 | yes | — | pass | yes | 1 | — | — | — | — | — | glass | structure | none (0) | pane 0.1 |
| 17 | `door` | Door | 4 | — | yes | block | — | 1 | — | yes | — | — | — | wood | structure | cover (1) | pane 0.08 |
| 18 | `door_open` | Open door | 4 | — | — | pass | — | 1 | — | — | — | — | — | wood | structure | none (0) | — |
| 19 | `stairs_wood` | Wooden stairs | 4 | yes | yes | block | yes | 1 | — | yes | — | burn→ash | yes | wood | structure | cover (1) | — |
| 20 | `stairs_stone` | Stone stairs | 8 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | structure | cover (1) | — |
| 21 | `water` | Shallow water | ∞ | — | — | pass | yes | 1.8 | wade | — | — | freeze→ice | — | earth | hydro | none (0) | — |
| 22 | `deep_water` | Deep water | ∞ | — | — | pass | — | 1 | blocked | — | — | freeze→deep_ice | — | earth | hydro | none (0) | — |
| 23 | `ice` | Ice | 2 | yes | — | block | yes | 1.4 | — | — | — | melt→water | yes | ice | cryo | cover (1) | liquid shoreline |
| 24 | `lava` | Lava | ∞ | — | — | pass | — | 1 | blocked | — | — | — | — | earth | pyro | none (0) | — |
| 25 | `hedge` | Hedge | 2 | yes | yes | pass | — | 1 | — | yes | — | — | — | plant | geo | concealment (0.35) | band 0.86 |
| 26 | `leaves` | Leaves | 1 | — | yes | pass | — | 1 | — | yes | — | — | — | plant | geo | concealment (0.35) | — |
| 27 | `trunk` | Tree trunk | 6 | yes | yes | block | — | 1 | — | yes | — | burn→ash | yes | wood | geo | cover (1) | — |
| 28 | `furniture` | Furniture | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | — |
| 29 | `shelf` | Shelf | 4 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | — |
| 30 | `crate` | Crate | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | — |
| 31 | `barrel_powder` | Fuel drum | 1 | yes | yes | block | — | 1 | — | yes | r 2.6, pow 9, dmg 5, pyro | — | — | wood | pyro | cover (1) | — |
| 32 | `barrel_water` | Water drum | 2 | yes | yes | block | — | 1 | — | — | r 1.8, pow 0, dmg 0, hydro | — | — | wood | hydro | cover (1) | — |
| 33 | `metal` | Iron | 16 | yes | yes | block | — | 1 | — | — | — | — | yes | metal | geo | cover (1) | — |
| 34 | `rubble` | Rubble | 3 | yes | yes | block | yes | 1.5 | — | — | — | — | — | stone | geo | cover (1) | — |
| 35 | `ash` | Ash | 1 | yes | yes | block | yes | 1.1 | — | — | — | — | — | earth | geo | cover (1) | — |
| 36 | `sandbag` | Sandbags | 6 | yes | yes | block | — | 1 | — | — | — | — | — | earth | anemo | cover (1) | band 0.62 |
| 37 | `crystal` | Crystal node | 5 | yes | — | block | yes | 1 | — | — | — | — | — | ice | cryo | cover (1) | — |
| 38 | `cloth` | Awning | 1 | yes | yes | pass | yes | 1 | — | yes | — | — | — | plant | structure | none (0) | — |
| 39 | `lantern` | Light fixture | 1 | yes | yes | block | — | 1 | — | — | r 1.4, pow 1, dmg 1, pyro | — | — | metal | pyro | cover (1) | — |
| 40 | `hay` | Hay bale | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | plant | anemo | cover (1) | — |
| 41 | `drystone` | Dry-stone wall | 8 | yes | yes | block | — | 1 | — | — | — | debris→rubble | — | stone | geo | cover (1) | band 0.62 |
| 42 | `fence` | Plank fence | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | band 0.14 |
| 43 | `rock` | Boulder | 14 | yes | yes | block | yes | 1 | — | — | — | debris→rubble | — | stone | geo | cover (1) | — |
| 44 | `cart` | Cart | 4 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | — |
| 45 | `stall` | Market stall | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | — |
| 46 | `stucco` | Stucco wall | 6 | yes | yes | block | — | 1 | — | — | — | debris→rubble | yes | stone | geo | cover (1) | wall 0.4 |
| 47 | `concrete` | Concrete paving | 10 | yes | yes | block | yes | 1 | — | — | — | debris→rubble | yes | stone | geo | cover (1) | — |
| 48 | `asphalt` | Asphalt | 8 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | geo | cover (1) | — |
| 49 | `oak_floor` | Oak floor | 5 | yes | yes | block | yes | 1 | — | yes | — | burn→ash | yes | wood | geo | cover (1) | — |
| 50 | `ceramic` | Ceramic tile | 6 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | geo | cover (1) | — |
| 51 | `lawn` | Lawn | 5 | yes | yes | block | yes | 1 | — | — | — | debris→soil | yes | earth | geo | cover (1) | — |
| 52 | `sofa` | Sofa | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | geo | cover (1) | — |
| 53 | `cabinet` | Kitchen cabinet | 5 | yes | yes | block | — | 1 | — | yes | — | — | — | wood | geo | cover (1) | — |
| 54 | `bed` | Bed | 3 | yes | yes | block | — | 1 | — | yes | — | — | — | wood | geo | cover (1) | — |
| 55 | `desk` | Desk | 3 | yes | yes | block | — | 1 | — | yes | — | — | — | wood | geo | cover (1) | — |
| 56 | `planter` | Concrete planter | 8 | yes | yes | block | — | 1 | — | — | — | debris→rubble | — | stone | geo | cover (1) | band 0.8 |
| 57 | `privacy_fence` | Privacy fence | 4 | yes | yes | block | — | 1 | — | yes | — | — | — | wood | geo | cover (1) | band 0.14 |
| 58 | `car_body` | Parked car | 10 | yes | yes | block | — | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
| 59 | `appliance` | Appliance | 7 | yes | yes | block | — | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
| 60 | `road_mark` | Road marking | 8 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | geo | cover (1) | — |
| 61 | `paving` | Paving slabs | 10 | yes | yes | block | yes | 1 | — | — | — | debris→rubble | yes | stone | geo | cover (1) | — |
| 62 | `deck` | Timber deck | 4 | yes | yes | block | yes | 1 | — | yes | — | burn→ash | yes | wood | structure | cover (1) | — |
| 63 | `gravel` | Gravel | 6 | yes | yes | block | yes | 1.05 | — | — | — | — | yes | stone | geo | cover (1) | — |
| 64 | `brick` | Brick wall | 9 | yes | yes | block | — | 1 | — | — | — | debris→rubble | yes | stone | structure | cover (1) | wall 0.4 |
| 65 | `concrete_wall` | Concrete wall | 12 | yes | yes | block | — | 1 | — | — | — | debris→rubble | yes | stone | geo | cover (1) | wall 0.4 |
| 66 | `siding` | Metal siding | 5 | yes | yes | block | — | 1 | — | — | — | — | yes | metal | geo | cover (1) | wall 0.4 |
| 67 | `roof_metal` | Metal roof | 4 | yes | yes | block | — | 1 | — | — | — | — | yes | metal | geo | cover (1) | — |
| 68 | `car_cabin` | Car cabin | 8 | yes | yes | block | — | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
| 69 | `container` | Shipping container | 20 | yes | yes | block | yes | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
| 70 | `dumpster` | Dumpster | 12 | yes | yes | block | — | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
| 71 | `jersey` | Concrete barrier | 14 | yes | yes | block | — | 1 | — | — | — | debris→rubble | — | stone | geo | cover (1) | band 0.62 |
| 72 | `bench` | Bench | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | — |
| 73 | `bin` | Wheelie bin | 2 | yes | yes | block | — | 1 | — | yes | — | — | — | wood | geo | cover (1) | — |
| 74 | `pump` | Fuel pump | 4 | yes | yes | block | — | 1 | — | — | r 2.8, pow 8, dmg 6, pyro | — | — | metal | pyro | cover (1) | — |
| 75 | `pallet` | Pallet stack | 3 | yes | yes | block | — | 1 | — | yes | — | burn→ash | — | wood | structure | cover (1) | — |
| 76 | `shelving` | Store shelving | 5 | yes | yes | block | — | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
| 77 | `chainlink` | Chain-link fence | 2 | yes | — | pass | — | 1 | — | — | — | — | — | metal | geo | none (0) | band 0.08 |
| 78 | `carpet` | Carpet | 5 | yes | yes | block | yes | 1 | — | yes | — | burn→ash | yes | wood | structure | cover (1) | — |
| 79 | `tile_dark` | Floor tiles | 7 | yes | yes | block | yes | 1 | — | — | — | — | yes | stone | structure | cover (1) | — |
| 80 | `ladder` | Ladder | 3 | — | — | pass | — | 1 | — | — | — | — | — | metal | structure | none (0) | — |
| 81 | `deep_ice` | Ice (over deep water) | 2 | yes | — | block | yes | 1.4 | — | — | — | melt→deep_water | yes | ice | cryo | cover (1) | liquid shoreline |
| 82 | `door_locked` | Locked service-room door | ∞ | yes | yes | block | — | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
| 83 | `grate` | Steel grate | 4 | yes | — | pass | yes | 1 | — | — | — | — | yes | metal | geo | none (0) | — |
| 84 | `steel_stair` | Steel stairs | 6 | yes | — | pass | yes | 1 | — | — | — | — | yes | metal | geo | none (0) | — |
| 85 | `steel_post` | Steel post | 12 | yes | yes | block | — | 1 | — | — | — | — | yes | metal | geo | cover (1) | band 0.15 |
| 86 | `railing` | Steel railing | 4 | yes | — | pass | — | 1 | — | — | — | — | — | metal | geo | cover (1) | band 0.08 |
| 87 | `emergency_light` | Emergency light | 1 | yes | yes | block | — | 1 | — | — | — | — | — | metal | geo | cover (1) | — |
<!-- /generated:materials -->

## Notes

- `glass` is `walkable` and `cloth` (awning) is `walkable` by default value: a unit could stand on top of a window
  or an awning if there is headroom above it. Neither is set explicitly; probably unintended.
- `container`, `rock` (boulder) and `crystal` are walkable: units can stand on shipping containers and boulders.
- `door` is not solid: units walk through closed doors (opening them); see [02](02-movement.md#doors).
- `chainlink` is solid (blocks movement, vaultable) but not opaque and `pass`: no cover, no sight block.
- `glass` is solid (blocks movement) but `pass` and not opaque: no cover, never stops a shot, sight or an arc; it
  only breaks.
- `ladder` is not solid, not walkable, not opaque and `pass`: no cover; movement uses it through
  `PathSearch.ladderMoves` ([02](02-movement.md#ladders)). Placed only by `MapKit.ladder` (Harbor Yard).
- `hedge` is solid, opaque and `pass`: blocks movement and sight, not bullets.
- Flammable materials without `burnTo` (`door`, `hedge`, `leaves`, `cloth`, `barrel_powder`, `cabinet`, `bed`,
  `desk`, `privacy_fence`, `bin`) turn to air when they burn out instead of ash (none of them has `debris`). The fuel
  drum detonates when fire consumes it.
- No present-day map builder (the five maps, `MapKit`, `ModernBuilder`, the theme catalogues) places `city_wall`,
  `furniture`, `shelf`, `lantern`, `crystal`, `road`, `cobble`, `plank` or `stairs_wood`; they come from the earlier
  medieval content (the legacy `BuildingBuilder`, the unused `Props.js`, the generic `PROP_CATALOG`) and can still
  be placed with the debug `place` op. `stone_floor` appears in play only as cooled lava. `metal` is used for the
  Route 9 canopy columns.
