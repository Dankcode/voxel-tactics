# PLAN 01 (rev 2): Voxel Tactics — a new XCOM 2–style co-op game built on vibe-game's world

Revision 1 written 2026-09-30, **revision 2 written 2026-10-03** by Claude (planning mode). No code, tests or repos for the new
game were created. vibe-game at `~/Documents/GitHub/vibe-game` (HEAD `99b2f41c`, working tree dirty; see §2) was read, and its
world generator was run locally once to measure buildings (§2.1); nothing in vibe-game was changed.

**What rev 2 adds:** interior combat (§12), mission map design with measurable gates (§13), formations with their own balancing
rules (§14) and a headless balance harness that gates them (§15). It also replaces rev 1's guess about buildings with
measurements: vibe-game buildings are small **solid** blocks, so mission maps are upscaled and every building is rebuilt as a
hollow, multi-storey voxel structure (D11–D13, §5).

Order of work: Leon approves → Codex implements milestone by milestone with TDD → Hermes verifies and reports evidence.
Nothing in this plan authorises edits to vibe-game itself.

Leon's requests:
> (2026-09-30) Create a new three.js game and GitHub repo using just the world, voxel, backend connection, and noise map
> generation from vibe-game. We will use its assets to make an XCOM 2–style game with turn-based mechanics designed for co-op
> and destruction using the voxel system we've worked on. Characters will be in 2D and have a Chaos Zero Nightmare backshot
> when taking the action phase. It'll be a mix of our vibe game and XCOM 2.
>
> (2026-10-03) Include plans on how to implement interior combat and map design as well as implementing formations into the
> gameplay with its own balancing features.

Working title in this plan: **Voxel Tactics** (repo `Dankcode/voxel-tactics`). Placeholder — see Q1.

---

## 0. The game in one paragraph

A squad of 2D soldiers (billboards standing on a voxel grid) fights on a mission map cut from vibe-game's procedural world:
a burg street, a walled gate, a keep, a river crossing or a forest edge, generated from the same map-data package, WFC and
noise fields, then upscaled and rebuilt so every building can be entered, stormed and blown apart. Play is XCOM 2: two action
points per soldier, blue/yellow move ranges, half and full cover, hit chance, flanking, overwatch, grenades. Indoors, squads
**stack up and breach** through doors, windows, walls or ceilings, fighting room to room behind furniture that splinters.
Soldiers can lock into **formations** — a shield line, a breach stack, a crossfire pair — that pay off while held and are
punished by grenades and flanks. Two to four players share a squad in co-op against a server-run AI; PvP later. When a soldier
commits an action, the camera cuts to a short over-the-shoulder "back shot" of their large 2D illustration, as Chaos Zero
Nightmare frames its party from behind.

---

## 1. Decisions (proposed — each needs Leon's approval)

| # | Decision | Reason |
|---|---|---|
| D1 | **New repo, fresh history.** Files are copied, not forked. `PROVENANCE.md` records the vibe-game commit and a SHA-256 per copied file. | A fork carries 20 plans and the MMO systems' history. Provenance keeps the copy auditable. |
| D2 | **Extract exactly four systems:** (a) world generation, (b) voxel model and traversal, (c) noise fields, (d) the backend connection pattern. | Leon's scope. §3 lists every file. |
| D3 | **vibe-game's renderer is not ported.** A **chunked voxel mesher** replaces `WorldGenerator.js`/`Tile.js`. Materials, palettes and the atlas are reused. | Destruction rebuilds geometry many times per turn. |
| D4 | **Buildings are real voxels, not 2D sprites** (vibe-game PLAN 21's building sprites are not carried over). | You cannot blow a hole in a baked picture. |
| D5 | **Characters are 2D; the world is 3D voxels.** Depth sprites in 8 facings; a separate large back-view illustration for the action cut-in. | Leon. |
| D6 | **Server-authoritative and deterministic.** Both sides regenerate the map from a descriptor; the server owns all rolls (seeded `Rng`) and broadcasts ordered events; destruction travels as numbered voxel deltas. | vibe-game already does descriptor regeneration; generation has no `Math.random` (checked). |
| D7 | **Orthographic isometric camera** (`CameraView.js` direction) with **four 90° rotations**, zoom and a **storey cutaway**. | XCOM control scheme. |
| D8 | **Rules live in `shared/` as pure code** (no DOM, THREE, `Math.random` or `Date.now`). | Client previews, server re-runs, the AI and the balance harness run the same code. |
| D9 | **Co-op first, PvP second.** | Leon. |
| D10 | **The card combat engine is not carried over.** Porting the pure targeting code (`Ray`, `Arc`, `Area`, `Solidity`) is recommended but is Q3. | It already does voxel line of sight, arcs and blast areas. |
| D11 | **Tactical scale ×2.** Mission maps upsample the generated world **2× in X and Y** (each world cell → 2 × 2 tiles); heights stay 1:1 so 1-voxel steps remain climbable. A 4 × 5 cottage becomes 8 × 10 tiles (6 × 8 inside its walls); the Kida keep becomes 12 × 10. | Measured (§2.1): buildings are 4 × 5 to 6 × 5 cells with 2 × 3 interior rooms — too cramped for room fighting. `TACTICAL_SCALE` is one tunable (Q11). |
| D12 | **Every building is rebuilt from its metadata** by a new `TacticalBuildingBuilder`: hollow, 1-voxel walls, storeys every 3 voxels (slab + 2 headroom, vibe-game's `INTERIOR_FLOOR_SPACING`), voxel roofs, doors, windows and stairs. The solid shells from generation are discarded. | Measured (§2.1): shells are solid 3-voxel blocks with roofs drawn as meshes. Building records already carry footprint, entry door, archetype, room rectangles and roof style. |
| D13 | **Interior layouts reuse the room logic of vibe-game's `interior-v2`** (role-based plans, furniture placed with a connectivity guard, stair runs) at 1:1 footprint, with full-height walls. The 1.7× "MapleStory-spacious" scaling and knee-height cutaway walls are dropped (the renderer's cutaway does that job). | Proven, deterministic layout code; the presentation parts don't suit tactics. |
| D14 | **Formations are a squad-level, data-driven system** with explicit costs, a cohesion rule, built-in counters and hard bonus caps. **No formation ships unless the balance harness gates pass** (§15). | Leon: formations "with their own balancing features". |
| D15 | **Map quality is measured, not eyeballed.** Every generated mission is scored on cover density, sightlines, lanes, high ground and spawn safety; failing maps are repaired or rejected before play (§13). | Procedural maps vary wildly; XCOM maps are hand-made. Gates replace hand-making. |

---

## 2. Current evidence (read from vibe-game)

**Repo state.** `origin = github.com/Dankcode/vibe-game`, HEAD `99b2f41c` (2026-09-28). The working tree is **dirty in the
files this plan extracts** (modified `WfcNoiseMask.js`, `MapData.js`, `ActiveEnvironmentData.js`, `WaterSurfaceField.js`,
`Caves.js`, `CaveGenerator.js`, `WaterPalette.js`, `compile_environments.mjs`, `environments.json`; untracked `NoiseField.js`,
`CaveModuleLibrary.js`). `WfcNoiseMask.js` imports the untracked `NoiseField.js`, so **HEAD alone would not build** → Q2.

**Generation closure is clean.** From `WorldGenerationWorker.js` (`createFantasyWorldRowsAt`): **39 files, ~4.0 MB, zero npm
dependencies** (2.9 MB is the generated `ActiveWorldData.js`).

**World pipeline.** `map-data-package/` → compile tools → `GeographicWFCGenerator` (72 × 54 views, 8-cell WFC chunks)
→ `MapData.createFantasyWorldRowsAt(x, y)` (tile rows + `buildings` + `decorations`) → `TileLibrary.createVoxelMatrix`
(`voxel-matrix-v1`, sparse columns) → `VoxelWorld` (surfaces cache).

**Voxel model.** Sparse columns; `column`, `isSolid` (linear find), `surfaces`, global `invalidate()`. **No voxel mutation API**
outside the client renderer.

**Traversal.** `AGENT_PROFILES` (`player`: width 1, clearance 2, maxStep 1, stairs, doors, wades shallow); `PathSearch.reachable`
is Dijkstra over `(x,y,z)` — the move-range engine.

**Noise.** `sampleNoiseField` → 9 deterministic channels (relief, moisture, growth, grain, grainStrength, wildness, age,
strangeness, richness); `WfcNoiseMask` turns them into WFC weights for 16 environments.

**Backend.** Express + Colyseus 0.15; `WorldRoom` sends a **world descriptor** with a `collisionHash`; accounts on `node:sqlite`.
`WorldRoom` imports generation from `client/` (to clean up).

### 2.1 Buildings and interiors — measured 2026-10-03

Generated at `DEFAULT_WORLD_LOCATION` (burg **Kida**, 72 × 54 cells, 4.6 s on the MacBook Air):

- **17 buildings**, footprints **4 × 5, 5 × 4 and 6 × 5 cells** (20–30 cells); **every one `stories: 1`, `exteriorOnly: true`**.
- **Building columns are solid.** All 509 building cells have the same column: walkable ground-floor voxel at z 0, wall voxels at
  z 1 and z 2 (20 more sit one step higher). No headroom, so nothing is enterable. Roofs are **meshes** (`createDioramaRoof`),
  not voxels.
- **Terrain is flat:** cell heights 0 (3 165 cells), 1 (146), 2 (557), 3 (20). Map max z is 3. Verticality must come from
  buildings, walls and relief chosen by the mission picker.
- **Building records are rich enough to rebuild from:** `footprintCells`, `entryDoor {x, y, edge}`, `archetype`
  (manor, cottage, workshop…), `activity` (guard, home, craft…), `roofStyle` (flat, dome, terrace), `floors[].rooms[]` with
  `gridRect` and `doors`, `architectureThemeId`, `wallTextureId`.
- **60 decorations:** fountain, stall, lantern_cluster, banner, archway, waterfall, cave_mouth, resource_node, boulder, tree,
  plant, shrub — natural cover candidates.
- **`shared/interiors/InteriorGenerator.js` (`interior-v2`)**: role-based plans (home, shop, inn, workshop, temple, keep), storey
  spacing 3 (slab + 2 headroom), stairs via `shared/world/StairRun.js`, furniture placed against walls and rejected if it would
  split the floor (flood fill), every room checked reachable with `PathSearch`, deterministic content hash. It sizes interiors
  at **1.7× the exterior footprint** and uses **knee-height partition walls** for a dollhouse view — both unsuitable for tactics.
- `BUILDING_PARTS` already distinguishes WALL, DOOR, FLOOR, ROOF, STAIRS_*, lower/upper WINDOW_* per side, CITY_WALL_WALKWAY and
  CITY_WALL_STAIRS_* — the material table in §6 maps these directly.

**Character assets.** Leon's layered PSDs (`body-gp` walk n/nw/s/sw/w, attack ×2, attacked, fall ×2, idle, sit; `head-gp-2`) and
TexturePacker sheets. `lpc-human-male/Walk.png` is **CC-BY-SA 3.0 / GPL 3.0** → Q5.

**Balance tooling precedent.** vibe-game's `tools/sim_dive.mjs` (worker threads, seeds, `--gate`), `tools/sim/kits.json` and
`sim_tune_kits.mjs` (hill-climb) are the pattern for §15.

**Tests.** 34 test files cover generation and `shared/world`; `npm test` is `node --test`.

---

## 3. What moves, what stays

### 3.1 Copied into the new repo

| Area | vibe-game source | New location | Notes |
|---|---|---|---|
| Map package | `map-data-package/**` | `data/map-data-package/` | |
| Compilers | `tools/{import_world_map_package, compile_world_blueprints, compile_town_vectors, compile_environments, bake_partial_chunks, validate_world_generation, preview_environment_noise}.mjs` | `tools/worldgen/` | Outputs repointed to `shared/worldgen/generated/`. |
| Generation (39 files) | `client/src/data/*` closure + generated `Active*Data.js`, `BakedChunkData.js` | `shared/worldgen/` | Moves client → shared; re-export shims dropped. |
| Noise | `NoiseField.js`, `WfcNoiseMask.js` | `shared/worldgen/noise/` | |
| Voxel + traversal | `shared/world/{VoxelWorld, TileRegistry, TileLibrary, TraversalRules, PathSearch, StructuralMatrixRules, StairRun, BurgThemeCatalog, WorldPalettes, WaterPalette, CameraView}.js`, `shared/generation/WaveFunctionCollapse.js`, `shared/util/{Rng, MinHeap}.js` | same paths | `StairRun` added in rev 2 (used by the building builder). |
| Interior layout logic | `shared/interiors/InteriorGenerator.js` (`layoutRooms`, furniture rules, connectivity guard) | `shared/mission/buildings/RoomLayout.js` | **Adapted, not copied verbatim** (D13). Counts as part of (b) "voxel"; flagged in Q3b. |
| Backend | `server/src/index.js` pattern, `db/Database.js`, accounts table of `001_core.sql`, `AccountService`, `accountRoutes`, `RequestGuard`, descriptor logic from `WorldRoom`, `client/src/net/Account.js`, `NetworkMapCodec.js` | `server/src/…`, `client/src/net/` | Accounts only. |
| Render helpers | `RusticMaterials.js`, `DioramaEffects.js` (water), `WindField.js`, `DayCycle.js` + keys, `WorldClock.js` | `client/src/render/` | DayCycle optional (Q6). |
| Balance harness pattern | `tools/sim_dive.mjs`, `tools/sim/DiveSim.mjs`, `sim_tune_kits.mjs` | `tools/sim/` (rewritten) | Structure only: worker pool, seeds, gate, tuner. |
| Assets | materials, `tile-textures.png`, Leon's sprite PSDs/sheets | `client/public/assets/`, `art/source/` | LPC only if Q5. |
| Tests | the 34 generation/world tests | beside their modules | Import paths only. |

### 3.2 Left behind

Card combat and content, dives, caves (Q7), interiors-as-separate-rooms runtime (`InteriorRoom`, transfers), companions,
hiring, market, mail, crafting, inventory ledger, offline presence, endgame, wildlife, cosy FX, MeshKit/DioramaKit props,
`WorldGenerator.js`, `Tile.js`, `WorldRenderBatch.js`, `ObstructionHider.js`, PLAN 21 building sprites, MMO UI.

---

## 4. New repo layout

```
voxel-tactics/
  package.json, PROVENANCE.md, THIRD_PARTY_NOTICES.md
  data/map-data-package/
  tools/worldgen/   tools/art/   tools/mission/ (preview, heatmaps, batch report)   tools/sim/ (harness, tuner, kits)
  shared/
    util/  world/  worldgen/ (+ generated/, noise/)
    mission/          MissionSite, MissionRecipes, MissionMap, Upscale, Spawns, Objectives, Pods
      buildings/      TacticalBuildingBuilder, RoomLayout, Openings, Roofs, Furniture
      design/         MapMetrics, MapGates, MapRepair, Lanes, Sightlines
    voxel/            VoxelStore, Materials, Destruction, Support, CoverMap, RoomGraph, Delta
    tactics/          Unit, Actions, HitChance, Overwatch, Visibility, Breach, CloseQuarters, Phases, Ai
    formations/       Templates, Cohesion, GroupMove, Bonuses, Counters
    content/          weapons, classes, enemies, formations, balance (tunables with ranges)
    targeting/        Ray, Arc, Area, Solidity (if Q3)
  server/src/  rooms/LobbyRoom, rooms/MissionRoom, schemas/, db/, http/
  client/src/  render/ (ChunkMesher.worker, Cutaway, RoomReveal, Debris)  units/  cutin/  ui/ (incl. BreachPlanner,
               FormationBar)  net/
```

---

## 5. World → mission map

1. **Recipe and site.** A mission is built from a **recipe** (§13.2) — archetype, slice size, objective, required features,
   pod count. `pickMissionSite({ seed, recipe })` scores candidate world points: burg recipes use burg centres; wild recipes use
   noise channels (`wildness`, `growth`, `relief`, `age`) and water adjacency.
2. **Mission descriptor** = vibe-game world descriptor + `mission: { recipeId, siteKind, worldRect, tacticalScale, spawnSeed,
   objective, mapAttempt }`.
3. **Slice and upscale.** `createFantasyWorldRowsAt(centre)` → crop `worldRect` (default **32 × 32 cells** → **64 × 64 tiles**;
   small 24 × 24 → 48 × 48) → `Upscale` ×2: terrain columns duplicated, road and river cells widened with them, decorations
   moved to tile coordinates, building records' footprints and doors scaled. Solid building shells are removed.
4. **Buildings.** `TacticalBuildingBuilder` (§12.1) rebuilds each building hollow and multi-storey; `RoomLayout` fills it (§12.2).
5. **Dressing.** Decorations become voxel props with cover classes; noise-driven clutter is added until cover targets are met
   (§13.3).
6. **Objectives, spawns, pods** (§13.6–13.7), then **gates** (§13.1). Failing maps go through `MapRepair`, then up to 6 re-rolls
   (`mapAttempt` increments, deterministic); the best-scoring passing map wins. If none passes, the recipe falls back to its
   next site candidate.
7. **Determinism check.** Server and clients compare `collisionHash`; a mismatch refuses the join.

Indestructible 2-tile `bedrock` border; map height cap 16 voxels (terrain 0–3 + up to 3 storeys + roofs).

---

## 6. Voxel store and destruction

### 6.1 Store
16 × 16 × 16 chunks of typed arrays: `Uint16` material, `Uint8` hp, `Uint8` flags (solid, walkable-top, glass, support-root,
debris, door, prop). Implements the `VoxelWorld` interface so `TraversalRules`/`PathSearch` run unchanged; column-level
invalidation replaces the global `invalidate()`.

### 6.2 Materials
Built from `TileRegistry` + `BUILDING_PARTS`, plus `hp`, `destructibility` and `debrisMaterial`:

| Class | Examples | hp | Notes |
|---|---|---|---|
| bedrock | border, ground layer z 0 under terrain | ∞ | support root |
| stone | stone walls, city wall, keep | 6 | survives a grenade at the edge of the blast |
| brick/plaster | town walls | 4 | |
| wood | timber walls, floors, roofs, doors, furniture | 2 | flammable |
| glass | windows | 1 | breaks on any hit; blocks movement until broken |
| soil | terrain | 3 | craters |
| foliage | hedges, shrubs | 1 | concealment only, no cover |

### 6.3 Damage, support, collapse
`applyBlast` / `applyShot` → `VoxelDelta { rev, removed, damaged, fallen, unitsAffected }`, capped at 600 voxels per event.
Bounded flood fill from support roots finds unsupported pieces: small ones fall and settle as debris; large ones become rubble.
Units on removed floor **fall** (damage per storey, lose 1 AP next turn, cell becomes rubble = difficult terrain). Deterministic.

### 6.4 Cover map
Per walkable tile × 4 directions: `none / half / full` (full = neighbour solid at z+1 and z+2; half = z+1 only). Props count by
their cover class. Rebuilt within 1 tile of any delta.

### 6.5 Room graph
`RoomGraph` flood-fills enclosed air per storey into rooms with portals (doors, holes, windows, stairs). It drives interior
visibility, sound and the cutaway (§12.4). Destruction **merges** rooms (a blown wall joins two rooms; a blown roof makes a room
"open air").

### 6.6 Networking
Monotonic `rev`; ordered delta log; join/reconnect = regenerate + replay; must match `worldHash(rev)`.

---

## 7. Rendering

- **Chunk mesher in a worker** (greedy, per material, atlas UVs, vertex AO); only dirty chunks rebuild.
- **Tactical camera:** orthographic, 4 rotations (Q/E), zoom, pan, focus. Grid DDA picking.
- **Cutaway:** storey level (auto-follows the selected unit, manual PgUp/PgDn); roofs of rooms with friendly units or a hovered
  revealed room are hidden; wall-fade ring between camera and selection.
- **Overlays:** blue/yellow ranges, path, cover shields, hit %, arcs and blasts, overwatch cones, **breach slots** and **formation
  ghosts** (§12, §14).
- **Room reveal:** unrevealed rooms render darkened with contents hidden (§12.4).
- **Targets** (M4, MacBook Air): 64 × 64 × 16 map ≤ 200 draw calls; one chunk re-meshed ≤ 8 ms; 60 fps idle, ≥ 45 fps in a
  3-chunk blast.

---

## 8. Backend and netcode

Node ESM, Express, Colyseus 0.15, `node:sqlite`. `LobbyRoom` (join code, squad, ready) and `MissionRoom` (4 co-op / 2 PvP).
`MissionState { phase, round, activeSide, worldRev, units, players, formations, turnDeadline }`. Client → server
`action:intent`, `breach:intent`, `formation:intent`, `turn:end`; server → client `action:events`, `world:delta`. Named rejection
reasons. Client event player never blocks the server. `allowReconnection(client, 60)`. Accounts or guests (Q8). **Hidden
information** (unrevealed rooms, enemies out of sight) is filtered per client by the server in every mode, so a modified
client cannot see inside rooms.

---

## 9. Tactics rules (the XCOM layer, `shared/tactics/`)

- **AP:** 2 per soldier; blue move 1 AP, yellow dash 2 AP; firing/throwing ends the turn unless stated; overwatch and hunker spend
  remaining AP.
- **Movement:** `reachable()` with `mobility` / `2 × mobility`; maxStep 1; stairs and ladders.
- **Hit chance:** `aim + rangeMod − defense − cover (half 20, full 40) + height (+20 at 2+ voxels higher)`, clamped 0–100;
  flanked = no cover + crit bonus. The preview lists every modifier.
- **LOS:** eye 1.2 → chest 0.9; solid voxels block; intact glass passes LOS at −10 aim; step-out peeking from full-cover corners.
- **Overwatch:** −15 aim reaction shot.
- **Weapons v1:** rifle, shotgun, long rifle; reload 1 AP; misses damage the voxel behind the target.
- **Grenades:** arc, radius 3, damage to units and voxels.
- **Classes v1:** Ranger (shotgun, Run & Gun, sword) and Grenadier (launcher, Shred); Q12 for a third (Sharpshooter or Warden).
- **Enemy AI v1:** score reachable tiles by cover vs visible soldiers, flank chance and distance; shoot the best expected damage
  or overwatch. Seeded RNG only for rolls.
- **Concealment start:** the squad starts concealed; pods patrol until alerted (XCOM 2).
- **Determinism:** descriptor + intents replay to the same state hash.

---

## 10. Turn model for co-op and PvP

Side phases (any order within a side). Human phase ends on all *End Turn* votes or no AP. Soldiers dealt to players in the lobby;
20 s takeover on disconnect. Simultaneous intents serialised and re-validated against the current `rev`. Pings. PvP: alternating
phases, 90 s timer, server-filtered fog of war.

---

## 11. 2D characters and the action-phase back shot

### 11.1 Field sprites
Camera-facing depth quads, 1 tile wide, ~2 tall; 8 facings (N, NW, W, SW, S drawn; NE, E, SE mirrored — matches Leon's PSD
directions); states idle, walk, aim/fire, throw, hit, down, fall, hunker, **stacked** (pressed to a wall beside a door).
`tools/art/export-sprites` composites head + body + weapon layers into an atlas with anchors and timings.

### 11.2 The back shot
On a confirmed action, a 1.2–2.0 s cut-in: letterbox; the character's **large back-view illustration** slides in lower-left (~45%
of screen height), weapon toward the target; behind it a low perspective camera over the unit's shoulder frames the target with
depth of field; hit % and ability name; 3–5-layer parallax push-in; cut back for impact and destruction. Skippable; *Always /
First shot per turn / Off*; shortened in enemy phases; teammates see each other's.

**Group back shots (rev 2):** a **breach** shows every stacked soldier's back view in a row in entry order; a **crossfire**
reaction shows both shooters split-screen. Same layered stills, laid out side by side.

Art is our own illustrations in this framing — nothing from Chaos Zero Nightmare's assets.

### 11.3 Art per character (v1)
Field atlas + one layered back-view illustration + one HUD portrait.

---

## 12. Interior combat

The aim: buildings are not boxes you shoot around but places you fight *through* — stack on a door, pick the entry, clear room by
room, or skip the door and come through the wall or the roof.

### 12.1 Building anatomy (`TacticalBuildingBuilder`)
Input: an upscaled building record (footprint, entry door edge, archetype, activity, roof style, theme, wall texture).
1. **Storeys** from archetype, seed and the `richness`/`age` noise at the building: cottage 1–2, workshop 1, inn 2, manor/keep
   2–3, temple 1 (double height nave), city-wall towers 2 + walkway. Clamped by the map height cap.
2. **Shell:** 1-voxel outer walls (material from `wallTextureId` → stone, plaster or timber class); floor slab every 3 voxels.
3. **Openings:** the recorded entry door (2 tiles wide after upscale = double door); **at least one more entrance** on another
   side (back door or cellar hatch) so defenders can't be bottled by a single door and attackers have options; windows on every
   outward wall run of ≥ 3 tiles, one per 3–4 tiles, at z+1 (lower) on the ground floor and upper storeys; upper-storey windows
   are firing positions.
4. **Roofs as voxels:** `flat` → walkable roof with a 1-voxel parapet (half cover) and a hatch; `terrace` → stepped walkable
   tiers; `dome` → non-walkable, but destructible wood/plaster that can be breached. Roof overhangs are skipped (they would
   confuse cover).
5. **Stairs** with `createStairRun` along an inner wall; keeps and inns get a second stair or ladder so upper floors have two
   ways in.

### 12.2 Room layout (`RoomLayout`, adapted from `interior-v2`)
- Role from `interiorRoleFor` (home, shop, inn, workshop, temple, keep); room rectangles seeded from the building's own
  `floors[].rooms[].gridRect` where present, otherwise `layoutRooms`.
- **Full-height partitions** (wood class), 2-tile doorways; at least one room per storey has two exits (no dead-end death traps
  unless the recipe asks for a "holdout" room).
- **Furniture becomes destructible cover props:**

| Furniture | Cover | Material | Special |
|---|---|---|---|
| table, counter, bar, pew, bench, crate | half | wood hp 2 | can be vaulted (1 extra move cost) |
| bookshelf, wardrobe, shelf, forge, altar | full | wood hp 3 / stone hp 6 (forge, altar) | blocks LOS |
| barrel, keg | half | wood hp 1 | `explosive` (powder keg, radius 2) or `flammable` |
| hearth, lantern | none | stone | **light source** |
| rug, plant, bed | none | — | bed = half cover when flipped (Q13, later) |

- The interior-v2 connectivity guard stays: no furniture may cut a room off from its doors.

### 12.3 Openings and their rules
- **Doors:** closed (blocks LOS and movement until opened; opening is free when you walk through), open, **locked** (needs a
  kick: 1 AP, or a breach), **broken**. Opening a door adjacent to an unseen room **reveals** that room (§12.4).
- **Windows:** intact glass blocks movement, passes LOS at −10 aim; **vaulting** through a window costs +1 move and breaks it
  (noise); a soldier at a window has half cover from outside.
- **Walls:** shots don't penetrate walls in v1; explosives do (§6.3). A **wall charge** (§12.5) makes a 2 × 2 hole.
- **Floors and ceilings:** destructible; a grenade on the floor above drops whoever stands there (fall rules §6.3).

### 12.4 Visibility, reveal and sound indoors
- **Room reveal:** a room's contents (enemies, props, traps) are revealed when a friendly unit gains LOS into it through a
  portal, opens its door, or breaches it. Until then the room renders dark and the server does not send its occupants.
- **Interior sight:** LOS indoors uses the same ray test; rooms just make it legible.
- **Lighting:** rooms without a lit hearth or lantern are **dim**: −10 aim into the room from outside, concealment +1 tile for
  units inside. Destroying a lantern darkens a room (an option for the defender). Day/night (Q6) scales this outdoors too.
- **Sound:** shots, breaches and explosions emit noise (gunshot 10, explosion 16, breach 12, vault 6 tiles); it propagates through
  the room graph's open portals and is damped by closed doors (−4) and walls (−8 per wall). Pods inside the radius go alert.
  This makes "quiet entry vs loud entry" a real choice.

### 12.5 Breach system
Inspired by XCOM: Chimera Squad's breach, re-cut for XCOM 2's side turns and for destruction.

1. **Breach points** are generated per room: every door, every window, and — new — any wall tile, roof tile or floor tile that is
   destructible (marked when a soldier carries a charge).
2. **Stack up:** soldiers move into **stack slots** beside a breach point (2–4 slots along the wall). Being in a slot is the
   **Breach Stack formation** (§14.2) and shows the *stacked* sprite pose.
3. **Breach action** (initiated by any stacked soldier; costs each participant 1 AP): choose the entry type:

| Entry | Requirement | Effect | Noise |
|---|---|---|---|
| Door | door | stacked soldiers enter in order | 12 |
| Kick door | locked door | as door; first entrant −10 aim | 12 |
| Window vault | window | 1–2 entrants only, +1 move | 10 |
| Wall charge | charge item, destructible wall | 2 × 2 hole; defenders within 2 tiles take 2 dmg and lose 1 AP | 16 |
| Ceiling drop | charge, roof/floor above room | entrants drop in (no fall damage), defenders below stunned for their next action | 16 |
| Smoke entry | smoke grenade thrown in first | defenders −20 aim against entrants this round | 8 |

4. **Resolution:** entrants move to chosen interior tiles in stack order; each gets **one breach shot** at the best target
   (aim modifier by entry: door 0, wall/ceiling +10, window −10). Defenders who were **unalerted** are *surprised*: no reaction
   fire during the breach and they act last in their next phase. **Alerted** defenders on overwatch facing the breach point get
   their reactions — this is the counter to breaching blind.
5. **Back shot:** the group cut-in (§11.2) plays once for the breach.
6. **After the breach** the turn continues normally; entrants have their remaining AP minus the breach cost.

### 12.6 Close-quarters rules
- **Range bands indoors:** point blank (≤ 2 tiles) shotgun +20 aim and +crit, sword (melee, 1 AP, adjacent) allowed; long rifle
  −30 at point blank and **no squadsight** into or out of rooms.
- **Doorway overwatch:** overwatch limited to a narrow cone (≤ 60°) gets **+10 aim instead of −15** — interiors reward
  chokepoint control.
- **Corners:** a soldier diagonal to a doorway has full cover from units outside the room except along the opening line.
- **Enclosed blasts:** explosions inside a room get +1 radius against units (pressure) and always destroy wood furniture in range.
- **Fire:** `flammable` props and wood voxels hit by fire burn for 2 turns (damage 1 per turn to adjacent units; burning wood
  voxels lose 1 hp per turn and may collapse). Fire does **not** spread voxel-to-voxel in v1 (performance and chaos control).
- **Vertical fights:** stairs are chokepoints (only one unit per stair tile); ceiling drops and floor collapses are the
  alternative; ladders on the outside of keeps let you take the roof.

### 12.7 Interior AI
Defenders: pick tiles with cover facing the most likely breach points (doors weighted by squad position and noise heard), put
one unit on **doorway overwatch** if available, keep away from windows when outside threats are visible, retreat upstairs when
outnumbered. When alerted, they may **destroy their own lantern** or **lock a door** (1 AP). Attackers' AI (for PvP bots and the
harness, §15) uses the breach planner below.

### 12.8 Breach planner UI
Select a room → the UI shows every breach point with its entry options, stack slots, predicted noise ring, known defenders and the
per-entrant shot preview. Co-op: stacked soldiers can belong to different players; the breach fires when every owning player
has confirmed (a "ready" tick per soldier, 15 s timeout).

---

## 13. Map design

Hand-made XCOM maps are designed for readable lanes, cover rhythm and high ground. Here maps are generated, so design becomes a
set of **recipes**, a **dressing pass**, **measurable metrics with gates**, a **repair pass**, and **tools** to see why a map
passes or fails.

### 13.1 Metrics and gates (`shared/mission/design/`)

| Metric | How it is measured | Gate (default) |
|---|---|---|
| Cover density | % of walkable tiles with ≥ half cover in ≥ 1 direction / with full cover | 25–45 % / ≥ 8 % |
| Killing fields | largest axis-aligned open rectangle with no cover | ≤ 12 × 12 tiles |
| Sightlines | per tile, longest LOS to another walkable tile (sampled) | median 10–18 tiles; ≤ 5 % of tiles see > 30 |
| Lanes | k-shortest paths spawn → objective with ≥ 30 % non-overlap | ≥ 3 lanes; longest ≤ 1.8 × shortest |
| High ground | tiles ≥ 2 voxels above surroundings with LOS to the objective | ≥ 2, each reachable from ≥ 2 directions |
| Interior share | % of objective-area tiles indoors | per recipe (burg street 20–40 %, keep 50–80 %, wilds 0–15 %) |
| Breachability | rooms with ≥ 2 breach points | ≥ 70 % of rooms |
| Spawn safety | enemy LOS to squad spawn / first-contact distance | none / 12–20 tiles |
| Destructible cover | % of cover tiles that a grenade can remove | ≥ 40 %; ≥ 1 **keystone** wall whose loss opens a new lane |
| PvP fairness | difference between sides on cover, lanes, high ground, distance to objective | each ≤ 10 % (or mirrored map) |
| Performance | total solid voxels, chunk count | ≤ 260 k voxels |

Gates are tunables per recipe in `shared/content/mapDesign.js`.

### 13.2 Recipes (archetypes) and the world they come from

| Recipe | World source | Features | Objective (v1) |
|---|---|---|---|
| **Burg Street** | burg centre, market | stalls, fountain, carts, 2–3 enterable houses | Eliminate |
| **Walled Gate** | burg with city wall | `CITY_WALL_WALKWAY` as high ground, gatehouse interior, stairs | Extract |
| **Keep Assault** | manor/keep building + yard | 2–3-storey keep, multiple breach points, courtyard | Eliminate / Demolish |
| **Inn Holdout** (co-op defend, later) | inn | squad starts inside, waves breach in | Defend N turns |
| **Farmstead** | wilds, high `growth` | hedges (concealment), fences (half), barn interior | Extract |
| **River Crossing** | river/bridge cells | bridge choke, shallow fords (wade = −1 mobility), banks | Eliminate |
| **Forest Edge** | high `wildness` | trees (trunk full cover), boulders, undergrowth | Eliminate |
| **Ruin** | high `age` + `strangeness` | buildings pre-damaged (partial collapse applied), rubble | Demolish |

### 13.3 Dressing pass
1. **Decorations → props:** boulder/tree trunk = full; stall/fountain rim/archway pier/banner pole = half; shrub/plant = foliage
   (concealment, no cover); lantern_cluster = light source; waterfall/cave_mouth = blocked.
2. **Recipe props:** fences and hedges along field edges (`grain` gives their direction), carts and crates in streets, barricades at
   gates.
3. **Noise clutter** until cover density reaches the gate: candidates scored by `richness` (crates, barrels), `age` (rubble,
   broken walls), `growth` (hedges); never on roads' centre lines or in doorways; never closer than 2 tiles to another full-cover
   prop (keeps lanes readable).
4. **Prefabs:** small authored voxel JSON stamps for set pieces — extraction flare point, objective structure (a ward stone,
   siege engine, supply wagon), barricade sets. `tools/mission/prefab` validates them.

### 13.4 Repair pass (`MapRepair`)
Run in order until the gates pass or the attempt budget is spent: add cover clutter in killing fields → add a low wall/hedge
across over-long sightlines → open a second entrance in rooms with one breach point → lower a building one storey if high ground
is unreachable → shift squad spawn along the map edge for spawn safety. Every repair is deterministic and recorded in the
descriptor's `mapAttempt` log, so the client regenerates the same result.

### 13.5 Objectives
v1: **Eliminate**, **Extract** (reach the flare with ≥ 1 soldier), **Demolish** (destroy a structure's support — uses §6.3;
progress = % of its support voxels removed). Later: Defend, Rescue (VIP inside a room — breach), Secure (interact with a ward
stone).

### 13.6 Spawns and pods
Squad spawn on a map edge with a concealment start. Pods of 2–4 enemies placed in rooms and cover clusters: at least one pod
indoors on burg recipes, patrol routes along lanes, one pod within reach of the objective. A pod may be a **formation** (an enemy
shield line in a keep courtyard, §14.6).

### 13.7 Tools
- `npm run mission:preview -- --recipe keep --seed 42` → top-down PNGs: height, cover, sightlines, lanes, high ground, rooms,
  breach points, pod LOS; plus the metric table.
- `npm run mission:batch -- --recipe all --seeds 500` → pass rates per recipe, repairs used, worst seeds (worker threads).
- `npm run validate:missions` → CI gate: ≥ 95 % of 200 seeds per recipe pass within the attempt budget; generation ≤ 1.5 s
  per mission on the MacBook Air (excluding the world worker's first warm-up).
- A pinned **gallery** of 20 seeds per recipe is screenshotted at M9 for Leon's visual review.

---

## 14. Formations

A formation links 2–4 soldiers into a shape. While they hold it, they get a defined bonus; when it breaks, the bonus is gone.
Every formation has a cost, at least two counters, and a hard cap — so it's a choice, not an always-on buff.

### 14.1 Core rules (`shared/formations/`)
- **Declare:** select members and a template; members must be within 4 tiles of their slots. Costs **1 AP from each member not
  already in slot** (0 if the shape is already held). Persists across turns.
- **Slots** are relative to a **leader** and a **facing**; tolerance ±1 tile and ±1 voxel height to absorb terrain.
- **Cohesion (0–100):** 100 when all members are in slot at end of a move; −35 per member out of slot; +50 at the start of the
  side's phase if all are in slot again. **Bonuses: full ≥ 80, half 50–79, none < 50** ("ragged" / "broken" shown on the bar).
- **Group move:** the leader moves and the others follow into their slots in the same action, if every slot is reachable within
  each member's budget (`reachable()` per member); slots that can't be reached compress to the template's alternate shapes.
  Each member pays its own AP.
- **Limits:** one formation per 4 soldiers (squad of 4 → 1; 6 → 2); a soldier belongs to one formation; **dash breaks** any
  formation; abilities marked `solo` (Run & Gun) break it.
- **Breaks automatically** when a member is killed, falls (destruction), panics, is stunned, or a wall/floor collapse leaves a
  member with no path back to slot within 1 AP.
- **Co-op linked formations:** members may belong to different players; declaring needs each owner's accept; group moves need
  each owner's opt-in "follow" toggle (default on once accepted).

### 14.2 Templates (v1 ships three; three more are designed and held back)

| Formation | Shape | Bonus (full cohesion) | Costs | Counters |
|---|---|---|---|---|
| **Shield Line** (v1) | 2–4 adjacent, side by side, facing an arc | +10 defense vs attacks from the front 90° arc; members can't be flanked from the line's *inner* sides | −1 mobility; no dash | flank the ends; AoE (clustered); destroy the cover they lean on; static decay (below) |
| **Breach Stack** (v1) | 2–4 in stack slots at a breach point | entry order control; +10 aim on breach shots; −50 % noise on door entries | only valid at a breach point; dissolves after the breach | doorway overwatch; trapped doors; a wall charge from inside |
| **Crossfire** (v1) | 2 soldiers ≥ 4 tiles apart, both on overwatch with overlapping cones | overwatch in the overlap at **0 aim penalty** (instead of −15); both may react to the same target | both spend all AP on overwatch; must be ≥ 4 apart | smoke; destroying either position's cover; moving outside the overlap; dim interiors |
| Wedge (held) | leader + 2 diagonal behind | leader +10 aim first shot; followers +1 mobility in group move | leader exposed; −5 defense leader | focus the leader |
| Bounding Pair (held) | 2, one moves while the other covers | mover is *covered*: enemies that shoot the mover take −15 aim | covering soldier spends 1 AP | kill or suppress the coverer first |
| Hedgehog (held) | 3–4 around a point | cannot be flanked at all | −2 mobility; no attacks except overwatch | AoE (heavy), fire |

### 14.3 Built-in balancing features
1. **Clustered rule:** any unit with ≥ 2 allies within 2 tiles is *clustered*; AoE against clustered units gets **+1 radius and
   +25 % damage**. This is the universal counter to tight shapes and is shown as a warning icon.
2. **Bonus caps:** total formation aim bonus ≤ +15; total formation defense bonus ≤ +15; defense from all sources (cover +
   hunker + formation) ≤ 60. Formation bonuses never stack with each other (a soldier is in one formation anyway).
3. **Static decay:** Shield Line loses 5 defense per consecutive enemy phase it does not move (floor +0), resetting when it
   moves ≥ 2 tiles. Stops turtling forever behind one wall.
4. **Opportunity cost:** AP to form, mobility penalties, no dash, `solo` abilities break it.
5. **Destruction interplay:** formations grant bonuses *on top of* cover, so blowing up the wall they hold behind removes the bigger
   half of their defense — grenadiers are the natural answer.
6. **Enemy parity:** enemies use the same templates (§14.6) so players learn counters by facing them.
7. **Tunables with ranges:** every number above lives in `shared/content/balance/formations.js` as
   `{ value, min, max, note }`; the tuner (§15.4) may only move values inside `[min, max]`.

### 14.4 Interaction with other systems
- **Interiors:** Breach Stack is the indoor formation; Shield Line in a 2-tile corridor is strong but highly *clustered* — a
  grenade through the door punishes it.
- **Destruction:** collapses can split a formation (break rule); falling members leave it.
- **Back shot:** breach and crossfire use group cut-ins (§11.2).
- **AI:** the enemy AI scores "form up" as an action with expected value (bonus × exposure − AoE risk) like any other.

### 14.5 UI
Formation bar (templates available given selection), ghost slots at the destination while planning a group move, cohesion
meter on each member's nameplate, clustered warning, bonus breakdown in the hit/defense preview, enemy formations outlined.

### 14.6 Enemy formations
Guard pods in keeps may spawn as Shield Lines across a courtyard or hall; archer pairs as Crossfire on walls. The AI breaks
formation when cohesion is < 50 or when a grenade threat is visible (≥ 2 clustered units in a grenadier's range).

---

## 15. Balance harness (formations and everything else)

Based on vibe-game's `sim_dive.mjs` + `kits.json` + `sim_tune_kits.mjs` pattern, rewritten for tactics.

### 15.1 Runner
`tools/sim/tactics_sim.mjs`: worker threads run headless missions (pure `shared/` rules, no renderer, no server) with **bots on
both sides**. The squad bot uses the same scoring AI as enemies plus breach and formation policies. Inputs: recipes × seeds ×
**kits** (squad compositions and policies, `tools/sim/kits.json`). Deterministic; reports JSON + Markdown to `output/sim/`
(git-ignored).

### 15.2 Metrics
Win rate; turns to win; soldier deaths; damage dealt/prevented per formation; **formation uptime** (% of member-turns in a
formation at ≥ 80 cohesion); bonus value realised (expected hits added/prevented); break causes; AoE-on-clustered rate; breach
outcomes by entry type; interior vs exterior kills; map metric correlations (which map features drive losses).

### 15.3 Gates (`npm run sim:formations -- --gate`, 300 seeds × 6 recipes, CI nightly)

| Gate | Rule |
|---|---|
| Worth it | each v1 formation raises win rate vs the no-formation baseline kit by **+2 % to +8 %** (all recipes pooled) |
| Not mandatory | never more than **+12 %** in any single recipe |
| Not useless | never below **−3 %** in any recipe |
| Not always-on | uptime **30–70 %** when the bot may choose freely |
| No dominance | no template chosen in > **60 %** of free formation decisions |
| Counters work | vs a grenadier-heavy enemy kit, Shield Line's advantage drops to **≤ +2 %**; vs smoke-carrying enemies, Crossfire's ≤ +2 % |
| Breach sanity | each entry type is chosen in ≥ 10 % of breaches by the bot; no entry type has > 75 % room-clear success when defenders are alerted |
| Mission baseline | starter kit wins 55–75 % per recipe on standard difficulty |
| PvP mirror | each side wins 45–55 % on mirrored kits |

### 15.4 Tuner
`tools/sim/tune.mjs`: hill-climb over tunables inside their `[min, max]`, fitness = distance from all gate centres; writes a
**proposal file** only. Changing `balance/*.js` needs `--write` and a human review — the same rule as vibe-game's `sim:tune`.

### 15.5 Human check
Bots are not players. After M11, Leon and one co-op partner play 6 missions; the client logs the same metrics to a local JSON
(no server telemetry in v1) and the report compares human vs bot uptime and win deltas. Large gaps reopen the tunables.

---

## 16. Assets and licences

Leon's PSDs/sheets carried over; atlases and textures carried over pending Q5; LPC excluded by default; notices pruned; repo
licence Q4. New art needed for rev 2: *stacked* pose, furniture/prop atlas tiles (or voxel colours from the atlas), breach FX,
fire, and group cut-in layouts (re-uses the single back-view illustrations).

---

## 17. Build order

Each milestone is one Codex task: failing tests first, minimal implementation, focused then full tests, report changed files,
commands, results, risks, rollback. Hermes verifies the acceptance check.

| M | Work | Acceptance check |
|---|---|---|
| **M0** | Repo, workspaces, Vite + three ^0.183, Colyseus 0.15, `node --test`, CI, `PROVENANCE.md`, licence. | Cube renders; CI green. |
| **M1** | Extraction (§3.1); server off `client/` imports; 12 golden descriptors dumped from vibe-game at the pinned commit. | 34 carried tests pass; 12/12 goldens byte-identical; `worldgen:validate` passes. |
| **M2** | Mission pipeline: recipes (Burg Street, Keep Assault, Forest Edge first), site picker, slice, **upscale ×2**, `TacticalBuildingBuilder`, `RoomLayout`, roofs, openings, decoration → prop mapping, spawns. | 200 seeds × 3 recipes: deterministic hash; every room reachable; every building has ≥ 2 entrances; Kida keep → 12 × 10, 2–3 storeys with stairs. |
| **M3** | `VoxelStore`, material table (§6.2), blast/shot, support/collapse, `CoverMap`, `RoomGraph`, deltas + replay. | Traversal tests pass on `VoxelStore`; wall charge opens a path `reachable()` uses; blown wall merges two rooms; floor removal drops a unit; replay hash matches. |
| **M4** | Renderer: mesher worker, materials, water, camera, storey cutaway, roof hiding, room darkening, picking, debris. | §7 targets on the MacBook Air; screenshots of 3 recipes × 4 rotations × 2 storeys. |
| **M5** | Server: accounts, rooms, schema, descriptor + delta join, reconnect, per-client hidden-info filtering. | Two browsers, same hash; a blast seen by both; reconnect replays; an unrevealed room's occupants never appear in client state. |
| **M6** | Tactics core (§9): AP, ranges, LOS, hit chance, flanking, overwatch, reload, grenades, 2 classes, concealment, event player. | Modifier unit tests; deterministic replay; scripted flank/overwatch/grenade scenario passes headless. |
| **M7** | **Interior combat** (§12): doors/windows/locks, reveal, lighting, sound, CQB rules, furniture props, fire, breach system + planner UI, interior AI. | Scripted scenarios: each of the 6 entry types resolves correctly; surprise vs alerted defenders differ as specified; noise alerts the right pods through doors/walls; breach group cut-in plays. |
| **M8** | Co-op turn model (§10) + enemy AI incl. interior behaviour. | 2–4 clients finish a Keep Assault vs AI; cross-owner breach confirms; stale intents rejected. |
| **M9** | **Map design** (§13): metrics, gates, dressing clutter, repair pass, all 8 recipes (Inn Holdout may slip), prefabs, preview/batch tools, `validate:missions` in CI. | ≥ 95 % pass per recipe on 200 seeds; ≤ 1.5 s per mission; gallery of 20 seeds × recipe reviewed by Leon. |
| **M10** | **Balance harness** (§15) with squad bot, kits, metrics, mission-baseline gate (no formations yet). | Starter kit within 55–75 % per recipe; deterministic reports. |
| **M11** | **Formations** (§14): templates (3 v1), cohesion, group move, limits, clustered rule, caps, decay, linked co-op formations, UI, enemy formations; then all §15.3 gates. | Unit tests for every rule; all formation gates pass (tuner proposals reviewed by Leon before `--write`). |
| **M12** | 2D characters + back shot + group cut-ins (§11). | Every action shows its cut-in on all clients; sprites sort correctly behind walls at 4 rotations; *stacked* pose shown at breach slots. |
| **M13** | PvP (§10) incl. PvP fairness map gate and mirror-kit gate. | Two players finish a match; hidden info never leaks; mirror win rate 45–55 % in the harness. |
| **M14** | Vertical slice: HUD polish, sound hooks, human check (§15.5), Leon playtest. | Leon's sign-off. |

Critical path: M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8. M9 can start once M3 (cover, rooms) and M6 (LOS) land. M10 → M11 after
M8. Art for M12 starts on day one.

---

## 18. Tests (new)

- Worldgen: `worldgen.golden.test.js`.
- Mission: `mission.site`, `mission.upscale` (footprints and doors scale exactly ×2), `buildings.builder` (hollow, storey spacing
  3, ≥ 2 entrances, windows per wall run, roof walkability per style), `buildings.rooms` (every room reachable, two-exit rule,
  furniture never blocks a doorway), `mission.spawns`.
- Map design: `design.metrics` on hand-made fixture maps with known answers (e.g. a 20 × 20 open field fails killing-field),
  `design.repair` (each repair fixes its own failing fixture), `design.determinism` (repairs replay identically).
- Voxel: `voxelstore.compat`, `destruction.blast/support/fall`, `delta.replay`, `cover`, `roomgraph` (merge on wall loss, open-air
  on roof loss).
- Tactics: `hit`, `ap`, `overwatch`, `grenade`, `concealment`, `replay`.
- Interiors: `interior.doors`, `interior.windows`, `interior.reveal`, `interior.lighting`, `interior.sound` (damping through doors and
  walls), `breach.entries` (one per entry type), `breach.surprise`, `cqb.rangebands`, `fire`.
- Formations: `formation.declare` (AP cost), `formation.cohesion` (thresholds), `formation.groupmove` (compression),
  `formation.breaks` (each cause), `formation.caps`, `formation.clustered`, `formation.decay`, `formation.coop-link`.
- AI: cover choice, flanking, doorway overwatch, formation break on grenade threat.
- Server: `room.protocol` (hash refusal, intent validation, reconnect, hidden-info filter).
- Sim: harness determinism (same seed → same report), gate evaluator on synthetic results.

---

## 19. Risks

| Risk | Mitigation |
|---|---|
| Generation depends on uncommitted vibe-game work (Q2). | Pin a commit first; goldens from it. |
| `ActiveWorldData.js` (2.9 MB) in the bundle. | Worker-only load; JSON later. |
| Upscaled terrain looks blocky (every feature 2 × 2). | Dressing pass adds 1-tile detail; `TACTICAL_SCALE` is one tunable; 3× tested at M2 as a fallback (Q11). |
| Rebuilt buildings drift from the vibe-game look. | Materials, wall textures and theme ids come from the same records; roofs keep their style. |
| Interiors still cramped for small cottages. | Recipes favour larger archetypes near objectives; cottages may merge with a neighbour (shared wall) when adjacent. |
| Breach is over- or under-powered. | Breach gates in §15.3; alerted defenders on doorway overwatch are the built-in counter. |
| Formations add rules players don't read. | 3 templates in v1; ghost slots and a cohesion bar; the preview shows the bonus as a line item. |
| Bot balance ≠ human balance. | §15.5 human check; tunables have ranges; tuner never writes without review. |
| Map gates too strict → many re-rolls, slow loading. | Attempt budget 6, repair pass before re-roll, batch tool tracks repair usage; loosen per recipe if pass rate < 95 %. |
| Fire and collapse cascades. | No voxel-to-voxel fire spread in v1; bounded flood fill and 600-voxel cap. |
| Desync after many deltas. | `worldHash(rev)` checks; replay tests. |
| Hidden info leaks via deltas (a blast inside an unseen room). | Deltas are public (walls are visible), unit effects inside unrevealed rooms are filtered. |
| Art volume. | 2 characters first; mirrored facings; layered stills; group cut-ins reuse singles. |
| LPC share-alike. | Excluded by default. |

---

## 20. Rollback

The new repo is independent; any milestone is reverted by resetting its branch or deleting the repo. vibe-game is never written
to (M1 fixtures are produced by reading it with a script run from the new repo's `tools/`). Formations and map gates are behind
content flags (`formations.enabled`, per-recipe `gates.enabled`) so a bad tuning can be switched off without a code revert.

---

## 21. Open questions for Leon (default in bold if unanswered)

1. **Name and repo** — `Dankcode/voxel-tactics`, **private**?
2. **Extraction baseline** — **commit/tag vibe-game's current working tree first**, or HEAD `99b2f41c` without the new noise work?
3. **Port vibe-game's voxel targeting** (`Ray`, `Arc`, `Area`, `Solidity`)? **Yes, recommended.**
   3b. **Adapt `interior-v2`'s room layout** (`InteriorGenerator.js`) as the basis for `RoomLayout`? **Yes, recommended.**
4. **Licence** — **all rights reserved (private) for now**?
5. **LPC walk sheet** — **leave out**? Are `rustic-atlas.jpg` / `tile-textures.png` your own or generated?
6. **Day/night per mission** (affects interior lighting) — **yes**?
7. **Caves as missions** — **later**?
8. **Accounts** — **guests for v1**?
9. **Setting** — **fantasy re-skin of XCOM roles** (crossbow, fire flask, sword), or modern weapons?
10. **Squad size** — **4 soldiers, 2–4 players**?
11. **Tactical scale** — **×2** (64 × 64 maps from 32 × 32 world cells), or ×3 for roomier interiors and larger maps?
12. **Third class** — Sharpshooter (long rifle, squadsight outdoors) or **Warden** (shield, the Shield Line specialist)?
13. **Flippable furniture** (tables/beds into cover, 1 AP) — **later**?
14. **Formations v1 set** — **Shield Line, Breach Stack, Crossfire**, or a different three from §14.2?
15. **Formation cost** — **1 AP per member not already in slot**, or free to declare with bigger penalties?
16. **Cross-player formations in co-op** — **allowed with each owner's accept**, or same-owner only?

---

## 22. Non-goals (v1)

Strategy layer, persistent soldier progression, matchmaking and ranked PvP, server telemetry, mod tools, mobile controls, voxel
fire spread, shooting through walls/floors, vibe-game's MMO features, rewriting vibe-game, upgrading Colyseus or three.js majors,
the three held-back formations.

---

## 23. Review findings from reading vibe-game

1. The server imports world generation from `client/src/data/` — fixed by moving generation into `shared/`.
2. `VoxelWorld.invalidate()` is global; destruction needs column-level invalidation.
3. `isSolid` is a linear `find` per call — too slow for AI/LOS/map-metric volumes; the typed-array store fixes it.
4. `WorldRenderBatch.rebuild()` traverses the whole world group — unsuitable for per-turn changes.
5. PLAN 21's building sprites conflict with destruction.
6. The world descriptor already carries a `collisionHash` — a ready-made desync check.
7. **(rev 2)** Open-world buildings are solid 3-voxel blocks with mesh roofs and `stories: 1` everywhere measured; terrain spans
   only z 0–3. Tactical verticality must be built (D11–D12).
8. **(rev 2)** `interior-v2` already solves deterministic role-based room plans with a connectivity guard and stair runs; its
   1.7× scale and knee-height walls are presentation choices for the MMO view, not constraints.

---

## Codex brief (compact)

- **Owner:** Codex (implementation), Hermes (verification), Leon (approval per milestone).
- **Goal:** milestones M0–M14, one at a time, each only after Leon approves it.
- **Non-goals:** §22; no edits to vibe-game; no files outside the new repo.
- **Inputs:** this plan; vibe-game at the commit chosen in Q2 (read-only).
- **Acceptance checks:** the §17 column for the milestone in hand; for M9–M11 the gate tables in §13.1 and §15.3.
- **Evidence:** changed files, commands, test output, screenshots (M4, M9 gallery, M12), sim reports (M10, M11), risks, rollback.
- **Balance changes:** tuner output is a proposal; `balance/*.js` changes need Leon's review.
- **Secrets:** none in the repo or the handoff; `.env` git-ignored.

Sources consulted for the cut-in reference: Prydwen, "Chaos Zero Nightmare — Combat Explained"; Game8, "Combat Guide".
