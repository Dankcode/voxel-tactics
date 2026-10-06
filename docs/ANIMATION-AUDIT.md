# Animation audit and skeleton (2026-10-06)

What vibe-game already had for character animation, what this repo carries over, and the skeleton you fill in.
Originals are kept unmodified for reference in `docs/reference/vibe-game/` (not imported by the game).

## 1. Audit of vibe-game

| File | What it does | Verdict for Voxel Tactics |
|---|---|---|
| `client/src/entities/PlayerAvatar.js` (593 lines) | Billboard plane, 8 × 4 atlas (96 × 128 frames), **4 directions** (S/W/E/N), walk cycle only (frame 0 when idle), canvas-drawn fallback (`drawAnimeFrame`), visual position smoothing, an **occlusion silhouette** (additive material with `GreaterDepth`, shows the avatar through walls). | Movement smoothing and the silhouette idea are worth porting (TODO below). The 4-direction, walk-only state machine is replaced by `SpriteAnimator` (8 facings, any clip). |
| `client/src/rendering/CharacterSpriteBaker.js` | Bakes a modular low-poly 3D rig (sockets: legs, chest, head, off-hand, weapon) into a foot-anchored 4-direction × 8-frame walk atlas at runtime. | A real option for production art: bake our 8 facings × all clips from a 3D rig instead of drawing them. Only walk is keyed today. |
| `client/src/entities/PlayerGirl2.js` | Separate body + head `THREE.Sprite`s from TexturePacker sheets (`body-2-walk`, `head-2-walk`), flipX mirroring. | References `assets/sprites/body-2-walk.png`, which is not in `client/public` (only the `.json`/`.tps` exist) — a dead path. `THREE.Sprite` always faces the screen and does not depth-sort well against voxels; Voxel Tactics uses vertical quads with alpha test instead. |
| `client/src/combat/EventPlayer.js` | Queue of encounter events with durations from `shared/combat/Presentation.js`; moves views along paths, flies a projectile sphere, DOM floating text; optional `playDeath()` hook. | Its successor is `client/src/anim/EventPlayer.js` (async, ordered, drives clips, cut-ins, chunk rebuilds, debris). |
| `client/src/rendering/SpriteLayer.js` (PLAN 21) | Depth sprites: colour + baked depth (`ndd` texture) composited into the depth buffer so a 2D image sorts like a mesh. Built for buildings. | The right long-term technique for **characters** too (correct overlap with railings, doorframes, foliage). Not used yet; TODO. |
| Leon's PSDs `client/assets/sprites/body-gp/`, `head-gp/` | Body walk in **N, NW, S, SW, W** × 8 frames (43 × 92 PNG) + PSDs for attack (2 dirs), attacked, fall (2 dirs), idle, sit; head-gp-2 (15 frames). | Matches this repo's "5 drawn + 3 mirrored" facing plan. Missing for tactics: aim, fire, throw, hunker, stacked, down, and the **back-shot illustrations**. |

## 2. The contract (what the client reads)

Per character `client/public/assets/characters/<art>/`:

- `field.json` + `field.png` — the field atlas. Rows are screen-relative facings `["s","sw","w","nw","n","ne","e","se"]`
  (`s` faces the camera). `clips` maps a clip id to `{ column, frames, fps, loop }`. `anchor` is the foot point
  (0..1 of the frame), `worldHeight` is the quad height in voxels, `events` keys frame events (`fire` → `muzzle`).
  `mirror` is reserved for drawing 5 facings and mirroring 3.
- `cutin.json` + `cutin/*.png` — the back shot. Ordered layers (`back`, `body`, `arm`, `fx`), each with a
  `parallax` factor and optional CSS `blend`. `screenHeight` is the fraction of viewport height.
- `portrait.png` — 128 × 128 HUD portrait.

Replace PNGs and edit the JSON; no code changes are needed while clip ids stay the same.
`tools/art/make_placeholders.py` regenerates the placeholders (and documents the layout in code).

Placeholders v2 (2026-10-06): frames are 128 × 192 (was 64 × 96), drawn as vector shapes at 4× and shaded as
soft volumes (key light upper-left, rim light, thin dark edge), so they read as smooth illustrated units rather
than pixel art. The atlas is sampled with linear mip-mapped filtering and casts a sun shadow through its alpha.
Body proportions, helmets / hoods / caps, shields, capes, robes and weapon silhouettes differ per character.

## 3. The skeleton (files and TODOs)

| File | Implemented | TODO |
|---|---|---|
| `client/src/anim/AnimationClips.js` | Clip list, battle-event → clip map, hold times | `resolveClip()` per-weapon/ability overrides; `onClipFrameEvent()` muzzle flash, casings, footstep dust |
| `client/src/anim/SpriteAnimator.js` | Frame playback, loop/one-shot, `next` chaining, fallbacks for missing clips, 8-facing row from camera angle | `mirror` (flip U for 3 facings), blending/crossfade, upper/lower body layering, per-frame anchors, root motion |
| `client/src/units/UnitView.js` | Vertical quad (depth-tested), sun shadow through the alpha, contact shadow, ground ring, segmented HP pips + AP + stress, selection | Occlusion silhouette (port from PlayerAvatar), depth sprites (SpriteLayer technique), death fade, status icons, lighting the sprite (normal-mapped sprites) |
| `client/src/anim/CutInTimeline.js` | Keyframed tracks with easing; presets per kind (shot, burst, heavy, melee, throw, breach) | Per-character authored timelines (JSON), sound cues |
| `client/src/anim/CutInDirector.js` | DOM layered back-view with parallax, letterbox, flash, caption (name + hit %), group layout for breaches, skip, Always/First/Off modes | Per-layer animation (cape sway, recoil on the arm layer), video/Live2D layers if wanted |
| `client/src/anim/CameraDirector.js` | Over-the-shoulder perspective camera with a dolly, actor hidden during the shot | Per-kind rigs (low angle, tracking throws), wall collision, depth of field |
| `client/src/anim/EventPlayer.js` | Ordered playback of every battle event: walk, fire + tracers, throw arcs, explosions, debris, collapse, falls, floats, alerts, reveals, turn banners | Projectile art per weapon, impact decals, ragdoll-ish falls, speed curve per event |
| `client/src/render/Fx.js` | Tracers, flashes, explosion spheres, voxel debris, flame cones and smoke puffs mirrored from the element field | Particle sprites, element-specific VFX (ice crystals, water splash, wind lines) |

## 4. Art list for a first real character

1. Field atlas: 9 clips (`idle 2`, `walk 4`, `aim 1`, `fire 2`, `throw 2`, `hit 1`, `down 1`, `stacked 1`, `hunker 1`)
   × 5 drawn facings (mirror the other 3 once `mirror` is implemented), 128 × 192 per frame (any size works —
   set `frameWidth` / `frameHeight` / `anchor` in `field.json`).
2. Back shot: 4 layers at 512 × 768 (or larger, same aspect): back/cape, body, arm + weapon pointing upper-right, fx glow.
3. Portrait 128 × 128.
