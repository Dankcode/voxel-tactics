# PLAN-14: Loading screen, sound and search, drone techs, reticle aiming, faster movement, varied buildings

Status: implemented 2026-10-20 (not committed). Full suite green: 76/76 test files, including the new `shared/battle/plan14.test.js` and `shared/mapgen/plan14.test.js`. Content contract re-synced.

| Request | What changed | Where |
|---|---|---|
| Loading screen | A full-screen loading card is visible from the first paint. It shows stages with a progress bar (generating, textures and models, battlefield, squad), the operation name and a rotating tip. Each stage is painted before the heavy work starts. It covers the menu "Play" path and `?play=` deep links. | `client/src/ui/LoadingScreen.js`, `client/index.html`, `client/src/main.js`, `Game.start({ progress })`, `game.css` |
| Destroyed top floor turned into "rounded tiles" | Modern buildings fillet their authored slab edges. A blast hole used the same filleted mesher, so it looked like pillow tiles. Any voxel next to a damage scar is now drawn as a straight section with the building's own material, and the existing damage decals fray its edges. A hole in a roof keeps the roof flat around it instead of turning into new dipped eaves. | `ChunkMesher.js` (`brokenNear`), `RoofBuilder.js` |
| Enemies respond to loud sounds and search | Gunfire, blasts, breaches and smashes (noise radius ≥ 10) are heard out to 1.75× their radius. Inside the radius a pod is alerted as before. Out to the extended range it sends every member to search the source: they spread out on the way, sweep around it once they reach it, then the lead goes cold. Visible enemies that hear a sound show a "?" | `Battle.noise`, `EnemyAi.searchGoal / searchMove / investigateStep`, `Ai.decide`, `EventPlayer` (`heard`) |
| Enemy techs with search drones (one-shot) | New **Drone Tech** (sidearm, Launch Drone: at most 2 in the air, one launch every 3 rounds). New **Search Drone**: unarmed, no armour, 1 HP, a small hitbox hovering at head height. Drones run down sounds and last-known positions, then sweep a ring around their tech. Whatever a drone sees, the whole enemy side knows, and every pod within 14 tiles is alerted. Drones do not count toward "eliminate". The first outdoor pod on every generated map is a tech crew (tech, drone, gunman). The drone model is a procedural quadcopter with spinning rotors, a red scanner eye and a faint search cone. | `content/units.js`, `weapons.js` (`ARMOR.drone`), `Units.createUnit`, `Ballistics` (`DRONE_BODY`), `Battle` (`launchDrone`, relay), `EnemyAi.decideDrone`, `OperationDesigner.addPocketPods`, `client/src/units/DroneModel.js` |
| Targeting only through the reticle, by body part | The target portrait list, the body-part card, the Z/X/C/V/G part keys and Tab-to-next-target are removed. The reticle picks the target and the part: whichever body part sits under it (now including the arms) is the one aimed at. It shows `NAME · PART n% · ANY HIT n%` in amber when on an enemy. The aim card is a slim Fire / Back bar. Tab moves on to the next soldier. | `Game.js` (`aimPick`, `partChance`), `AimReticle.js`, `Hud.renderTarget(s)`, `Ballistics.stickyAim`, `game.css` |
| Aiming restricted, camera stuck (TPS / Phoenix Point) | Third-person-shooter aim camera. While aiming, the camera rides over the shooter's shoulder and turns with the mouse: the soldier keeps its place on screen, the reticle stays at the centre, and looking down raises the camera (orbit about the shoulder). The aim is free in every direction (±70° pitch) on anything. The shoulder pulls in only slightly near walls; past that, the walls between camera and aim are cut away. That cutaway is throttled and only re-applied when it changes. Stepping out round a corner glides the camera over without a cut. | `CameraDirector.track` (`SHOULDER`), `prepareAim` |
| Running sprite not looping | The run cycle had been cut to two frames of the same stride, so it never looked like it alternated. The original four-frame stride (left foot, passing, right foot, passing) is restored in all eight facings at 10 fps, looping. | `ranger-01/field.png`, `field-normal.png`, `field-lighting.png`, `field.json`, `sprite-list.json` (22 columns) |
| More movement, modified by gear | Tiles per AP × `B.moveScale` = 1.5 for both sides. That gives about 4.5 per AP for most soldiers (blue moves about 9, dashes about 18). Gear adds or takes off on top: Scout rig +0.4, Recon pack +0.3, Recon armour +0.3, Assault rig −0.3, Raid pack −0.4, Ballistic helmet −0.1, plus the existing armour mobility and encumbrance. Worn slots show the modifier. | `balance.js`, `gear.js` (`move`), `Equipment.gearMove`, `Units.mobilityPerAp`, `EquipmentPanel` |
| Repetitive buildings, merged parcels, more types, fewer fire escapes | **Footprint variants:** each building kind has several (never larger than its lot template). **Merged parcels:** up to three-quarters of building parcels get a lower attached wing behind or beside the block. A wing is its own building with its own programme (shop, diner or garage), wall material, interior and door, so blocks read as L, T and stepped shapes. **New building types:** tenement, townhouses, motel and bar (new `motel` and `bar` programmes). **Fewer fire escapes:** only about a third of tall blocks keep one; the objective always does. The others carry their stair core up through a railed roof hatch. | `LotCatalogue` (variants, kinds, `WING_PROGRAM`), `ExteriorSolver.placeBuildings / planWing`, `Generator.planAccess` (`roof_stair`), `StoreyCompiler` (roof flight), `AccessModules.checkAccess`, `Gates` (roof and escape gates), `OperationDesigner` programmes |
| Find the enemy | New squad ability **Recon Scan** (any soldier, 1 AP, 1 WP, 40 tiles, shared 3-round cooldown). Each hostile in range shows as a pulsing red circle of radius 3 around a deterministic offset of its real tile, labelled CONTACT? or DRONE?. Contacts above the storey cut are drawn on the cut plane. The circles last two rounds. Scanning makes no noise. | `units.js`, `Battle.reconScan`, `Hud.slotsFor`, `SightingMarks.showScan`, `EventPlayer` (`scan`) |

## Rule changes

These are needed so the new buildings can pass the existing generator checks:

- **Tall-building access:** tall blocks now pass `accessByHeight` with either a fire escape or a roof stair.
- **`secondEscape`:** checked only on blocks that have a fire escape.
- **`roofsReachable`:** attached wings are exempt, and so are single-storey blocks whose margins leave no facade for a ladder (`lowRoof`).
- **Two-storey blocks without room for a ladder:** they take the roof flight instead.
- **Narrow footprint variants:** if the back door blocks every position for the stair core, the back door is dropped.

## Bug fixed along the way

Tree canopies now fill only empty air, so they no longer overwrite ladder rungs. This moved the Main Street fixture hash.

## Tests changed

| Test | Change |
|---|---|
| `battle.test` | Movement is now 1.5×. |
| `rules.test` | Drones are excluded from the 30 HP rule. |
| `ranger-sprites.test` | The four-frame run loop and the 176-frame atlas. |
| `aim.test` | The follow camera keeps the aim centred and the soldier fixed on screen. |
| `vertical.test` | The `main-street` hash. |

## Checked in the running game

The game was run in headless Chromium. The development server on the Mac was not running, so it was run in the cloud workspace.

- The loading card appears with its stage and operation name, then the game.
- The Recon Scan circles appear on downtown seed 1.
- The tech pod stands on the street with its drone. The drone was then enlarged and raised so it reads above the crowd.
- A floor blasted on the top storey shows straight broken edges with fray decals.
- The aim view puts the reticle on the enemy with the part label. Software rendering is too slow to judge how smooth the aiming camera feels, so that needs a check on a real GPU.
