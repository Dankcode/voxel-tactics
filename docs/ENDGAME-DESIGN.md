# Endgame Campaign, Escalation & Tactical Map Logistics Design

## 1. Strategic Endgame Architecture & Force Levels

The campaign scales enemy lethality and tactical doctrine across **Force Levels 1–4** (`THREAT_FORCE_LEVEL` in `OperationsTheater.js`), matching an XCOM 2-style regional escalation curve before culminating in the multi-stage Citadel offensive.

| Force Level | Campaign Stage | Core Pod Archetypes | Armored / Special Assets |
| :--- | :--- | :--- | :--- |
| **FL 1 — Reconnaissance** | Early Theater (`threat: low`) | `officer + cultist`, `cultist + archer`, `breacher + cultist`, `tech + search_drone + cultist` | Unarmed Search Drones relaying LOS within 14 tiles |
| **FL 2 — Garrison** | Mid Theater (`threat: moderate`) | `officer + cultist + warden_foe`, `heavy_gunner + cultist`, `breacher + medic + cultist`, `sniper + archer` | Armed `gun_drone` escorts paired with Drone Techs |
| **FL 3 — Lockdown** | Late Theater (`threat: high`) | `officer + heavy_gunner + medic`, `demolisher + breacher + cultist`, `sniper + officer + archer`, `pyromancer + warden_foe + medic` | Twin Gun Drones (`['tech', 'gun_drone', 'gun_drone']`) and 40mm ordnance |
| **FL 4 — Citadel / Retaliation** | Climax & Endgame (`threat: critical`) | `officer + heavy_gunner + medic + demolisher`, `sniper + breacher + officer`, `heavy_gunner + demolisher + medic` | Open-pocket `wall_strider` breachers (`along >= 0.45`) and full 4-trooper command cells |

### Threat Clock & Syndicate Retaliation
- Ignoring regional contracts or failing to intercept Supply / Relay operations raises sector threat by `+1` Force Level.
- Every critical biome features an extraction/hold objective anchored on natural elevation terraces (`highPad` / `lowerPad`), punishing slow attrition with converging FL 3–4 pods and Drone Tech optical relays.
- **Test Environment Override**: `TEST_UNLOCK_ALL_OPERATIONS = true` in `OperationsTheater.js` unlocks all 8 campaign operations (plus custom seed overrides and Skirmish Threat Level selectors) so map generation, hill geometry, and FL 1–4 enemy rosters can be inspected directly without campaign gating (`unlockAll: false` restores progressive theater locks).

---

## 2. Three-Stage Finale Arc

1. **Stage I — Relay Severance (`op-sf-avenue`, `hillside_avenue`, FL 2–3)**:
   - Fight uphill along San Francisco-style terraced avenues divided by sloped asphalt streets (`road_slope`) and parallel sidewalk stairways (`sidewalk_stair`).
   - Neutralize elevated Deadeye Snipers holding roof/crest sightlines before breaching the hilltop relay command room.
2. **Stage II — Industrial Core Breach (`industrial` / `sunken_basin`, FL 3–4)**:
   - Descend into a `-2` recessed industrial basin past Heavy Gunners on suppressing lanes and Field Medics projecting Aegis Shields (`field_shield`).
   - Clear the multi-pod loading yards and demolish hardened interior barricades to sever Syndicate construct logistics.
3. **Stage III — Citadel Summit (`op-citadel-push`, `downtown`, FL 4)**:
   - Assault a multi-storey command tower defended by linked command squads (`officer`, `heavy_gunner`, `medic`, `demolisher`) and autonomous `wall_strider` / `gun_drone` pickets.
   - Counter crossfire killzones by using vertical flanking (`fire_escape` / `roof_stair` / underground subway tunnels) and breaking enemy overwatch with Smoke, Concussion, or high-caliber wall penetration.

---

## 3. Full Hostile Roster & Tactical Counters (16 Enemy Types)

### Baseline Syndicate & Construct Forces (9 Existing Types)
- **Gunman (`cultist`)**: Rifleman (`musket` 7.62x39mm) with incendiary and extinguisher flasks.
- **Lookout / Drone Hunter (`archer`)**: Precision `shortbow` (7.62mm) lookout that detects stealth drones out to 8 tiles; uses cryo & smoke combos.
- **Arsonist (`pyromancer`)**: Close-range `firelance` & twin `fire_flask` area denial.
- **Enforcer (`brute`)**: High-mobility melee rusher wielding `maul` with knockback.
- **Riot Guard (`warden_foe`)**: Heavy `plate`-armored anchor using `brace` and `earth_cover`.
- **Drone Tech (`tech`)**: Launches and guides aerial quadcopters (`launch_drone`, max 2) while hanging back behind `smoke_pot`.
- **Search Drone (`search_drone`)**: 1-HP unarmed optical relay that investigates noise and alerts pods within 14 tiles.
- **Wall Strider (`wall_strider`)**: 60-HP 5-tile quadruped construct that climbs facades and smashes through walls (`smash`).
- **Siege Weaver (`siege_weaver`)**: 90-HP 7-tile armored climbing gun platform armed with an assault `repeater`.

### Expanded XCOM 2 Archetypes (7 New Types)
- **Squad Officer (`officer`)**: Command leader armed with `.45 ACP` `smg` + `handcannon`. Marks high-value soldiers (`mark_target`: `0.78×` spread multiplier & `+2` bonus damage per hit for 2 rounds) so the pod focuses fire (`+35%` focus weight in `PodPlanner`), and rallies panicked/stressed teammates (`rally`). *Counter*: Focus down first or break LOS / smoke marked soldiers.
- **Heavy Gunner (`heavy_gunner`)**: `heavy`-armored anchor wielding a 60-round 5.56mm `lmg`. Locks down dug-in soldiers with `suppress` (`accuracy × 0.6` and widened sway) and destroys cover with `demolish`. *Counter*: Flank around suppression arcs or stun/burn to cancel active suppression.
- **Assault Breacher (`breacher`)**: Fast `medium`-armored flanker armed with a 12-gauge `auto_shotgun` (`shred: 2`), `shock_baton` (11 dmg melee + `stunned` 1 round), `gale_flask`, and `dash`. *Counter*: Overwatch corridors and maintain spacing before they reach point-blank range.
- **Deadeye Sniper (`sniper`)**: Long-range specialist carrying a `.50 BMG` `anti_materiel` rifle (`36 dmg, pierce 6, voxel 18`), `handcannon`, and `deadeye` (`0.5×` spread). Placed on upper floors and high-ground posts (`c.z * 2.5` spawn weight). *Counter*: Approach through solid full cover, interior rooms, or underground subway flanks.
- **Field Medic (`medic`)**: Support specialist carrying `smg`, `medkit`, `water_mend` (`+8 HP` & extinguish), and `field_shield` (`+2` armor `braced` aura within 5 tiles for 1 round). *Counter*: Use shred (`auto_shotgun`, `powder_bomb`), high-pierce calibers (`.338`/`.50`), or neutralize the medic before injuring multi-target clusters.
- **Demolisher (`demolisher`)**: Ordnance trooper armed with a 40mm `grenade_launcher` (`blast: { radius: 2.3, power: 10, damage: 12, shred: 1 }`), `powder_bomb`, `fire_flask`, and `demolish`. Strips destructible cover on impact. *Counter*: Spread formation (`B.podSpacing`) and bait blasts away from critical upper floors.
- **Armed Drone (`gun_drone`)**: 15-HP `light`-armored combat quadcopter mounting an underslung `.45 ACP` `smg` pod (with visible crimson gun pod in `DroneModel.js`). Fires directly on spotted soldiers (`decideDrone`) before repositioning at optimal standoff range. *Counter*: Prioritize anti-air burst fire or high-pierce rifle shots.

---

## 4. Ammunition & Weapon Progression

| Weapon ID | Display Name | Caliber | AP / Mode | Core Role |
| :--- | :--- | :--- | :--- | :--- |
| `smg` | Submachine Gun | `45acp` (9 dmg, 0p) | 2 AP · single/burst/auto | Agile CQB lead & drone gun pod |
| `lmg` | Light Machine Gun | `5.56` (10 dmg, 2p) | 2 AP · burst/auto (`shred: 1`) | Heavy suppression & prolonged firefights |
| `auto_shotgun` | Auto Shotgun | `12g` (8×3.75 dmg) | 2 AP · single/burst (`shred: 2`) | Room breaching & armor shredding |
| `anti_materiel` | Anti-Materiel Rifle | `50bmg` (36 dmg, 6p, 18v) | 3 AP · bolt-action (`shred: 3`) | Armor/wall-piercing long-range elimination |
| `grenade_launcher` | Grenade Launcher | `40mm` (12 dmg + blast r2.3) | 2 AP · HE impact | Cover destruction & clustered suppression break |
| `shock_baton` | Shock Baton | melee (11 dmg, 2p) | 1 AP · `stun: true` | Non-lethal-profile CQB incapacitation (`-2 AP` stun) |

---

## 5. Procedural Map Logistics & San Francisco Sloped Streets

To resolve disconnected stairs, landlocked parking lots, stray concrete barriers, and floating height rectangles:

1. **Lot-Aligned Urban Terraces (`planLotTerraces`)**:
   - Elevation biomes (`hillside_avenue`, `hillside_ridge`, `sunken_basin`) and explicit vertical flows compute contiguous `LW × LD` lot terraces (`lotDz`) BEFORE building heights and programmes are finalized.
   - Every building and attached wing (`b.wingOf`) snaps its occupied lots to one uniform terrace elevation (`b.baseZ = plot.datum + dz`) with masonry foundation columns (`MAT.concrete`) down to `z = 1` and storey clamping (`<= height - 2 - baseZ`) to guarantee `heightBudget` (`<= 18`).
   - Biomes with underground tunnels (`metro_hub`) clamp `minDz >= 0` so recessed geometry never intersects subway corridors.

2. **San Francisco Sloped Streets & Parallel Sidewalk Stairs (`TerrainFeatures.js` + `KitPieces.js` + `KitView.js`)**:
   - Adjacent road lots at differing terrace levels generate 1-cell-per-vertical-step ramps (`MAT.road_slope` or `MAT.cobble_slope` across the 4-cell carriageway -> rendered with `road_ramp` wedges) flanked on both sidewalks by parallel `MAT.sidewalk_stair` runs (rendered with 6-tread `sf_stair_step` + cheek curbs).
   - Every sloped road tile, sidewalk stair, terrace stair, and canal bank stair stores an explicit uphill `stairYaw` hint in `mission.visual.hints`, and `KitView.stairYaw()` ignores non-walkable adjacent walls/railings and detects single-step drops so stairs never face sideways or into walls.

3. **Connected Parking Lots & Clean Urban Cover**:
   - `parking_lot`, `depot_yard`, `construction_site`, `loading_yard`, and `motor_pool` enforce `roadFront: true` in `ExteriorSolver.solveLots()`.
   - `Generator.carveDriveways()` cuts a protected `4×2` asphalt/cobble driveway apron (`cls = 'driveway'`) across the adjacent road's sidewalk and protects the interior `4×2` entry throat so trees, bollards, planters, and parked cars never seal off a parking entrance.
   - Highway `jersey` barriers are restricted strictly to `checkpoint_yard`, `construction_site`, and off-map `barricade` road edges; parks, plazas, yards, and pockets use planters, benches, hedges, low stone walls, and twin street `bollard` posts (`KitPieces.bollard`).
   - 8 new parcels (`fire_station`, `police_precinct`, `pharmacy`, `courtyard_park`, `amphitheater_steps`, `loading_yard`, `motor_pool`, `overlook_plaza`) + missing `BAY_PIECES` (`boulder`, `fountain`, `drystone`, `bollard`, `checkpoint`, `market_stall`, `cafe_patio`, `fuel_pump`, `truck`, `bus`, `abandoned_car`, `container_y`) + multi-variant road generators expand geometric diversity across all 12 biomes.

---

## 6. XCOM 2 Pod Composition & Tactical Spawn Doctrine

- `OperationDesigner.js` scales pod composition dynamically from Force Level 1–4 across Leader + Follower formulas while preserving PLAN-15 spacing invariants (at most 2 pods inside the objective building, outdoor pods distributed around ~30%, ~55%, and ~78% of the line of play at `>= B.podSpacing * 0.75`, and `>= 16` tiles from insertion).
- `MissionCommon.finalizeMission()` evaluates candidate reachable cells per enemy role relative to `player[0]` (`threat`) while keeping squad spread (`>= 2` tiles) and `secureSpawns`:
  - `sniper` / `archer`: weighted toward elevation (`z`), cover vs `threat`, and standoff distance.
  - `heavy_gunner` / `officer` / `warden_foe`: weighted toward strong directional cover anchoring firing lanes.
  - `breacher` / `brute` / `pyromancer`: weighted toward forward/flank ambush cover closer to `threat`.
  - `medic` / `tech`: weighted toward full rear cover; `demolisher` prefers cover with open overhead headroom for 40mm arcs.
  - Unbriefed enemies automatically face `facingToward(threat)` rather than defaulting to south.
