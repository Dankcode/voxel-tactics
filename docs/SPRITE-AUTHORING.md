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
