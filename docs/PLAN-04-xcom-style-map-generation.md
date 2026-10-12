# PLAN-04 — XCOM 2-style map generation: uniform modules, noise-guided WFC outside and inside

Status: **implemented** (2026-10-10, P0–P9) with the recommended decisions in §11: 6×2 switchback, downtown/industrial/suburb first, cover from WFC (scatter retired on generated maps), existing textures with tint and wear. The five hand-built maps were deliberately left hand-built; see [MAPGEN](MAPGEN.md#generated-operations-and-the-v3-pipeline-plan-04) for what shipped, measurements and limits.
Builds on PLAN-02 / PLAN-03 as implemented up to `c3dc68c`. Amends PLAN-03 §5.1 (fire exits).

## 1. Leon's direction (2026-10-10)

1. Fire escapes and every other way to scale a building are **uniform**: fixed sizes that never change from building
   to building, modelled on XCOM 2's fire escapes.
2. Improve the map designs: **noise-guided wave function collapse for the exterior**, driven by the picture
   references; the **interior gets its own noise and WFC** using our pre-baked tiles and textures.
3. Use any method that works, and **invent new ones where needed**, so maps fit the gameplay flow and feel like a
   place in the world, the way XCOM 2 maps do.

## 2. Goal

Every map reads as a believable piece of a larger place and plays like a designed XCOM 2 level: a clear line of play
from insertion to objective, flanks, cover where fights happen, height and underground used on purpose, and
buildings whose outsides and insides are assembled from a fixed, uniform kit. The picture decides the character;
noise supplies variety; WFC guarantees that the pieces fit; gameplay fields decide where things matter.

## 3. Non-goals

- New art. Every module uses the existing pre-baked tile set and textures (placeholder pieces from code where a module
  is new, as today).
- Non-rectangular grids or free-form geometry: everything stays on the voxel grid.
- Running any model at play time (unchanged).
- Rebalancing weapons or units.

## 4. Evidence (on `c3dc68c`)

**Fire escape (`shared/mapgen/FireEscape.js`).** Each upper floor gets a 3×3 grate landing on the east facade, with
an outer railing, and **ladders** between landings that alternate north and south of the landing (`y = mid ± 2`). So
a 3–4 storey building still climbs by ladders, against PLAN-03 D3 ("3+ floors: no ladders"). The structure's size
follows the building's mid-line and floor count, and there are no stairs.

**One-storey roof access (`StoreyCompiler`).** A single `MapKit.ladder` on the west wall, cut through the parapet.
Two-storey buildings get the fire escape, not a roof ladder.

**Exterior generation.**
- `SiteSolver` and `LayerSolver` solve 4×4-cell parcels with only a handful of kinds (building, street, sidewalk,
  yard; rock, tunnel, junction; air, rooftop, bridge). The picture's read pins most of them.
- Cover and props come from `CoverScatter` (random placement with a max-gap rule), not from WFC.
- There is no noise anywhere in the site pipeline.

**Interior generation.**
- `FloorSolver` uses one fixed template for every floor: a 3-cell central hall plus two rows of bays. WFC only
  decides which room kind goes in which bay.
- `FacadeSolver` picks window or wall per perimeter slot. Furniture comes from `ModernBuilder.furnish`.
- Every generated building is stucco, with exits mid-wall on the west and east.

**Solver.** `WaveFunctionCollapse.js` already supports per-node weights (`nodeWeights`), fixed cells, initial
domains, deterministic backtracking with a budget, and entropy with seeded jitter. That is enough to drive WFC from
noise and gameplay fields without a new solver.

**Context.** XCOM 2 builds maps as a **plot** (the overall map and its backbone) filled with **parcels** (a parking
lot, a building) that are swapped in piece by piece "like a quilt" ([Game Developer, Jake Solomon](https://www.gamedeveloper.com/design/jake-solomon-explains-the-careful-use-of-randomness-in-i-xcom-2-i-);
[GDC 2018, Plot and Parcel Procedural Level](https://gdcvault.com/play/1025213/Plot-and-Parcel-Procedural-Level)).
Hierarchical semantic WFC ([Alaka & Bidarra, FDG 2023](https://graphics.tudelft.nl/Publications-new/2023/AB23)) adds
meta-tiles that collapse into finer tiles, which matches a plot → parcel → piece hierarchy.

## 5. Design

### 5.1 The uniform kit metric

Every generated thing snaps to one metric, so modules never resize:

| Unit | Size | Used by |
|---|---|---|
| cell | 1 voxel (≈ 0.9 m) | everything |
| storey | 3 voxels (slab + 2 headroom) | buildings, fire escapes, underground levels |
| bay | 2 cells | facades (window, door, pier), fire-escape modules, interior partitions |
| lot | 8 × 8 cells | parcels (a lot is 4 × 4 bays) |
| block | 16 × 16 cells (2 × 2 lots) | plot structure, large parcels |

Building footprints become whole multiples of a bay (with a one-cell wall shell), so facade modules always tile them.

### 5.2 Uniform vertical access (amends PLAN-03 §5.1)

**Fire escape module (XCOM 2 style), one per storey, always the same size: 6 cells along the facade × 2 cells out.**

```
  facade wall ────────────────────────────
  inner row   [L][L][s][s][L][L]   ← stair flight rises left→right on odd storeys
  outer row   [L][L][s][s][L][L]   ← stair flight rises right→left on even storeys (other row)
              landing  flight  landing   (each landing 2×2, railing on its open sides)
```

- Each storey adds the same 6×2 module stacked on the one below. A landing is 2×2 grate; the two flight cells climb
  the 3-voxel storey (steps at +1 and +2 onto the next landing at +3). Flights alternate rows (inner / outer) so a
  flight always has 2 voxels of headroom over the one below it.
- Doors open from the landing that sits in front of a facade bay on the floors the design picks; other landings are
  railed all round (PLAN-03 D3).
- The bottom flight starts from a 2×2 street landing; the top landing reaches the roof over a 2-cell parapet gap.
- **Stand**: steel posts under the outer corners of every landing, down to footings, and wall brackets. They carry
  the module in the support field (PLAN-03 §5.5), so shooting out posts drops landings.
- **Placement**: one per building of 3–4 storeys, on the facade facing an approach lane, centred on a bay boundary,
  never over a door or the entrance apron, leaving a 2-cell clear street apron. If no facade fits, the building is
  rejected and regenerated rather than given an odd-sized escape.

**Other ways up, each a fixed module:**

| Module | Size | Rule |
|---|---|---|
| Roof ladder | 1 cell wide, 1 storey tall per segment, top hoop over a 1-cell parapet gap | 1–2 storey buildings with flat roofs only (PLAN-03 D3); on a blank facade bay |
| Manhole | 1 × 1 shaft, one underground level, ladder on one wall | single-level underground |
| Service stair | the fire-escape module turned inward inside a 6 × 3 shaft | deep underground (2 levels) and hive maps |
| Drainpipe (climb) | 1 cell, building height | optional climb on 1–2 storey buildings; same rules as the roof ladder |
| Container / rubble step | 1 storey | existing jump/climb rules, no new module |

A **validation gate** checks every access structure against its module template (cell-for-cell), so a size change
can't ship.

### 5.3 The generation pipeline: plot → lots → modules, guided by fields

```
picture ──► site read ──► PLOT (backbone)  ──► GUIDE FIELDS ──► EXTERIOR WFC (hierarchical) ──► BUILDINGS ──► INTERIOR WFC ──► DRESSING ──► GATES
             (vision)     roads, blocks,       picture prior     district → lot → bay/piece      shells,       room tiles,       wear,         flow,
                          water, levels        + noise           (noise-weighted)                facades,      furniture         texture       cover,
                                               + gameplay                                        access        clusters          variants      flanks …
```

**1. Plot (the backbone).** From the site read and a context catalogue (downtown grid, suburb cul-de-sac, industrial
yard, roadside strip, slum alleys, underground-heavy), the plot fixes roads, blocks, water, bridges, the street
datum and the map edges. The picture says which plot family and where the roads run; plots are authored templates
with sockets, like XCOM 2's.

**2. Guide fields (new method: field-guided WFC).** Several low-resolution scalar fields over the map, all
deterministic from the seed and the picture:

| Field | Source | Steers |
|---|---|---|
| Picture prior `P(kind, cell)` | the vision read upsampled (building / road / green / water / height cues per area) | what goes where, so the map resembles the reference |
| Variety noise `N` | seeded fBm (value noise, 2–3 octaves), different frequency per layer: district, lot, detail | which of the allowed variants appears, so nothing tiles visibly |
| Line of play `L` | distance to the path insertion → objective, plus left and right flank paths, computed on the plot before WFC | cover density and building openness near the fight; quieter edges |
| Sightline field `S` | open distance along 8 directions from each cell, recomputed per WFC stage | breakers where sightlines exceed the gate, open lanes where the overwatch should be |
| Height intent `H` | the design's played heights + noise | which lots carry tall buildings, rooftops, bridges |

Each WFC tile weight at a cell becomes
`w = base(tile) · P(tile, cell)^α · f(N(cell), tile)^β · g(L, S, H, tile)^γ`, passed through the solver's existing
`nodeWeights`. α, β, γ are per-plot tunables. WFC still guarantees adjacency; the fields only bias choices.

**3. Exterior WFC, hierarchical** (Alaka & Bidarra style meta-tiles):
- **District level** (per block): commercial / residential / industrial / park / yard / plaza, from `P` and `N`.
- **Lot level** (8 × 8): lot kinds per district (corner shop, terrace row, parking lot, depot yard, pocket park,
  vacant lot, container stack, construction site, subway entrance plaza …). Each lot kind is a **parcel template**
  with fixed sockets (street frontage, alley, party wall, underground opening). Objective lots are a separate
  pool, as in XCOM 2.
- **Bay / piece level** (2 × 2 inside lots): sidewalk pieces, kerbs, planters, bus stops, barriers, parked cars,
  fences, hedges, dumpsters — **cover becomes part of WFC** instead of random scatter, with sockets so cars sit on
  roads, benches face streets, barrier runs connect, and cover clusters form readable positions (XCOM 2 "cover
  islands") where `L` says fights happen.
- Vertical sockets from PLAN-03 (drops, manholes, bridges, entrances) are tiles at the lot and bay levels.

**4. Buildings.** A lot with a building socket gets a shell sized in bays from the lot template (fixed footprints:
2×3, 3×3, 3×4, 4×4 bays + shell), the played height, and a **facade WFC per storey** over bay tiles: window
(punched, band, storefront, full glazing), door, pier, blank, vent, balcony, fire-escape bay, signage. Vertical
sockets keep windows aligned and ground floors commercial when the lot is commercial. Wall material comes from the
district plus `N` (brick, stucco, concrete, siding: no more stucco everywhere). Exits face the street or alley sockets
of the lot, not fixed west/east.

**5. Interior WFC with its own noise (new: two-pass interior).**
- **Pass A — plan WFC on a bay grid.** Tiles are room-cell tiles (room kind × role: corridor, room interior,
  wall-adjacent, corner, door, window bay, stair core, column). Constraints: the design's room programme and
  adjacency, stair core fixed and stacked, doors on bay boundaries, service rooms closed. An **interior noise** field
  (different seed and frequency per building and floor) varies the plan: corridor offset, open-plan vs cellular,
  where partitions jog. That replaces the single corridor-plus-two-rows template.
- **Pass B — furnishing WFC on cells inside each room.** Tiles are pre-baked furniture clusters (desk pod, meeting
  table, kitchen run, bed and nightstand, shelving aisle, counter, crate stack, sofa set, lab bench …) with
  sockets: back to wall, front clear, door swing clear, aisle connectivity. A **clutter noise** sets density and
  disorder (tidy office vs ransacked squat), and the gameplay field `L` (inside: distance from breach doors to the
  objective) places half and full cover where the room fight happens.
- **Story dressing.** Beat props (cash table, CCTV bank, lab, squat) are fixed tiles placed first, as WFC pins.

**6. Dressing: pre-baked texture variants by noise.** Each material gets variant slots from the existing texture
set (clean, worn, dirty, damaged, graffiti or stained where available). Low-frequency noise picks variants per
building and per lot, so whole streets age together instead of per-tile flicker; interior wear follows the clutter
noise. Colour accents (doors, signage, awnings) are sampled from the picture's palette, quantised to the kit's
colour slots.

**7. Fitting into the world (new: world-edge treatment).** A map is a window into a city, not an island:
- Edges are closed by "world" lots: tall building faces, fences, walls, embankments, with backdrop buildings beyond
  (MissionBackdrop) continuing the district.
- Roads and tunnels run off the map with closed-off ends (barricades, police cordon, tunnel doors) so the plot reads
  continuous.
- The skyline backdrop, fog and lighting preset come from the picture's time of day and district.

### 5.4 Gameplay-flow methods (new)

- **Flow-first carving.** The line of play, two flanks and the evac zone are computed on the plot and pinned into
  every WFC stage as fixed corridors and weights, before anything else is solved.
- **Engagement pockets.** Along the line of play, every 8–12 cells, a pocket of 3–5 cover pieces facing the
  advance is pinned as a WFC seed (the XCOM 2 rhythm of move, take cover, push). Pods spawn at pockets.
- **Local repair by re-collapse** (after Merrell's model synthesis). When a gate fails (a sightline too long, a
  room with one entrance, no flank), only the region around the failure is un-collapsed and re-solved with weights
  adjusted toward the fix, instead of reseeding the whole map. That keeps good parts, converges faster and stays
  deterministic.
- **Gameplay critic.** After assembly the existing metrics plus new ones (pocket spacing, flank concealment, vertical
  use, interior breach options, distance from the objective to evac) score the map; scores feed the repair loop and
  are saved in the manifest.
- **AI awareness.** Pockets, flanks and drops are written into the mission so the enemy AI defends pockets and the
  squad autopilot uses flanks (the sim then measures whether flanks are used).

### 5.5 What stays

- Lockstep determinism: every field and solve is seeded from the map id, layer and seed; packages rebuild
  byte-identically.
- The voxel matrix stays the gameplay truth; modules compile to voxels plus render hints as now.
- Support (PLAN-03 §5.5), layers and datum (PLAN-03 §5.3), lighting (visual only).

## 6. Files

```
shared/mapgen/KitMetric.js            cell / storey / bay / lot / block constants, snapping helpers
shared/mapgen/AccessModules.js        fire-escape, roof ladder, manhole, service stair, drainpipe templates + validator (replaces FireEscape.js)
shared/mapgen/Fields.js               picture prior, seeded fBm noise, line of play, sightline, height intent
shared/mapgen/PlotCatalogue.js        plot families with road/block/edge sockets
shared/mapgen/LotCatalogue.js         lot (parcel) templates with sockets; objective lots
shared/mapgen/ExteriorSolver.js       hierarchical district → lot → bay WFC with field weights (replaces SiteSolver parcel solve, folds LayerSolver)
shared/mapgen/FacadeSolver.js         per-storey bay WFC with vertical sockets and district materials
shared/mapgen/InteriorPlanSolver.js   pass A: bay-grid plan WFC with interior noise (replaces FloorSolver template)
shared/mapgen/FurnishSolver.js        pass B: furniture-cluster WFC with clutter noise and gameplay weights
shared/mapgen/Repair.js               local un-collapse and re-solve for failed gates
shared/mapgen/Critic.js               gameplay-flow metrics and scores
shared/mapgen/Gates.js                module-template, pocket, flank, world-edge gates
client/src/render/kit/ModernPieces.js new modules: fire-escape landing/flight/post, facade bays, furniture clusters, world-edge pieces
client/src/render/MaterialLibrary.js  texture variant slots chosen by noise
tools/mapgen/schemas/*.json           plot, lot, field weights, critic scores in layout/manifest
docs/MAPGEN.md, docs/mechanics/02, 11 the method and the module rules
```

## 7. Steps (each its own commit, test first)

| # | Step | Accept when |
|---|---|---|
| P0 | Kit metric + `AccessModules`: uniform 6×2 fire-escape platforms connected by vertical ladders, separate primary interior stairs, roof ladder module, manhole, service stair; template gate | every access structure matches its template cell-for-cell on all fixtures; Signal House has ladder access outside and stairs inside; screenshot review |
| P1 | `Fields.js`: picture prior, fBm noise, line of play, sightline, height intent | fields deterministic per seed; a property test shows the noise is continuous and in range; line of play matches PathSearch |
| P2 | Plot catalogue (3 families first: downtown grid, industrial yard, suburb) + lot catalogue (12 lots) | a picture read picks a plot family; lots tile a plot with matching sockets on 20 seeds |
| P3 | `ExteriorSolver`: hierarchical WFC with field weights; cover and props as bay-level tiles (CoverScatter retired for generated maps) | existing combat gates pass on seeds 1–4; cover pockets on the line of play; the same picture with two seeds gives different but recognisable maps |
| P4 | Facade WFC per storey on bays; district materials; exits by lot sockets | windows align; no generated building is all stucco; doors face street or alley |
| P5 | Interior pass A (plan WFC + interior noise) | 20 seeds × 4 programmes give varied plans (not one template), every room reachable, two ways into most rooms, stair core stacked |
| P6 | Interior pass B (furnishing WFC + clutter noise + interior line of play) and story beat pins | furniture never blocks doors or splits floors; each room has cover near its fight; beat props placed |
| P7 | Engagement pockets, local repair, critic, AI awareness of pockets and flanks | failed gates repair locally in most cases (measured); the sim uses flanks in ≥ 25 % of battles; critic scores in the manifest |
| P8 | Texture variants by noise, palette accents, world-edge lots and backdrop continuity | no visible per-tile flicker; map edges closed by world lots; screenshot review against the reference picture |
| P9 | Rebuild the fixtures (Cedar Image, Signal House, Subway Crossing) and the hand-built maps through the new pipeline; docs | every map is a package that passes all gates on seeds 1–4; MAPGEN and mechanics updated |

P0 fixes the fire escape and can go first.

## 8. Tests

- Modules: each access module compiles to its exact template; rotation and mirroring keep the size; stairs-only
  reachability on 3–4 storey buildings; roof ladders only on 1–2 storey flat roofs.
- Fields: determinism, ranges, continuity; line of play equals the PathSearch route.
- Exterior: socket consistency at every level; picture prior respected (IoU of building and road areas against the
  read); variety between seeds; cover pockets present along the line of play.
- Interior: programme areas and adjacency; stacked cores; doors on bay boundaries; furniture connectivity guard;
  cover in rooms.
- Repair: a deliberately broken map is fixed by local re-collapse without touching cells outside the repair region.
- End to end: packages rebuild byte-identically; co-op hashes agree; sim completes on every fixture.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Hierarchical WFC contradictions grow with more tile kinds | meta-tiles collapse first; sockets kept small; backtracking budget plus local repair; failures name the socket |
| Field weights make maps samey (fields dominate) | per-plot α/β/γ; variety measured between seeds in tests |
| Cover from WFC loses the "every tile near cover" guarantee | the cover gate stays; repair adds pocket seeds where it fails |
| Interior variety breaks stacked cores and support | core and columns are pinned before the plan solve; support gate runs after |
| More modules and texture variants cost mobile performance | instancing per module; draw-call and instance budgets in the gates |

## 10. Rollback

Each step is its own commit. The new exterior and interior solvers sit beside the current ones behind the plot
version in the package (`generatorVersion`), so older packages keep building with the old path until P9 retires it.

## 11. Decisions needed (Leon)

1. **Fire-escape module**: the 6×2 switchback described in §5.2 (recommended), or a narrower 4×2 module with steeper
   flights (needs a 2-step rise rule)?
2. **Plot families first**: downtown grid, industrial yard, suburb (recommended), or others first (slum, roadside,
   underground-heavy)?
3. **Cover from WFC**: retire random cover scatter on generated maps (recommended), or keep scatter as a fill pass
   after WFC?
4. **Texture variants**: use only the existing textures with tint and wear masks (recommended, no new art), or
   commission worn/damaged variants?
