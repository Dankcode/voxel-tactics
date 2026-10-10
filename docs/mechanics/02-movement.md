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

Dijkstra over the 8 neighbours plus vaults, jumps down and ladders (`PathSearch.reachable`; `Battle.reach` uses all
three, so the squad and the Syndicate both get them). A step (`TraversalRules.canStep`) is legal
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

## Jumping down

`PathSearch.canJumpDown`: a one-way drop off a ledge, balcony, roof edge or container.

- Cardinal directions only, into the **adjacent** column. The landing is the highest standable surface in that
  column 2–4 voxels below the jumper (`JUMP_DROP` = { min 2, max 4 }: one storey). A 1-voxel drop is an ordinary
  step.
- The jumper's own z+1..z+2 must be clear, and the column beside the ledge must be open from the landing up to the
  jumper's head (landing z + 1 … ledge z + 2): a railing, parapet, wall or awning on the edge blocks the jump. A
  ladder column is not jumped into either: it is climbed down (below).
- Cost `JUMP_COST` = **3** path cost, flat (not scaled by the landing's moveCost).
- **No fall damage.** The jumper gets `staggered` for 1 round after the move (`Battle.doMove`): accuracy × 0.8
  (`Units.accuracyMult`) for the rest of its turn and any overwatch reaction in the opponent's phase; it expires at
  the start of its next turn ([06](06-elements.md#statuses)). Overwatch still triggers on the landing step.
- There is no jump up: the way back is stairs or a ladder.

## Ladders

`ladder` is a material (`Materials.js`: not solid, not opaque, `projectile: 'pass'`, not walkable, hp 3, `metal`
family, no cover). `MapKit.ladder(x, y, dx, dy)` fills cell (x, y) with rungs from the ground up to the top of the
neighbour in direction (dx, dy), which must be a standable ledge at least 2 above the foot with headroom 2 (it throws
otherwise), and reserves the 3×3 cells round it from the cover pass.

`PathSearch.ladderMoves`:

- **Up**: from the ladder's foot cell (ladder voxel at z+1), with a rise of at least 2 and air above the top rung,
  to any cardinal neighbour whose surface is level with the top rung.
- **Down**: from a ledge whose cardinal neighbour holds the top rung at the ledge's level (nothing above it), to the
  ladder's foot.
- Cost `LADDER_BASE_COST` + rise = **1.5 + levels climbed**, either way. No stagger, no fall damage.

Harbor Yard has three ladders up container stacks ([11](11-maps-and-level-design.md)).

## Step kinds

`PathSearch.stepKind` labels each step of a path: `climb` (|Δz| ≥ 2 on a ladder), `jump` (|Δz| ≥ 2 otherwise),
`vault` (a 2-cell hop) or `walk`. `doMove` puts them in the `move` event as `kinds` (one per step);
`client/src/anim/EventPlayer.js` animates the hop, the jump arc and the climb from them, and the battle uses them to
decide the stagger.

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
`frozen`; the AP is not refunded. The `move` event carries the walked path and its step `kinds`. A living unit whose
walked path included a jump gets `staggered` (1 round). At the end tile: a `burning` surface sets the unit burning, a `wet` surface makes
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

## PLAN-03 mechanics

Generated maps put the street at z=4 and tunnels at z=1. PgDn reaches BELOW. Stairs connect layers; the attached manhole/drop ladder costs 1.5 plus rise. Controlled 2–4 voxel drops cost 3 movement points and stagger the unit; their noise radius is 8. A compiled ladder needs continuous solid backing on one side. Generated fire escapes use walkable grate platforms and steel stairs.
