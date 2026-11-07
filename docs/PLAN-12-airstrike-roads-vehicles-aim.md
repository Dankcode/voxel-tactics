# PLAN-12: Airstrike salvo, road paint, new vehicles, steady aim camera, decals, reticle

Status: implemented 2026-10-19 (not committed). Full suite green: 73/73 test files; content contract re-synced.

| Request | What changed | Where |
|---|---|---|
| Killstreak not sending 3 | Two causes. The classic-rules "Strike" was still the old single radius-4 Commander Strike; it is now the same three-bomb airstrike (lighter bombs, 25 dmg). And strike targeting used the walkable-floor pick, which found no tile over roofs and walls, so nothing highlighted and nothing could be cast | `Strikes.js`, `Battle.doAbility`, `units.js`, `Game.strikeCell` |
| Rectangular area, 3 inside | 15 × 9 rectangle (long side along the caster's facing); 3 seeded bomb centres inset so every blast stays inside, ≥ 4 apart, fixed fallback pattern | `STRIKES.carpet_bomb / killstreak_strike`, `airstrikeBombs` |
| Highlight on the viewed level | One flat rectangle (fill, outline, corner posts) on the plane of the level in view (visible floor under a cut, else the street); the cursor targets that plane | `Overlays.showStrikeArea`, `Game.strikePlaneY / strikeCell` |
| Strike from above, no shooting animation | No soldier cut-in for strikes; a `strike` event drops three finned bombs with hot trails from ~30 m onto the targets, then the three blasts go off together | `Fx.bomb`, `EventPlayer` (`strike`), `Battle.doAbility` |
| Street lines | Voxel road-mark cells removed (a 1 m cell cannot centre a line on a 4-cell carriageway); thin dashed centre lines exactly on the carriageway centre and zebra bars where a street meets a junction, drawn as a render overlay, rebuilt after destruction | `client/src/render/RoadMarkings.js`, `ExteriorSolver.roadLotCells`, `Generator.js` |
| Crates everywhere | A committed finishing pass turned every planter and bench into crates (and hedges into sandbags); removed | `MissionCommon.finalizeMission` |
| New car models | Superseded by original procedural sedan and pickup pieces in the main tile set; the imported FBX/OBJ, separate GLB and vehicle texture set were removed. Both retain the 4 × 2 footprint and per-car paint tint | `VehiclePieces.js`, `client/public/assets/kit/tileset.glb`, `KitView.vehicle` |
| Character shifting while aiming | The shoulder framing holds still while aiming (the reticle moves, the soldier stays put on screen); it re-anchors in one step only when the reticle nears the frame edge or passes ±35° yaw | `CameraDirector.track` |
| Bullet holes across floors | Holes above the storey cut no longer fray or mark the walls below it, and cut caps carry no damage decals | `DamageDecals.collect` |
| Crosshair readability, one line | Bold accuracy ring with a dark halo, centre cross, labelled readout; the dashed inner ring is gone; the aim overlay is a single line (no cone, rings or spokes) | `game.css`, `Overlays.showCone` |
