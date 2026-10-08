# 02 · Movement

Movement runs on the voxel grid with vibe-game's copied path search (`shared/world/PathSearch.js`,
`shared/world/TraversalRules.js`) over `VoxelStore.surfaces`.

## The grid

- Coordinates (`shared/voxel/VoxelStore.js`): x east, y south, z up. Voxel `(x, y, z)` fills
  `[x, x+1) × [y, y+1) × [z, z+1)`. A unit "at" `(x, y, z)` stands **on top of** voxel z; its feet are at z + 1.
  One voxel ≈ 0.9 m (`docs/LEVELS.md`). A storey is a slab plus 2 voxels of headroom (`ModernBuilder.STOREY` = 3).
- A **standable surface** (`VoxelStore.surfaces`) is a voxel whose material is `walkable` (or a liquid with
  `traversal: 'wade'`) and whose voxel above is neither solid nor liquid. Headroom is counted up to 8.
- The squad profile (`AGENT_PROFILES.player`: width 1, clearance 2, maxStep 1, stairs, doors, `swim: 'shallow'`)
  needs headroom ≥ 2. Enemies use the same profile (`Battle` uses `PROFILE = player` for everyone).
- **Walkable**: ground, floors, stairs, rubble, ash, ice, shipping containers, boulders, crystal, and (by default
  value) glass and awnings. **Not walkable**: walls, low cover (sandbags, planters, barriers, fences, hedges),
  furniture, cars, dumpsters, pitched and metal roofs, doors. Flat concrete roofs are walkable. Full list in
  [13](13-materials.md).
- One unit per tile: a tile with another living unit on it is blocked (`Battle.reach` → `blocked`).

## Path cost

Dijkstra over the 8 neighbours plus vaults (`PathSearch.reachable`). A step (`TraversalRules.canStep`) is legal
when |dx|, |dy| ≤ 1, |dz| ≤ **1** (one voxel up or down), the body (2 voxels) fits above the higher of the two
floors in both cells, and, for a diagonal, both cardinal corner cells admit the step (no corner cutting).

`stepCost` = (1.414 diagonal, else 1) × destination `moveCost` (stairs always 1) + **0.5 per level up** or
**0.15 per level down**.

| Terrain | moveCost |
|---|---|
| shallow `water` (wading) | 1.8 |
| `rubble` | 1.5 |
| `ice`, `deep_ice` | 1.4 |
| `snow` | 1.2 |
| `sand` | 1.15 |
| `ash` | 1.1 |
| `gravel` | 1.05 |
| everything else, and every stair | 1 |

**Vaulting** (`PathSearch.canVault`, XCOM style): cardinal directions only, over a cell whose voxel at z+1 is solid,
not walkable, not liquid and not a door, with nothing solid at z+2 and z+3 above it, the mover's own z+1..z+2 clear,
and a standable surface at the same z on the far side. The hop covers both cells for `VAULT_COST` = **2.6** × the
landing cell's moveCost. So sandbags, hedges, planters, low walls, jersey barriers, fences, chain-link, bins,
benches and one-high furniture are vaulted; two-high walls, closed doors and two-deep objects (cars) are not.

## Converting path cost to AP

- **Tiles per AP** (`Units.mobilityPerAp`) = class mobility + armour mobility + formation penalty (Shield Line
  −0.5), ×0.5 when the legs are disabled, **0 while `frozen`**, otherwise at least 0.5. Per class (see
  [07](07-units-and-classes.md)): Assault 3.2, Sharpshooter 3.1, Grenadier 2.5, Breacher 2.5; Syndicate 2.4–3.2.
- **Budget** (`Battle.moveBudget`) = (AP + move-only AP) × tiles per AP. With 4 AP the Assault reaches path cost
  12.8, the Grenadier 10.
- **AP charged** (`Battle.apForCost`) = `ceil(cost ÷ tiles per AP)`, taken from move-only AP first. A frozen unit
  has tiles per AP 0 and cannot move.
- Validation (`Battle.validate` → `move`) returns `occupied`, `no_ap` (reachable within 4 × budget + 8) or
  `unreachable`.

## What happens during a move (`Battle.doMove`)

The full AP cost is charged up front. Then, per step: a closed door in the destination cell opens for free
(`openDoorsOnStep`, which also reveals the room beyond), the unit turns toward the step, the room it enters is
revealed, visibility is recomputed (pods may wake), and enemy **overwatch** is checked
(`checkReactions`, [04](04-ballistics-and-weapons.md#overwatch)). The move stops early if the mover dies or becomes
`frozen`; the AP is not refunded. At the end tile: a `burning` surface sets the unit burning, a `wet` surface makes
it wet ([06](06-elements.md)); the formation recomputes cohesion; noise radius 3.

## Stairs

Buildings get straight stair runs (`ModernBuilder.placeStairRun` via `StairRun.createStairRun`): rise 3 (one
storey), one voxel per cell, `stairs_stone` columns hugging a wall, with the slab above the bottom cells removed for
headroom and both floors kept connected. Each stair step costs 1 + 0.5 climb. Programs with stairs: `townhouse`
(living room), `office` (hall, lobby), `bunker`, `tower` (also to the roof). See
[11](11-maps-and-level-design.md) and `docs/LEVELS.md`.

## Doors

A closed `door` voxel is **not solid**: the floor under it is a normal surface, so paths go straight through door
cells and the door opens when stepped into, at no AP. A closed door is opaque, stops bullets (hp 4) and burns; an
open door (`door_open`) passes sight and bullets and gives no cover. The `door` intent opens a door for 0 AP and
closes one for 1 AP (`Battle.doDoor`). Open-plan room links are 2-wide gaps of air, not doors.

## Water and ice

| Material | Standable | Cost | Notes |
|---|---|---|---|
| `water` (shallow) | yes (wade) | 1.8 | The unit stands on the water voxel. Gives no cover, bullets pass. Wading does **not** make a unit `wet`. |
| `deep_water`, `lava` | no | — | `traversal: 'blocked'` |
| `ice` | yes | 1.4 | Shallow water frozen by cryo; melts back to `water` under pyro. Solid: stops bullets, is cover when it stands above a unit's feet. |
| `deep_ice` | yes | 1.4 | Deep water frozen by cryo: an ice bridge. Melts back to `deep_water`, not to a wadeable shallow. |

Freezing needs air above the water voxel (`ElementField.applyArea`, cryo). A unit standing on `deep_ice` when it
melts has no surface at, below or just above its height, so `checkFalls` kills it (falls "to −1"); this follows
from the code rather than an explicit drowning rule.

## Forced movement

Knockback (Sledgehammer, Concussion Grenade) and falling after destruction are covered in
[05](05-destruction.md#falling-units-and-knockback). Neither triggers overwatch.
