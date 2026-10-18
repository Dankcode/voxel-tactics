# PLAN-11: Sighting markers, aim camera and magnetism, stairs, cover chain, status tag, still idles

Status: implemented 2026-10-18 (not committed). Full suite green: 72/72 test files; content contract re-synced.

| Request | What changed | Where |
|---|---|---|
| Show where enemies were seen | A red "!" and ring flash when a hostile comes into view; a red "?" ghost with "last seen N rd ago" stays where it dropped out of view (up to 3 rounds, hidden above the floor cut and while aiming) | `client/src/render/SightingMarks.js`, `Game.js` |
| Aim camera covered / aiming at walls | The shoulder camera cuts away whatever blocks its view of the target, not only in cramped rooms; free aim sticks to a visible enemy's torso, head or legs when the line passes within ~3° / 0.6 m, and only if the muzzle actually has a line to that part | `CameraDirector.begin`, `Ballistics.stickyAim`, `Game.moveAim` |
| Stairs showing two staircases | Renderer bug: a flight cut by the storey view grew a full tread set on every cut column; treads now come from the real column. A voxel balustrade tried in the stair core was removed again (it split upper floors in half and forced map re-rolls); railings no longer count as load-bearing | `KitView.js` (stairs), `StoreyCompiler.js`, `Destruction.settleUnsupported` |
| Better map logic (references) | Cover chain from the Gears of War MP map theory (traversal between cover): no open dash longer than seven steps along the main line of advance; the repair pins low cover in the middle of a long dash first | `MissionMetrics.coverChain`, `Gates` (`advanceCover`), `Repair.js` |
| Unobtrusive health / inventory | A slim segmented HP bar over each soldier; for ~2 s after selecting, reloading or choosing a gadget it opens into a small card: HP, AP, weapon rounds + spares, grenades / gadgets | `UnitView.drawBar / flashStatus`, `Game.statusLines` |
| Fewer idle / sprite animations | Idle, aim, stacked and hunker are still frames; only actions animate; no idle breathing sway | `SpriteAnimator` (`STILL_CLIPS`), `UnitView` |

References: Epic, *Gears of War Multiplayer Map Theory* (cover chain, low cover, clusters with open ground, visible flanks);
Game Developer, *Better level design via line of sight*.
