# 03 · Cover and sight

Cover works on two layers:

1. **Ballistics is the truth.** A projectile is a ray traced through the real shapes of the voxels; whatever it
   meets first takes the hit. Cover never changes a dice roll; it changes what the rays can reach
   ([04](04-ballistics-and-weapons.md)).
2. **The cover readout** (`shared/voxel/Cover.js`) turns the same voxels into XCOM's NONE / HALF / FULL. It drives
   the HUD shields, the move tooltip, the "FLANKED" warning, the AI's tile scoring and the map metrics. It does not
   enter the hit calculation.

## Which materials count (`Materials.coverWeight`)

| Weight | Materials | Readout |
|---|---|---|
| 1 | every material with `projectile: 'block'` (walls, props, furniture, vehicles, ground, rubble, closed doors, ice) | counts |
| 0.35 | `concealment` materials: `hedge`, `leaves` (opaque, bullets pass) | treated as **no cover** (`protection` returns 0 below weight 1) |
| 0 | air, **`glass`**, `door_open`, water, `chainlink`, `cloth` (awning), `ladder` | no cover |

## Cover per face (`Cover.coverToward`, `coverAt`)

For each of the four faces (N, E, S, W) the readout looks at the neighbouring cell at the unit's **z+1** (low band)
and **z+2** (high band). Each band's protection is the fraction of **5 parallel rays** (offsets −0.38, −0.19, 0,
0.19, 0.38: a 0.76-wide body band) that meet the neighbour's actual footprint; a voxel without a special footprint
counts as 1.

- **FULL**: low ≥ 0.8 **and** high ≥ 0.8 (at least 4 of 5 rays in both bands).
- **HALF**: low ≥ 0.4 **or** high ≥ 0.4 (2 of 5 in either band; a window gap or overhang above still counts).
- **NONE** otherwise.

`coverAt` returns all four faces (the HUD's per-face shields and the map metrics use it).

## Directional cover and flanking (`Cover.coverAgainst`, `isFlanked`)

Against a shooter at `(sx, sy)`: only faces whose outward direction is within **60°** of the bearing to the
shooter count (normalised dot ≥ 0.5). For each, the 5-ray band is laid **along the actual line of fire** through
the neighbour cell (`protectionAlong`), so a shot that comes round a wall end or a corner post is rated by what it
would really cross. The best face wins.

- Height is ignored: only the target's own neighbours at z+1 and z+2 are sampled; the shooter's z plays no part.
- **Flanked** = `coverAgainst` is NONE. The move tooltip and the red "!" shield use the worst cover against every
  enemy currently visible to the squad (`coverAgainstAll` in `Battle.js`).
- Flanking has no damage or crit bonus (there are no crits). It matters only because nothing physical is in the
  way of the rays.

## Partial connected shapes

`shared/voxel/ConnectedShapes.js` gives some materials a footprint thinner than the cell. Rays (bullets, sight,
grenade arcs) and the cover sampler intersect the footprint prism; movement still reserves the whole cell.

| Shape | Materials | Width | Joins with |
|---|---|---|---|
| wall module (`WALL_KEYS`) | `stone`, `plaster`, `timber`, `stucco`, `brick`, `concrete_wall`, `siding` | 0.4 | other walls and openings (`glass`, `door`, `door_open`, `lantern`) |
| band (`BANDS`) | `hedge` 0.86, `planter` 0.8, `sandbag` 0.62, `drystone` 0.62, `jersey` 0.62, `privacy_fence` 0.14, `fence` 0.14, `chainlink` 0.08 | as listed | the same material only |
| pane | `glass` 0.1, closed `door` 0.08 | as listed | oriented along the wall it sits in (`openingAxis`) |
| shoreline | `ice`, `deep_ice` | full cell, rounded outside corners | water and ice |
| full cell | everything else | 1 | — |

Only face neighbours join; diagonal neighbours never do. Exposed corners are rounded (radius 0.12 for walls; per
band otherwise). Consequences of the 5-ray rule, all from the code:

- A **lone wall post** (0.4 wide) is hit by 3 of 5 rays → 0.6 → **HALF**, even two voxels high. A wall *run*
  facing the shot covers the whole band → FULL when two high.
- A **lone sandbag or barrier** stack (0.62) → 3 of 5 → HALF; a joined run → full band.
- A **lone fence post** (0.14) → 1 of 5 → NONE; a fence run across the line of fire → full band (HALF, it is one
  high).
- A planter (0.8) covers all 5 offsets even alone → HALF (one high).

More background, including the audit of rating vs geometry, is in `docs/CONNECTED-SURFACES.md`.

## Glass is cosmetic

`glass` is `projectile: 'pass'` with `shatters: true` (`Materials.js`), so the readout and the ballistics agree:

- **No cover**: `coverWeight` is 0, so a window, a window over a sill wall (only the sill counts) or a storefront
  rates as nothing. A sill wall under a pane still gives its own HALF.
- **Never stops anything**: bullets (`traceProjectile` stops only on `'block'`), sight (not opaque), grenade arcs
  (`Raycast.traceArc` blocks on anything not `'pass'`), blast shielding (`Battle.blastUnits`) and the lean-out check
  (`chooseMuzzle`) all ignore it.
- **It still breaks**: a pane whose real shape a live bullet crosses before the ray ends is set to air
  (`Battle.fireWeapon`, from the tracer's `glass` list), so windows shatter as visual feedback and the voxel store
  changes. The hit-chance estimate breaks nothing.
- Glass is still `solid` (blocks movement) and, by default value, `walkable` ([13](13-materials.md#notes)).

## Concealment (hedges, leaves)

Hedges and canopy leaves are opaque (they block sight and spotting), let bullets through, and give no cover rating.
A hedge is solid (blocks movement; vaultable). Their `concealment: 2` value is only read through `coverWeight`.

## Line of sight (`Battle.sees`, `sightLine`)

- Range: 3D distance with Δz × 0.8 must be ≤ `B.sightRange` = **24**.
- Ray from the viewer's eye (tile centre, z+1+1.55) to the target's head (z+2.5) **or** chest (z+1+1.05); either
  clear means seen.
- Blocked by any opaque voxel's real shape (walls, closed doors, hedges, leaves, furniture, ground …) and by smoke
  cells. Transparent: glass, open doors, chain-link, water, ice, crystal.
- Facing does not matter (no vision cone).
- **Unit targeting requires squad sight.** `validate` rejects a dead or unseen unit target. A teammate may spot
  for the shooter. Free-aim points remain available for firing at walls and other terrain.

## Fog of war

`Battle.visibleTo(side)` is the union over every unit of that side (squad sight). `battle.visible` (enemies the
squad sees) is recomputed after every intent and every move step. The client hides enemies not in it and tints
unrevealed rooms; the battle state itself is not hidden (every lockstep peer has all of it,
[12](12-co-op-and-determinism.md)).

## Smoke

Smoke Grenade: every air cell within radius 3 (horizontal; `r² + 0.5`) in the 3 layers from the landing height up,
for 3 round ticks (`ElementField.addSmoke`, `tick`). Smoke blocks sight and multiplies spread by
`B.smokeSpreadMult` = **1.6** against a target whose z+1 or z+2 cell is smoky. It does not stop bullets or blasts.
Wind (`anemo`) clears it.

## Other modifiers tied to position

- **Height**: spread × `B.heightAccuracyBonus` = 0.85 when the shooter stands 2+ voxels above the target.
- **Dim rooms**: spread × `B.dimRoomSpreadMult` = 1.25 when the target is in a room with `lit: false` and the
  shooter is not in that room. `ModernBuilder` defaults warehouse rooms to dim while offices remain lit. Building specs may
  override a room kind with `lighting: { warehouse: true }` or all rooms with `lit: false`.
