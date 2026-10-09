# PLAN-02 — From one picture to a playable multi-storey map

Status: **mechanics first; visual design deferred** (Leon, 2026-10-09). The restored WFC, 2–4-storey compiler, uniform-scale site solver, repair/congruence checks and manifest-backed packages are implemented. The four-storey Signal House fixture exercises traversal, escape routes, collapse, objectives and co-op. Authoring providers, floor concept generation/read-back and caches are implemented and contract-tested; live model/art acceptance is unverified without an API key. Final art direction and briefing UI are deferred to the later map-builder design pass. See [MAPGEN.md](MAPGEN.md).
Leon also decided §16.2–4 and asked for them to be built; they are implemented (see §8 and the M0 / M5 / M8 rows
of §12): glass is aesthetic, jump-down and ladders, and extract / recover / hold objectives, plus 30 HP for every
character with caliber-based damage (§8.6).

## 1. Goal

Give the tool **one picture** (a street photo, a concept painting like `docs/design/cedar-close-concept.png`, a
screenshot) and get back a **playable, story-driven Fireteam map**: buildings of **2 to 4 storeys** with furnished,
purposeful interiors, a mission story, enemy placement that follows from it, and every system working (cover,
ballistics, destruction, elements, breaching, co-op determinism). The steps:

1. **Read the picture**: a vision model extracts the site (buildings, storeys, materials, street layout, era,
   mood) and the story it suggests.
2. **Design the level**: a design pass turns that into a mission (objective, factions, approach lanes,
   encounter beats per floor) and a program for every building and floor.
3. **Generate interior concept art**: one cutaway concept image per building floor, in the reference's style, as
   art direction and as a second source of layout facts.
4. **Rebuild it with WFC from the pre-baked tile set**: a deterministic solver lays out each floor (rooms, walls,
   doors, windows, stairs, furniture) from the extracted specs, using only tile-set pieces the game already draws.
5. **Validate and repair**: the existing design gates plus new vertical and story gates; repair or re-solve,
   never ship a broken map.
6. **Save a map package** that the game builds deterministically, with no AI at runtime.

## 2. Non-goals (this plan)

- No AI calls inside the game or the server. AI runs only in an authoring tool; the game loads its saved output.
- No aliens or new enemy factions; no new weapons.
- No free-form 3D mesh generation from images: everything on screen stays a tile-set piece on the voxel grid.
- No changes to lockstep, ballistics or cover rules except the vertical-play items in §8.
- No in-browser map editor (a later plan can add one on top of the package format).

## 3. Where we start (evidence)

| Have | Where | Use in this plan |
|---|---|---|
| Room-program buildings, 1–2 storeys, stairs, doors for breaching, glazing by room, furniture with a connectivity guard | `shared/mission/modern/ModernBuilder.js` | becomes the **storey compiler**; extend to 4 storeys and arbitrary room graphs |
| Map toolkit (roads, cars, trees, cover pass, decor, finish with spawn safety) | `shared/mission/modern/MapKit.js` | the **site compiler** |
| Design gates (cover gap, sightlines, lanes, breachability, spawn safety …) | `shared/mission/MissionMetrics.js` | validation, plus new gates |
| Connected thin walls, grouped cover, water; physical cover readout | `shared/voxel/ConnectedShapes.js`, `Cover.js` | unchanged; every generated wall and prop uses them |
| Pre-baked tile set: 311 pieces (walls, glazing, doors, stairs, furniture, vehicles, street furniture, decor) | `client/src/render/kit/*`, `assets/kit/tileset.json` | the WFC **tile vocabulary** |
| Deterministic graph WFC with backtracking, validated fixed cells and weights | vibe-game `shared/generation/WaveFunctionCollapse.js` (in this repo's history at `cf16d62`) | restore as `shared/generation/WaveFunctionCollapse.js` |
| Map-to-world rules: congruence audit, repair-don't-drop, explicit stair footprints, seeded furnishing | Leon's `procedural-voxel-town-worlds` skill | adopted as rules in §6 and §9 |
| Mechanics reference and known rule quirks | `docs/mechanics/` | §8 fixes the quirks that multi-storey play exposes |

Constraints that matter: one storey is a slab plus 2 voxels of headroom (`STOREY = 3`), so 4 storeys plus a roof
need a store at least 16 high; the storey cutaway already exists (PgUp/PgDn); maps are 44–60 cells across.

## 4. The pipeline

```
picture ─►(A) SITE READ ──► site.json ─►(B) LEVEL DESIGN ──► design.json ─►(C) CONCEPT ART ──► floors/*.png
  (vision model)                         (language model)                  (image model)        │
                                                                                                ▼
                               map package ◄──(F) PACKAGE ◄──(E) VALIDATE + REPAIR ◄──(D) WFC LAYOUT
                       client/public/maps/<id>/    (deterministic from here on)     floorspec.json (vision model)
```

Stages A–C and the concept-image reading in D call models and run once, on the Mac, in an authoring CLI
(`npm run mapgen -- --image street.jpg --id harbor-row`). Their outputs are saved as JSON and PNG next to the map. Stages
D (solve) to F are pure functions of those files and a seed, so the same package always builds the same map, on
every client and on the server.

### A. Site read (picture → `site.json`)

A vision model gets the picture and a strict JSON schema. It returns:

- `setting`: theme (suburbs / downtown / industrial / roadside / new), era, time of day, weather, mood.
- `buildings[]`: id, apparent use, **storeys (clamped 2–4)**, footprint estimate (cells, from relative size), roof
  type, facade material (mapped to our wall keys), glazing style, entrances seen, balconies, fire escapes, roof
  access, condition (pristine / damaged).
- `ground`: streets, sidewalks, yards, parking, water, fences, hedges, trees, vehicles, with rough positions in a
  normalised 0–1 frame.
- `storyHooks[]`: what the picture suggests ("a closed bar with a lit upstairs", "a van backed into an alley").
- `confidence` per field; anything under a threshold falls back to theme defaults instead of being guessed.

The schema only allows values the game can build (our materials, programs and props), so the model can't invent
an unbuildable thing. The Cedar Close concept image becomes the first golden test input.

### B. Level design (`site.json` → `design.json`)

A language model, with a design brief written from `docs/mechanics/` and `docs/LEVELS.md`, returns:

- `mission`: title, briefing (3–5 sentences), objective type (eliminate, extract VIP, recover intel, hold, destroy
  the stash — eliminate first, the others gated on §8.4), fail conditions, time of day.
- `story`: who the Syndicate are here, why they are in these buildings, what the squad finds; 3–6 **beats**, each
  tied to a place (`building / floor / room`): "the lookout on the roof sees the approach", "the stash room on
  floor 3", "the hostage behind the kitchen".
- `layout`: the site grid size, parcel per building, approach lanes (at least 2 for the gates), squad entry,
  where the vertical advantage is, where the chokepoints are.
- `programs`: for every building and floor, a list of rooms with kind, approximate area share, required adjacencies
  ("stairwell touches corridor"), exterior openings, and props or decor that carry a beat (cash-counting table,
  surveillance monitors, mattresses in a squat).
- `encounters`: pods with types and rooms, chosen to serve the beats (the spawn-safety pass still has the last word).

### C. Interior concept art (`design.json` → `floors/<building>-<floor>.png`)

For each building floor, an image model renders a **top-down cutaway concept** in the reference picture's style
(like `cedar-close-concept.png`): labelled rooms, furniture, doors and windows. The prompt is built from the
programme, the facade facts from A and a style descriptor taken from the picture. These images:

1. are the **art direction** a human can review and redo before anything is built (`--redo building-2/floor-3`);
2. are read back by the vision model into **`floorspec.json`**: room polygons in a normalised frame, doors,
   windows, stairs, furniture items with positions. This is the only layout fact taken from pixels, and it is
   treated as a soft prior for the solver, never copied cell for cell.

### D. WFC layout (`design.json` + `floorspec.json` → voxels)

Three nested solves, each using the restored deterministic graph WFC (backtracking, fixed cells, weights).
`hash(mapId, buildingId, floor, seed)` seeds every solve.

1. **Site WFC (parcels)**. Nodes are 4×4-cell parcels; tiles are parcel modules (building footprint parts, yard,
   street, plaza, parking, alley, water) with edge sockets (road, sidewalk, yard, building wall, fence). The site
   read's positions are fixed or weighted priors; the result is congruent with the picture (one uniform scale,
   buildings never dropped; see §9).
2. **Floor-plan WFC (rooms)**. Nodes are the building's interior cells on one floor; tiles are **room-cell tiles**
   (room kind × role: interior, wall-adjacent, corner, door cell, stair cell, window bay). Constraints:
   - adjacency from `design.programs`;
   - room areas within ±25 % of the programme;
   - stair cores fixed first and identical on every floor (one stair shaft per building, plus fire stairs for 3–4
     storeys);
   - load-bearing walls that line up between floors (a partition on floor N must sit on a partition or slab on
     floor N−1);
   - weights from `floorspec.json` (rooms where the concept art drew them).

   Partitions, doors and openings are then derived exactly as ModernBuilder does now (spanning tree plus second ways
   in, open-plan openings).
3. **Facade and detail WFC (pieces)**. Nodes are perimeter cells per storey; tiles are the tile set's facade modules
   (`joined_wall_*`, glaze full / band / punched, `mdoor`, `gdoor`, `roller`, balcony, fire-escape landing) with
   sockets for rhythm (piers every N, aligned windows between floors, glazing by the room behind). Furniture uses
   the existing recipes, keyed by room kind and story beat, with the connectivity guard.

Every WFC tile maps 1:1 to voxel materials plus render hints, so the result is always something the game can draw
and simulate. A contradiction makes the solver backtrack; after a bounded number of reseeds it fails loudly with the
conflicting constraints.

### E. Validate and repair

The existing gates on several seeds (cover gap ≤ 6, sightlines, lanes, breachability, spawn safety, destructible
cover, full-cover share), plus new ones:

- **Vertical**: every floor reachable; every building with 3+ storeys has 2 ways up (stairs plus a fire escape,
  ladder or second stair); no dead-end top floor without a window line; at least one elevated firing position per
  approach lane; no unreachable roof that enemies spawn on.
- **Story**: every beat's room exists and is reachable; the objective is reachable from the squad entry; the first
  contact happens after at least 2 moves.
- **Congruence** (from the picture): building count equals `site.json`; each footprint matches the read with
  IoU ≥ 0.85 after scaling; storeys match.
- **Performance**: tile-set instances, draw calls and store height within budget (§10).

Repairs are rule-based and logged: open a second door, add a fire escape, drop a cover prop, move a pod. If a map
still fails, the tool stops and reports why; it never saves a map that fails a gate.

### F. Package (`client/public/maps/<id>/`)

```
manifest.json      id, name, theme, version, seed(s), generator version, gate results, size, storeys, credits
site.json          stage A output (kept for re-runs)
design.json        stage B output: mission, story, programs, encounters
floorspec/*.json   stage C read-backs
concept/*.png      the reference picture and concept art (art direction, loading screen, briefing)
layout.json        the solved layout: parcels, buildings, floors, rooms, doors, stairs, facade and furniture choices
```

At runtime `Maps.js` registers packages next to the hand-built maps; `buildPackagedMap(pkg, seed)` compiles
`layout.json` into the voxel store with MapKit and the storey compiler. Mission briefings and the loading screen
show the concept art. Co-op peers load the same package, so lockstep is unaffected.

## 5. Multi-storey buildings (2–4 storeys)

- `STOREY` stays 3. A 4-storey building is 12 voxels plus a roof; maps that use it get a store height of 18.
- **Stairs**: one core per building, stacked on every floor and placed first; 3–4 storeys add a second escape: an
  external fire escape (new pieces: landing, steel stair) or a second core. The stair cells use the existing
  `createStairRun` with a validated footprint and carved headroom.
- **Floor programs by use**: ground floor commercial or lobby, upper floors residential or office, top floor or roof
  for overwatch. Setbacks and terraces on upper floors (walkable flat roofs over the floor below) give elevation
  play.
- **Balconies**: walkable 1-cell ledges with a railing (half cover) outside window bays; drop-down to the floor below
  as a new 1-storey jump-down move (see §8.3).
- **Cutaway**: the existing level cut works per storey; the HUD level indicator shows up to L4 and the roof.
- **Destruction**: floors and walls stay destructible; collapse rules already drop unsupported voxels. Add a
  structural test: removing a ground-floor wall run must not delete a whole 4-storey building.

## 6. Story and game design rules (baked into stage B's brief and checked in stage E)

- A map tells one story in 3–6 beats, each a place you can find. Decor sets carry it, for example a cash-counting
  table, CCTV monitors, sleeping bags, a ransacked office or a chemical lab (new decor kinds; visual only).
- Every building earns its place: a landmark (tallest, roof overwatch), a fortress (the objective), a flank (a
  cheap way round), filler (cover and sightline breaks).
- Verticality is designed: enemies overlook at least one lane; the squad can take high ground on at least one
  flank; going up costs time (stairs are chokepoints and breach points).
- XCOM pacing: concealment start, first pod reveal after the squad is in cover, an escalation beat (reinforcement
  or alarm), a climax room.

## 7. Tile vocabulary additions

New pre-baked pieces for multi-storey and story. Each is drawn and collides through the existing contracts; every
gameplay piece gets a material and a connected footprint where it is a wall or cover.

| Piece | Gameplay |
|---|---|
| External fire-escape landing, steel stair, ladder | walkable landing (grate), half-cover railing; a ladder is a climb move (§8.3) |
| Balcony slab and railing | walkable, half cover, can collapse when its slab is destroyed |
| Roof hatch, roof access door, rooftop AC unit, water tank | AC unit and water tank: full cover, the tank douses (water drum rules) |
| Stairwell door and core wall variants | connected wall masks; the door breaches like any door |
| Story decor sets (cash table, CCTV bank, lab bench, squat, server rack) | visual only, except the objective object |

## 8. Rule changes multi-storey play needs

1. **Height and cover**: a shooter 2+ voxels above the target ignores half cover that is lower than the target's
   chest (XCOM high ground) — **done**. Shooter-aware readouts and AI scoring sample the pitched line of fire; full walls and upper bands still count when intersected (`docs/mechanics/03`).
2. **Glass** — *done, decided: glass is aesthetic.* It gives no cover and never stops a shot or sight; a pane a
   bullet crosses still breaks (`shatters`). Readout and ballistics agree.
3. **Moves** — *done.* Jump down 2–4 voxels off a ledge (cost 3, no fall damage, `staggered` until the next turn;
   a railing blocks it) and fixed steel ladders (`ladder` material, cost 1.5 + rise, both ways). Drainpipes are not
   in. Harbor Yard has three ladders up container stacks. See `docs/mechanics/02-movement.md`.
4. **Objectives** — *done.* `extract`, `recover` (with or without an extraction zone) and `hold`, plus an optional
   `turns` deadline, in `shared/battle/Objectives.js`; Route 9 (recover), Main Street (hold) and Harbor Yard
   (extract) use them. See `docs/mechanics/01-turn-flow.md`.
6. **Health and damage** (added by Leon 2026-10-09) — *done.* Every character has **30 HP**; gun damage comes from
   the round (`shared/content/calibers.js`: 9 mm, 5.56, .300 BLK, 7.62×39, 7.62×51, .338, 12-gauge), not the gun.
   Armour, explosives, melee, fire and falls were rescaled to the new pool and the balance sim's win rates kept near
   their old values. See `docs/mechanics/04-ballistics-and-weapons.md` and `07-units-and-classes.md`.
5. **Line of sight for shots**: a shot must have line of sight (mechanics quirk 4); it matters more with floors.

## 9. Determinism and congruence rules (from the map-to-world playbook)

- One uniform scale from the picture's frame to the grid; the grid size comes from the content, not a fixed size.
- No import caps and no silent drops: repair undersized footprints, split touching ones, fail loudly otherwise.
- Doors only on ground-floor perimeter cells that aren't corners, with a walkable approach and an inside landing.
- Stairs as explicit footprints validated against the real floor, ending on a real upper floor or roof.
- Every random choice is seeded from `hash(mapId, buildingId, floor, room, seed)`; the package and seed decide the
  map byte for byte, which is tested.
- Never hand-edit generated JSON; change the rules and re-run the stage.

## 10. Budgets

| Item | Budget |
|---|---|
| Map size | ≤ 64 × 64 cells, store height ≤ 18 |
| Buildings | ≤ 6 per map, ≤ 4 storeys, ≤ 2 of them 4-storey |
| Build time (package → mission) | ≤ 1.5 s in Node |
| Tile-set instances | ≤ 6,000; draw calls ≤ 1,500 on the mobile profile (instancing across chunks may be needed: a sub-step) |
| Authoring run | stage A–C ≈ 1 + 1 + (floors) model calls; a 4-building, 12-floor map ≈ 15 image generations |

## 11. Files

```
tools/mapgen/cli.mjs                      npm run mapgen -- --image <file> --id <id> [--seed n] [--redo <stage|item>]
tools/mapgen/providers/vision.mjs         site read + concept read-back (configurable OpenAI vision, validated JSON)
tools/mapgen/providers/text.mjs           level design (configurable OpenAI text model)
tools/mapgen/providers/image.mjs          concept art (configurable OpenAI image model)
tools/mapgen/prompts/*.md                 versioned prompts and the design brief
tools/mapgen/schemas/*.json               site, design, floorspec, layout, manifest JSON schemas
shared/generation/WaveFunctionCollapse.js restored solver (from vibe-game, cf16d62)
shared/mapgen/SiteSolver.js               parcel WFC
shared/mapgen/FloorSolver.js              room-cell WFC with stacked cores and aligned walls
shared/mapgen/FacadeSolver.js             facade and detail WFC
shared/mapgen/StoreyCompiler.js           ModernBuilder generalised to room graphs and 4 storeys
shared/mapgen/PackageBuilder.js          layout.json → mission (MapKit), pure
shared/mapgen/Gates.js                    vertical, story and congruence gates; repairs
shared/mission/Maps.js                    registers packages
client/public/maps/<id>/                  packages
docs/MAPGEN.md                            how to make a map from a picture
```

## 12. Steps (milestones, each with its acceptance check)

| # | Step | Accept when |
|---|---|---|
| M0 | Fix rule quirks that block vertical play: shots need LOS, the glass rule (§8.2 — **done**), burning expiry | focused tests; full suite green |
| M1 | Restore the WFC solver; extend ModernBuilder into `StoreyCompiler` (room graphs, 4 storeys, stacked cores, aligned walls, second escape) | a hand-written 4-storey `layout.json` builds; gates pass on 4 seeds; collapse test |
| M2 | `layout.json` schema, `PackageBuilder`, package registry in `Maps.js`; port Cedar Close to a package | Cedar Close from the package is byte-identical across runs; map tests extended to packages |
| M3 | Floor-plan WFC and facade WFC from a hand-written `design.json` (no AI yet) | 20 seeds × 3 programmes solve without contradiction, or fail with a named constraint |
| M4 | Site WFC and the congruence audit | a hand-written `site.json` → congruent site (IoU ≥ 0.85), no dropped buildings |
| M5 | New pieces (§7; ladder **done**) and moves (§8.3 — **done**); high-ground cover (§8.1) | kit tests for parity and winding; traversal and cover tests |
| M6 | Authoring CLI with providers; stage A and B against the Cedar Close concept; review in a browser preview | `site.json` / `design.json` validate against their schemas; human review |
| M7 | Stage C concept art and read-back; the full run → a package; the gates | one new 3–4 storey map passes every gate on 4 seeds and plays in co-op |
| M8 | Objectives (§8.4 — **done**) and story decor; briefing UI with concept art | an extract or recover mission plays to completion in the sim |
| M9 | Three more maps from three pictures; docs | `docs/MAPGEN.md`; every map passes the gates |

Current acceptance evidence: M1 has a saved four-storey fixture passing four seeds and local-collapse/access tests; M2 registers separate Cedar Image and Signal House packages (the original hand-built Cedar Close remains separate); M3 passes 20 seeds × house/office/warehouse including required adjacency checks; M4 checks count and IoU after uniform scaling and contact repair. M5 movement and height-aware cover work with the existing kit. M6/M7 providers and cached concept/read-back stages have schema and injected-provider coverage; real model calls/art review are pending. M8 recover completion and replay hashes are tested; new story art and briefing UI are deferred. M9's three new picture-derived artistic maps remain deferred. Rectangular floor bays are the present WFC vocabulary; polygon floors and new facade/detail modules remain future work.

## 13. Tests

- Solver: determinism (same seed → same assignment), contradiction reporting, fixed cells honoured.
- StoreyCompiler: every floor reachable; cores stacked; partitions supported; doors not on corners; stairs end on a
  floor; collapse leaves the building standing.
- Package: byte-identical builds; schema validation; all existing gates plus the new ones on 4 seeds.
- Pipeline: recorded model responses (fixtures) so CI never calls a model; a contract test per schema.
- Rendering: new pieces within budget, parity with collision footprints, correct winding.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Vision read is wrong or hallucinates | strict schema with game-only values, confidence thresholds with theme defaults, human review step, `--redo` |
| Concept art doesn't match the programme | used only as a soft prior; the solver enforces the programme; regenerate one floor |
| WFC contradictions on tight footprints | stair cores and walls fixed first, bounded backtracking and reseeds, programme relaxation in steps (areas ±25 % → ±40 %) |
| 4-storey maps hurt mobile performance | budgets in §10, cross-chunk instancing, cutaway hides upper floors by default |
| Model or provider cost and keys | runs only at authoring time; responses cached in the package; keys stay in the Mac's environment, never in the repo |
| Rule changes (§8) shift balance | sim runs before and after; BALANCE.md update |

## 15. Rollback

Each milestone is its own commit. Packages are data next to the hand-built maps, which are untouched; removing the
registry entry removes a generated map. M0 and M5 rule changes are covered by tests and can be reverted
individually.

## 16. Decisions needed (Leon)

1. **Image model for concept art** (stage C): OpenAI Images, Google Gemini image generation, Stability, or a local
   ComfyUI/SDXL on the Mac. The vision and design stages assume the Claude API. All need an API key in the Mac's
   environment.
2. ~~Glass rule~~ — decided: aesthetic only (§8.2, done).
3. ~~New moves~~ — in scope (§8.3, done).
4. ~~Objectives~~ — in scope (§8.4, done; the briefing UI with concept art stays in M8).
5. **First picture**: the Cedar Close concept, or a picture of your choice for the first generated map?
