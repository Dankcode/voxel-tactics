# PLAN-15: Aim state with peek, free aim, grenade preview, one tool at a time, AP HUD, armour, pod spacing, AI, more realistic maps

> PLAN-16 note: the real-place generator this plan refers to (`GeoDistrict`, `tools/geo`, `client/public/geo`) was removed from this repo. Real places now come from Geo-voxel and are imported by `tools/places` (`shared/mission/PlaceImport.js`); see `docs/PLAN-16-place-import-new-parcels.md`.

Status: implemented 2026-10-27 in the cloud workspace and copied into the local `voxel-tactics` folder (not committed).

**Decisions used.** Leon asked for the implementation without picking options, so the plan's recommended defaults apply:

| Decision | Default used |
|---|---|
| D1 | A peek is free. The shot fires from the peek tile, and the soldier steps back home. |
| D2 | `B.peekRange` = 1 |
| D3 | Z/X change floors. WASD, the arrow keys, the screen edges and right-drag pan. |
| D4 | One shared armour table |
| D5 | The in-battle squad selector |
| D6 | Every AI item |

**Map request.** Leon added "a more realistic map build" and chose three things:

- real-place fidelity
- real data driving the generator
- XCOM gameplay layout

| Request | What changed | Where |
|---|---|---|
| Aiming as its own state, with a 1–2 tile WASD peek; the sprite moves and is exposed | While aiming, WASD steps the soldier out to a peek tile: camera-relative, one tile per press, up to `B.peekRange`. Peek tiles are on the same storey and reached by plain walking (no doors, vaults or ladders). The sprite glides there and the shoulder camera follows, swapping shoulders by side. The reticle line shows the peek tile's cover (FULL / HALF / EXPOSED) and any known overwatch. The shot intent carries `from`, which Battle validates. On a peek shot: emit `peek`, take overwatch reactions on that tile, fire, step back (`peekBack`). A soldier killed out there stays there. The first Esc steps back home. | `shared/battle/Peek.js`, `Battle.validate/doShoot`, `Game.stepPeek/setPeek/shooterOf`, `ToolState.peekStep`, `Hud.renderTarget` |
| Freer aim, no snapping | `options.aimAssist` has three settings. **Light** (the default) only slows the mouse to 0.55× near a visible enemy and never moves the aim point. **Strong** is the old snap. **Off** turns both off. The body part comes from the hitbox actually under the line, not the nearest part centre. | `Ballistics.partUnderRay/aimFriction`, `Game.moveAim`, Settings |
| Aim angles going through walls | Wall tests always use the current shooter (home or peek). The old code kept testing from where aiming began, which was the step-out bug. The shoulder pull-in is now continuous, with a raised second try. The camera is never placed inside a solid voxel. The x-ray cut holds a cell for 0.4 s (hysteresis), so fast swings no longer flash walls. | `CameraDirector.track/pullIn/openSpot` |
| Grenade landing and detonation highlight | `Battle.throwPreview` (pure) returns the arc, the real detonation point (the wall, when the arc is blocked — before, the preview lied about this), the scatter, the floor tiles the blast reaches, and each unit's damage after armour. The overlay draws a bold arc with beads, a pulsing ring, highlighted tiles, a dashed scatter ring, a height pillar and a red ✕ when blocked. Damage tags show over hostiles (red) and squadmates (amber). The tooltip counts enemies and allies in the blast. | `Battle.blastHit/throwPreview`, `Overlays.showThrowPreview`, `Game.onHover` |
| Practical shotgun reticle | A pattern reticle replaces the giant cone circle: corner brackets capped at 120 px (`WIDE` past that), eight fixed pellet marks, and a range band (EFFECTIVE / FALLOFF / OUT OF RANGE). On an enemy it reads `~n/8 PELLETS · ~dmg`. | `AimReticle.js`, `game.css` |
| Gadget quick keys showing aim and grenades together | `ToolState.toolTeardown` is the single teardown. Entering any tool closes the panels, releases the mouse lock when aiming ends and resets the peek. The Gear slot leaves aim first. With the gear panel open, the number keys pick from it. | `ToolState.js`, `Game.setMode`, `Hud.runSlot/pickPanelItem` |
| Status shown more often; AP more visible; know who is selected | The active-soldier card is always on in the squad phase: portrait, name, class, large AP pips (blue = can act, yellow = move only), HP, rounds, gadgets and statuses. It shrinks to a strip while aiming. The selected soldier carries a name + AP tag over its head (`unitTags`) and a bobbing beacon. Every change of soldier shows a `▶ NAME · CLASS` call-out. | `Hud.renderUnitCard/announceUnit`, `UnitView.drawBar/beacon` |
| Smarter character select | Squad portraits show READY / n AP / WATCH / DONE / KIA plus AP pips, and spent soldiers are dimmed. Hovering a portrait lights that soldier's ring in the world. A NEXT ▸ button jumps to the next ready soldier. | `Hud.refresh` (`squadBadge`), `UnitView.setHovered` |
| End the turn when all AP is spent | On by default; a one-time settings migration flips an old saved `false`. A 1.2 s `ALL AP SPENT — ENDING TURN` countdown runs; Esc, a click or a new order cancels it. | `ToolState.autoEndReady/migrateSettings`, `Game.startAutoEnd` |
| Z and X move the building floors | Z/X call `changeLevel(±1)`; W/S pan the tactical camera. | `Game.onKey/handleKeysHeld` |
| Armour too high | New lighter table. Every projectile keeps at least `B.armorMinDamage` (0.5) of its damage. Brace drops from +4 to +2; the ballistic helmet from 3 to 2. A braced Riot Guard now takes 7 from a 5.56 round (was 2), and buckshot hurts plate (was 0). `docs/BALANCE.md` has the before/after table. These are starting values; nothing was auto-tuned. | `weapons.js`, `balance.js`, `Elements.js`, `gear.js`, `Battle.dealDamage`, AI damage estimates |
| Enemy spawns too close (generated maps) | Encounter zones. The objective building holds two pods at most. Pods take the cover pockets nearest 30 / 55 / 78 % of the line of play, at least `B.podSpacing` (12) tiles apart and 16 from the insertion; a post beside the route is used when a zone has no pocket. A picket goes in a side building at mid-route. Members of a pod stand two or more tiles apart. Fixture maps keep their old rules. | `OperationDesigner.addPocketPods`, `Generator`, `MissionCommon` |
| AI needs more work | Pod plan: one focus target per pod per round, and roles from the situation (the grenade holder supports, the widest member flanks). The support acts first. Focus fire, and wounded soldiers are preferred. Scamper scores cover against every soldier that sees the pod and spreads members out. Tiles with cover are never skipped by sampling. Every enemy intent carries a `why`; the F1 debug panel's **ai** tab lists the pod plans and the last 40 decisions. | `shared/battle/PodPlanner.js`, `EnemyAi.js`, `Ai.aiOrder`, `Battle.scatterPod`, `DebugTools` |
| Realistic maps: real places | Buildings cut by the map edge are kept, clipped, when 12 % or more is inside. Before, anything under 40 % was dropped. Results: Third Street 15 → 22 buildings, Old State Capitol 2 → 4, Independence Hall 4 → 5. Pods follow the insertion → objective line instead of the far corner. The generator is now `geo-compact-5` and all four places were re-baked. | `GeoDistrict.js`, `Pods.zonedDistrictPods`, `client/public/geo/*/baked-s1.json`, building prefabs |
| Realistic maps: real data drives generation | Place profiles from the geo catalog: storey counts by use and footprint depth ratios, baked by `npm run geo:profiles`. Generated downtowns draw building heights and footprint variants from the Baton Rouge / Philadelphia data. Generated suburbs use the Sherwood strip-centre footprints. Noise is the fallback when a family has no data. | `shared/mapgen/geo/PlaceProfile.js`, `PlaceProfiles.source.js`, `PlaceProfiles.generated.js`, `tools/geo/place-profiles.mjs`, `ExteriorSolver.placeBuildings` |

## Bugs fixed along the way

- During `start()`, `Game.isVisible` could run before the voxel view existed. The exception killed the render loop for good, which showed as a black screen in headless runs. The loop now survives a bad frame, and `isVisible` is null-safe.
- The `modeText` hint still said "Tab snaps to the next enemy", left over from before PLAN-14.

## Tests

New test files:

- `shared/battle/plan15.test.js` (7 tests): peek cells, peek shot, overwatch on peek, exposure, armour floor, grenade preview, pod plan.
- `shared/mapgen/plan15.test.js` (11 tests): pod spacing for 3 themes × 3 seeds, place profiles in step with the catalog, real-place clipping and pods.
- `client/src/render/kit/plan15-controls.test.js` (5 tests): tool teardown, auto end, WASD peek steps, settings migration, free-aim hitbox and friction.

Updated tests (intended changes):

- `enemy-ai.test`: roles are now situational.
- `tactical-overhaul.test`: the helmet gives 2 and light armour torso 1.
- `plan14.test`: the lone soldier in the search test is god-moded, because it now dies to the lighter armour before the search ends.

Full `test:fast` result: everything passes except three tests that already fail at `4ddc19e` without these changes:

- combat rooms reachable
- render hints
- hand-built map hashes

## Checked in the running game (headless Chromium, software GL)

See the screenshots in this session. Not checked:

- **The back-shot cut-in.** It crashes SwiftShader in headless runs. This is the existing PLAN-08 path, unchanged here. It was switched off for these checks, so the aim, peek and wall behaviour still needs a look on a real GPU.
- **How smooth the aim camera feels.** Software rendering is too slow to judge it.
