# 07 · Units, classes and abilities

Data: `shared/content/units.js` (classes, Syndicate types, abilities, squads), `shared/content/weapons.js`
(armour). Rules: `shared/battle/Units.js` (`createUnit`, `accuracyMult`, `mobilityPerAp`, `partArmor`,
`addStatus`), `Battle.doAbility`, `Battle.addStress`.

## Unit sheet

<!-- generated:units -->
| id | name | side | HP | part HP head/torso/arm/legs | accuracy | tiles per AP (base + armour) | Will | armour | weapons (first = default) | items | abilities |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `vanguard` | Assault | squad | 30 | 12/30/12/17 | 0.9 | 3.2 (3.4 -0.2) | 6 | `medium` | Combat Shotgun, Sidearm, Combat Knife | Incendiary Grenade ×1, Smoke Grenade ×1 | Seismic Sense, Earth Cover, Sprint |
| `grenadier` | Grenadier | squad | 30 | 12/30/12/17 | 0.85 | 2.5 (2.9 -0.4) | 6 | `heavy` | Assault Rifle | Frag Grenade ×2, Concussion Grenade ×1 | Water Sense, Water Mend, Demolition, Suppressive Fire |
| `marksman` | Sharpshooter | squad | 30 | 12/30/12/17 | 1 | 3.1 (3.1) | 7 | `light` | Sniper Rifle, Sidearm | Smoke Grenade ×1, Cryo Canister ×1 | Scout Drone, Snap Shot, Deadeye |
| `warden` | Breacher | squad | 30 | 12/30/12/17 | 0.88 | 2.5 (2.9 -0.4) | 7 | `plate` | Suppressed Carbine, Combat Knife | Breaching Charge ×2, Extinguisher Grenade ×1 | Quiet Cut, Shield Wall, Rally |
| `wall_strider` | Wall Strider | Syndicate | 60 | 24/60/24/33 | 0.7 | 2.4 (2.6 -0.2) | 6 | `medium` | Strider Claws | — | Wall Smash |
| `siege_weaver` | Siege Weaver | Syndicate | 90 | 36/90/36/50 | 0.65 | 1.4 (1.8 -0.4) | 8 | `heavy` | Assault Rifle | — | — |
| `cultist` | Gunman | Syndicate | 30 | 12/30/12/17 | 0.55 | 3 (3) | 4 | `light` | AK Rifle, Combat Knife | Incendiary Grenade ×1, Extinguisher Grenade ×1 | — |
| `archer` | Lookout | Syndicate | 30 | 12/30/12/17 | 0.64 | 3.2 (3.2) | 4 | `hide` | Marksman Rifle | Cryo Canister ×1, Smoke Grenade ×1 | — |
| `pyromancer` | Arsonist | Syndicate | 30 | 12/30/12/17 | 0.68 | 2.8 (2.8) | 6 | `light` | Flamethrower | Incendiary Grenade ×2 | — |
| `brute` | Enforcer | Syndicate | 30 | 12/30/12/17 | 0.6 | 2.8 (3.2 -0.4) | 6 | `heavy` | Sledgehammer | Smoke Grenade ×1 | — |
| `warden_foe` | Riot Guard | Syndicate | 30 | 12/30/12/17 | 0.62 | 2.4 (2.8 -0.4) | 6 | `plate` | AK Rifle, Combat Knife | — | Shield Wall, Earth Cover |
| `tech` | Drone Tech | Syndicate | 30 | 12/30/12/17 | 0.56 | 3 (3) | 5 | `light` | Sidearm | Smoke Grenade ×1 | Launch Drone |
| `search_drone` | Search Drone | Syndicate | 1 | 1/1/1/1 | 0 | 4.2 (4.2) | 9 | `drone` |  | — | — |
<!-- /generated:units -->

- **HP**: every character, squad and Syndicate, has **30** (`UNIT_HP`). It is one pool. Each body part also has its
  own HP gauge, `max(1, round(30 × share))` (`createUnit`): head 12, arms 12, legs 17 (16.5 rounds up), torso 30
  (it mirrors the pool). Damage to a part comes off both the part and the pool
  ([04](04-ballistics-and-weapons.md#damage-battledealdamage)). Classes differ by armour, mobility, accuracy and
  kit; gun damage comes from the round ([04](04-ballistics-and-weapons.md#ammunition-calibers)), so one rifle hit
  is about a third of anyone's health.
- **Tiles per AP** = class mobility + armour mobility ([02](02-movement.md)).
- **Weapons**: the first is the default (`u.weapon`); switching is free. All ballistic weapons start loaded.
- **AP**: 4 for everyone (`B.apPerTurn`). **Will** starts at max and regenerates +1 per own turn.
- Facing starts north for the squad and as specified (default south) for enemies; it only matters for where the arm
  hitboxes sit and the default overwatch direction.

<!-- generated:bodyparts -->
| part | label | HP share of unit HP |
|---|---|---|
| `head` | Head | 0.4 |
| `torso` | Torso | 1 |
| `armL` | Left arm | 0.4 |
| `armR` | Right arm | 0.4 |
| `legs` | Legs | 0.55 |
<!-- /generated:bodyparts -->

<!-- generated:armor -->
| armour | head | torso | arm L | arm R | legs | mobility (tiles/AP) |
|---|---|---|---|---|---|---|
| `light` | 0 | 1 | 0 | 0 | 0 | 0 |
| `medium` | 1 | 2 | 1 | 1 | 1 | -0.2 |
| `heavy` | 1 | 2 | 1 | 1 | 2 | -0.4 |
| `hide` | 0 | 0 | 0 | 0 | 0 | 0 |
| `plate` | 1 | 3 | 2 | 2 | 2 | -0.4 |
| `drone` | 0 | 0 | 0 | 0 | 0 | 0 |
<!-- /generated:armor -->

## Abilities

<!-- generated:abilities -->
| id | name | Will | AP | text (from data) | who has it |
|---|---|---|---|---|---|
| `killstreak_strike` | Airstrike | 0 | 0 | Ready at the start of the mission and again 10 rounds after each use. Three bombs fall together somewhere inside the marked 15 x 9 rectangle (long side along your facing; each blast stays inside it). Craters stay one level deep on open ground; buildings lose up to two storeys. Damages allies too. |  |
| `seismic_sense` | Seismic Sense | 1 | 1 | Share grounded enemy contacts within 14 tiles and two levels, through walls. Contacts are snapshots. | Assault |
| `water_sense` | Water Sense | 1 | 1 | Share contacts within 14 tiles near water, through walls. Contacts are snapshots. | Grenadier |
| `scout_drone` | Scout Drone | 1 | 1 | Scout from a tile within 18. Drone sees 10 tiles through clear sight. Enemies detect within 2; Drone Hunters within 8. Recast to reposition. | Sharpshooter |
| `quiet_cut` | Quiet Cut | 1 | 1 | Remove two wall voxels within 3 without noise. Enemy sight can still expose you. | Breacher |
| `carpet_bomb` | Airstrike | 0 | 1 | Three heavy bombs fall together somewhere inside the marked 15 x 9 rectangle (long side along your facing; each blast stays inside it). Craters stay one level deep on open ground; buildings lose up to two storeys. Damages allies too. Recharges after 10 of your turns. |  |
| `orbital_laser` | Orbital Laser | 0 | 1 | Cut a 33-tile line, 5 wide, along your facing: everything standing in it is destroyed down to the ground floor. Damages allies too. Recharges after 10 of your turns. |  |
| `earth_cover` | Earth Cover | 2 | 1 | Raise destructible half cover on an empty visible tile within 6. Persists until destroyed. | Assault, Riot Guard |
| `smash` | Wall Smash | 0 | 1 | Walker monsters: tear through walls and cover within 3 tiles of the body, two storeys high, battering anyone behind. | Wall Strider |
| `water_mend` | Water Mend | 2 | 1 | Restore 8 HP to a visible living ally within 6 and extinguish burning. Disabled limbs stay disabled. | Grenadier |
| `dash` | Sprint | 2 | 0 | +1 AP that can only be spent moving. | Assault |
| `rally` | Rally | 2 | 1 | Allies within 6 lose 25 stress and gain 1 WP. | Breacher |
| `demolish` | Demolition | 1 | 0 | Next shot or blast deals double damage to walls and cover. | Grenadier |
| `suppress` | Suppressive Fire | 2 | 2 | Burst at a visible target; it is Suppressed (accuracy ×0.6) for two own turns. | Grenadier |
| `quick_aim` | Snap Shot | 2 | 0 | Next shot costs 1 AP less. | Sharpshooter |
| `deadeye` | Deadeye | 3 | 0 | Next shot has half the spread. | Sharpshooter |
| `brace` | Shield Wall | 1 | 1 | +4 armour on every part until your next turn. | Breacher, Riot Guard |
| `recon_scan` | Recon Scan | 1 | 1 | Sweep for hostiles within 40 tiles. Each contact shows as a red search circle (3-tile radius) around its approximate position for two rounds, on its floor; the exact tile stays hidden. Any soldier can use it; the squad shares one cooldown of 3 rounds. |  |
| `launch_drone` | Launch Drone | 0 | 1 | Enemy techs: put a search drone in the air beside them (two at most, one launch every 3 rounds). | Drone Tech |
<!-- /generated:abilities -->

What the code actually does (`Battle.doAbility`; Will and AP are paid when the intent is applied):

| Ability | Effect | Lasts |
|---|---|---|
| Sprint (`dash`) | +1 move-only AP | until the start of the next own turn |
| Snap Shot (`quick_aim`) | next shot costs weapon AP − 1 (min 1); does not lower the overwatch requirement | next shot, or the next own turn start |
| Deadeye | spread × 0.5 | until the next `shoot` intent consumes it, or the next own turn start; overwatch reactions and breach shots in between also get it without consuming it |
| Demolition (`demolish`) | next shot's voxel damage × 2, or next throw's voxel power × 2 | the next shot of any kind (reactions and breach shots included) or detonation, or the next own turn start |
| Shield Wall (`brace`) | `braced`: +4 armour on every part against shots and melee; against blasts it nets +2 on the torso, because blast pierce is half the (braced) torso armour, rounded up | through the opponent's phase |
| Rally | every ally within 6 tiles (3D, Δz × 0.8; includes the user) loses 25 stress and gains 1 Will (cap) | instant |
| Suppressive Fire (`suppress`) | if the user carries the Assault Rifle: a normal Assault Rifle shot at the target's torso (uses 3 rounds), then `suppressed` for 2 rounds (accuracy × 0.6). Requires 3 rounds loaded, a living visible target and weapon range; rejected uses spend nothing | 2 rounds of the target's status |

Ability use is refused with `no_will` while `panicked`. The AI never uses abilities.

**Suppression through the HUD uses the paid ability.** The button enters torso targeting; confirmation sends
`{ type: 'ability', abilityId: 'suppress', targetId }`. It costs 2 AP and 2 Will, consumes 3 Assault Rifle rounds,
and applies suppression only after the shot. A normal `shoot` carrying `suppress: true` is rejected.

## Items

Items are per-unit counts (`u.items`), spent by `throw` intents ([04](04-ballistics-and-weapons.md#throwables)).
The Breaching Charge is used by `breach` with `entry: 'charge'` or placed directly with a `throw` intent (range
1.6), which works against any wall. The debug `refill` op tops every item up to at least 2.

## Stress and breakdown

Stress runs 0–`B.breakdownAt` (100) for every unit, squad and Syndicate alike (`Battle.addStress`).

| Event | Stress | Who |
|---|---|---|
| wounded (damage > 0) | +12 (`B.stressOnWound`) | the target |
| ally killed within 8 tiles and in sight | +22 (`B.stressOnAllyDown`) | each such ally |
| near miss: a shot aimed at the unit that hit nothing on it | +4 (`B.stressOnNearMiss`) | the target |
| fell (destruction) | +8 | the faller |
| kill | −10 (`B.stressRelieveOnKill`) | the killer |
| Rally | −25 | allies within 6 |

- **Stress ≥ 75**: accuracy × 0.9 (`Units.accuracyMult`).
- **Breakdown** at 100: stress resets to **60**, the unit gets `panicked` for 1 round, loses overwatch and leaves
  its formation. `panicked` halves the next turn's AP (rounded up) and blocks abilities throughout the next own turn ([06](06-elements.md#statuses)).

## Will

Will (WP) is spent on abilities, regenerates +1 at the start of each own turn (`B.willRegen`, not on the first squad
turn), is raised by Rally (+1), and a disabled head cuts max Will by 2 (min 1). Syndicate units have Will but no
usable abilities in practice.

## Notes on the data

- The Breacher's role text mentions a "ballistic shield"; there is no shield mechanic beyond plate armour and Shield
  Wall.
- `armor: 'hide'` (Lookout) is the lightest set: 1 on the torso, 0 elsewhere (`light` is 2 torso, 1 legs).
- Squad accuracies (0.85–1.0) sit above the Syndicate's (0.55–0.68); the values were retuned with the 30-HP / caliber
  change to keep the balance-sim win rates near their earlier level (`npm run sim`).
- `ENEMY_PODS` presets are not used by the current maps; each map lists its enemies and groups directly
  ([11](11-maps-and-level-design.md)).

<!-- generated:squads -->
| squad preset | classes |
|---|---|
| `standard` | Assault, Grenadier, Sharpshooter, Breacher |
| `assault` | Assault, Assault, Grenadier, Breacher |
| `ranged` | Sharpshooter, Sharpshooter, Grenadier, Breacher |

| enemy pod preset (unused by the current maps) | members |
|---|---|
| `patrol` | Gunman, Gunman, Lookout |
| `fire` | Arsonist, Gunman |
| `guard` | Riot Guard, Riot Guard, Lookout |
| `brute` | Enforcer, Gunman |
| `tech` | Drone Tech, Search Drone, Gunman |
<!-- /generated:squads -->

Squad members spawn on the map's player spawn points in order (`mission.spawns.player[i % n]`) and take call signs
from `CALLSIGNS` (Reyes, Kowalski, Okafor, Tanaka, …) via `Scenarios.squadFor`.
