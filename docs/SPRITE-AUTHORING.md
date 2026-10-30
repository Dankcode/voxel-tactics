# Static soldier backshot

The active Ranger backshot is a new painting made directly from the user's supplied rear-shoulder screenshot. The final generation used that screenshot as its only visual input and a text description of the project's cel-shaded style. No previous soldier pixels or assembled arm layers are reused.

The character is one transparent image, `client/public/assets/characters/ranger-01/backshot-static.png`. Body, helmet, backpack, right shoulder, arms and occluded hands remain fixed in one direction. The gun is a separate existing 3D asset, registered behind the character painting. Changing between rifle, sniper and shotgun changes only the gun. Aim sway/recoil cannot deform the painting or reposition its arms.

Open http://localhost:2567/sprite-parts.html to inspect the sprite, switch weapons or select **Soldier only**. The former puppet controls and old aiming layers are removed from this page. `cutin.json` has `staticPose: true`, one character layer, a separate gun entry, no puppet, no mirrored pose and no old world-aim sprite. Persistent aiming displays this static painting at the lower-left, matching the supplied screenshot; tactical field sprites are unchanged.

## Source and rebuild

- Source painting: `tools/art/sprites/ranger-01/source/backshot-static-reference-remake.png`.
- User pose reference: `source/static-backshot-pose-reference.png` in the same folder.
- Gun registration and provenance: `tools/art/sprites/ranger-01/static-backshot.json`.
- Rebuild: `node tools/art/build_static_backshot.mjs`, then `node tools/art/build_parts_sheet.mjs`.
- Blender reference: `tools/art/sprites/ranger-01/ranger-static-backshot.blend`. Three gun scenes each use the same single soldier plane, with zero armatures or shape keys. Regenerate gun projections with `node tools/art/export_static_backshot.mjs`, then call `tools/art/blender/static_backshot.py → build()` through Blender MCP.

The full previous right arm (upper arm, forearm, glove and finger fragment) was captured through Blender MCP for inspection before the redraw. It was not reused in the final painting. The connected Blender scene had no armature to extract.

## Retired work

Previous `aim-*` and `world-aim-*` textures were moved out of the public game assets into `tools/art/archive/ranger-puppet/`, together with a snapshot of their manifest and formula. They are historical fixtures for the legacy renderer's tests, not selectable game sprites. The old bake/seed/apply commands refuse to overwrite the new static manifest. The archived puppet's known elbow diagnostic is retained in regression coverage; it is not a shipping art check.

Check the active replacement with `node --test client/src/render/kit/static-backshot.test.js`, then `npm run build`. The six enemy packs and tactical field animations are unaffected by this replacement.

## Shoulder alignment and aiming HUD (2026-10-30)

`rig.gunView.projection: shoulder` uses a perspective camera and a rigid transform of the gun. The stock is pinned at `rig.stock` in the painting. The barrel axis, including its height above the stock, intersects the aim ray at target depth. It is not aligned using the diagonal from stock to muzzle. `CutInDirector` supplies the live crosshair in sprite coordinates, so the same alignment works at other aspect ratios; the painting is never deformed. The gun preserves its native metre scale. The sprite is width-limited on narrow screens and remains attached to the bottom edge.

The current 3D alignment source is `tools/art/sprites/ranger-01/ranger-shoulder-alignment.blend`. Rebuild it by running `node tools/art/export_static_backshot.mjs`, then `tools/art/blender/shoulder_alignment.py → build()` through Blender MCP. It contains metre-space gun meshes, a perspective camera, the unchanged soldier card, and shoulder/muzzle/target markers. `shoulder-blender-audit.json` records independent Blender projection and bore checks. The older `ranger-static-backshot.blend` is the previous flattened layout reference.

Aiming uses one circle sized from ballistic angular spread (bounded to stay visible and fit the screen), with distance below it. There are no pellet dots, aim lines, hit percentages, range bands, or spread text. Ammunition and controls live at the screen edge. Firing suppresses tactical HUD, captions, letterboxing and character slide/scale animations; its circle uses the shot's spread. Tactical controls return on leaving aim.

Validation: `node --test client/src/render/kit/shoulder-alignment.test.js`. See `docs/AIMING-HUD-AUDIT.md` for the visual audit and scope.

Shotgun/sniper rear-stock correction: `gunStockDrop` in `SpriteWeapon.js` drops the rear 45/55 mm, tapering to
zero at the receiver. Forward barrel vertices and the bore transform stay fixed. `lowerGunRearGeometry` clones
geometry per instance; `stock-drop-audit.json` and the exported layout record the lowered physical stock.
The original Blender shoulder file predates this correction; the updated export/rebuild scripts include it.
