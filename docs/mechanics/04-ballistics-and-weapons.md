# 04 · Ballistics and weapons

Phoenix Point free aim: a shot is a number of rays inside an accuracy cone, each traced through the voxels and the
targets' body-part cylinders. Code: `shared/battle/Ballistics.js`, `Battle.fireWeapon` / `spreadFor` /
`dealDamage`, data in `shared/content/weapons.js`.

## Aiming

- **Aim at a body part** (`Ballistics.aimPointOf` → `partCentre`): the centre of that part's hitbox on the target,
  arms offset sideways from the target's facing. HUD keys `Z X C V G` = head, torso, left arm, right arm, legs.
- **Free aim** (`Alt`+click): any point, e.g. a wall voxel to shoot away. Target-dependent modifiers (height,
  smoke, dim room, formation) are skipped because there is no target unit.
- **Muzzle and leaning** (`chooseMuzzle`): the shoulder (tile centre, z+1+1.35), or that point shifted **0.55
  tiles** right, then left, perpendicular to the aim line: the first candidate that is not inside a solid voxel and
  has no `block` voxel on the straight line to the aim point is used; otherwise the centre. This is how units lean
  out round corners.

## The accuracy cone (`Battle.spreadFor`)

Spread is the cone's half-angle in degrees. Every modifier multiplies:

| Factor | Value | Applies when |
|---|---|---|
| base | weapon `spread` ÷ max(0.2, accuracy multiplier) | always |
| accuracy multiplier (`Units.accuracyMult`) | class accuracy × 0.75 (one arm disabled) or 0.5 (both) × 0.8 (head disabled) × 0.6 (`suppressed`) × 0.8 (`staggered`) × 0.9 (stress ≥ 75) | always |
| range | 1 + (d − range) ÷ range × `B.rangeFalloff` (1.0) | horizontal distance d from the shooter's tile centre to the aim point exceeds the weapon's `range` |
| reaction | × `B.reactionSpreadMult` 1.3 (1.0 in an active Crossfire) | overwatch shots |
| breach | × 1 ÷ (`B.breachAccuracyMult` 1.15 × 1.1 with an active Breach Stack) | breach shots |
| Deadeye | × 0.5 | next shot after the ability |
| height | × 0.85 | aimed at a unit, shooter z − target z ≥ 2 |
| dim room | × 1.25 | target in an unlit room the shooter is not in (never on current maps) |
| Shield Line | × up to 1.3 | target in a Shield Line slot, shooter in its front 90° ([09](09-formations.md)) |
| smoke | × 1.6 | target's z+1 or z+2 cell has smoke |

Example: a Gunman (accuracy 0.55) with the AK Rifle (1.6°, range 16) at 20 tiles: 1.6 ÷ 0.55 × 1.25 = 3.64°,
a lateral spread of about 1.3 tiles at the target against a torso radius of 0.25. A Sharpshooter (1.0) with the
Sniper Rifle (0.6°, range 30) at the same distance: 0.6°, about 0.2 tiles.

Rays are drawn uniformly over the cone's circular cross-section (`sampleCone`: radius tan(spread)·√u, angle 2πu)
with the battle RNG.

## Tracing a projectile (`Ballistics.traceProjectile`)

- The ray runs up to min(`maxRange`, max(d + 10, 1.6 d)) from the muzzle (`fireWeapon`).
- Voxels: Amanatides–Woo traversal (`Raycast.castRay`) against each voxel's connected footprint
  ([03](03-cover-and-sight.md#partial-connected-shapes)). It stops at the first `projectile: 'block'` shape.
  `pass` materials (hedges, leaves, open doors, water, chain-link, awnings, ladders, **glass**) are ignored. Glass
  (`shatters: true`) is cosmetic: the tracer lists every pane whose real shape the ray crosses before it ends, and
  the live shot (`fireWeapon`) sets those panes to air ([03](03-cover-and-sight.md#glass-is-cosmetic)).
- Units: every living unit except the shooter is tested against vertical cylinders; the nearest unit hit before the
  voxel hit wins. **Friendly fire is real**: allies in the cone can be hit.

| Part (`HITBOX`) | radius | height above feet | lateral offset |
|---|---|---|---|
| legs | 0.20 | 0 – 0.72 | 0 |
| torso | 0.25 | 0.72 – 1.32 | 0 |
| head | 0.15 | 1.32 – 1.74 | 0 |
| armR / armL | 0.10 | 0.75 – 1.30 | ±0.36 (perpendicular to facing) |

A disabled head, arm or legs (part HP 0) no longer stops rays (`rayUnit`).

## Hit chance (`Ballistics.estimateShot`)

The HUD's percentage is a deterministic Monte Carlo of the **same tracer**: N rays from the same muzzle and cone,
with an RNG seeded from the shooter, its tile, the aim point and the spread (it never touches the battle RNG).

- Samples: 96 for `Battle.preview` (`B.estimateSamples`), 64 per body part in the HUD target panel
  (`Game.aimAt`), 24 for the AI, 32 for the Alt free-aim cone preview.
- Outputs: `hit` (share of rays that hit the aimed unit anywhere), `parts` (per part), `partHit`, `cover` (share
  stopped by a voxel more than 0.3 short of the aim point), `friendly`, `other`, `miss`, and
  `expectedHits = hit × projectiles`. The HUD shows, for the selected part, the share of rays that hit **that part**
  when aiming at it.
- The live shot draws fresh rays from the battle RNG, so outcomes scatter around the estimate. Minor difference:
  the estimate traces to min(`maxRange` ?? 40, max(d + 8, 1.5 d)) instead of the live d + 10 / 1.6 d.
- The HUD computes one spread (aimed at the torso centre) and reuses it for every part.

## Damage (`Battle.dealDamage`)

Per projectile that hits a part:

1. Effective armour = max(0, part armour (+4 while `braced`) − weapon `pierce`).
2. Damage = max(0, round(weapon damage) − effective armour); −1 more if the hit is `pyro` and the target is `wet`.
   For guns, damage and pierce are the round's ([calibers](#ammunition-calibers)).
3. `shred` then permanently lowers that part's armour.
4. The damage comes off the part's HP **and** the unit's HP (the torso gauge mirrors unit HP). The unit dies at
   unit HP ≤ 0, whatever part was hit.
5. A head, arm or legs reaching 0 HP is **disabled** (once). Element statuses are applied even when the damage is 0;
   stress +12 if damage > 0.

| Disabled part | Effect (`Units.js`) |
|---|---|
| one arm / both arms | accuracy × 0.75 / × 0.5 |
| head | accuracy × 0.8; max Will −2 (min 1) |
| legs | tiles per AP × 0.5 |

There are **no crits, grazes or dodges**. Debug god mode sets damage to 0.

Every character has 30 HP (`UNIT_HP`). Examples:

| Shot | Target part (armour) | Per projectile |
|---|---|---|
| Assault Rifle (5.56, 9 dmg, pierce 2) | Riot Guard torso (plate 6) | 5 (a full 3-round burst on the torso: 15 of 30) |
| Assault Rifle | Riot Guard head (plate 3) | 8 |
| Assault Rifle | Riot Guard torso while `braced` (10) | 1 |
| AK Rifle (7.62×39, 10 dmg, pierce 2) | Assault torso (medium 3) | 9 |
| Sniper Rifle (.338, 18 dmg, pierce 5) | Riot Guard torso (plate 6) | 17 |
| Combat Shotgun (12-gauge, 4 dmg, pierce 0) | Gunman torso (light 2) / Riot Guard torso (plate 6) | 2 / 0 per pellet |
| Sidearm (9 mm, 7 dmg, pierce 0) | Lookout torso (hide 1) | 6 |

## Overwatch

- **Set** (`Battle.doOverwatch`): needs AP ≥ the weapon's AP and ammo; spends all AP and move-only AP. The cone
  points at the clicked tile (else 5 tiles along the unit's facing); half-angle **50°** (`halfAngleDeg`, the client
  never changes it); range **1.25 × weapon `range`**.
- **Trigger** (`Battle.checkReactions`, after every step of an enemy's move and every step of a breach entry): the
  mover's tile is within range, at least 0.5 away, inside the cone, and the watcher **sees** it. The watcher fires
  one normal shot of its overwatch weapon at the mover's torso with reaction spread.
- One reaction per turn (`reactionsLeft` 1; 2 in a Crossfire); overwatch ends after the last reaction, and in any
  case at the start of the watcher's next turn. `surprised` units cannot react.
- Not triggered by knockback, falls, formation slot moves or debug teleports.

## Ammunition (calibers)

Gun damage comes from the round, not the gun (`shared/content/calibers.js`). Every ballistic weapon names a
`caliber`; `withCaliber` fills its `damage`, `pierce` and `voxel` from `CALIBERS`, and any of those set on the weapon
itself wins. Guns differ only in how they deliver the round: projectiles per shot, spread, range, AP, magazine and
noise. The Flamethrower has no caliber (fuel jets; its numbers are set on the weapon).

<!-- generated:calibers -->
| id | round | dmg/proj. | pierce | voxel dmg | fired by |
|---|---|---|---|---|---|
| `338` | .338 Lapua Magnum | 18 | 5 | 3 | Sniper Rifle |
| `9mm` | 9×19 mm | 7 | 0 | 1 | Sidearm |
| `5.56` | 5.56×45 mm NATO | 9 | 2 | 1 | Assault Rifle, Marksman Rifle |
| `300blk` | .300 BLK subsonic | 10 | 2 | 1 | Suppressed Carbine |
| `7.62x39` | 7.62×39 mm | 10 | 2 | 2 | AK Rifle |
| `7.62` | 7.62×51 mm NATO | 12 | 3 | 2 | — |
| `12g` | 12-gauge 00 buckshot | 4 | 0 | 1 | Combat Shotgun |
<!-- /generated:calibers -->

`7.62×51 mm NATO` is defined but no current weapon fires it.

## Ballistic weapons

<!-- generated:weapons -->
| id | name | round | AP | proj. | dmg/proj. | pierce | shred | spread | range | max range | ammo | reload AP | voxel dmg | noise | element |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `repeater` | Assault Rifle | 5.56×45 mm NATO | 2 | 3 | 9 | 2 | — | 1.6° | 18 | 34 | 9 (3/shot) | 1 | 1 | 14 | — |
| `blunderbuss` | Combat Shotgun | 12-gauge 00 buckshot | 2 | 8 | 4 | 0 | — | 6.5° | 7 | 14 | 4 (1/shot) | 1 | 1 | 14 | — |
| `longrifle` | Sniper Rifle | .338 Lapua Magnum | 3 | 1 | 18 | 5 | — | 0.6° | 30 | 48 | 3 (1/shot) | 1 | 3 | 18 | — |
| `handcannon` | Sidearm | 9×19 mm | 1 | 1 | 7 | 0 | — | 1.8° | 12 | 22 | 12 (1/shot) | 1 | 1 | 12 | — |
| `crossbow` | Suppressed Carbine | .300 BLK subsonic | 2 | 1 | 10 | 2 | — | 0.9° | 20 | 32 | 6 (1/shot) | 1 | 1 | 2 | — |
| `shortbow` | Marksman Rifle | 5.56×45 mm NATO | 2 | 1 | 9 | 2 | — | 1.4° | 16 | 26 | 8 (1/shot) | 1 | 1 | 12 | — |
| `musket` | AK Rifle | 7.62×39 mm | 2 | 1 | 10 | 2 | — | 1.6° | 16 | 28 | 6 (1/shot) | 1 | 2 | 14 | — |
| `firelance` | Flamethrower | — (fuel) | 2 | 5 | 4 | 0 | — | 4.2° | 8 | 12 | 3 (1/shot) | 1 | 1 | 10 | pyro |
<!-- /generated:weapons -->

Notes: `voxel dmg` is the damage each projectile deals to a voxel it hits (doubled by Demolition). The Assault
Rifle fires 3 rays and spends 3 rounds per shot. The Flamethrower's rays carry `pyro` (status and a 0.6-radius
fire impact on units, 0.8 on voxels). Display names are what the player sees; ids are legacy and stable. The HUD
weapon tooltip (`Hud.js`) shows name · round · shot AP · damage (× projectiles) · pierce (when > 0) · range.

## Melee weapons

<!-- generated:melee -->
| id | name | AP | dmg | pierce | shred | knockback | noise | `reach` (unused) | `voxel` (unused) |
|---|---|---|---|---|---|---|---|---|---|
| `sword` | Combat Knife | 1 | 10 | 2 | — | — | 4 | 1.5 | 1 |
| `maul` | Sledgehammer | 2 | 16 | 3 | 1 | 2 tiles | 8 | 1.5 | 4 |
<!-- /generated:melee -->

Melee (`Battle.doMelee`) **always hits** the chosen part (the client always picks the torso); no line of sight or
roll. The Sledgehammer knocks the target 2 tiles away. Melee deals no voxel damage; `reach` and `voxel` are unused.

## Armour

<!-- generated:armor -->
| armour | head | torso | arm L | arm R | legs | mobility (tiles/AP) |
|---|---|---|---|---|---|---|
| `light` | 0 | 2 | 0 | 0 | 1 | 0 |
| `medium` | 1 | 3 | 2 | 2 | 2 | -0.2 |
| `heavy` | 2 | 4 | 3 | 3 | 3 | -0.4 |
| `hide` | 0 | 1 | 0 | 0 | 0 | 0 |
| `plate` | 3 | 6 | 4 | 4 | 4 | -0.4 |
<!-- /generated:armor -->

## Throwables

<!-- generated:throwables -->
| id | name | AP | range | radius | unit dmg | voxel power | element | shred | knockback | smoke | noise | delivery |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `fire_flask` | Incendiary Grenade | 2 | 12 | 2.2 | 6 | 2 | pyro | — | — | — | 10 | thrown (arc + scatter) |
| `frost_flask` | Cryo Canister | 2 | 12 | 2.5 | 5 | 1 | cryo | — | — | — | 8 | thrown (arc + scatter) |
| `water_flask` | Extinguisher Grenade | 1 | 12 | 2.6 | 0 | 0 | hydro | — | — | — | 4 | thrown (arc + scatter) |
| `gale_flask` | Concussion Grenade | 2 | 12 | 2.5 | 4 | 2 | anemo | — | 2 tiles | — | 8 | thrown (arc + scatter) |
| `powder_bomb` | Frag Grenade | 2 | 11 | 2.6 | 14 | 8 | geo | 1 | — | — | 18 | thrown (arc + scatter) |
| `smoke_pot` | Smoke Grenade | 1 | 12 | 3 | 0 | 0 | smoke | — | — | 3 rounds | 4 | thrown (arc + scatter) |
| `breach_charge` | Breaching Charge | 2 | 1.6 | 1.7 | 8 | 16 | geo | — | — | — | 16 | placed (no arc, no scatter) |
<!-- /generated:throwables -->

### Throwing (`Battle.doThrow`, `throwArc`)

- **Range**: horizontal tile distance from the thrower to the target tile ≤ the item's range.
- **Scatter** (thrown items): the landing tile is moved by up to dist × tan(3.2°) ÷ max(0.3, accuracy multiplier),
  uniformly over a disc, then rounded to a tile. A Grenadier (0.85) throwing 10 tiles lands within 0.66 tiles.
- **Arc** (`Raycast.fitArc`): from the hand (z+1+1.6) to the standable surface nearest the requested height
  (+0.15), with an apex 2.8 above the higher end; if blocked it tries apexes 4.3, 1.68, 1.2, 0.6, 0.4. If every
  arc is blocked the item **detonates where the first (2.8) arc hit**. Arcs are blocked by anything whose
  projectile mode is not `pass`; glass, foliage, chain-link, awnings, open doors and ladders do not block them.
- **Placed** items (Breaching Charge): no arc and no scatter; centre at the chosen cell, z+1.5; range 1.6.
- Detonation (`Battle.detonate`): smoke makes a cloud ([03](03-cover-and-sight.md#smoke)); everything else explodes
  ([05](05-destruction.md)), voxel power doubled under Demolition; then noise.

### Blast damage to units (`Battle.blastUnits`)

For every living unit (friend or foe) with its chest point at 3D distance d (Δh × 0.8) from the centre:

- Radius r = item radius, **+1 if the unit is clustered** (2+ allies within 2 tiles, [09](09-formations.md)).
- Hit if d ≤ r + 0.5. Damage = round(damage × max(0.25, 1 − d ÷ (r + 0.5)) × 1.25 if clustered × 0.5 if a `block`
  voxel lies between the centre and the chest).
- Applied to the torso with pierce = ceil(torso armour ÷ 2) (braced armour included) and the item's shred.
- Element statuses apply even when the damage rounds to 0; knockback, if any, pushes away from the centre.
