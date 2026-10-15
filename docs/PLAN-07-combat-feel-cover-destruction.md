# PLAN-07 · Combat feel: breakable cover, penetration, visible damage, aim, AP and killstreaks

Status: **implemented** (2026-10-15). Planned read-only against `main` at `3618c27`; approved by Leon with the
choices recorded in §11.

## 1. Goal

Make fights read and play like XCOM 2 / Phoenix Point with destruction that matters:

1. Cover can be shot apart, and bullets can go through thin cover.
2. Damage stays visible: cracked and chipped blocks, broken edges where a neighbour was blown out, soot and burn
   marks on floors and walls.
3. Free aim feels like a third-person shooter: the reticle has inertia, its size shows the gun's accuracy, and the
   back-shot sprite and camera follow it.
4. Moving inside the blue area always leaves enough AP to shoot or overwatch with the equipped gun; moving cancels
   overwatch.
5. Killstreaks no longer need kills: one charge at the start, and it comes back 10 turns after use.
6. Visible bullet tracers and XCOM 2-style **!** alert markers.
7. A balance pass, measured by the simulator, so the changes land in the target band.

## 2. Non-goals

- No rubble or debris piles (your 2026-10 rule: destroyed voxels become air). Damage shows as surface marks only.
- No new weapons, classes or enemy types. Numbers change, but the roster stays the same.
- No change to map generation, except the enemy count on the large districts (§4.7).
- No character-art pass. The back-shot sprite rotates and is placed with the existing placeholder art.
- No change to co-op networking beyond the new state fields (scorch, scars, killstreak cooldown) in snapshots.

## 3. Current evidence (from the code at 3618c27)

| Area | What the code does now | File |
|---|---|---|
| Bullets vs cover | A ray **stops at the first `block` voxel**. There is no penetration at all. | `Ballistics.traceProjectile` |
| Cover durability | A projectile deals its round's `voxel` value (1, 2 or 3) to the voxel it stops on. Cover HP: concrete wall 12, jersey 14, car body 10, dumpster 12, container 20, brick 9, sandbag 6. An assault rifle needs **12 bullets on one cell** to break a concrete wall cell, and 10 to break a car-body cell. | `Materials.js`, `calibers.js`, `Battle.fireWeapon` |
| Accuracy | Base spreads are very tight: AR 0.42°, Marksman 0.24°, Sniper 0.12°, Pistol 0.55°. At FOV 38 the reticle is about **4–10 px** for every gun (floor 4 px), so accuracy is not readable. Shots mostly land where aimed, and only voxels in the way stop them. | `weapons.js`, `AimReticle.js` |
| Aim feel | `updateFreeAim` snaps the aim point to the cursor every frame. The prepare camera is aimed once, at the first target (`CameraDirector.prepareAim`), and does not follow. The back-shot sprite only turns on the committed shot (`EventPlayer` `shot` → `face`). | `Game.js`, `CameraDirector.js`, `EventPlayer.js` |
| Body parts | The HUD hint still says "Z X C V G body part" (`Hud.js:296`). Body-part anchors still exist as optional snap points. | `Hud.js`, `Game.aimAt` |
| Blue area | Blue means "AP left ≥ the cheapest action". The knife (1 AP) counts as an action, so a blue tile can leave **1 AP**, which is not enough for a 2 AP rifle shot or overwatch. | `Game.minActionAp` |
| Overwatch | It persists across phases. **Moving does not clear it**, so the cone stays where the soldier used to stand. | `Battle.doMove`, `doOverwatch` |
| Killstreak | Commander Strike gets one charge per **3 squad kills** (`Battle.validate`, `Hud.js:180`). Intel supports recharge 10 turns after use, but only **after detection**. | `Battle.js:272`, `IntelOps.js:29` |
| Tracers | A 1-px `THREE.Line` drawn instantly, start to end, that fades in 0.18 s. Every pellet appears at once. It is almost invisible at battle zoom. | `Fx.tracer`, `EventPlayer` |
| Damage visuals | None. A voxel at 1/12 HP looks new. A destroyed voxel just disappears, leaving clean faces on its neighbours. Explosions and fire leave no mark. Flying debris was removed in your last commit. | `KitView`, `VoxelView`, `Fx` |
| **!** markers | Flanked shields and the manual red/blue/green map marks exist. There are no alert markers on enemies, risky tiles or hazards. | `Overlays.js`, `Markers.js` |
| Balance | The large districts spawn **2 enemies** (one warden, one cultist) against 6 soldiers. Sim of Civic District, 12 seeds: **100 % player wins**, 17.3 rounds, **14 voxels destroyed per battle**. Cedar Close has 7 enemies in 4 pods. | `LargeDistricts.js:162`, `tools/sim` |

## 4. Design

### 4.1 Bullet penetration (shared, deterministic)

Each projectile carries **penetration energy** `E`, which comes from its round. Each solid voxel the ray crosses
costs that material's **resistance** `R`:

| | E |
|---|---|
| 9 mm | 3 |
| 5.56 / .300 BLK | 6 |
| 7.62×39 | 8 |
| 7.62×51 | 10 |
| .338 Lapua | 22 |
| 12 g pellet | 1 |
| fuel spray | 0 |

| Resistance | Materials |
|---|---|
| 1 | fence, cloth, shelving, crate, pallet |
| 2 | door, timber, privacy fence, car cabin, appliance, siding |
| 3 | stucco, plaster |
| 4 | car body, dumpster, container (thin steel) |
| 6 | brick, sandbag |
| 9 | concrete wall, planter |
| 14 | jersey barrier |
| ∞ | metal, ground |

A wall module counts by its real crossing length: a 0.4-wide wall costs 0.4 × R ÷ 0.4 = R, and a glancing hit
costs more.

- If `E > R`, the ray continues with `E −= R`, and its damage is scaled by `E_after ÷ E_before` (minimum 25 %).
  The voxel takes its normal voxel damage.
- If `E ≤ R`, the ray stops (today's behaviour) and deals voxel damage.
- **Pierce** (armour penetration) is unchanged. Energy is a separate number, so plate armour still matters.
- The hit estimate (`estimateShot`) uses the same tracer. The new output `throughCover` reports the share of
  hits that passed through something.

Result: 5.56 goes through crates, doors, fences, siding and a car cabin, but not brick or concrete. 7.62×39
goes through one brick or a car body. .338 goes through a concrete wall. Shotgun pellets go through almost
nothing.

### 4.2 Breakable cover

- Voxel damage per projectile is raised: AR/pistol 1 → 2, 7.62 2 → 3, .338 3 → 6. Shotgun pellets stay at 1.
  Penetrating rays damage every voxel they cross.
- HP is trimmed on the strongest cover:

  | Material | Now | Proposed |
  |---|---|---|
  | car body | 10 | 7 |
  | car cabin | 8 | 5 |
  | dumpster | 12 | 9 |
  | concrete wall | 12 | 10 |
  | sandbag | 6 | 6 (unchanged) |
  | jersey | 14 | 14 (unchanged; it stays the hard, rare cover) |

  A burst of three AR rounds then breaks a crate or a car-cabin cell. Two or three bursts open a car-body cell.
- **Soft cover in the readout.** If the equipped gun's round would pass through a cover cell, that cell's shield
  shows as **cracked** (soft) in the HUD and move preview. If cover only stops pistols, the player sees that before
  committing. The AI scores soft cover at half weight.

### 4.3 Visible damage (render-only, plus two state fields)

- **Damage state.** Voxels at ≤ 66 % HP get a chipped/cracked overlay, and voxels at ≤ 33 % HP get a heavy one.
  The source is the `VoxelStore.hp` the game already keeps. It is drawn as decal quads on exposed faces with
  `polygonOffset`, using a crack atlas.
- **Scars (broken edges).** When a solid voxel is destroyed, its key goes into a new `store.scars` set. Every
  surviving neighbour face that now looks into a scar cell gets a **broken-edge decal**: jagged edge, exposed brick
  or rebar for masonry, torn metal for steel, splinters for wood. This answers "conjoining broken parts show
  destruction near the side it was destroyed".
- **Scorch.** A new `store.scorch` map (cell → 0–3) records:
  - explosions: the top surfaces within the radius, stronger near the centre;
  - burning cells, when the fire burns out;
  - the floor under a destroyed burning voxel.

  It is drawn as soot decals on floor tops and as a vertical soot gradient on walls within 1 cell of the blast.
- Both new fields are written in `Destruction.js` / `ElementField`, so every co-op peer and every snapshot
  agrees. They are sorted for the state hash, like `squareCorners`.
- Textures: one 1024² atlas (cracks ×2, broken edges ×3 families, scorch ×3), generated by
  `tools/art/make_damage_atlas.py`, with a canvas fallback when the PNG is missing.

### 4.4 Aim with inertia, accuracy reticle, back shot that follows

- **AimController** (new, client-side). Your cursor sets the aim *target*. The *current* aim point follows it
  with a critically damped spring:
  - the time constant depends on gun weight: pistol 0.08 s, rifle 0.14 s, shotgun 0.16 s, sniper 0.22 s, plus
    10 % for each wounded arm;
  - a slow figure-eight sway is added (amplitude scales with stress and suppression, and goes to 0 when braced or
    Deadeye is active).

  The shot fires at the **current** aim point, so flicking and firing at once is less accurate, as in a shooter.
  The server still gets an exact point, so lockstep is unaffected. The sway is seeded per shot so replays match.
- **Reticle = real dispersion.** Two rings, both projected at the aim distance:
  - the outer ring is the whole cone, where every pellet or bullet can land;
  - the inner ring holds half the shots (r × √0.5).

  The 4 px floor goes, and a centre dot is added. With the spread pass below, an AR at 15 tiles shows about a
  40 px ring, a sniper about a 6 px pinpoint, and a shotgun a wide circle.
- **Back shot follows the reticle.** In the prepare phase:
  - the shoulder camera's look direction tracks the current aim point, damped and limited to ±35° yaw and ±20°
    pitch before it re-anchors behind the shooter;
  - the soldier's back-view sprite turns to the aim bearing every frame;
  - the camera's side offset keeps the sprite lower-left of the reticle, so the muzzle line visibly runs into it.
  - The committed back shot starts from that same pose.
- Body-part anchors stay as optional snap points (Tab cycles enemies). The HUD hint changes to "move the reticle,
  Space fires".

### 4.5 AP, the blue area and overwatch

- Blue now means: **AP left ≥ the AP of a shot with the equipped gun (and its overwatch)**. The knife no longer
  counts. With 4 AP and a 2 AP rifle, blue covers moves costing up to 2 AP; with the 3 AP sniper, up to 1 AP. If
  the equipped gun has no ammo, blue falls back to the cheapest available action.
- **Moving cancels your own overwatch.** This covers `doMove`, formation follow and climbing; knockback and falls
  do not cancel it. The overwatch cone overlay is removed with it, and the log shows "Overwatch cancelled".
- The `overwatch` validation already requires `ap ≥ weapon AP`, so a soldier who ends a move on blue can always
  overwatch.

### 4.6 Killstreaks without kills

- Commander Strike starts **ready** (1 charge) and recharges **10 rounds after use**. No kill count is needed. The
  HUD shows "READY" or "in N turns".
- The intel supports (Carpet Bomb, Orbital Laser) follow the same rule. The "after detection" requirement is
  removed (decision D3).
- New state: `killstreakReadyAt` per side, or per owner in async co-op. It is added to snapshots.

### 4.7 Tracers and **!** alerts

- **Tracers:**
  - a glowing streak (a camera-facing quad strip with additive blending, 1.2 tiles long) that travels at about 90
    tiles/s from the muzzle;
  - burst rounds 70 ms apart, and shotgun pellets in one spread volley;
  - colours: squad warm white, enemy red-orange, overwatch amber, elemental shots in their element colour;
  - at the impact point, a spark or dust puff by material family, and a small exit puff where a round
    penetrated;
  - optional slow-motion on the last shot of a kill (tied to the existing animation-speed setting).
- **XCOM 2 !** alerts (decision D4 picks the set). Proposed:
  1. a yellow **!** over an enemy pod when it activates, then a small persistent marker while it is alerted;
  2. a red **!** on a move destination inside a visible enemy's overwatch cone;
  3. an orange **!** on tiles next to explosive drums and pumps, or on burning tiles;
  4. a **!** on portraits of soldiers flanked by a visible enemy;
  5. a white **!** over objective items that need an action.

### 4.8 Balance pass

| Change | Proposal |
|---|---|
| Base spread × ~2.5 | AR 0.42° → 1.0°, Marksman 0.24° → 0.6°, Carbine 0.3° → 0.8°, AK 0.5° → 1.3°, Pistol 0.55° → 1.4°, Sniper 0.12° → 0.3°, Shotgun 2.4° → 4°. Misses then come from the cone as well as from cover, and the reticle becomes readable. |
| Large-district enemies | 2 → 3 pods of 2–3 (6–8 enemies), placed in the far buildings plus one street pod. This matches the other maps. |
| Targets (simulator, ≥ 24 seeds per map; Civic, Downtown, Dockside, Cedar Close) | Player win 55–75 % (PLAN-01 §15.3). Rounds 12–18. ≥ 60 voxels destroyed per battle. 20–40 % of hits pass through or break cover. Sniper dmg/AP no more than 1.3× the AR. |
| Tuning order | Spreads first, then voxel damage and HP, then the enemy count. Re-run after each step. |

## 5. Files

| File | Change |
|---|---|
| `shared/content/calibers.js` | `energy` per round; voxel damage values |
| `shared/content/weapons.js` | spreads |
| `shared/voxel/Materials.js` | `resistance` per material; HP trims |
| `shared/battle/Ballistics.js` | penetration in `traceProjectile`; `estimateShot.throughCover` |
| `shared/battle/Battle.js` | `fireWeapon` damages every crossed voxel; `doMove` clears overwatch; killstreak readiness; alert events (`podActivated`) |
| `shared/battle/IntelOps.js` | support readiness without detection |
| `shared/voxel/Destruction.js`, `shared/voxel/VoxelStore.js`, `shared/elements/Elements.js` | `scars` and `scorch` |
| `shared/voxel/Cover.js` | `soft` flag per face for a given energy |
| `shared/battle/Ai.js` | soft cover at half weight |
| `shared/mission/LargeDistricts.js` | enemy pods |
| `client/src/ui/AimController.js` (new), `client/src/ui/AimReticle.js`, `client/src/anim/CameraDirector.js`, `client/src/Game.js`, `client/src/units/UnitView.js` | aim inertia, reticle, follow camera and sprite |
| `client/src/render/DamageDecals.js` (new), `client/src/render/VoxelView.js`, `client/src/render/kit/KitView.js` | cracks, scars, scorch |
| `client/src/render/Fx.js`, `client/src/anim/EventPlayer.js` | tracers, impacts |
| `client/src/render/AlertMarkers.js` (new), `client/src/render/Overlays.js`, `client/src/ui/Hud.js` | **!** alerts, soft shields, killstreak button, HUD hint |
| `tools/art/make_damage_atlas.py`, `client/public/assets/textures/damage_atlas.png` | atlas |
| `docs/mechanics/01, 03, 04, 05, 07`, `docs/BALANCE.md`, `docs/TACTICAL-LOADOUT.md` | rules as built |

## 6. Steps (each one its own commit, test first)

1. **Blue area and overwatch cancel.**
   - Tests: a blue tile always leaves `shotAp(equipped)`; a move clears overwatch; knockback does not.
2. **Killstreak readiness.**
   - Tests: ready on round 1; refused until 10 rounds after use; intel supports work before detection; the
     snapshot round-trips.
3. **Penetration.**
   - Tests: 5.56 passes a crate and stops in brick; 7.62×39 passes one brick; .338 passes a concrete wall; damage
     scales down after penetration; the estimate equals the live tracer on a fixed seed; lockstep hash is stable.
4. **Breakable cover numbers**, plus the soft-cover readout and the AI weight.
   - Tests: three AR bursts break a car-cabin cell; the soft flag is set for the matching energy.
5. **Scars and scorch state.**
   - Tests: an explosion writes scorch in its radius; a destroyed voxel writes a scar; they survive a snapshot;
     determinism.
6. **Damage decals renderer.**
   - Tests: a decal count for a damaged voxel, a scarred neighbour and a scorched floor; no decals on full-HP
     voxels; a chunk rebuild clears stale decals.
7. **Tracers and impacts.**
   - Tests: the streak travels (its position changes over time); burst rounds are staggered; it is disposed after
     its life.
8. **Aim controller, reticle, follow camera and back-shot sprite.**
   - Tests:
     - the spring converges and is deterministic for a seeded sway;
     - the reticle radius equals the projected spread ±1 px;
     - the fire intent uses the current aim point;
     - the camera yaw stays within its limits;
     - the sprite faces the aim bearing.
9. **! alerts.**
   - Tests: pod activation emits an alert; an overwatch-cone tile is flagged; a hazard tile is flagged.
10. **Balance pass.**
    - Spreads, then voxel numbers, then district pods. Sim of ≥ 24 seeds on 4 maps after each change. The
      results table goes in `BALANCE.md`.
11. **Docs and contract.** Update the mechanics docs, regenerate the content contract, then run the full test
    suite, the server tests and a browser check of a battle.

## 7. Tests

- Each step's new tests (above) run in `test:fast`. The existing tests that pin old behaviour are updated, and the
  change is called out in the commit:
  - `tactical-overhaul.test.js:80`: the strike no longer needs 3 kills;
  - overwatch persistence, which keeps its phase-refresh test but adds the move cancel.
- Determinism: mission snapshots and lockstep hash tests include `scars`, `scorch` and killstreak state.
- Simulator gates (step 10), and `npm run sim:formations` must stay inside its +2 … +8 band.
- Manual browser check:
  - aim inertia;
  - the reticle on the AR, sniper and shotgun;
  - the back shot follows;
  - tracers are visible at default zoom;
  - decals after a grenade and after a car is shot apart.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Penetration makes interiors lethal: walls stop nothing. | Brick and concrete still stop AR rounds. Only .338 goes through concrete, and the sniper is 3 AP. The sim gate watches the win rate. |
| Many decals on big maps cost frame time. | Instanced decal quads per chunk, capped at about 4k per chunk, built only on chunk rebuild. Low quality uses scorch only. |
| Aim inertia feels sluggish. | Constants live in one table, and a Settings toggle can turn inertia off. |
| Spread × 2.5 lowers hit rates too much. | Step 10 tunes spreads first, with the sim, in 0.25× steps. |
| Snapshot size grows with scars and scorch. | Both are stored sparse (keys only). A typical battle has a few hundred entries. |
| AI cover scoring changes. | The AI tests and the formation A/B gate run in step 10. |

## 9. Rollback

Each step is one commit. The rules changes (1–5, 10) are separate from the presentation changes (6–9), so either
side can be reverted alone. The new state fields default to empty, so old snapshots still load.

## 10. Decisions for Leon (defaults in bold)

| # | Question | Options |
|---|---|---|
| D1 | Penetration scale | **as §4.1** / gentler (energy × 0.75) / stronger (× 1.25) |
| D2 | Spread increase | **× 2.5 then tune by sim** / keep the current spreads and rely on penetration only |
| D3 | Intel supports | **same rule as the strike (ready at start, 10-turn recharge, no detection gate)** / keep the detection gate |
| D4 | **!** alerts to ship | **1, 2, 3, 4** / all five / a different set |
| D5 | Unused killstreak charges | **at most 1 charge (cooldown)** / they stack (+1 every 10 rounds) |
| D6 | Large-district enemies | **6–8 in 3 pods** / keep 2 |

## 11. Implementation record (2026-10-15)

Leon's answers: implement as planned; spreads × 2.5 tuned by sim; **!** alerts = overwatch-cone path steps, flanked
soldiers and objectives (no pod-activation or hazard alerts); one killstreak charge with a 10-turn cooldown; intel
supports follow the same rule. Mid-way he took balance back: "we don't need balancing, I will do that by hand", so
step 10 stopped after five simulator runs (see `docs/BALANCE.md`), keeping run E's numbers.

| Step | Where |
|---|---|
| S1 blue area, overwatch cancel | `Battle.blueAp`, `doMove` (`overwatchCancel` event), `Game.minActionAp` |
| S2 killstreaks | `Battle.strikeReadyAt`, `IntelOps` (no detection gate), `Hud` strike button, `units.js` texts |
| S3 penetration | `Ballistics.traceProjectile` / `crossingCost`, `Materials.RESISTANCE`, `calibers.js` energy, `Battle.fireWeapon` |
| S4 breakable cover | voxel damage per round, car/cabin/dumpster HP, `Cover.softToward` / `softAt` / `hardCoverAgainst`, AI half weight, cracked shields |
| S5 scars and scorch | `VoxelStore.scars` / `scorch`, `Destruction.destroyVoxel` / `scorchBlast` / `damageBand`, fire tick |
| S6 decals | `client/src/render/DamageDecals.js` (procedural DataTextures instead of a PNG atlas), `VoxelView` |
| S7 tracers | `Fx.tracer` / `impact`, `EventPlayer` shot playback |
| S8 aim | `client/src/ui/AimController.js`, `AimReticle`, `CameraDirector.track`, `Game.stepAim`, Settings toggle |
| S9 alerts | `Battle.overwatchThreats` / `flankedBy`, `Overlays.showAlerts` / objective "!", portrait "!" |
| S10 balance (partial) | spreads, district pods (`district/Pods.js`, also Hillside Terraces) |
| S11 docs | mechanics 01, 03, 04, 05, 07 (+ generated tables, new resistance table), TACTICAL-LOADOUT, LARGE-DISTRICTS, INTEL-COOP-TEST, BALANCE |

Differences from the plan:
- **Car bodies have resistance 6** (not 4), so a 5.56 round stops in a car body as §4.1's prose says; 7.62×39 and
  .338 go through.
- **Concrete walls keep 12 HP**: hold-zone anchors are built from them and the hold gates count HP ≥ 12 as durable.
- **The damage atlas is procedural** (DataTexture), so it needs no asset and runs in headless tests.
- **Camera re-anchors on yaw only**; pitch is followed by the look-at (a pitch re-anchor jittered on high targets).

### Follow-ups after review

- **Back shot placement**: barrel on the crosshair in the committed cut-in; while aiming, the whole figure stands still
  in the bottom-left corner past the squad rail and leans/bends after the crosshair with a slight delay.
- **Step-out aiming** (Leon: "the aiming needs to be adjusted to the side tile in order to get a line of sight on the
  target… do this for all angles that will be blocked"): `chooseMuzzle` now tries a step out to a free side tile
  (sideways, then forward diagonals) after the two leans. Shot estimate, fired shot, reaction fire and the overwatch
  preview share it. The shoulder camera and reticle are framed from that tile (`Game.frameAim`), the reticle shows
  STEP OUT / BLOCKED, and playback slides the soldier out and back.
- **Left shoulder**: leaning or stepping out to the left looks over the left shoulder; the back shot uses cutin.json
  `variants.left` (Leon is drawing it) and mirrors the right-hand art until it exists (`sideCutin`).
- **Moving without the elevation cut**: a move click that does not land on a destination walks the pick ray through
  roofs and walls to the highest reachable floor (`pickReachableAlongRay`). The cut only helps browse buildings.
