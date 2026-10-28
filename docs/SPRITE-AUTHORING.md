# Sprite authoring

The Ranger aiming pose uses a custom in-game 2D puppet inspired by VTuber workflows. It is not a Live2D Cubism model or SDK integration. The artwork stays on flat textured meshes; the gun retains its 3D model and original scale.

## Edit and export

1. Reuse `npm run dev` at port 2567; open `/sprite-parts.html`.
2. Choose rifle, sniper or shotgun and close-up or world view. Expand **Edit puppet mesh**. Drag S/E anchors or change the shoulder/elbow sliders. Sleeve bend and three width controls deform the mesh; **Show mesh** reveals its tessellation.
3. Under **Aim / recoil keyforms**, adjust elbow offsets at each parameter extreme. Use yaw, pitch and recoil to review the interpolation. Hands remain pinned to the gun, and the torso stays fixed. World-view edits are converted back into the same close-up coordinate system.
4. **Save locally** persists only the editor preview in this browser. **Export rig** downloads `ranger-puppet.json`. Apply it from the repository root:

   ```sh
   node tools/art/apply_puppet.mjs /absolute/path/to/ranger-puppet.json
   ```

   The command validates the schema, then updates the source formula and all runtime close-up, world and mirrored variants. It does not rebake or replace the paintings. Reload the game after applying.
5. **Reset rig** restores the version loaded from the game and removes the local draft. Part labels are saved separately; **Export labels** downloads them. The SVG sheet contains separate editable image and text elements; PNG is the flattened review sheet. Both sheets contain 34 entries, including world-pose and weapon-specific hand fragments.

The basic controls are intentionally bounded, but arbitrary combinations can still produce unattractive anatomy. Review the silhouette and hand contact for all weapons and both view sizes before applying a new rig.

## Sources and rebuilds

- `tools/art/sprites/ranger-01/formula.json`: source placement, painted part registration and active `poses.aim.puppet` keyforms.
- `client/src/anim/SpritePuppetRig.js`: parameter interpolation, sleeve warp and configuration validation.
- `tools/art/sprite_formula.py → bake_heroes()`: packs the existing torso, sleeve and glove paintings, normal/response textures and manifests. Run through Blender MCP. The current sleeve source is `aim-sleeves-v5.png`; it removes the false black elbow cuffs while retaining black wrist cuffs. Do not invoke the older `bake_field()` to rebuild the current four-frame player run.
- `node tools/art/build_parts_sheet.mjs`: regenerates the parts grid, SVG, PNG and catalog after an artwork bake.
- `node tools/art/export_aim_layout.mjs`, then Blender MCP `runpy.run_path('…/tools/art/blender/aim_review.py')['build']()`: writes `ranger-puppet.blend` with three weapon scenes, flat meshes and named aim/recoil shape keys. This is an editable review export. Blender vertex edits are not automatically imported into the game; transfer the desired shape into the workbench controls and export it there. The gun is a neutral reference mesh in Blender; the game applies its own gun material.

The active rig uses authored 2D projections. Historical `proportionAudit` lengths and `rig.arms` in the source record the painting's registration, not enforced anatomical bone lengths. No armature, auto-weighting or IK chooses the active elbows.

## Enemy redesign

`/enemy-sprites.html` previews six distinct Syndicate roles: gunman, lookout, arsonist, enforcer, guard and drone tech. Each pack includes eight directions, idle, two run drawings, aim, a settled down pose, portrait and baked aiming cut-in. `CharacterArt.js` maps existing gameplay art IDs to those packs; mechanics and player identity are retained. The drone tech has its own art ID.

Sources and crop definitions live under `tools/art/sprites/syndicate/`. Run `node tools/art/pack_enemies.mjs` to rebuild the packs and editable enemy lineup. Secondary actions currently reuse held poses; detailed throw, climb, hit and falling transitions need a later animation pass. Enemies retain baked weapon paintings rather than the Ranger's editable aiming puppet.

## References and verification

The separation of painted meshes, deformers and parameter keyforms follows the concepts in the official [Live2D deformer guide](https://docs.live2d.com/en/cubism-editor-manual/deformer/) and [warp deformer placement guide](https://docs.live2d.com/en/cubism-editor-manual/making-and-placement-of-warp-deformer/). Existing glove/weapon photo references and model scale references are recorded in [CHARACTER-SPRITES.md](CHARACTER-SPRITES.md).

Run the focused checks with:

```sh
node --test client/src/render/kit/sprite-puppet.test.js client/src/render/kit/enemy-sprites.test.js client/src/render/kit/ranger-sprites.test.js client/src/render/kit/world-aim.test.js client/src/render/kit/backshot.test.js
npm run build
```

The new puppet tests cover actual projected gun contacts, sleeve pins, mesh orientation at parameter corners, interpolation continuity and world configuration. The old IK tests cover the legacy fallback only. Use the shared downtown seed-1 baseline for gameplay review.
