# Xcom2 game: Fireteam (working title)

A 2D-character XCOM 2-style game in the browser with co-op multiplayer and PvP. Repo:
[Dankcode/Xcom2-game](https://github.com/Dankcode/Xcom2-game); the full history of the earlier local
`voxel-tactics` repo is in it.

Spun off from [Dankcode/vibe-game](https://github.com/Dankcode/vibe-game) (path search, traversal, RNG and the tile-set
contract came from there; see `PROVENANCE.md`). Current focus: **mechanics**. Final visual design is deferred to the map builder. [PLAN-02](docs/PLAN-02-image-to-map-generation.md) and [MAPGEN.md](docs/MAPGEN.md) cover the deterministic multi-storey builder and its mechanical fixtures.

A present-day, turn-based co-op tactics game in three.js: **XCOM 2** side phases, cover, overwatch, breaching and
an XCOM-style camera, and **Phoenix Point** free-aim ballistics with body parts, on fully destructible maps.
Characters are 2D. Every committed action plays a **Chaos Zero Nightmare-style back shot**.

The battlefield is a voxel grid underneath — movement, cover, line of sight, ballistics, fire and destruction run
on it — but nothing is drawn as blocks: terrain is meshed with rounded edges, kerbs and recessed roads, buildings
are generated from room programs (houses, shops, a diner, offices, a warehouse, a motel …) and drawn with a modern
pre-baked tile set (slim-framed glazing, flush doors, roller shutters, furniture), and cars, containers and trees
are drawn as whole objects. The block-world look stays in vibe-game.

> Test build. Character and tile-set art is **placeholder** (procedural, see `docs/LEVELS.md` → Resource
> requirements), and the animation code is a skeleton with marked TODOs. The battle rules, maps, destruction,
> elements, formations, AI, balance sim and online co-op work. See `docs/LEVELS.md`, `docs/TILESET.md`,
> `docs/RENDERING.md`, `docs/ANIMATION-AUDIT.md` and `docs/BALANCE.md`. **Every game rule is documented in
> [`docs/mechanics/`](docs/mechanics/README.md)** (generated tables refresh with `npm run docs:mechanics`).

## Quick start

```bash
npm install            # on macOS run this natively (don't copy node_modules between machines)
npm run dev            # http://localhost:5173  → menu
npm test               # mechanics and co-op tests: voxels, cover, elements, ballistics, battle, buildings, maps, tile set, co-op room
```

Deep links for testing:

| URL | What |
|---|---|
| `/?play=cedar-close&seed=3` | Suburbs: two modern homes and a street |
| `/?play=main-street` · `harbor-yard` · `route-9` | Downtown (dusk) · Industrial docks (night) · Roadside gas station and motel (dusk) |
| `/?play=signal-house&seed=1` | Four-storey mechanical fixture: stairs, independent ladder escapes, locked service rooms and upper-floor intel recovery |
| `/?play=proving-grounds` | Training Facility: the test map with every system in it |
| `/?play=operation&plot=downtown&seed=4` | Generated operation (PLAN-04): a new map per seed. `plot` = `downtown` · `industrial` · `suburb`; optional `objective` (`recover` · `extract` · `hold` · `eliminate`) and `time` (`day` · `dawn` · `dusk` · `overcast` · `night` · `night-ops`) |
| `…&auto=1` | Squad plays itself (AI vs AI), useful to watch balance |
| `…&cutins=off` | Skip back shots (`always` / `first` / `off`) |
| `…&debug=1` | Start with debug mode on (or tick *Debug mode* in the menu, or press F1 in battle) |

**Online co-op:** `npm run server` (port 2567), then *Host online co-op* in the menu and share the room code;
teammates use *Join*. Soldiers are dealt round-robin; the squad's turn ends when everyone has pressed End turn.
`npm run dev:all` runs client and server together.

## How a turn plays (XCOM 2 flow, Phoenix Point AP)

1. **Select** a soldier (click, `Tab`, or the squad column). The ground shows the **blue zone** (move and still
   have AP for an action) and the **yellow zone** (dash: spend everything on movement).
2. **Hover** a tile: a path ribbon, the destination marker, the AP cost, and XCOM shields on the destination's
   faces (half / full cover; a red **!** shield when a visible enemy would flank you there).
3. **Click** to move. The action bar stays up while the soldier has AP.
4. **Act**: pick a weapon (`1`–`9` or click). Targeting mode frames the shot, lists visible enemies as red icons
   above the bar (`Tab` cycles), shows the hit chance per body part (`Z X C V G`), and **Space / the Fire button
   / clicking the target again** fires. `Esc` backs out.
5. When a soldier is out of AP the next ready soldier is selected; when the whole squad is spent the turn ends on
   its own (Options ⚙ → *Auto end turn*), or press **End turn** / `Enter`.
6. **Enemy activity**: the camera follows each hostile that acts; then the next round starts.

## Controls

| Input | Action |
|---|---|
| Left click | select soldier · move · in targeting: pick / fire · throw / overwatch target |
| Right click / Esc | back out of targeting or a mode · right-drag pans |
| `1`–`9` | ability bar slots (weapons, grenades, overwatch, reload, abilities, formation, breach, door) |
| `Tab` / `Shift+Tab` | next / previous soldier (in targeting: next / previous target) |
| `Space` | fire (targeting) · `Enter` end turn |
| `Z X C V G` | aim at head / torso / L arm / R arm / legs |
| `Alt` + click | free aim at any voxel (shoot cover away) |
| `T` throw · `O` overwatch · `R` reload · `F` formation · `B` breach | |
| WASD / arrows / screen edges / right-drag | pan the camera |
| `Q` / `E` | rotate 90° · middle-drag orbits freely |
| wheel | zoom (the camera tilts up as it zooms out) |
| `H` / `Home` | centre on the selected soldier · `V` isometric view on / off |
| `PgUp` / `PgDn` | storey cutaway |
| `F1` | debug mode |

## Debug mode

Turn it on with `?debug=1`, the menu checkbox, the bug button in the top bar, or `F1`. The drawer has five tabs:

| Tab | Tools |
|---|---|
| **World** (click the map) | inspect (`F2`), teleport the selected unit (`F3`), destroy voxels (`F4`), place any material (radius / height), explode (`F6`, radius / power), ignite (`F7`), freeze (`F8`), soak, gust, quake, smoke, spawn any unit type on either side |
| **Units** | every unit with HP / AP / position: select, +AP, heal / revive, kill, refill, +stress, burn / chill / stun; heal squad, +AP to the active side, kill visible, god mode |
| **Turn** | end the active side (`F10`), take control of the enemy side, pause the AI and step it one action at a time (`F9`), autoplay the squad, playback speed, back-shot mode, alert all pods |
| **View** | fog of war, reveal rooms, overlays (cover map, line of sight from the selected unit, rooms, reach cost, element field), lighting (day / dusk / night), shadows, render stats |
| **Mission** | restart, new seed, generate fresh map-builder layouts, jump to any map, map metrics and gates, weapon stats, battle hash |

A readout at the top of the screen shows the hovered tile: coordinates, materials and voxel HP at ground / +1 /
+2, cover per side, room id, element state and any unit there. Battlefield editing actions use a `{ type: 'debug' }`
intent (`shared/battle/DebugOps.js`): it animates like normal play, stays deterministic, and is refused unless
the battle was created in debug mode (online rooms only when the host ticked debug).

To test the map builder, start a local battle, press **F1 → Mission**, choose a seed,
building programme, storeys and time, then click **Generate map**. **New layout** increments
the seed and reruns the site, floor, facade and underground solvers; **Restart** replays
the same generated map. Gate results appear below the controls. Navigation and structural support are checked before loading: every squad spawn, upper
escape landing, roof and gameplay room must be reachable. Fire escapes use facade-mounted metal
platforms and attached ladders, with a reachable stop at each storey and the roof. Compiler errors preserve
the current battle and show the failing seed. These are procedural test sites, with no API key
or installed-map files required. They do not run screenshot analysis.

The console entry point is `await __game.debug.generateMap({ seed: 3, program: 'office', storeys: 4, timeOfDay: 'night-ops' })`
while local debug mode is enabled. It returns `{ options, site, layout, design }` on success
(and `null` with an on-screen error on failure). The same data remains available at
`__game.battle.mission.meta.debugGeneration` for inspecting or exporting the generated blueprint.
Map generation replaces the current local battle and resets its progress.

## What the battle tests

- **Five present-day maps in five themes** (`docs/LEVELS.md`): Cedar Close (suburbs), Main Street (downtown),
  Harbor Yard (docks), Route 9 Stop (gas station and motel), Training Facility. Human opposition only for now: the
  Syndicate.
- **Buildings from room programs** (`shared/mission/modern/ModernBuilder.js`): rooms front to back, doors so most
  rooms have two ways in, open-plan openings, stairs, glazing by room type, furniture with a connectivity guard.
- **Outdoor cover**: real objects only — cars (half cover at the bonnet, full at the cabin), containers, planters,
  privacy fences, low walls, jersey barriers, bins, benches, pallets, fuel drums (explode), fuel pumps (explode) —
  then a cover pass fills gaps until no outdoor tile is more than ~4 moves from cover. Every map passes the design
  gates (cover gap ≤ 6, spawn safety, lanes, breaching …) on several seeds.
- **Targeting** (Phoenix Point): each shot fires real rays inside an accuracy cone; hit % per body part is a
  deterministic Monte-Carlo of the same tracer. Disabled arms cost accuracy, legs cost movement, head costs Will.
- **Cover**: physical — walls stop the rays that hit them; XCOM shields on the HUD read the voxels. Units lean
  out of corners. Flanking is simply having no wall in the way.
- **Destruction**: every voxel has hit points; bullets chip, bombs and powder kegs blast, unsupported floors and
  walls collapse into rubble, and units on vanished floors fall.
- **Interiors**: room reveal, dim rooms, noise through doors and walls, **breach** (door or charge) with surprise.
- **Voxel elemental system** (an element on every voxel): fire ignites and spreads through timber, furniture and
  fences and burns them down; water douses and wets; cold freezes water into walkable ice bridges and frozen ground; wind
  clears smoke and fans fire; earth concussion cracks stone.
- **Formations**: Shield Line, Breach Stack, Crossfire — with cohesion, costs, caps, static decay and the
  "clustered" blast counter. `npm run sim:formations` gates them.
- **Weapon balancing**: `npm run sim` runs AI-vs-AI battles and reports hit rates, damage per AP and kills per shot.
- **Stress / Breakdown** (CZN-inspired) and **Will points** (Phoenix Point) for abilities.

## Layout

```
shared/            deterministic rules (no DOM, no THREE, no Math.random) — run by client, server, sim, tests
  world/ util/     path search, traversal rules, stair runs, RNG (from vibe-game, see PROVENANCE.md)
  voxel/           VoxelStore, Materials, Raycast (ported DDA), Destruction, Cover
  elements/        ElementField: fire, water, ice, wind, smoke; statuses; element ids
  mission/         Maps (registry), CedarClose, MainStreet, Harbor, Route9, ProvingGrounds (Training Facility),
                   modern/ (MapKit, ModernBuilder), PropCatalog, CoverScatter, MissionMetrics, MissionCommon
  battle/          Battle engine, Units, Ballistics, Formations, Ai, DebugOps
  content/         weapons, units (squad classes, Syndicate), formations, balance tunables
  session/         scenario descriptors → missions/battles
client/src/        three.js client: render/ (rounded chunk mesher, apron, camera rig, materials, kit/ tile set,
                   overlays, fx, lights), units/, anim/ (skeleton), ui/, debug/, net/
server/src/        Colyseus 0.15 lockstep co-op room
tools/             sim/battle_sim · mission/report · kit/bake_tileset · art/make_placeholders · art/make_textures
docs/              LEVELS, TILESET, RENDERING, BALANCE, PLAN-01, ANIMATION-AUDIT, design/, provenance.json, reference/vibe-game
```

## Useful commands

```bash
npm run sim                     # 24 AI-vs-AI battles on the Training Facility, weapon table
npm run sim:all                 # a few battles on every map
npm run sim -- --scenario operation [--plot suburb]   # generated operations, a new map per seed
npm run sim:formations          # 100 seeds, formations on vs off, fails if the gates fail
npm run mission:report          # map-design metrics and gates for every map
npm run art:placeholders        # regenerate placeholder characters (python3 + Pillow + numpy + scipy)
npm run art:textures            # regenerate the textures (python3 + Pillow + numpy + scipy)
npm run kit:bake                # re-bake the tile set (assets/kit/tileset.glb + tileset.json)
```

## Status and known limits

- Character art is placeholder; animation is frame-based with stubs (see `docs/ANIMATION-AUDIT.md`).
- The storey cutaway rebuilds every chunk when the level changes (75–150 ms headless).
- Draw calls are high (820–1,300 per frame with shadows and AO) because the tile set is instanced per chunk.
- Tile-set pieces are procedural placeholders; drop real art into `assets/kit/tileset-art.glb` (see `docs/TILESET.md`).
- Decor (rugs, lamps, street lights …) is visual only: it never blocks, and it disappears with the floor under it.
- Online co-op is lockstep: every peer runs the battle, so it is not cheat-proof and fog of war is client-side.
  PvP needs server-filtered state (PLAN-01 M13).
- Generated packages enforce combat, vertical and reference-congruence gates before installation, with bounded repairs/reseeds; hand-built maps retain their existing reported gates.
- Generated buildings have indoor stairs between storeys; 3–4 storey buildings get the uniform 6×2 stair fire escape and 1–2 storey flat roofs a roof ladder. Hand-built maps provide roof access where specified and are not rebuilt by the PLAN-04 generator.
- Generated operations are mechanics-checked, not difficulty-balanced (sim: player wins 25–50 %).
- Aliens and their themes are not in yet.

Generated fixtures now include supported fire escapes, underground flanks, floor charges and deterministic darkness. Play `?play=subway-crossing&seed=1` for the night-ops bridge/subway test. See [PLAN-03](docs/PLAN-03-vertical-maps-underground-lighting.md) and [MAPGEN](docs/MAPGEN.md).

**Generated operations (PLAN-04):** the menu's *Generated operation* card builds a new map per seed from a plot family, with noise-guided WFC outside and inside, uniform access modules, engagement pockets, a tunnel flank and local repair against every gate. See [PLAN-04](docs/PLAN-04-xcom-style-map-generation.md) and [MAPGEN](docs/MAPGEN.md#generated-operations-and-the-v3-pipeline-plan-04).
