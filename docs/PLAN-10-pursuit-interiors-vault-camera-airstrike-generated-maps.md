# PLAN-10: Pursuit AI, open interiors, vaulting, floor-aware camera, 3-blast airstrike, generated-only maps, aiming

Status: implemented 2026-10-18 (not committed). Full suite green: 72/72 test files (`npm run test:fast` file by file),
`npm run content:check` clean. Tunables are in `shared/content/balance.js` (`ai*`) and `STRIKES.carpet_bomb`.

| Area | What changed | Where |
|---|---|---|
| Enemy pursuit | Dash when no good shot is reachable; path-progress scoring; keep closing after a move; hide only when wounded or the pod is half gone; unalerted pods patrol around their post | `shared/battle/EnemyAi.js`, `Ai.js`, `Battle.js` (`u.home`) |
| Step-out sight | Units against full cover see (and so can target) past corners from their step-out tiles; never into unopened rooms | `Battle.sees` / `peekEyes` |
| Vaulting | Any sill-high gap under a lintel in a wall is a vault line (windows of every kind, blasted holes); landings kept clear | `PathSearch.isAperture`, `FurnishSolver`, `StoreyCompiler` |
| Camera | Tab, selection, targeting and enemy activity switch the storey cut to the unit's floor; enemy shots focus the squad member being targeted; zooming out to the roof view hands the cut back to the zoom | `FloorCutaway.unitCutLevel`, `Game.focusFloor`, `EventPlayer` |
| Interior aiming | When the shoulder camera would be pushed into the shooter's back, it stays back with a 50° view and hides the walls/furniture between it and the shot (x-ray, presentation only) | `CameraDirector.occluders`, `VoxelView.setXray` |
| Aim line / accuracy | Free aim turns about the actual muzzle (lean/step-out) and lands on whatever the crosshair line meets, so shots no longer miss by the lean offset at a different depth (the "carbine too inaccurate" cases); the cone follows the live aim; reticle and point shots use the aimed target's spread modifiers | `Ballistics.resolveAimPoint`, `aimedUnit`, `Game.moveAim/stepAim`, `AimReticle` |
| Airstrike | 15 × 15 square, three simultaneous blasts inside it (inset, ≥ 4 apart, seeded), no edge damage; highlight draped on the floor in view | `Strikes.js`, `EventPlayer`, `Game` |
| Maps | Play, co-op lobby, Test ground and debug panel offer themes only (Downtown / Industrial / Suburbs) with a random seed; fixed maps remain as code fixtures (Training Facility and Architecture Yard as admin test rigs; `?play=<id>&fixture=1` for tests); old ids open the closest theme | `Scenarios.js`, `Maps.js`, `main.js`, `staging.js`, `TestGroundPanel.js`, `DebugTools.js` |
| Clutter | No crates, pallets or drums outdoors; nothing in the carriageway but parked cars; fewer dumpsters/bins; pocket cover matches the ground | `LotCatalogue.PIECE_POOLS`, `ExteriorSolver.planPockets`, `Repair.js`, gate `noClutter` |
| Interiors | Service rooms get real doors and windows (no sealed rooms); gates `noSealedRooms`, `roomsReachable`, `roomWindows`, `noDeadEnds` on generated maps | `OperationDesigner.js`, `Gates.checkInteriorGates` |

Baseline for shared visual testing: `http://localhost:2567/?play=operation&plot=downtown&seed=1` (AGENTS.md, CLAUDE.md).
