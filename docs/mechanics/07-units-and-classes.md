# 07 · Units, classes and abilities

Data: `shared/content/units.js` (classes, Syndicate types, abilities, squads), `shared/content/weapons.js`
(armour). Rules: `shared/battle/Units.js` (`createUnit`, `accuracyMult`, `mobilityPerAp`, `partArmor`,
`addStatus`), `Battle.doAbility`, `Battle.addStress`.

## Unit sheet

<!-- generated:units -->
| id | name | side | HP | part HP head/torso/arm/legs | accuracy | tiles per AP (base + armour) | Will | armour | weapons (first = default) | items | abilities |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `vanguard` | Assault | squad | 22 | 9/22/9/12 | 0.85 | 3.2 (3.4 -0.2) | 6 | `medium` | Combat Shotgun, Sidearm, Combat Knife | Incendiary Grenade ×1, Smoke Grenade ×1 | Sprint, Rally |
| `grenadier` | Grenadier | squad | 24 | 10/24/10/13 | 0.8 | 2.5 (2.9 -0.4) | 6 | `heavy` | Assault Rifle | Frag Grenade ×2, Concussion Grenade ×1 | Demolition, Suppressive Fire |
| `marksman` | Sharpshooter | squad | 18 | 7/18/7/10 | 1 | 3.1 (3.1) | 7 | `light` | Sniper Rifle, Sidearm | Smoke Grenade ×1, Cryo Canister ×1 | Snap Shot, Deadeye |
| `warden` | Breacher | squad | 26 | 10/26/10/14 | 0.82 | 2.5 (2.9 -0.4) | 7 | `plate` | Suppressed Carbine, Combat Knife | Breaching Charge ×2, Extinguisher Grenade ×1 | Shield Wall, Rally |
| `cultist` | Gunman | Syndicate | 14 | 6/14/6/8 | 0.7 | 3 (3) | 4 | `light` | Battle Rifle, Combat Knife | Incendiary Grenade ×1 | — |
| `archer` | Lookout | Syndicate | 12 | 5/12/5/7 | 0.85 | 3.2 (3.2) | 4 | `hide` | Marksman Rifle | — | — |
| `pyromancer` | Arsonist | Syndicate | 16 | 6/16/6/9 | 0.75 | 2.8 (2.8) | 6 | `light` | Flamethrower | Incendiary Grenade ×2 | — |
| `brute` | Enforcer | Syndicate | 30 | 12/30/12/17 | 0.6 | 2.8 (3.2 -0.4) | 6 | `heavy` | Sledgehammer | — | — |
| `warden_foe` | Riot Guard | Syndicate | 22 | 9/22/9/12 | 0.75 | 2.4 (2.8 -0.4) | 6 | `plate` | Battle Rifle, Combat Knife | — | Shield Wall |
<!-- /generated:units -->

- **HP** is one pool. Each body part also has its own HP gauge, a share of the pool (below); damage to a part comes
  off both the part and the pool ([04](04-ballistics-and-weapons.md#damage-battledealdamage)).
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
| `medium` | 0 | 2 | 1 | 1 | 1 | -0.2 |
| `heavy` | 1 | 3 | 2 | 2 | 2 | -0.4 |
| `hide` | 0 | 1 | 0 | 0 | 0 | 0 |
| `plate` | 2 | 4 | 3 | 3 | 3 | -0.4 |
<!-- /generated:armor -->

## Abilities

<!-- generated:abilities -->
| id | name | Will | AP | text (from data) | who has it |
|---|---|---|---|---|---|
| `dash` | Sprint | 2 | 0 | +1 AP that can only be spent moving. | Assault |
| `rally` | Rally | 2 | 1 | Allies within 6 lose 25 stress and gain 1 WP. | Assault, Breacher |
| `demolish` | Demolition | 1 | 0 | Next shot or blast deals double damage to walls and cover. | Grenadier |
| `suppress` | Suppressive Fire | 2 | 2 | Burst at a target; it is Suppressed (spread ×1.6) until its next turn. | Grenadier |
| `quick_aim` | Snap Shot | 2 | 0 | Next shot costs 1 AP less. | Sharpshooter |
| `deadeye` | Deadeye | 3 | 0 | Next shot has half the spread. | Sharpshooter |
| `brace` | Shield Wall | 1 | 1 | +4 armour on every part until your next turn. | Breacher, Riot Guard |
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
| Suppressive Fire (`suppress`) | if the user carries the Assault Rifle: a normal Assault Rifle shot at the target's torso (uses 3 rounds), then `suppressed` for 2 rounds (accuracy × 0.6). With fewer than 3 rounds loaded the shot is skipped but the status still applies | 2 rounds of the target's status |

Ability use is refused with `no_will` while `panicked`. The AI never uses abilities.

**Suppression through the HUD is free.** The HUD's Suppressive Fire button does not send the `ability` intent: it
switches to targeting and sends a normal `shoot` intent with `suppress: true` (`Game.useAbility`, `Game.fire`).
`Battle.doShoot` applies `suppressed` (2 rounds) for any shot that carries the flag, and `validate` does not check
the ability. So in play Suppressive Fire costs the weapon's shot AP and **no Will**, and any unit could send the flag
with any weapon (verified with a Sharpshooter).

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
  its formation. `panicked` halves the next turn's AP (rounded up) and blocks abilities while present; see the
  timing quirk in [06](06-elements.md#statuses).

## Will

Will (WP) is spent on abilities, regenerates +1 at the start of each own turn (`B.willRegen`, not on the first squad
turn), is raised by Rally (+1), and a disabled head cuts max Will by 2 (min 1). Syndicate units have Will but no
usable abilities in practice.

## Notes on the data

- The Breacher's role text mentions a "ballistic shield"; there is no shield mechanic beyond plate armour and Shield
  Wall.
- `armor: 'hide'` (Lookout) is identical to `light`.
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
<!-- /generated:squads -->

Squad members spawn on the map's player spawn points in order (`mission.spawns.player[i % n]`) and take call signs
from `CALLSIGNS` (Reyes, Kowalski, Okafor, Tanaka, …) via `Scenarios.squadFor`.
