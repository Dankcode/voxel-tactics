# PLAN-17: Puppet depth layering, clipping masks, pose linter and angle-keyed art swaps

Status: **proposed — awaiting approval. No code changed.**

## Request

> The aiming pose is still incorrect and needs to be reworked, the layers are overlapping and anatomically
> incorrect, we need to implement new tools into this to solve the problem.

Chosen tools (2026-10-29): depth-sorted layering + clipping masks, pose linter + overlay, angle-keyed art swaps.
Not chosen: a 3D arm skeleton driving the puppet. Anatomy stays authored by hand; the linter polices it.

## Goal

The over-the-shoulder Ranger aim pose (`cutin.json`, perspective `gunView`) reads as one correct body for rifle,
sniper and shotgun at every sway/recoil corner:

- The left (support) arm is hidden behind the torso and pack except for the glove on the handguard.
- The right (trigger) elbow hangs down and out beside the body, not across the pack.
- A sleeve can pass behind the receiver at the hand and in front of it at the elbow; no fixed whole-part order.
- A sleeve pointing into the scene switches to foreshortened art instead of a squashed side-view tube.
- Problems are caught by a linter in the workbench and in `node --test`, not by eye after export.

## Non-goals

- No 3D character, armature, auto-weighting or runtime IK (the existing "no IK" rule in `SpritePuppetRig.js` stays).
- No change to gameplay, aim input, `AimController` sway limits or the cut-in timeline.
- The world pose (`worldAim`, side view, orthographic) keeps working unchanged; it only gains the linter.
- Gun shading/size in the 3P view (pale toon shading) is a separate finding below, not part of this plan.
- Painting the new foreshortened sleeves. This plan ships the swap mechanism, a placeholder and the painting brief.

## Current evidence (workbench, rifle, commit 2fc5f7e)

1. Shoulder anchors: trigger `S [0.505, 0.565]`, support `S [0.465, 0.525]` (kept from the side view). Both sit on the
   right shoulder, so the support sleeve emerges beside the trigger sleeve and crosses the back in front of it.
2. Seeded trigger elbow `[0.4015, 0.7897]` lies over the backpack. `seed_aim_3p.mjs` picked the "lower" two-bone
   solution; with the shoulder on the right edge that solution points across the body. (Claude's seed, to be replaced.)
3. Draw order is one integer per whole part (`layerZ`: support-upper 10, body 20, support-hand 30, trigger-fingers 35,
   gun 40, trigger-hand 50, support-fingers 55, support-forearm 60, trigger-upper 70, trigger-forearm 80). The gun is
   drawn in a separate pass between `backScene` and `frontScene`, so a sleeve cannot be partly behind it.
4. Sleeves are side-view paintings. The ribbon warp (`warpPuppetPoint`) only maps the painted segment onto the
   projected one, so foreshortening shows as a stretched/squashed tube.
5. Existing tests check contacts, mesh folding and interpolation; none checks stretch, elbow direction, occlusion or
   overlap, so 32/32 tests pass on the broken pose.

## Design

### 1. Puppet schema v2 (authored in the workbench, applied with `apply_puppet.mjs`)

```jsonc
{
  "version": 2, "technique": "authored-2d-warp", "meshDivisions": 32, "range": {...},
  "keyforms": { "rifle": { "trigger": {
      "shoulder": [u, v], "elbow": [u, v], "upper": {...}, "forearm": {...},
      "depth": { "shoulder": 0.62, "elbow": 0.70 },                // metres from the gun camera
      "parameters": { "aimX": { "negative": [du, dv], "positive": [du, dv],
                                "depthNegative": [ds, de], "depthPositive": [ds, de] }, ... } } } },
  "layers": {                                                       // per layer id, all optional
    "body":            { "depth": 0.85 },                            // or "depthMap": "aim-body-depth.png"
    "support-upper":   { "clip": { "by": ["body"], "mode": "outside" } },
    "trigger-forearm": { "swaps": [ { "image": "aim-trigger-forearm-fs.png", "foreshorten": [0, 0.75], "blend": 0.08 } ] }
  }
}
```

- Wrist/palm depths are **not authored**: they come from the projected gun contacts (camera-space depth of the grip
  and support points), so gloves always sit at the gun's real depth.
- Depth is interpolated shoulder → elbow → wrist along each ribbon (per vertex, from the ribbon parameter `t`).
- v1 manifests stay valid: no depth means legacy pass order; `validatePuppet` accepts v1 and v2.

### 2. Depth-sorted rendering (`SpriteWeapon.js`)

- One pass with a shared depth buffer instead of back/gun/front passes. Cards keep the flat orthographic camera for
  x/y but write `gl_FragDepth` converted from their metric depth into the **gun camera's** perspective depth
  (same near/far), so the gun and the painted cards depth-test per pixel.
- Two sub-passes for soft painted edges: alpha ≥ 0.5 writes depth (opaque core), then edges blend with
  `depthWrite:false, depthFunc:LEQUAL`. Same-depth ties fall back to `layerZ`.
- Legacy (orthographic / v1): unchanged three-pass path.

### 3. Clipping masks (Live2D-style)

- `clip.by` lists mask layers; `mode: inside | outside`. Masks render their alpha into stencil bits (≤ 8 masks);
  clipped layers stencil-test against them. Used to keep the support arm visible only outside the torso silhouette.
- Requires `new WebGLRenderer({ stencil: true })` (three's default is off).

### 4. Angle-keyed art swaps

- `foreshorten = projected segment length / painted segment length` (computed per frame per sleeve).
- A layer's `swaps` pick an alternative painting (with its normal and light-response maps) inside a ratio band;
  `blend` crossfades across the band edge so there is no pop. Same mesh, same warp; only textures change.
- Placeholder until paintings exist: the current sleeve with a shortened source segment (so the mechanism is testable).
- Painting brief added to `tools/art/sprites/ranger-01/remake-prompts.json`: trigger upper arm seen from behind with
  elbow out, trigger forearm receding into the scene (short, cuff toward camera), support glove-only fragment.

### 5. Pose linter (`client/src/anim/PuppetLint.js`, CLI `tools/art/lint_puppet.mjs`)

Runs for each weapon × pose (close-up, world, mirrored) at neutral and every parameter corner (yaw ±, pitch ±,
recoil, and the four yaw/pitch diagonals). Geometry rules are pure functions (shared by workbench, CLI and tests);
pixel rules use the paintings' alpha (browser canvas in the workbench, `sharp` in node).

| Rule | Error when |
|---|---|
| `stretch` | projected/painted sleeve length outside 0.75–1.25 (warn 0.9–1.1) with no active swap covering it |
| `elbow-bend` | interior elbow angle < 25° or > 178° |
| `elbow-flip` | elbow changes side of the shoulder→wrist line between neutral and any corner |
| `elbow-side` | 3P trigger elbow on the torso side of the shoulder→wrist line (across the pack) |
| `contact` | palm off its gun contact by > 0.5 px, or cuff transparent at the contact |
| `shoulder-anchor` | a shoulder outside the torso alpha; support shoulder visible when its layer is clipped `outside` body |
| `depth-order` | a sleeve's depth is in front of the gun where it overlaps the receiver near the hand (should pass behind), or two sleeves overlap with depths within 1 cm (z-fighting) |
| `seam` | gap pixels at shoulder/elbow/wrist joints exceed the neutral pose's by > 40 px |
| `pop` | a layer's visible area changes by > 30 % between adjacent sample steps |

- Workbench: lint panel (list, click to jump to the failing weapon/corner and highlight the part), plus an
  **overlay**: the 3P blockout guide and ID masks (`output/rig-aim/3p/`, fitted to the card) as onion skin with an
  opacity slider, and a depth false-colour view.
- CLI: `node tools/art/lint_puppet.mjs [--json]` exits non-zero on errors; `apply_puppet.mjs` runs it and refuses to
  apply a rig with errors unless `--force`.

## Proposed files

| File | Change |
|---|---|
| `client/src/anim/SpritePuppetRig.js` | v2 schema, validation, depth interpolation, foreshorten ratio, swap selection |
| `client/src/anim/SpriteWeapon.js` | depth pass (`gl_FragDepth` in `paintedMaterial`), stencil masks, swap textures, `stencil:true` |
| `client/src/anim/PuppetLint.js` (new) | lint rules and corner sampler |
| `tools/art/lint_puppet.mjs` (new) | CLI with `sharp` alpha reads |
| `tools/art/apply_puppet.mjs` | accept v2, run lint, `--force` |
| `client/sprite-parts.html` | overlay, lint panel, depth/mask/swap editors, v2 export |
| `tools/art/sprite_formula.py` | carry `puppet.layers` (depth/clip/swaps) and swap images through the bake |
| `tools/art/export_aim_layout.mjs`, `tools/art/blender/aim_review.py` | export depth as card z and mask/swap info for the Blender review scenes |
| `tools/art/seed_aim_3p.mjs` | elbow choice uses the outside-of-body side; seeds depths from the 3P blockout |
| `tools/art/sprites/ranger-01/formula.json`, `client/public/assets/characters/ranger-01/cutin.json` | re-authored 3P keyforms + layers (via apply) |
| `tools/art/sprites/ranger-01/remake-prompts.json` | painting brief for the swap sleeves |
| tests: `sprite-puppet.test.js`, new `puppet-depth.test.js`, `puppet-lint.test.js` | see Tests |
| `docs/SPRITE-AUTHORING.md`, `docs/CHARACTER-SPRITES.md` | workflow, schema, lint rules |

## Ordered steps

1. Schema v2 + validation + v1 compatibility; depth interpolation and foreshorten ratio in `puppetPose` (tests first).
2. Linter geometry rules + corner sampler; CLI; wire into `apply_puppet.mjs`. Run it on the current rig and record the
   failures as the baseline (expected: elbow-side, shoulder-anchor, stretch, depth-order).
3. Depth-sorted rendering behind the v2 check; legacy path untouched.
4. Stencil clipping masks.
5. Art swaps runtime + placeholder + painting brief.
6. Workbench: overlay, lint panel, depth/mask/swap editors, v2 export.
7. Re-author rifle, sniper, shotgun 3P rigs in the workbench until lint is clean: support shoulder behind the torso
   with `clip outside body`, trigger elbow out beside the body, depths from the blockout, swaps on receding sleeves.
8. Blender review export with depth/masks; rebuild `ranger-puppet.blend`.
9. Docs; full `npm run test:fast` and `npm run build`; seed-1 downtown gameplay review.

## Tests

- `puppet-lint.test.js`: each rule fires on a hand-made bad rig and passes on a good one; the shipped rifle/sniper/
  shotgun close-up, mirrored and world rigs are lint-clean (this becomes the regression gate).
- `puppet-depth.test.js`: card depth → gun-camera depth conversion matches `Vector3.project` for points on the gun;
  wrist/palm depth equals the projected contact depth; v1 rigs render through the legacy path.
- `sprite-puppet.test.js`: v2 validation, swap selection hysteresis/crossfade at band edges, depth parameter
  interpolation continuity at neutral.
- Existing contact/fold/interpolation tests keep passing.

## Risks

- `gl_FragDepth` disables early depth rejection; the card is 768², so cost is small, but check mobile.
- Soft painted edges against the gun can halo; the two-sub-pass alpha split is the mitigation, tune the 0.5 cutoff.
- Stencil needs `stencil:true` on the sprite renderer; more than 8 masks would need a second scheme.
- Without a skeleton, depths are authored guesses; `depth-order` and the overlay catch the worst cases only.
- Until the foreshortened paintings exist, receding sleeves will still look approximate (placeholder swap).

## Rollback

v1 rigs keep the legacy path, so reverting `cutin.json`/`formula.json` to commit 2fc5f7e restores today's behaviour;
reverting this plan's commit removes the tools. `sideView` keeps the world pose independent throughout.

## Review findings (outside this plan)

- The rifle renders pale and small in the 3P view (toon ramp + sun direction tuned for the side view). Worth a
  separate pass on `SpriteGunMaterial.js` lighting once the arms are right.
- `seed_aim_3p.mjs` seeded the across-the-pack trigger elbow (evidence 2); step 7 replaces those keyforms.

## Acceptance checks

- `node tools/art/lint_puppet.mjs` reports 0 errors for rifle, sniper and shotgun (close-up, mirrored, world).
- Workbench screenshots at neutral and the four sway corners show: left arm hidden except the glove, trigger elbow
  outside the body, forearms behind the receiver at the hands, no stretched tubes.
- `npm run test:fast` and `npm run build` pass; the seed-1 downtown aim cut-in plays without visual pops.
