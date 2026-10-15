# PLAN-08 · A 3D gun in the 2D back shot

Status: **planned, waiting for Leon's approval** (2026-10-15). Planned read-only against `main` at `d1f182b`; the
working tree also holds Leon's uncommitted audio work (`Game.js`, `EventPlayer.js`, `Hud.js`, `package.json`,
`client/src/audio/`). Only the gun **assets** (§4.0) were produced in this session; no game code has changed.

## 1. Goal

While a soldier aims, and in the committed cut-in, the back-shot sprite holds the soldier's **real gun**. This gun is a
low-poly 3D model built from the equipped weapon and its attachments, drawn as a live layer between the 2D body and
the 2D hands:

1. The gun model shows the loadout: the gun family (AR, sniper, shotgun for now), plus a scope and a precision
   barrel when they are fitted.
2. When the aim moves, the gun swings toward the crosshair first, with weight: it trails a fast move, overshoots a
   little and settles. The 2D sprite bends after it, using the existing lean/bend spring.
3. In the committed cut-in, the muzzle of the actual gun lands on the crosshair. With a long barrel that tip is
   further out than the painted one.
4. Characters stay 2D. The gun is the only 3D asset.

## 2. Non-goals

- No 3D characters. (The Blender soldier experiment was cancelled and removed.)
- No new 2D character art in this plan. The 2D sheet remake was cancelled. The only art step is splitting the
  existing back-shot illustration into layers (§4.2, decision D1).
- The field atlas keeps its painted chibi rifle; field sprites do not change.
- No rules or balance changes. Attachment stats stay in `weaponBuild()`, and this plan only shows them.
- No new attachments (lasers, grips, red dots). The kit is built so they can be added as new parts later.
- No pistol, suppressor or AK magazine for now (Leon, 2026-10-15: "only make the shotgun, sniper and AR"). The
  sidearm, carbine and AK fall back as listed in §4.1.

## 3. Current evidence

| Area | What the code does now | File |
|---|---|---|
| Aiming back shot | `beginAim(unit,{shoulder})` builds `.figure` with one `<img>` per `cutin.json` layer. `placeAim({x,y})` runs every frame from the reticle. The figure is static in the bottom-left corner (`aimBackshotLayout`). It leans and bends after the crosshair through a critically damped spring (`followStep`, τ 0.2 s) and CSS `rotate()` / `skewX()` pivoting at the feet (`aimBackshotPose`). | `client/src/anim/CutInDirector.js` |
| Committed cut-in | `play(o)` places a single figure so that `cutin.muzzle` (the painted rifle's tip) sits on the projected aim point (`backshotPlacement`). Group cut-ins (breach) use the stacked layout. | `CutInDirector.js` |
| Art contract | `test-soldier/cutin.json` has one `body` layer (`backshot.png`, 653 × 435, gun painted in), `muzzle [0.995, 0.392]` and no `variants.left`. `sideCutin()` already swaps in a `variants.left` sprite. `loadCharacterArt()` forces `test-soldier` for every unit. | `client/public/assets/characters/test-soldier/`, `client/src/units/UnitView.js` |
| Loadout | `u.weapon` is the equipped id. `u.attachments[weaponId] = { scope, barrel }`. `weaponBuild()` reads them, and `w.scoped` is built in for `longrifle` and `shortbow`. Ids → names: `repeater` Assault Rifle, `musket` AK, `crossbow` Suppressed Carbine, `shortbow` Marksman, `longrifle` Sniper, `blunderbuss` Shotgun, `handcannon` Sidearm, `firelance` Flamethrower. | `shared/inventory/Equipment.js`, `shared/battle/FireControl.js`, `shared/content/weapons.js` |
| Call sites | `Game.frameAim` / `Game.stepAim` call `cutins.beginAim(u,{shoulder})` with `this.mode.weaponId` in scope. `AimReticle` calls `placeAim`. `EventPlayer.js:57` calls `cutins.play({...})` with `e.weaponId` on shot events. | `client/src/Game.js:768,784`, `client/src/ui/AimReticle.js:15`, `client/src/anim/EventPlayer.js:57` |
| 3D in the client | three `^0.183.2`; `GLTFLoader` is already used by `KitLibrary`. | `client/src/render/kit/KitLibrary.js` |
| Tests pinning behaviour | `backshot.test.js`: the muzzle lands on the crosshair, the static bottom-left layout, lean/bend limits, the follow spring, `sideCutin`. | `client/src/render/kit/backshot.test.js` |

## 4. Design

### 4.0 Assets (delivered in this session)

Each gun is built on a reference model Leon supplied, never from scratch. Every part is rebuilt as a very low-poly
**UV relief** by depth analysis, because the gun is only ever seen small. Real-world scale comes from published
specs: the M5 SCW is about 0.705 m with a 10.3" barrel; the L118A1 (AI Arctic Warfare family) is 1.18 m with a
26"/660 mm barrel; the Mossberg Maverick 88 Security is about 1.02 m with an 18.5–20" barrel.

| Gun | Reference | Kit parts |
|---|---|---|
| AR | Low-poly Colt M5 SCW (`m5-scw.blend`) | `body_rifle` (lower, upper, grip, stock, trigger, handguard); `barrel_std` (10.3" barrel + flash hider, cut at the handguard so the hidden part is gone); `barrel_long` (precision, stretched 1.45×); `sight_irons`; `mag_rifle` (PMAG). The small controls and the bolt are dropped. |
| Scope | The L118A1's own scope, at 0.75 scale (the M5 has no optic) | `optic_scope`, seated on the AR's flat-top. The shotgun uses the same node moved by `scopeOffset.shotgun`. |
| Sniper | Low-Poly L118A1 (`l118a1.usdz`) | `body_sniper`, with its own scope |
| Shotgun | Pump shotgun (`shotgun/shotgun.obj`), coloured from its reference photo through the model's UVs (wood-coloured photo background is rejected) | `body_shotgun` |

How each part is built:

1. **Scan**: orthographic ray casts from the right and left sides at 2 mm per texel give the silhouette, both
   surface depths, and a baked side texture. The texture uses the reference material colour, or the reference
   texture, with light and ink.
2. **Clean**: holes under 60 texels (slots, screws) are filled; the trigger guard, thumbhole and stock cut-outs
   stay. Both depth maps are smoothed, and the surfaces can never cross.
3. **Relief**: silhouette samples, a bevel ring of samples 3 texels inside the outline, depth-step samples and a
   sparse interior are triangulated (Blender's CDT). The two sides meet at the outline with separate normals, which
   gives even shading. The mesh runs 2 texels past the outline and the texture alpha (glTF `MASK`) cuts the exact
   edge.

| File | What |
|---|---|
| `client/public/assets/weapons/gun-kit.glb` | One `Gun` node with parts `body_rifle` (660 tris), `barrel_std` (48), `barrel_long` (149), `sight_irons` (81), `mag_rifle` (140), `optic_scope` (155), `body_sniper` (927) and `body_shotgun` (653), plus empties `muzzle_std`, `muzzle_long`, `muzzle_sniper` and `muzzle_shotgun`. One material (alpha-masked atlas, 1024²); 225 KB. **Per loadout: AR 929 tris, AR + scope 1,003, AR + scope + precision barrel 1,104, sniper 927, shotgun 653, shotgun + scope 808.** |
| `client/public/assets/weapons/gun-kit.json` | Anchors in gun space (metres, Blender axes: +Y muzzle, +Z up, +X right, origin = the firing hand's grip): `grip`, `support` per body, `muzzles`, `bores`, `scopeOffset` per body, triangle counts, reference names. |
| `tools/art/blender/gun_kit.py` | The whole pipeline (load references, kitbash, scan, relief, atlas, export). It runs in Leon's Blender 5.2.1 over the MCP in about 2 s with byte-identical output, and removes everything it created. It also runs as `blender -b -P tools/art/blender/gun_kit.py`. |
| `output/reference/` | `m5-scw.blend`, `l118a1.usdz`, and `shotgun/` (obj, mtl, photo), kept **outside git** until their licences are confirmed (D5). |
| `docs/gun-kit-contact-sheet.png` | Six loadouts rendered with three.js from the GLB, side and three-quarter views. |

### 4.1 Which parts show: `gunParts()`

`client/src/anim/GunKit.js` is a pure module, testable in node:
`gunParts(weaponId, mods = {}, { scoped }) → { parts, muzzle, body } | null`.

| Weapon | Kit | Barrel | Sight |
|---|---|---|---|
| `repeater` (Assault Rifle) | `body_rifle` + `mag_rifle` | `barrel_long` if `mods.barrel`, else `barrel_std` | `optic_scope` if `mods.scope`, else `sight_irons` |
| `shortbow` (Marksman) | `body_rifle` + `mag_rifle` | `barrel_long` | `optic_scope` (built in) |
| `musket` (AK), `crossbow` (carbine) | the AR kit for now (no AK mag, no suppressor yet) | as `repeater` | as `repeater` |
| `longrifle` (Sniper) | `body_sniper` (its own scope) | built in | built in |
| `blunderbuss` (Shotgun), `firelance` | `body_shotgun` | built in | `optic_scope` if `mods.scope`, moved by `scopeOffset.shotgun` |
| `handcannon`, melee, throwables, none | `null`: no 3D gun, and the `flat` art is shown | | |

### 4.2 Art contract: layers around a gun slot

`cutin.json` (and `variants.left`) gains these fields. Old files without them keep working unchanged.

```json
{
  "layers": [
    { "id": "back",  "image": "cutin/aim-back.png" },
    { "id": "gun",   "gun": true },
    { "id": "front", "image": "cutin/aim-front.png" }
  ],
  "flat": "backshot.png",
  "gun": { "grip": [0.773, 0.487], "support": [0.900, 0.409], "into": 40, "roll": 0, "fov": 40 },
  "muzzle": [0.995, 0.392]
}
```

- **back**: the illustration with the painted gun removed and the body behind it filled in.
- **gun**: where the 3D gun canvas goes in the draw order.
- **front**: what sits on top of the gun: the hands that wrap it, and the head and hair where the stock meets the
  cheek.
- **flat**: the untouched illustration. It is used wherever no 3D gun is drawn: group cut-ins, melee,
  WebGL unavailable, or art without a `gun` slot.
- **gun.grip / gun.support**: where the firing hand holds the pistol grip and where the support hand holds the
  handguard, as fractions of the art. The values above were measured on the current `backshot.png`.
- **gun.into**: how far the barrel points into the screen. The Arma reference is about 40°.
- **gun.roll**: cant. **gun.fov**: the camera the gun is projected with.

Splitting `backshot.png` into `back` and `front` is the one art step. Decision D1 settles who does it.

### 4.3 Placing the gun in the hands: `solveGunPose()`

This is a pure function in `GunKit.js`. The camera sits at the origin and looks along −Z (three.js camera space),
with vertical FOV `gun.fov` and an image of `width × height` (the art box).

1. Cast a ray through each anchor pixel: `r_g` for the grip and `r_s` for the support.
2. Put the grip point at `P = t · r_g`. The support point must lie on `r_s` at distance `L = |support − grip|`
   from `P`, which solves a quadratic. Take the far root, so the gun points into the scene.
3. Pick `t` by bisection so that the angle between `S − P` and the image plane equals `gun.into`.
4. Build the rotation: the kit's grip→support direction maps to `S − P`, and gun +Z goes as close as possible to
   screen-up rotated by `roll`.
5. Return the camera-space matrix composed with the Blender→glTF basis change, so it applies directly to the GLB
   node. Also return the projected muzzle of any part set, for the committed cut-in.

### 4.4 Drawing it: `GunModel` + `GunOverlay`

- **GunModel** (`client/src/anim/GunModel.js`):
  - loads `gun-kit.glb` once and caches the promise;
  - `assemble(sel)` clones `Gun` and shows the selected parts;
  - swaps materials to `MeshToonMaterial` (3-step gradient, same base colours) plus a thin dark ink outline (a
    back-face hull pushed out about 1.5 px in clip space), so the gun sits with the anime line art (D3);
  - adds a hemisphere light and a key light from the upper left, matching the illustration.
- **GunOverlay** (`client/src/anim/GunOverlay.js`):
  - **one shared** `WebGLRenderer` (alpha, antialias, pixel ratio ≤ 2) whose canvas is moved into the active
    `.figure` at the `gun` slot, sized to the figure box;
  - `PerspectiveCamera(gun.fov, art aspect)`;
  - renders only when the pose, size or parts change;
  - if creating the WebGL context fails, the director falls back to `flat`.
- Because the canvas is a child of the figure, the existing CSS lean and bend carry the gun with the body. The
  gun's own swing (§4.5) is added on top of that.

### 4.5 Motion: the gun leads, the sprite follows

There are two springs on the same crosshair:

| Spring | Behaviour | Drives |
|---|---|---|
| Body | Unchanged: `followStep`, critically damped, τ 0.2 s | Lean and bend of the whole figure (CSS) |
| Gun | New: underdamped, ω ≈ 14 rad/s, ζ ≈ 0.55. ω is scaled by gun weight with the same ratio as `aimTau(u, w)`: the AR is fastest, the sniper slowest | Gun yaw/pitch about the grip pivot |

`gunAimPose(gunLag, gunVel, neutral, view, weight) → { yaw, pitch, roll }`:

- **Aim term**: the gun turns toward the lagged crosshair's offset from the neutral point (screen centre), up to
  ±12° yaw and ±8° pitch.
- **Drag term**: the spring velocity tips the muzzle against the motion. A fast flick trails, overshoots by under
  15 % and settles in under 0.6 s.
- **Settings**: with *Aim inertia* off, the gun follows without overshoot, like the reticle does.

### 4.6 Committed cut-in

- For an aligned single figure, `play()` assembles the shooter's gun from `e.weaponId` and the unit's attachments.
  It then places the figure so the **projected muzzle of that gun** lands on the crosshair, with `cutin.muzzle` as
  the fallback.
- On the timeline's flash peak, the gun kicks: pitch +4° and 2 cm back, recovering over 80 ms. A small additive
  flash sprite shows at the muzzle node.
- Group cut-ins and melee keep `flat`.

### 4.7 Integration points (minimal touch on files with uncommitted work)

- `CutInDirector.beginAim(unit, { shoulder, weaponId = unit.weapon })` and `play({ ..., weaponId })`.
- `Game.js`: the two `beginAim` calls add `weaponId: this.mode.weaponId`. That is a one-argument change at lines
  768 and 784.
- `EventPlayer.js:57`: add `weaponId: e.weaponId`.
- `endAim()` detaches the canvas but keeps the renderer. `Game.exitToMenu` disposes it.

## 5. Files

| File | Change |
|---|---|
| `client/src/anim/GunKit.js` (new) | `gunParts`, `solveGunPose`, `projectPoint`, `gunAimPose`, `gunSpringStep` (pure) |
| `client/src/anim/GunModel.js` (new) | GLB load and cache, assembly, toon + ink materials |
| `client/src/anim/GunOverlay.js` (new) | shared renderer, canvas in the figure, render on demand, fallback |
| `client/src/anim/CutInDirector.js` | gun slot in `beginAim` / `placeAim` / `play`; `sideCutin` also carries `gun` / `flat` |
| `client/src/Game.js`, `client/src/anim/EventPlayer.js` | pass `weaponId` (one argument each) |
| `client/public/assets/characters/test-soldier/cutin.json` + `cutin/aim-back.png`, `cutin/aim-front.png` | contract fields and split layers (per D1) |
| `client/src/render/kit/gunkit.test.js` (new), `backshot.test.js` | tests (§7) |
| `docs/ANIMATION-AUDIT.md`, `docs/TACTICAL-LOADOUT.md`, `docs/RENDERING.md` | contract, visible attachments, how to add a part |

## 6. Steps (one commit each, test first)

0. **Assets**: done in this session (§4.0).
1. **`gunParts`**: tests cover every row of §4.1, attachment combinations, and `null` for the sidearm and melee.
2. **`solveGunPose` / `projectPoint`**: the projected grip and support land on their anchors (±0.5 px), the barrel
   angle equals `into` (±0.5°), the gun points away from the camera, and the result is deterministic.
3. **Gun spring + `gunAimPose`**: overshoot is under 15 %, settling takes under 0.6 s, limits hold, inertia-off
   gives no overshoot, and a heavier gun is slower.
4. **Contract**: `cutin.json` gets `layers` with a `gun` slot plus `flat` and `gun`. `sideCutin` carries them, and
   old cutins without a slot load as before. `backshot.test.js` is updated, and the muzzle test uses `flat` /
   `muzzle`.
5. **GunModel + GunOverlay**: a node test checks part visibility on a stub scene; the rendering is checked in the
   browser.
6. **Director integration** (aim and committed cut-in), plus the `weaponId` arguments in `Game` / `EventPlayer`.
   This lands after Leon commits his audio work, or on top of it with only those lines touched.
7. **Art split** for `test-soldier` (D1). `variants.left` follows when its art exists (D4).
8. **Docs**, then the full `npm test`, then the browser check (§7).

## 7. Tests

- New `gunkit.test.js` (steps 1–3), in `test:fast`. A node test also loads `gun-kit.json` and checks that every part
  `gunParts` can return exists in `gun-kit.glb`.
- `backshot.test.js`: the existing guarantees still hold (static corner, lean/bend limits, follow spring, no
  mirroring). The muzzle-on-crosshair test runs for `flat`, and for the 3D muzzle via `solveGunPose`.
- Browser check:
  - AR with irons, then add a scope and a precision barrel, and the gun changes;
  - a sniper and a shotgun;
  - the sidearm falls back to flat;
  - flick the aim left and right: the gun trails, overshoots and settles, and the body bends after it;
  - *Aim inertia* off;
  - the committed shot puts the barrel tip on the crosshair, with a kick on fire;
  - a breach cut-in stays flat;
  - a phone-sized window.

## 8. Risks

| Risk | Mitigation |
|---|---|
| A second WebGL context, since mobile caps contexts | One shared renderer, created lazily and reused. If the context fails, the director draws `flat`. |
| Frame cost | A canvas the size of the figure (≤ 42 % of the width), rendered only on change, with about 1k visible triangles. |
| The 3D gun looks off against the anime art | Toon ramp, ink outline and art-matched light (D3). The look stays a material swap, so changing it later is cheap. |
| The hands do not match every gun (the long sniper) | Anchors are per art, and the support point is per body (`gun-kit.json`). |
| The reference models' licences are unknown | They stay out of git (D5). The shipped GLB is a heavy derivative, but attribution may still be needed. |
| Layer-split quality (the body behind the painted gun) | D1. Until the split exists, the art has no `gun` slot and `flat` shows, so nothing breaks. |
| Leon's uncommitted edits in `Game.js` / `EventPlayer.js` | Only one argument changes in each file, applied to his working copy without reformatting. |

## 9. Rollback

Steps 1–3 are pure modules with no callers. Step 6 is the only behaviour change: revert it and the director draws
the art exactly as today. Removing the `gun` slot from `cutin.json` also turns the 3D gun off without a code change.

## 10. Decisions for Leon (defaults in bold)

| # | Question | Options |
|---|---|---|
| D1 | Who splits the back-shot art into `back` (gun removed) and `front` (hands, head) | **Leon or an artist paints the two layers from `backshot.png`** / a scripted polygon split plus fill (fast, but the fill behind the gun is rough) / interim: draw the 3D gun over the painted one, posed to match it at rest |
| D3 | 3D gun look | **Toon ramp + ink outline** / plain PBR as exported |
| D4 | Left-peek sprite (`variants.left`) | **Later, when its art exists, in the same bottom-left spot** / build it from the existing kneeling illustration / place it bottom-right as in the XCOM 2 reference (this changes the "never moves" rule) |
| D5 | Licences of the three references (M5 SCW `.blend`, L118A1 `.usdz` exported from Sketchfab, shotgun `.obj` + photo) | **Leon confirms each source and licence; credits go in `PROVENANCE.md`** / replace any reference that can't be cleared before shipping |
