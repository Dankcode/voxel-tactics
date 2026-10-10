# PLAN-03 — Vertical maps from a picture: fire escapes, underground flanks, destructible buildings, dark lighting

Status: **implemented mechanics foundation** (2026-10-10), authorized by Leon’s “implement these changes” request.
Builds on PLAN-02 and the map builder in `d4a7b3b` (`docs/MAPGEN.md`).

## 1. Leon's direction (2026-10-09)

1. The exterior ladders on the generated apartment/office map are broken. A fire escape needs a real stand: a
   supported steel structure, not ladders.
2. Storey counts are a **concept**, not a fixed 2–4 rule: each map's design (read from the picture) decides how tall
   each building is. The 4-storey Signal House is only a multi-floor test fixture.
3. Generated tile sets get **underground sections** that open flanks, as in XCOM 2, where soldiers and enemies drop
   down from a bridge or street to a lower level.
4. Make the map generation a **novel method**, not "place buildings on a lot". Buildings can be torn open in the
   middle by gameplay (destruction).
5. Picture-to-map generation decides buildings and heights so the maps are fun and worth exploring.
6. Add **lighting** to the game design that fits the darker XCOM 2 / Phoenix Point look.

## 2. Goal

A picture becomes a map built in **layers**: underground, street, and elevated (rooftops, bridges, fire escapes).
Each layer has routes, and the routes between layers (drop points, stairs, ladders, holes) are what make flanks.
Buildings get the height the design gives them, can be breached and holed, and the whole map is lit darkly, with
light and darkness both visible and, where approved, part of the rules.

## 3. Non-goals

- New character art, briefing UI or final art for the new tile pieces (placeholders built from code, as today).
- Changing the hand-built maps' ground level (they keep the street at z = 1; see decision D1).
- Real-time global illumination or shadow-casting point lights on mobile.
- A structural engineering model. Support stays "connected to the ground"; §5.4 only adds what holes need.

## 4. Evidence (current state, measured on `d4a7b3b`)

**Fire-escape ladders (Signal House, building `command` at x 12–36, y 8–23).** `StoreyCompiler.compileBuilding`
builds one separate ladder per upper floor:

- The ladders stand in column x = 38, **two cells off the east wall**, in a row at y = 15, 16, 17, 18 (floors 1, 2,
  3, roof). Each ladder's only contact is a single `concrete` voxel at its top (x = 37) that serves as the landing.
- The kit draws a ladder segment with its back toward a solid neighbour at the same height (`KitView`, case
  `ladder`). Below the landing there is no solid neighbour, so the lower segments fall back to yaw 0 and face the
  wrong way. On screen this reads as four free-standing ladders and floating blocks (screenshot from the review).
- The landings are 1×1 cells with no railing and no support underneath; the exit door opens onto them.
- Exit-apron planters land at (37, 18–19), right by the roof ladder foot.
- Pathing works (all four landings are reachable by ladder only, `stepKind` = `climb`; the escape gate passes), so
  the break is the structure and the drawing, not the move rules.

**Storeys.** `SiteSolver.solveSite` clamps every building to 2–4 (`Math.max(2, Math.min(4, …))`), the offline
`LevelDesigner` gives every floor the same four rooms, and `Gates.storeys` requires 2–4.

**Ground level.** The street is z = 1 on every map: `createMap` lays the ground at z = 1 over bedrock at z = 0,
`MapKit` helpers default to z = 1, `StoreyCompiler` uses `baseZ` 1. There is no room under the street for anything.

**Destruction.** Two frag-sized blasts in the middle of Signal House remove 35 voxels and nothing collapses; cutting
a 4×4 shaft through all four slabs removes 38 voxels and nothing collapses (`settleUnsupported` keeps anything still
6-connected to bedrock). Holes in the middle of a building already work; a unit can drop through a hole with the
jump-down rule (2–4 voxels). Nothing ever collapses while one voxel still connects it.

**Lighting.** `Scene.js` has five presets (day, dawn, dusk, overcast, night): hemisphere fill 0.55–1.1, a sun with
soft shadows, a back light, distance fog, ACES tone mapping. `LanternLights` keeps a pool of 10 unshadowed point
lights near the camera focus for lantern voxels and lamp decor. Materials carry a `light` value (lantern 3, lava 2),
unused by the rules. The only rule tied to light is `dimRoomSpreadMult` (×1.25) for unlit rooms, and only
warehouse rooms are unlit.

## 5. Design

### 5.1 Fire escapes (fixes the broken ladders)

A fire escape is one connected steel structure on one facade, generated per building that needs a second way out:

- **Attachment**: platforms anchor directly to the building's floor slabs. Every ladder run has continuous
  facade backing. Fire escapes have no free-standing posts or exterior stair flights.
- **Landings**: a 3×3 metal grate platform at each upper floor, outside a door, with low outer-edge railing.
  A small socket extension provides the foot of the next ladder without closing the doorway.
- **Ladders**: alternating facade sockets between consecutive landings. Each run stops at the next floor,
  allowing soldiers to enter any storey instead of climbing one continuous column directly to the roof.
- **Ground access**: the first attached ladder starts on clear street ground; scatter reserves its foot.
- **Roof**: the final ladder ends on a metal roof landing connected through an open parapet doorway.

Fire-escape materials are `grate` (walkable, `projectile: 'pass'`, hp 4, metal, structural), attached `ladder`,
and `railing` (thin half cover, see-through). `steel_stair` and `steel_post` remain available for bridges;
they are not used by the fire escape. Railing collision comes from `BANDS`, like other grouped cover.

Rule fixes that come with it:

- A ladder must be **attached**: every ladder voxel needs a solid neighbour on the same side for its whole height
  (MapKit and the compiler fail loudly otherwise), and `KitView` orients each segment to that attachment, not to
  whatever is solid at that height.
- Planters and other scatter never land within 2 cells of a fire escape's foot or a ladder foot.

### 5.2 Picture-driven heights (storeys are a concept)

- The site read gives each building an **observed** storey count from the picture (1 to the store budget). The
  design stage then sets the **played** height for fun, with rules: a landmark (the tallest building, roof
  overwatch), filler (1–2 storeys), and the objective building. Not every building is tall; at least one approach
  lane is overlooked by height; going up always costs time (stairs, fire escape, ladder).
- The clamp becomes a budget: 1–4 storeys by default with store height ≤ 18 (decision D5 can raise it). Single-storey
  buildings get no fire escape.
- Floor programmes vary by use and height: ground floor public (lobby, shop, bar), upper floors private (flats,
  offices), top floor or roof for the beat that needs a view. The offline designer stops copying one floor four
  times.
- Signal House stays as the multi-floor test fixture; it is not a template.

### 5.3 Layered map generation (the new method)

The map is solved as **three stacked layers on the same parcel grid** (4×4-cell parcels, as `SiteSolver` uses now):

| Layer | Datum | Parcel tiles (examples) |
|---|---|---|
| Elevated | street + 3 and up | rooftop, bridge deck, fire-escape landing zone, walkway |
| Street | z = 4 on generated maps (D1) | road, sidewalk, plaza, yard, building footprint, **drop opening** (grate, broken slab, bridge edge), **entrance down** (subway stairs, ramp, manhole) |
| Underground | z = 1–3 | tunnel, junction, platform, storm drain, underpass, parking deck, basement, solid rock |

**Vertical sockets** tie the layers together. A street *drop opening* must sit over an open underground tile; an
*entrance down* must land on a walkable underground tile; a building footprint over a basement requires the
building programme to allow one; a bridge deck spans a sunken street or canal. One WFC solve runs over the three
layers at once (nodes = parcel × layer; neighbours = 4 sideways + up/down), seeded as today, with the picture's
read as fixed or weighted cells. The site read gains an `underground` hint (a subway sign, a canal, a ramp, a
bridge) and a `levels` field; when the picture shows nothing, the design stage may still add an underground route
if a flank gate needs one.

**Moving between layers** uses the rules that exist:

- **Drop down**: the jump-down rule (2–4 voxels, one way, staggered). The street-to-tunnel drop is 3 voxels, the
  bridge-to-street drop is 3. This is the XCOM 2 drop: quick, one way, noisy.
- **Climb back up**: stairs (subway entrance), ramps (parking), ladders (manhole, attached to the shaft wall).
- **Make a new drop**: explosives that break a street slab or a floor open a new drop point (5.4).

**Flank gates** (new, in `Gates.js`): at least one underground or elevated route connects the squad's insertion to the
objective building, at most about 1.6 times the length of the direct route, and hidden from the enemy start positions
for most of its length. Every underground area has two ways in. No enemy spawns where it can see a drop point at
the start. The squad cannot reach the objective by the underground alone without facing at least one pod.

### 5.4 Destructible buildings: holes in the middle

- Keep connectivity support (holes in the middle already hold, see §4). Add **slab breaching**: a breaching charge
  can be placed on a floor (not only a door) to blow a hole 2×2 into the room below, opening a drop. The existing
  explosion and settle code does the rest; the hole becomes a jump-down edge.
- **Span check (optional, D6)**: a slab voxel more than 6 cells from any wall, post or column falls when its last
  neighbour within that span is destroyed, so a building can be torn open, not only perforated, without a full
  structural model.
- Generated buildings get interior columns every 6–8 cells in large rooms so the span rule has supports to use.

### 5.5 Lighting: darker XCOM 2 / Phoenix Point look

**Look (renderer):**

- Re-tune the five presets darker: hemisphere fill about 40–60 % of today, a stronger key light, cooler shadows, an
  exposure that lets light pools read. Add a `night-ops` preset as the default for generated maps.
- A **voxel light field**: light from emissive materials (`light` > 0: lanterns, signs, fire, lava) and lamp decor
  spreads through air cells, blocked by opaque voxels. It is computed in shared code on load and after
  destruction (dirty chunks only). The chunk mesher and kit instances take the field as a per-vertex or per-instance
  tint. This costs no extra draw calls or lights, so it suits the mobile profile.
- The existing pool of 10 point lights stays for the brightest sources near the camera; emissive windows, light
  cones under street lights and red emergency lights underground come from the field plus emissive materials.
- Fire lights its surroundings (burning voxels add to the field), so grenades and arson visibly change the scene.

**Rules (D2 — only if approved):** generalise the dim-room modifier to **darkness**. A target standing on a cell
below a light threshold gets `B.darkSpreadMult` against shooters more than 4 cells away; underground is dark unless
lit; shooting out a light (`lantern` hp 1) darkens its area. Because the field is shared and deterministic, co-op
peers agree.

**HUD:** the move preview shows dark cells with a moon-style marker, the same way cover shows shields, so darkness
is information, not just mood.

### 5.6 Rendering the layers

- The street slab at z = 4 with holes needs the ground mesher (`Ground.js`) to treat the street as any other slab.
- The storey cutaway gains a **"below street"** level, so the camera can show the underground with the street cut
  away (PgDn past street level).
- Camera clamp: the rig's minimum height follows the lowest visible layer.

## 6. Rule changes

1. Ladders must be attached along their whole height (MapKit, compiler and kit).
2. New walkable `grate` and `steel_stair` materials and `railing` half cover.
3. Floor-placed breaching charge opens a 2×2 slab hole.
4. Optional span check (D6).
5. Optional darkness modifier (D2).

## 7. Files

```
shared/voxel/Materials.js              grate, steel_stair, steel_post, railing (+ BANDS entry in ConnectedShapes.js)
shared/mapgen/FireEscape.js            fire-escape layout per building + validation
shared/mapgen/StoreyCompiler.js        uses FireEscape; storeys 1–N; interior columns; door onto landings
shared/mapgen/LayerSolver.js           three-layer parcel WFC with vertical sockets (replaces SiteSolver's parcel solve)
shared/mapgen/UndergroundCompiler.js   tunnels, platforms, drains, parking, basements, entrances, drop openings
shared/mapgen/LevelDesigner.js         heights for fun, varied floor programmes, layer routes in beats
shared/mapgen/Gates.js                 flank, layer-connectivity, attached-ladder and fire-escape gates
shared/lighting/LightField.js          deterministic voxel light propagation (shared: rules + render)
shared/battle/Battle.js                floor breach, darkness modifier (D2)
client/src/render/Scene.js             darker presets, night-ops
client/src/render/ChunkMesher.js, kit/KitView.js   light-field tint; ladder orientation by attachment
client/src/render/kit/ModernPieces.js  fire-escape pieces, tunnel pieces
client/src/render/Ground.js, CameraRig.js, VoxelView.js   street slab above ground, below-street cutaway
tools/mapgen/schemas/site.json, design.json, layout.json   storeys policy, underground hints, layers
docs/MAPGEN.md, docs/mechanics/02, 03, 05, 11            rules and method
```

## 8. Steps (each is its own commit, test first)

| # | Step | Accept when |
|---|---|---|
| N0 | Ladder attachment rule + kit orientation fix; scatter keeps clear of ladder feet | free-standing ladder fails to build; existing ladder maps unchanged; screenshot review |
| N1 | Fire escape: materials, pieces, `FireEscape.js`, compiler uses it | Signal House: every upper floor and roof reachable by the fire escape only; railings rate HALF; destroying its facade anchors drops it; screenshot review |
| N2 | Storey policy: picture/design-driven heights 1–4, varied floor programmes, landmark/filler rules | a 3-building fixture builds 1, 2 and 4 storeys; no two floors share a programme unless the design says so |
| N3 | Street datum z = 4 for generated maps; ground mesher, camera and cutaway "below street" | a generated map with an empty underground renders and plays; hand-built maps byte-identical |
| N4 | `LayerSolver` + `UndergroundCompiler` (tunnel, junction, stairs entrance, manhole, grate drop, underpass under a bridge) | 20 seeds solve or fail with a named socket; drop and climb edges exist where the layout says |
| N5 | Flank gates + one fixture with a bridge over a sunken street and a subway tunnel | gates pass on seeds 1–4; the sim uses an underground or drop route in at least 25 % of battles |
| N6 | Slab breach + optional span check (D6) | a floor charge opens a drop; a 4-storey building can be holed through the middle without full collapse |
| N7 | Light field, darker presets, night-ops, HUD dark-cell marker; darkness rule if D2 | field deterministic across peers; shooting a lantern darkens its cells; mobile profile within draw-call budget |
| N8 | Docs and the mechanics reference | `docs/mechanics` regenerated; MAPGEN describes the layer method |

N0 and N1 fix the reported bug and can go first on their own.

## 9. Tests

- Ladders: attached-ladder validation; orientation chosen from the attachment; foot clearance.
- Fire escape: reachability per floor with stairs disabled; railing cover; attached ladder runs stop at every platform; losing facade support drops the landing.
- Layers: socket compatibility; every drop opening lands on walkable underground; every underground area has two
  ways in; flank gate positive and negative fixtures.
- Datum: hand-built maps unchanged (hash), generated maps rebuild byte-identically.
- Destruction: slab breach opens a jump-down edge; hole through all floors leaves the building standing; span rule.
- Lighting: light field determinism and incremental update after destruction; darkness modifier (if approved).
- Sim: generated fixtures complete; report how often drop and underground routes are used.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Raising the street to z = 4 touches every height assumption | generated maps only (D1); a datum constant in `createMap`; hand-built maps tested for identical hashes |
| Underground flanks make missions trivial | flank gate requires a pod on the way; noise from drops alerts pods; AI knows the routes |
| Light field cost on large maps | per-chunk incremental updates, a max light radius of 8, integer levels |
| Darkness frustrates players | HUD marker, flares or flashlights later; the rule is opt-in (D2) |
| Fire escapes clutter facades | one per building at most, on the side facing an approach lane |

## 11. Rollback

Each step is its own commit. The layer solver is behind the generated-map path; hand-built maps don't use it. The
darkness rule is a tunable that defaults to 1 if D2 is declined.

## 12. Decisions needed (Leon)

1. **D1 Street datum**: raise the street to z = 4 on generated maps only (recommended), or on every map (rebuilds
   the hand-built maps)?
2. **D2 Darkness as a rule**: dark cells raise spread against far shooters (recommended), or lighting is visual only?
3. **D3 Fire escape**: resolved by the latest request: only attached ladders and metal platforms,
   with a stop at each floor and the roof, following the XCOM 2 style.
4. **D4 First underground kinds**: subway tunnel + storm drain + underpass under a bridge (recommended), or start
   with basements and parking?
5. **D5 Height budget**: keep the 4-storey / store height 18 cap, or raise it (6 storeys needs height ≥ 24 and a
   mobile performance check)?
6. **D6 Span check**: add the simple span rule so buildings can be torn open, or keep "connected means standing"?


## 13. Implementation record (2026-10-10)

N0–N7 are implemented: continuous ladder attachment/orientation, supported steel escapes, observed/played 1–4 heights and varied floor programmes, generated datum 4 and BELOW cutaway, one three-layer parcel graph and compiled tunnels/sockets, flank gates and Subway Crossing fixture, 2×2 floor charges, shared incremental integer lighting and the darkness modifier. N8 updates MAPGEN and the mechanics reference.

D1: generated maps only. D2: darkness ×1.25 beyond four cells, tunable to 1 for visual-only lighting. D3: facade-mounted metal platforms with alternating ladder runs; no exterior stair flights. D4: subway, wet storm drain and raised-bridge underpass. D5: four storeys/height 18. D6: keep connectivity support; the optional span model and its column placement are deferred. Fire escapes now use only facade-mounted metal platforms and attached ladder runs, as requested after implementation. Alternating sockets allow a stop at every floor and the roof. They use the building slabs and continuous wall backing for support, without exterior stair flights or a free-standing tower. Generated-map preflight rejects disconnected squad spawns, escape/roof landings, missing facade anchors and initially unsupported geometry.

The alternate-escape test disables the **indoor** core cells, allowing steel stairs. Disabling every stair material would also disable the escape itself. Geometry/route gates use real voxel surfaces; parcel WFC is constrained by solved route/socket priors. Recorded image fidelity remains count/footprint IoU, with observed and played heights kept separately. Final art, bespoke facade placement, arbitrary polygon interiors and live model/art acceptance remain deferred.

Regression coverage includes 20 seeds of sockets and deterministic solves, four-seed package gates, attached ladders, escape-only floor/roof access, railing HALF cover, post loss, legacy map hashes, floor-charge drops, deterministic light/opaque blocking/lantern destruction/fire and darkness agreement across peers. The Subway Crossing four-seed simulation records 75% underground/drop route use with no draws.

Final verification: **118 tests passed**, production build passed, all three packages passed seeds 1–4 at roughly 0.3 seconds per build. Subway Crossing recovered the objective in 4/4 simulated battles, with 75% underground/drop route use and no draws. Production browser checks covered fire-escape climbing (z4→z7, 2 AP, 30 HP retained), ABOVE/BELOW cutaways, night-ops tunnel focus, console errors and the mobile draw-call budget. The full Signal House profile used 302 draw calls; the below-street night fixture stayed well below that. Screenshots were reviewed locally. The existing crowded mobile HUD is deferred with the visual design phase.
