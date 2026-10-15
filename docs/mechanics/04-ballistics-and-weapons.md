# 04 · Ballistics and weapons

Phoenix Point free aim: a shot is a number of rays inside an accuracy cone, each traced through the voxels and the
targets' body-part cylinders. Code: `shared/battle/Ballistics.js`, `Battle.fireWeapon` / `spreadFor` /
`dealDamage`, data in `shared/content/weapons.js`.

## Aiming

- **Free aim** (move the reticle, then click or press Space): the shot goes at the reticle's point, whatever it is on
  (an enemy, a wall voxel to shoot away, an unseen spot). Tab snaps the reticle to the next visible enemy's torso;
  body-part anchors are only snap points, no longer a required choice. Target-dependent modifiers (height, smoke, dim
  room, formation) apply when the shot is anchored on a unit.
- **Aim inertia** (`client/src/ui/AimController.js`, PLAN-07): the cursor sets where you want to aim; the aim point
  follows it through a critically damped spring with a time constant by weapon weight (pistol 0.08 s, rifle 0.14 s,
  shotgun 0.16 s, sniper 0.22 s, +10 % per wounded arm) plus a slow figure-eight sway (0.12° × (1 + stress ÷ 60),
  × 2 suppressed, 0 braced or under Deadeye). The shot fires at the **current** point, so flick-and-fire is less
  precise. The intent carries the exact point, so lockstep is unaffected. Settings → *Aim inertia* turns the spring off.
- **Reticle**: the outer ring is the whole accuracy cone projected at the aim distance (every round lands inside it),
  the inner ring holds half the rounds (r × √0.5). No size floor (≥ 1.5 px only so it stays visible). The label shows
  the weapon, the distance and the cone radius in metres.
- **Shoulder camera and back shot**: while aiming, the shoulder camera looks where the aim currently is and swings
  round behind the shooter once the aim leaves ±35° of its framing; the shooter's back-view sprite turns to the aim
  bearing every frame. The committed back shot starts from that pose.
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
| dim room | × 1.25 | target in an unlit room the shooter is not in (warehouse interiors are dim by default) |
| Shield Line | × up to 1.3 | target in a Shield Line slot, shooter in its front 90° ([09](09-formations.md)) |
| smoke | × 1.6 | target's z+1 or z+2 cell has smoke |

Example: a Gunman (accuracy 0.55) with an AK Rifle (0.5°, range 16) at 20 tiles has about 1.14° spread. A Sharpshooter with a scoped Sniper Rifle has 0.072° before situational modifiers. Scopes multiply base spread by 0.6; precision barrels by 0.8 and extend range.

Rays are drawn uniformly over the cone's circular cross-section (`sampleCone`: radius tan(spread)·√u, angle 2πu)
with the battle RNG.

## Tracing a projectile (`Ballistics.traceProjectile`)

- The ray runs up to min(`maxRange`, max(d + 10, 1.6 d)) from the muzzle (`fireWeapon`).
- Voxels: Amanatides–Woo traversal (`Raycast.castRay`) against each voxel's connected footprint
  ([03](03-cover-and-sight.md#partial-connected-shapes)). At each `projectile: 'block'` shape the round may
  **penetrate** (below); otherwise it stops there.
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

## Penetration (PLAN-07)

Every round carries **penetration energy** (calibers table below). Every blocking voxel it meets costs that material's
**resistance**, divided by max(0.5, |cos|) of the angle to the face it enters (glancing hits cost up to twice as much).
While energy > cost the round goes through: the voxel takes the round's voxel damage, the energy drops by the cost,
and the damage of whatever the round hits next is scaled by energy left ÷ starting energy (at least 25 %). Otherwise
the round stops in that voxel, as before. A round crosses at most six voxels. Materials without a resistance (ground,
floors, slabs, steel, stone masses) always stop it. Pierce (armour penetration) is separate and unchanged.

<!-- generated:resistance -->
| resistance | materials | rounds that pass through one cell (straight on) |
|---|---|---|
| 1 | `furniture`, `crate`, `barrel_powder`, `ash`, `lantern`, `hay`, `fence`, `stall`, `sofa`, `bed`, `desk`, `bin`, `pallet`, `shelving`, `emergency_light` | .338 Lapua Magnum, 9×19 mm, 5.56×45 mm NATO, .300 BLK subsonic, 7.62×39 mm, 7.62×51 mm NATO |
| 2 | `timber`, `roof`, `door`, `ice`, `shelf`, `barrel_water`, `cart`, `cabinet`, `privacy_fence`, `appliance`, `siding`, `roof_metal`, `car_cabin`, `bench`, `deep_ice` | .338 Lapua Magnum, 9×19 mm, 5.56×45 mm NATO, .300 BLK subsonic, 7.62×39 mm, 7.62×51 mm NATO |
| 3 | `plaster`, `crystal`, `stucco`, `pump` | .338 Lapua Magnum, 5.56×45 mm NATO, .300 BLK subsonic, 7.62×39 mm, 7.62×51 mm NATO |
| 4 | `trunk`, `rubble`, `container`, `dumpster` | .338 Lapua Magnum, 5.56×45 mm NATO, .300 BLK subsonic, 7.62×39 mm, 7.62×51 mm NATO |
| 6 | `sandbag`, `car_body`, `brick` | .338 Lapua Magnum, 7.62×39 mm, 7.62×51 mm NATO |
| 7 | `stone`, `drystone` | .338 Lapua Magnum, 7.62×39 mm, 7.62×51 mm NATO |
| 9 | `planter`, `concrete_wall` | .338 Lapua Magnum, 7.62×51 mm NATO |
| 14 | `city_wall`, `jersey` | .338 Lapua Magnum |
| ∞ | everything else (ground, floors, slabs, steel, stone masses) | — |
<!-- /generated:resistance -->

So a 5.56 round goes through crates, doors, fences, siding and a car cabin but not brick; 7.62×39 goes through one
brick or a car body; the .338 goes through a concrete wall; buckshot pellets and the flamethrower go through nothing.
The hit estimate uses the same tracer and reports `throughCover` (share of hits that went through something).

## Hit chance (`Ballistics.estimateShot`)

The internal estimate used by AI and previews is a deterministic Monte Carlo of the **same tracer**: N rays from the same muzzle and cone,
with an RNG seeded from the shooter, its tile, the aim point and the spread (it never touches the battle RNG).

- Samples: 96 for `Battle.preview` (`B.estimateSamples`), 64 per body part in the HUD target panel
  (`Game.aimAt`), 24 for the AI. The displayed reticle projects the actual spread cone.
- Outputs: `hit` (share of rays that hit the aimed unit anywhere), `parts` (per part), `partHit`, `cover` (share
  stopped by a voxel more than 0.3 short of the aim point), `friendly`, `other`, `miss`, and
  `expectedHits = hit × projectiles`. The player HUD displays body-part condition and physical obstruction instead of percentage hit rolls.
- The live shot draws fresh rays from the battle RNG, so outcomes scatter around the estimate. Minor difference:
  the estimate traces to min(`maxRange` ?? 40, max(d + 8, 1.5 d)) instead of the live d + 10 / 1.6 d.
- The HUD computes one spread (aimed at the torso centre) and reuses it for every part.

## Damage (`Battle.dealDamage`)

Per projectile that hits a part:

1. Effective armour = max(0, part armour (+4 while `braced`) − weapon `pierce`).
2. `FireControl.projectileDamage` chooses close/far damage and distributes shotgun shell damage across pellets. Damage = max(0, round(projectile damage) − effective armour); −1 more if the hit is `pyro` and the target is `wet`.
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

Human characters have 30 HP (`UNIT_HP`); constructs can have more. Within five tiles, AR rounds do 10 damage, high-caliber rounds 30, and a shotgun shell distributes 30 total across its pellets. Beyond five tiles the respective values are 5, 10, and 5. Armor and penetration apply after this selection. For example, a close 5.56 hit against plate torso armor 6 with pierce 2 deals 6 damage; a close .338 hit against the same torso deals 29. Helmet equipment supplies head protection separately from body armor.

## Overwatch

- **Set** (`Battle.doOverwatch`): requires the weapon's AP cost and ammo, then spends remaining AP. A soldier who
  ended a move on a blue tile always has that AP ([01](01-turn-flow.md#move-then-act-blue-and-yellow-zones)).
- **Moving cancels it** (PLAN-07): a voluntary move (including formation follow) clears the unit's own overwatch and
  logs "Overwatch cancelled"; knockback and falls do not. The clicked direction sets the cone. Gun build and armor determine its width; a scope narrows it. Range is capped by sight range and 1.25 × weapon range.
- **Trigger**: an enemy movement or breach entry crosses the cone while visible and in range. The watcher fires one normal salvo at the mover's torso, spending actual rounds. Each watcher reacts at most once per movement event and can react to successive movers.
- **Warning**: while planning a move, path steps a *known* enemy overwatch covers (watcher visible, step in its sector
  and sight) show a red **!** and the tooltip says "! OVERWATCH" (`Battle.overwatchThreats`).
- **Persistence**: turn refresh does not remove overwatch. It ends on a wound, a status effect, or empty loaded ammo. `surprised` units cannot react. Bolt actions automatically cycle available loose rounds.
- Normal formation following triggers reactions; knockback, falls, and debug teleports do not.

## Ammunition (calibers)

Gun damage comes from the round, not the gun (`shared/content/calibers.js`). Every ballistic weapon names a
`caliber`; `withCaliber` fills its `damage`, `pierce` and `voxel` from `CALIBERS`, and any of those set on the weapon
itself wins. Guns differ in spread, attachments, range, AP, capacity, fire modes, and noise. Carried ammo has three physical families: AR, high caliber, and shotgun. Caliber IDs below retain penetration and flavor. The Flamethrower prototype draws the shotgun-family stack and distributes a 30-damage payload while retaining pyro effects.

Single spends 1 round, burst 3, auto at most 5; each bullet traces independently. Supported rifles default to burst. Reload transfers loose carried ammo up to capacity. Bolt actions cycle without a manual reload. See [the loadout guide](../TACTICAL-LOADOUT.md#guns-and-free-aiming).

<!-- generated:calibers -->
| id | round | dmg/proj. | pierce | voxel dmg | penetration energy | fired by |
|---|---|---|---|---|---|---|
| `338` | .338 Lapua Magnum | 30 | 5 | 6 | 22 | Sniper Rifle |
| `9mm` | 9×19 mm | 10 | 0 | 2 | 3 | Sidearm |
| `5.56` | 5.56×45 mm NATO | 10 | 2 | 2 | 6 | Assault Rifle, Marksman Rifle |
| `300blk` | .300 BLK subsonic | 10 | 2 | 2 | 5 | Suppressed Carbine |
| `7.62x39` | 7.62×39 mm | 10 | 2 | 3 | 8 | AK Rifle |
| `7.62` | 7.62×51 mm NATO | 10 | 3 | 3 | 10 | — |
| `12g` | 12-gauge 00 buckshot | 3.75 | 0 | 1 | 1 | Combat Shotgun |
<!-- /generated:calibers -->

`7.62×51 mm NATO` is defined but no current weapon fires it.

## Ballistic weapons

<!-- generated:weapons -->
| id | name | round | AP | proj. | dmg/proj. | pierce | shred | spread | range | max range | ammo | reload AP | voxel dmg | noise | element |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `repeater` | Assault Rifle | 5.56×45 mm NATO | 2 | 1 | 10 | 2 | — | 1° | 18 | 34 | 30 (1/shot) | 1 | 2 | 14 | — |
| `blunderbuss` | Combat Shotgun | 12-gauge 00 buckshot | 2 | 8 | 3.75 | 0 | — | 4° | 7 | 14 | 8 (1/shot) | 1 | 1 | 14 | — |
| `longrifle` | Sniper Rifle | .338 Lapua Magnum | 3 | 1 | 30 | 5 | — | 0.3° | 30 | 48 | 1 (1/shot) | 1 | 6 | 18 | — |
| `handcannon` | Sidearm | 9×19 mm | 1 | 1 | 10 | 0 | — | 1.4° | 12 | 22 | 12 (1/shot) | 1 | 2 | 12 | — |
| `crossbow` | Suppressed Carbine | .300 BLK subsonic | 2 | 1 | 10 | 2 | — | 0.8° | 20 | 32 | 30 (1/shot) | 1 | 2 | 2 | — |
| `shortbow` | Marksman Rifle | 5.56×45 mm NATO | 2 | 1 | 10 | 2 | — | 0.6° | 16 | 26 | 20 (1/shot) | 1 | 2 | 12 | — |
| `musket` | AK Rifle | 7.62×39 mm | 2 | 1 | 10 | 2 | — | 1° | 16 | 28 | 30 (1/shot) | 1 | 3 | 14 | — |
| `firelance` | Flamethrower | — (fuel) | 2 | 5 | 4 | 0 | — | 3.5° | 8 | 12 | 10 (1/shot) | 1 | 1 | 10 | pyro |
<!-- /generated:weapons -->

Notes: `voxel dmg` is the damage each projectile deals to every voxel it hits or passes through (doubled by Demolition). The Assault
Rifle fires 1/3/5 bullet rays in single/burst/auto. Shotguns trace their pellet count per shell. The Flamethrower's rays carry `pyro` (status and a 0.6-radius
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
| `medkit` | Medical Kit | 1 | 1.5 |  |  |  | — | — | — | — |  | thrown (arc + scatter) |
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
- Hit if d ≤ r + 0.5. Damage = round(damage × max(0.25, 1 − d ÷ (r + 0.5)) × 1.25 if clustered × 0.5 if a `block` or `shatter`
  voxel lies between the centre and the chest).
- Applied to the torso with pierce = ceil(torso armour ÷ 2) (braced armour included) and the item's shred.
- Element statuses apply even when the damage rounds to 0; knockback, if any, pushes away from the centre.
