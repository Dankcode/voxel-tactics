# Ranger sprite pack

The active human character is `ranger-01`. Field units, UI heads and the shooting pose use one original olive/tan ranger identity. The character is painted 2D artwork on flat cards; only the gun is a 3D model. Mechanical walkers retain their existing separate renderer.

Open the shared game at http://localhost:2567/?play=burger-district&seed=1 or the editable rig preview at http://localhost:2567/sprite-lab.html. Both use the same modules and asset files.

## Sprite contract

`client/public/assets/characters/ranger-01/field.json` describes a 4608×2048 atlas: 24 columns of 192×256 frames across eight facings. `sprite-list.json` enumerates all 192 frames with their source crop rectangles.

| Clip | Frames | FPS | Playback |
| --- | ---: | ---: | --- |
| idle | 2 | 2 | loop |
| run | 4 | 12 | loop |
| aim | 1 | 1 | hold |
| fire | 2 | 12 | return to aim |
| throw | 2 | 6 | return to idle |
| hit | 1 | 1 | return to idle |
| down | 4 | 8 | stumble → knee → side fall → settled; hold final |
| stacked / hunker | 1 each | 1 | hold |
| vault | 3 | 7 | return to run |
| climb | 3 | 6 | loop |

There is no exported walking clip. Rules/path edges still use the existing internal `walk` movement kind; presentation plays `run`. Downed playback never loops or returns to idle.

## Lighting and arm rig

Albedo PNGs preserve the cleaned source illustrations' colours, cel shading and thin line work. The exporter only cleans near-transparent alpha; it does not quantize colours or apply a majority filter, which previously muted the palette and erased outlines. The shooting pose uses independent `source/*-body-modular.png` and `source/*-arm-sections.png` paintings, styled after the retained `aim-flat.png` and `ready-flat.png` references. Field frames and portraits likewise retain their source colours. Directional illumination is confined to silhouette edges through separate normal and response maps: R = direct rim, G = unchanged painted base, B = ambient rim, A = coverage. A smooth inner band is six source pixels wide for shoulder cards and two pixels for field frames. Interior pixels have exactly R=0, G=1, B=0, preserving the painted colours and cel shadows. The mask follows alpha contours, not internal painted folds.

World lighting and received shadows affect only the edge bands. Shoulder rims use the live sun, hemisphere, back light, nearby point lights and camera orientation. Character materials bypass exposure/tone mapping so changing day/dusk/night cannot wash or darken their painted interiors. The 3D guns retain their normal full-surface lighting and exposure response.

Each pose now has a complete independently painted torso, two upper sleeves, two forearm sleeves, two gloves and an extra support-finger overlay. The torso is never produced by subtracting arm silhouettes: the chest, harness and side panels continue beneath the arms. `source/*-body-modular.png` contains the complete body; `source/*-arm-sections.png` contains separate complete parts with overlapping ends. The formula records each section's source rectangle and two joint anchors. The exporter places these sections without borrowing pixels from the torso or filling joints with capsule shapes.

Shoulders, elbows, wrists and gun sockets use full-frame UV pivots in `tools/art/sprites/ranger-01/formula.json`. Two-bone IK preserves segment lengths; glove sockets follow the actual projected gun grips. Hand rotation follows the projected stock-to-muzzle axis, so the lower pistol grip cannot twist the support hand. Its cuff stays below the barrel, with the palm behind the gun and curled fingers in front. A socket may be transparent because the gun occupies it; the exported cuff must remain opaque. Each section has its own normal and light-response maps. Gun sway is constrained to the joint workspace and recoil rotates around the seated stock. The rig regression sweeps 2,808 combinations of poses, supplied guns, mirrored sides, yaw, pitch and recoil; wrist seams stay below 0.01 source pixels, with no bone scaling.

**One sprite for aiming and firing.** The separate readying (side-on, gun-across-the-body) sprite was removed on 2026-10-16. The shooting pose, at the supplied rear-shoulder reference angle, is used both for the persistent aiming back shot and for the committed cut-in. The right shoulder is authored once; the left shoulder (`cutin.variants.left`, `sideCutin(cutin, 'left')`) mirrors the entire assembled sprite and gun, with light direction and pointer yaw corrected. The ready source paintings stay under `tools/art/sprites/ranger-01/source/` but are no longer baked (`formula.json` has only the `aim` pose; `cutin.json` has no `ready` key).

## Gun references and scale

`tools/art/blender/ranger_guns.py` assembles the supplied source meshes in their original relative positions, using one metre conversion for each whole source gun. It replaces the relief reconstruction in the active ranger composition. Every part has a reference role, original object names, source file, metre bounds and identity scale in `client/public/assets/weapons/ranger-preview/gun-kit.json` and glTF extras.

| Source assembly | Normalized length | Parts |
| --- | ---: | --- |
| Colt M5 SCW | 0.705 m | receiver, stock, trigger grip, handguard, magazine, barrel/muzzle, sights |
| L118A1 | 1.180 m | native body + native scope, one copy |
| Pump shotgun | 1.020 m | supplied unified mesh; stock/grip/foregrip/muzzle landmarks |

The colour-coded `gun-reference.png` and editable `gun-reference.blend` show equal-scale side views and numbered anchors: 1 stock/armpit, 2 trigger grip, 3 support grip, 4 muzzle. The carbine’s separate pieces are labelled A–G. Sniper and shotgun retain their source mesh grouping; the labels do not imply invented component meshes.

The runtime uses one camera scale per pose for all three guns, instead of resizing each gun to arbitrary painted hand spacing. The stock is the rotation pivot and remains seated at the armpit during aim movement. The painted arms follow the gun. Longer native barrels remain longer. The supplied sources do not include native pistol, AK, suppressor or alternate scope/barrel attachments; compatible long-gun game variants currently reuse the base family assembly. Sidearm, melee and flamethrower poses do not substitute an unrelated 3D gun.

## Editable formula and rebuild

Authoring sources and prompts are under `tools/art/sprites/ranger-01/`; they are kept outside the public game bundle. `modular-prompts.json` records the built-in image generation prompts used for the independent body and arm illustrations. `ranger-01-2d.blend` contains the flat shooting scene, named layers and parented planar pivot controls. No 3D character is built or exported. `formula.json` owns source selection, section placement, pivots, light volumes and per-pose gun camera calibration. All existing 3D gun assets are retained.

With Blender MCP at `127.0.0.1:9876`:

```python
import runpy
m = runpy.run_path('/Users/lx/Documents/GitHub/voxel-tactics/tools/art/sprite_formula.py')
m['bake_field']()
m['bake_heroes']()
```

For a long bake, schedule the calls with `bpy.app.timers.register` so the MCP request does not time out. The same source also runs through Blender CLI:

```sh
"/Applications/Blender 5.2.1 LTS.app/Contents/MacOS/Blender" -b -P tools/art/sprite_formula.py
"/Applications/Blender 5.2.1 LTS.app/Contents/MacOS/Blender" -b -P tools/art/blender/ranger_guns.py
```

Gun rebuilds need the supplied originals in the ignored `output/reference/` directory; the generated GLB is self-contained. Sources are `m5-scw.blend`, `l118a1.usdz`, and `shotgun/shotgun.obj`.

The sprite studio tests all three provided guns, the shooting pose on both shoulders, lighting, inertia, recoil and all field clips/facings. The Sections selector isolates the complete torso or the arm/glove layers to review overlaps. The game uses the active ranger pack; previous character folders remain legacy fixtures for unrelated tests.

## Art references

The original ranger uses simplified anime line work and flat material blocks informed by the [official Chaos Zero Nightmare art direction interview](https://newsroom.smilegate.com/en/game/chaos_pd_interview) and [official game page](https://www.smilegate.com/en/game/chaoszeronightmare.do). User-supplied screenshots define the shoulder camera and corner-ready poses. No Chaos Zero Nightmare character or game texture is included.

## Gloves that hold the gun (2026-10-16)

The active gloves now come from `source/gloves-cleaned/anatomy-painted.png`, drawn using real human grip references. `tools/art/paint_gloves.py` remains the earlier editable geometric contact guide; its segmented fingers are no longer the displayed artwork. `pack_glove_paintings.py` registers each complete painting with two anatomical landmarks (wrist and weapon socket), using uniform scale and rotation. It splits disjoint near/far pixels from that same hand, rather than building additional fingers on both sides of the gun.

- **Trigger hand (2)** wraps the grip: back of the hand and knuckle pads toward the camera, finger roots round the grip front, index finger along the trigger guard with its tip on the trigger. Thumb and fingertips are a separate `trigger-fingers` layer drawn behind the gun.
- **Support hand (3)** cradles the handguard from below: palm and thumb (`support-hand`) behind the gun, the four fingers (`support-fingers`) curled up the camera side in front of it.
- **Per family:** the carbine's pistol grip, the sniper's grip and forend, and the pump gun's straight stock wrist and pump each have their own glove (`variants` in `cutin.json`); `SpriteWeapon` picks the one for the gun in hand. Each variant is painted in that gun's neutral frame and mapped back into the rig's rest frame, so the existing hand bone (rotation with the gun axis) puts it exactly on the grip.
- Each pose has exactly one anatomical left upper arm, forearm and hand, and one anatomical right upper arm, forearm and hand. `cutin.json.anatomy` identifies them; near/far hand layers carry `fragmentOf` and share the same hand bone. The aiming wrist/elbow and sleeve width were adjusted for the new compact grip. Runtime IK preserves the revised lengths throughout the 1,404-sample sweep (both shoulders, three guns, full sway and recoil).
- Real anatomy references: [PIG Alpha glove grip photograph](https://skdtac.com/pig-alpha-gloves/), [Swiss defence over-shoulder handguard photograph](https://www.vbs.admin.ch/fr/acquisition-materiel-armee-2023), and [Mechanix M-Pact grip photographs](https://www.mechanix.com/us-en/tactical-and-military-gloves/MPSD-55-010.html). These informed proportions and occlusion; photos are not shipped in the game. No human mocap capture was supplied. `anatomy-glove-prompts.json` records the built-in image-generation prompt and references.

**Trigger finger contact.** The index finger lies along the frame on top of the trigger guard (trigger discipline). Each gun family has a gun-space contact point (`TRIGGER_CONTACT` in `pack_glove_paintings.py`, copied to `rig.triggerContact`): carbine `[0.019, 0.065, 0.028]`, sniper `[0.018, 0.070, 0.035]`, shotgun `[0.020, 0.065, 0.030]` m from the grip socket. The packer finds the painted index fingertip automatically and registers the trigger glove so that fingertip lands on the projected contact (carbine: grip socket + fingertip pinned, the rest wrist follows the painted cuff and the elbow is re-solved; sniper/shotgun: cuff + fingertip pinned). `rig.arms.trigger.fingertip` stores the rest contact; the studio shows it as marker 5 and `SpriteWeapon` reports it as the `trigger` target. A test checks the rest contact (the gripping hand sits under the upper arm in the shoulder view).

**Shooting pose layering.** Seen from behind, the right upper arm is nearest the camera, so the trigger forearm (order 0.4) and the gripping hand (0.5) draw under the shoulder and upper arm (1) in the aim pose.

Rebuild the active anatomical glove layers:

```sh
python3 tools/art/pack_glove_paintings.py
python3 -c "import runpy; runpy.run_path('tools/art/sprite_formula.py')['bake_heroes']()"
```

The earlier contact guides can still be regenerated separately when authoring another weapon:

```sh
node tools/art/gun_guides.mjs            # writes tools/art/sprites/ranger-01/gun-guides.json
python3 tools/art/paint_gloves.py tools/art/sprites/ranger-01/gun-guides.json client/public/assets/characters/ranger-01/cutin.json tools/art/sprites/ranger-01/source/gloves '{"aim":{"trigger":[492,505],"support":[527,380]}}'
python3 -c "import runpy; runpy.run_path('tools/art/sprite_formula.py')['bake_heroes']()"
```

`sprite_formula.py` now also runs in plain Python (PIL reads the sources); Blender is only needed for the preview render and the editable `.blend`.

## Game weapon mesh and cel materials

The Blender exporter keeps the original metre-space stock, grip, support and muzzle sockets before simplifying geometry. Planar dissolution and selective decimation reduce the active kit from **29,290 to 11,703 triangles** (60% fewer): carbine 8,722, sniper 2,625, shotgun 356. Part names, roles and assembly scale remain intact. The self-contained GLB is about 1.02 MB rather than 1.86 MB; original source files remain available for future LODs.

`SpriteGunMaterial.js` supplies Three.js `MeshToonMaterial`, a nearest-filtered three-band ramp and a thin back-face ink shell. The shell shares the reduced geometry and adds a second draw pass; triangle counts shown in the studio describe the mesh, excluding that outline pass. Scene light and exposure still affect the gun. Character interior colours remain fixed, with world lighting applied only at the sprite edges. Each cut-in owns and disposes its cel materials and ramp; cached GLTF geometry is shared.

## Field atlas scale

`bake_field` used to scale every frame to its own target height and centre it by its bounding box, so the character changed size between clips and slid sideways while running. Now each source sheet has one scale per facing (standing frames of the field sheet = 232 px; the run/down sheet so its run cycle is 0.94 of that), frames are anchored on the head-and-torso centre (the whole body when lying down), and only frames that would not fit the 192×256 cell shrink (never below 85 %, listed in `sprite-list.json` → `scale`). The field sheet's colours are pulled 60 % toward the cleaner run/down sheet so the two paintings read as one character.

## Aiming feel (shoulder view)

- **Reticle sensitivity.** In the shoulder camera the cursor moves the aim *relatively* (`aimDelta` in `client/src/ui/AimController.js`): one pixel of cursor motion turns the aim by `fov / screen height × sensitivity` radians, keeping the aim distance and clamping pitch to ±70°. The camera turns toward the aim, so the old absolute cursor ray kept running away from the hand. Settings → *Aim sensitivity* offers 0.25× / 0.5× (default) / 0.75× / 1×. Clicking a target re-anchors the aim on that body part.
- **Back-shot follow** (`AIM_SHOT` in `CutInDirector.js`) is calmer: a slower follow spring (τ 0.32 s), lean 0.3°/° capped at 5°, bend capped at 3.5°, and the 3D gun swings about half as far with the crosshair (yaw 0.16 rad per screen width, pitch 0.1 per screen height).
- **The shooter stays hidden.** The shooter's world sprite is hidden from the moment the aiming back shot starts, and `CameraDirector.begin` no longer clears the hidden set, so the shoulder camera re-anchoring past its ±35° yaw, or re-framing to a step-out tile while the reticle moves, cannot reveal the shooter in the shot. `end()` shows them again.
