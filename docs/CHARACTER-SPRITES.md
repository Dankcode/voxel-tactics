# Ranger sprite pack

The active human character is `ranger-01`. Field units, UI heads, shooting and readying poses use one original olive/tan ranger identity. The character is painted 2D artwork on flat cards; only the gun is a 3D model. Mechanical walkers retain their existing separate renderer.

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

Albedo PNGs preserve the cleaned source illustrations' colours, cel shading and thin line work. The exporter only cleans near-transparent alpha; it does not quantize colours or apply a majority filter, which previously muted the palette and erased outlines. Shooting and readying use independent `source/*-body-modular.png` and `source/*-arm-sections.png` paintings, styled after the retained `aim-flat.png` and `ready-flat.png` references. Field frames and portraits likewise retain their source colours. Directional illumination is confined to silhouette edges through separate normal and response maps: R = direct rim, G = unchanged painted base, B = ambient rim, A = coverage. A smooth inner band is six source pixels wide for shoulder cards and two pixels for field frames. Interior pixels have exactly R=0, G=1, B=0, preserving the painted colours and cel shadows. The mask follows alpha contours, not internal painted folds.

World lighting and received shadows affect only the edge bands. Shoulder rims use the live sun, hemisphere, back light, nearby point lights and camera orientation. Character materials bypass exposure/tone mapping so changing day/dusk/night cannot wash or darken their painted interiors. The 3D guns retain their normal full-surface lighting and exposure response.

Each pose now has a complete independently painted torso, two upper sleeves, two forearm sleeves, two gloves and an extra support-finger overlay. The torso is never produced by subtracting arm silhouettes: the chest, harness and side panels continue beneath the arms. `source/*-body-modular.png` contains the complete body; `source/*-arm-sections.png` contains separate complete parts with overlapping ends. The formula records each section's source rectangle and two joint anchors. The exporter places these sections without borrowing pixels from the torso or filling joints with capsule shapes.

Shoulders, elbows, wrists and gun sockets use full-frame UV pivots in `tools/art/sprites/ranger-01/formula.json`. Two-bone IK preserves segment lengths; glove sockets follow the actual projected gun grips. Hand rotation follows the projected stock-to-muzzle axis, so the lower pistol grip cannot twist the support hand. Its cuff stays below the barrel, with the palm behind the gun and curled fingers in front. A socket may be transparent because the gun occupies it; the exported cuff must remain opaque. Each section has its own normal and light-response maps. Gun sway is constrained to the joint workspace and recoil rotates around the seated stock. The rig regression sweeps 2,808 combinations of poses, supplied guns, mirrored sides, yaw, pitch and recoil; wrist seams stay below 0.01 source pixels, with no bone scaling.

The ready frame is 1536×768: transparent space beside the original square body artwork accommodates the full-size gun. The character, arms and gun are never squeezed independently to fit the frame. The right ready pose is authored once. Left ready mirrors the entire assembled sprite and gun, with light direction and pointer yaw corrected. The committed shooting pose uses the supplied rear-shoulder reference angle.

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

Authoring sources and prompts are under `tools/art/sprites/ranger-01/`; they are kept outside the public game bundle. `modular-prompts.json` records the built-in image generation prompts used for the independent body and arm illustrations. `ranger-01-2d.blend` contains flat aiming and readying scenes, named layers and parented planar pivot controls. No 3D character is built or exported. `formula.json` owns source selection, section placement, pivots, light volumes and per-pose gun camera calibration. All existing 3D gun assets are retained.

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

The sprite studio tests all three provided guns, mirrored ready poses, lighting, inertia, recoil and all field clips/facings. The Sections selector isolates the complete torso or the arm/glove layers to review overlaps. The game uses the active ranger pack; previous character folders remain legacy fixtures for unrelated tests.

## Art references

The original ranger uses simplified anime line work and flat material blocks informed by the [official Chaos Zero Nightmare art direction interview](https://newsroom.smilegate.com/en/game/chaos_pd_interview) and [official game page](https://www.smilegate.com/en/game/chaoszeronightmare.do). User-supplied screenshots define the shoulder camera and corner-ready poses. No Chaos Zero Nightmare character or game texture is included.
