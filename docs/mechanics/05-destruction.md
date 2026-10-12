# 05 · Destruction

Every voxel is gameplay truth: when it goes, its cover, its sight block and its floor go with it. Code:
`shared/voxel/Destruction.js` (pure, no RNG), `Battle.fireWeapon` / `explode` / `settle` / `checkFalls` /
`knockback`, per-material data in `shared/voxel/Materials.js` ([13](13-materials.md)).

## Voxel HP

- Each voxel starts with its material's `hp` (stored per voxel in `VoxelStore.hp`, a Uint16). `hp: Infinity`
  (bedrock, water, deep water, lava) and every liquid are indestructible.
- Typical values: glass 1, fuel drum 1, hedge 2, crate / sofa / pallet 3, timber / door / roof 3–4, stucco and
  plaster 6, sandbags 6, drystone and planters 8, brick and stone 9, concrete paving 10, car body 10, concrete wall
  12, dumpster 12, jersey barrier and boulder 14, iron 16, shipping container 20.

## Damaging a voxel (`Destruction.damageVoxel`)

Damage = round(amount × element multiplier for the material's `family`); nothing happens at ≤ 0. When HP reaches
0 the voxel is destroyed (`destroyVoxel`) and, if the material is `explosive`, an explosion is queued at its centre.

<!-- generated:elementvoxels -->
| element \ family | earth | stone | wood | glass | ice | plant | metal |
|---|---|---|---|---|---|---|---|
| `pyro` | 1 | 1 | **1.5** | 1 | **3** | **3** | 1 |
| `hydro` | **0.3** | **0** | **0** | **0** | **0.5** | **0** | **0** |
| `cryo` | 1 | 1 | 1 | **1.5** | **0** | 1 | 1 |
| `anemo` | 1 | 1 | 1 | **1.5** | 1 | **1.5** | 1 |
| `geo` | **1.5** | **2** | **1.2** | **2** | 1 | 1 | **1.5** |
<!-- /generated:elementvoxels -->

(Bold = not 1. `pyro` vs `ice` is ×3 voxel damage, and pyro areas also melt ice outright, see
[06](06-elements.md).)

Sources of voxel damage:

| Source | Amount per hit | Code |
|---|---|---|
| A projectile that stops on a voxel | the weapon's `voxel` value (1–3), ×2 after Demolition | `fireWeapon` |
| Explosion | power × (1 − d ÷ (radius + 0.5)) for every voxel whose centre is within the radius | `explodeVoxels` |
| Fire | 1 HP per round per burning voxel ([06](06-elements.md)) | `ElementField.tick` |
| Debug `destroy` | removes voxels outright | `DebugOps` |

Melee never damages voxels (the `voxel` field on melee weapons is unused). A shot that crosses glass also destroys
the pane it crosses.

## Destroyed voxels and debris (`Destruction.destroyVoxel`)

A destroyed voxel becomes its `debris` material when the voxel below is solid and not liquid and
`(7x + 13y + z) mod 3 ≠ 0` (a fixed two-in-three pattern, so a blown wall leaves broken low cover); otherwise air.
Debris: masonry, concrete, paving, planters, barriers, boulders → `rubble`; grass, lawn, forest floor → `soil`;
soil → `rubble`. Rubble is walkable (cost 1.5, hp 3) and, one voxel high beside a unit, is half cover.

## Explosions (`Destruction.explodeVoxels`, `Battle.explode`)

- Every non-air voxel whose centre is within `radius` of the blast takes power × (1 − d ÷ (radius + 0.5)) ×
  element multiplier, nearest first.
- Explosive voxels destroyed by a blast queue their own explosion: breadth first, at most 9 blasts per call
  (`maxChain` 8, loop runs while chain ≤ 8) and 900 destroyed voxels.
- Each blast in the chain then damages units (`blastUnits`, [04](04-ballistics-and-weapons.md#blast-damage-to-units-battleblastunits)),
  applies its element over its radius ([06](06-elements.md)), and the structure settles.
- An item with power 0 (Extinguisher, water drum) skips voxel damage but still applies its element and unit effects.

Worked examples (from running `explodeVoxels` on a flat test map):

- **Frag Grenade** (power 8, radius 2.6, geo ×2 vs stone) landing one tile from a two-high wall destroys 6 stucco
  voxels, 1 brick voxel, no concrete wall, car or container voxels, 3 sandbag voxels, and about 9 ground voxels
  (a crater, partly refilled with debris).
- **Breaching Charge** (power 16, radius 1.7, geo) on a door in a two-high wall blows the door, the wall cells either
  side (brick, stucco, siding: both layers; concrete wall: the lower layer) and the ground or floor around the
  threshold (a one-voxel dip).

## Explosive materials

| Material | hp | radius | power | unit damage | element |
|---|---|---|---|---|---|
| `barrel_powder` (Fuel drum) | 1 | 2.6 | 9 | 5 | pyro |
| `pump` (Fuel pump) | 4 | 2.8 | 8 | 6 | pyro |
| `lantern` (Light fixture) | 1 | 1.4 | 1 | 1 | pyro |
| `barrel_water` (Water drum) | 2 | 1.8 | 0 | 0 | hydro |

- A fuel drum goes off from any bullet that stops on it (1 HP); a pump needs 4 voxel damage (two Sniper Rifle hits,
  or a nearby blast).
- **Fire detonates explosive materials when they burn down.** `ElementField.tick` removes the destroyed voxel
  and queues its material explosion; `Battle.roundEnd` resolves it with the same chain, damage and element rules
  as a shot-triggered explosion. Each destroyed drum detonates once.
- Pyro explosions ignite flammable voxels and set burning surfaces in their radius; the water drum douses and wets.

## Structural collapse (`Destruction.settleUnsupported`, `Battle.settle`)

Runs after any explosion that destroyed voxels, after a shot that changed a structural voxel, after fire burned a
voxel out, and after debug destroys.

- Every voxel that is neither air nor liquid must connect (6-neighbour, through non-air, non-liquid voxels) to a
  voxel in the bottom layer (z = 0, bedrock). Everything else is loose.
- Loose voxels are removed. Per column, loose voxels of `structural` materials (not glass) become a rubble pile of
  min(2, ceil(n ÷ 3)) voxels on the first solid voxel below the column's highest loose voxel (at most 600 rubble
  voxels per settle). Non-structural loose voxels (furniture, props, doors, glass, foliage) simply vanish.
- In practice: a floor slab or roof whose supporting walls are gone drops as rubble.

## Falling units and knockback

`Battle.checkFalls` runs after shots, explosions, the round end and debug destroys:

| Situation at the unit's tile | Result |
|---|---|
| its surface still exists with headroom ≥ 2 | nothing |
| surface gone, a lower surface with headroom ≥ 2 exists | falls to it; legs take (levels − 1) × `B.fallDamagePerLevel` (5), pierce 99, if it fell more than 1 level; stress +8 |
| a surface 1–2 voxels above exists (rubble piled on it) | climbs onto it, `B.crushDamage` (5) torso damage, pierce 99 ("crushed") |
| no surface at, below or just above | dies (falls to −1), e.g. on melted `deep_ice` |
| surface exists but headroom < 2 and nothing above | stays (no rule) |

**Knockback** (`Battle.knockback`; Sledgehammer 2 tiles, Concussion Grenade 2 tiles): the unit is pushed one tile at a
time along the rounded direction away from the attacker or blast centre. It stops with `B.impactDamage` (2) torso damage (pierce 99) at a
solid cell at z+1 or z+2 or another unit; stops if there is no surface at or below its height; a drop of more than
1 level deals (drop − 1) × `B.fallDamagePerLevel` (5) to the legs and stops it. Knockback does not trigger
overwatch. A voluntary jump down ([02](02-movement.md#jumping-down)) deals no fall damage.

## PLAN-03 mechanics

Generated escape platforms depend on two ground posts. Losing both removes the escape surfaces and then settles disconnected material; removal is included in collapse statistics/events. Buildings retain connectivity support; the optional six-cell span rule is deferred. Floor breaching removes four slab voxels to make a controlled drop; damaging a larger shaft does not collapse a building still connected to bedrock.

## Load-bearing voxels and collapse (2026-10-12)

Only solid voxels carry load in `settleUnsupported`. Ladders, doors and leaves hang on whatever holds them and are
supported through it, but never hold anything up; a steel stand (fire escape) stands or falls by its own posts rule
and never holds up the building it is attached to. So a building whose ground storey is destroyed collapses even
with a roof ladder or a fire escape on its facade (before this, either kept the whole building standing).

A collapse never strands the objective (`Battle.settleObjective`, run with every fall check): a loose package drops
to the floor left in its column, or the nearest one within four tiles, and a hold/extract zone whose floor is gone
moves down to the level that remains in its area. Floor breach charges also work on carpet and tiled upper floors.
