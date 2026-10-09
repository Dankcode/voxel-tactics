# 01 · Turn flow

XCOM 2 side phases with a Phoenix Point action-point pool. Everything here lives in `shared/battle/Battle.js` unless
noted; the player-facing flow is `client/src/Game.js`.

## Sides, rounds, phases

- Two sides: `player` (the squad) and `enemy` (the Syndicate). A battle starts at **round 1, squad phase**
  (`Battle.constructor` → `startSide('player', first = true)`).
- During a phase, any living unit of the active side may act, in any order, with any number of intents until its
  AP is gone. Units are not locked after acting; you can move A, shoot with B, then move A again.
- `endTurn(player)` starts the enemy phase. `endTurn(enemy)` runs the **round end**, then `round++` and a new squad
  phase (`Battle.endTurn`).
- **Round end** (`Battle.roundEnd`), once per round, after the enemy phase: the element field ticks (fire burns and
  spreads, surfaces and smoke fade, see [06](06-elements.md)), burned-out voxels trigger a collapse check, every
  unit standing on a burning surface or a burning voxel gets `burning`, then falls are resolved. Elements therefore
  tick **once per round, not once per side**. Then `objectiveRoundEnd` counts hold progress and checks the
  deadline ([Objectives](#objectives-and-outcome)), and if the battle is not over the next round starts.

## Start of a side (`Battle.startSide`)

For each living unit of the side that is starting, in this order:

1. **Damage over time**: every status with `dotPerRound` hits the torso with pierce 99: `burning` deals
   `B.burningDamage` = 3 (as pyro), `bleeding` 2 (nothing in play applies bleeding; only the debug `status` op).
2. **AP** = `maxAp` (4) − 1 per `chilled` stack − 2 if `stunned` − 1 if `surprised`; then halved and rounded up
   if `panicked`; floored at 0. On the very first squad phase the penalties are ignored (`first`).
3. Reset: `moveOnlyAp = 0`, `reactionsLeft = 1`, overwatch cleared, one-shot buffs cleared (Snap Shot, Deadeye,
   Demolition expire if unused), Will +`B.willRegen` (1, capped at max Will; not on the first squad phase),
   `movedThisTurn = 0`.
4. **Status durations tick**: every status loses 1 round; those at 0 are removed. Because AP is computed *before*
   the tick, a 1-round status given during the opponent's phase costs its AP penalty on the unit's next turn and
   then disappears.
5. Formations update (`Formations.onSideStart`: cohesion regain, Crossfire dissolves; see [09](09-formations.md)).

## Action points

`B.apPerTurn` = **4** for every unit. Moves and actions share one pool (`u.ap`), plus `u.moveOnlyAp` from Sprint.

| Intent | AP | Other cost / rule | Code |
|---|---|---|---|
| `move` | `ceil(path cost ÷ tiles per AP)`; move-only AP is spent first | path must fit `(ap + moveOnlyAp) × tiles per AP` | `doMove`, `apForCost` |
| `shoot` | weapon AP (Snap Shot −1, min 1) | ammo ≥ `perShot`; aim point ≤ `maxRange` (horizontal); **no line-of-sight check** | `doShoot` |
| `melee` | weapon AP | target adjacent: Chebyshev ≤ 1 and \|Δz\| ≤ 1 | `doMelee` |
| `throw` | item AP | horizontal tile distance ≤ item range | `doThrow` |
| `overwatch` | needs ≥ weapon AP (Snap Shot does not help); then spends **all** AP and move-only AP | ammo ≥ `perShot` | `doOverwatch` |
| `reload` | `reloadAp` (1 for every weapon) | refills to full (allowed even when full) | `apply` |
| `switchWeapon`, `face` | 0 | | `apply` |
| `ability` | ability AP | ability Will; refused while `panicked` | `doAbility` |
| `door` | 0 to open, **1 to close** | door within Chebyshev 1 (no height check) | `doDoor` |
| `breach` | 1 per participant | see [08](08-interiors-and-breaching.md) | `doBreach` |
| `formation` | 1 per member moved into its slot | see [09](09-formations.md) | `Formations.declare` |
| `formation_break` | 0 | | `Formations.dissolve` |
| `extract` | 1 to send; the unit's remaining AP and move-only AP go to 0 and it leaves the map | objective is `extract` or `recover` with a zone; unit inside the zone (`not_in_zone`) | `doExtract` |
| `recover` | 1 | `recover` objective; item not carried or secured (`no_target`); item within Chebyshev 1 and \|Δz\| ≤ 1 (`not_adjacent`) | `doRecover` |
| `endTurn` | — | must be the active side | `endTurn` |

Rejections come back as one of `REJECT` (`not_your_turn`, `not_your_unit`, `unit_down`, `no_ap`, `unreachable`,
`occupied`, `no_ammo`, `out_of_range`, `no_item`, `no_target`, `bad_intent`, `no_will`, `battle_over`, `no_door`,
`not_adjacent`, `formation_invalid`, `not_in_zone`) plus `debug_disabled`, `no_unit`, `out_of_bounds`, `no_footing`,
`bad_unit_type`, `bad_material`, `bad_element`, `bad_status` from debug intents (`DebugOps.validateDebug`).

## Move then act: blue and yellow zones

There is no XCOM "firing ends the turn" rule; the zones are a client readout (`Game.refreshRange`):

- Every reachable tile gets its AP cost. **Blue** if the AP left afterwards (move-only AP is spent first) is at
  least the cheapest action the soldier can still take (`Game.minActionAp`: cheapest loaded weapon shot, melee or
  throwable; 1 if none). **Yellow** ("DASH" in the tooltip) otherwise.
- There is no separate dash action. The **Sprint** ability (id `dash`, 2 Will, 0 AP, Assault only) adds 1
  move-only AP.

## Ending the turn

- **Local**: End turn button or `Enter`. With *Auto end turn* on (default, local sessions only) the turn ends
  700 ms after no controllable squad unit has AP left; units on overwatch count as done (`Game.afterUnitAction`).
  *Auto next* (default on) selects the nearest soldier that can still act.
- **Online**: every connected player must vote End turn; see [12](12-co-op-and-determinism.md).
- **Enemy phase**: in a local session the client runs the AI (`Game.maybeRunAi`: each enemy, up to 6 intents
  from `Ai.decide`, then `endTurn`); online the server does the same (`MissionRoom.runEnemyTurn`). See
  [10](10-ai.md).

## Pods, alerting and noise

- Every enemy has a `group` (its pod) from the map's spawn spec. Enemies start **unalerted**; squad units are
  always alerted. An unalerted enemy does nothing (`Ai.decide` returns null). Alert is permanent and per pod:
  `alertGroup` wakes every living enemy sharing the group.
- A pod is alerted (`Battle.updateVisibility`, after every intent and after every step of a move) when a squad
  unit **sees** one of its members, or when one of its unalerted members sees a squad unit (`spotted`); when a
  squad **noise** reaches a member (`noise`); and when its room is **breached** (`breach`).
- **Noise** (`Battle.noise`): every unalerted enemy within the radius (3D Euclidean, tiles, z not scaled) of the
  noise point wakes its pod. The radius is ×0.6 when the listener stands in a room and the source is not in that
  same room. Noise from enemies never wakes enemies.

| Source | Radius | Where |
|---|---|---|
| Move | 3, at the end tile of each move intent | `doMove` |
| Shot (incl. overwatch and breach shots) | weapon `noise` (2–18, see [04](04-ballistics-and-weapons.md)) | `fireWeapon` |
| Melee | weapon `noise` (knife 4, sledgehammer 8) | `doMelee` |
| Throw / placed charge | item `noise` (4–18), at the blast point | `detonate` |
| Breach through a door | 12, ×0.5 with an active Breach Stack | `doBreach` |
| Breach with a charge | the charge's noise, 16 | `doBreach` → `detonate` |

Chained explosions (fuel drums, pumps) add no noise of their own; the shot or throw that set them off already did.

## Reveal

Rooms are revealed for the squad when a squad unit enters one, opens a door into one, breaches one, or when an
enemy inside one becomes visible. Reveal is presentation and AI bookkeeping (the client tints unrevealed rooms; the
squad autopilot breaches unrevealed rooms); it does not hide state. Details in [08](08-interiors-and-breaching.md).

## Objectives and outcome

Each mission carries an `objective` spec; `Battle` builds its state with `Objectives.createObjective` (unknown kinds
become `eliminate`). The HUD shows the spec's `text` and a status line (`Objectives.objectiveStatus`), offers
**Take** *label* and **Extract** buttons (1 AP) when they are legal for the selected unit (`Hud.js`), and the
overlay draws the zone (teal tiles) and the item (`Overlays.showObjective`). The end banner names the `reason`.

| Kind | Squad wins when | Extra intents |
|---|---|---|
| `eliminate` (default) | no hostile left alive | — |
| `extract` | every squad member still on the map has extracted and at least `needed` (default 1) made it out; or no hostile left | `extract` in the zone |
| `recover` | the item is **secured**: picked up when the spec has no zone, otherwise carried out by its carrier's `extract`. Killing every hostile does **not** win | `recover` next to the item; `extract` in the zone |
| `hold` | `rounds` (default 3) round ends with a squad member in the zone and no hostile in it; or no hostile left | — |

- **Zone**: `{ x0, y0, x1, y1, z?, dz? }`, inclusive; with `z` a unit counts only within `dz` (default 1) levels of it
  (`Objectives.inZone`).
- **Extract** (`doExtract`): the unit gets `extracted`, its AP and move-only AP drop to 0, overwatch is cleared and
  it leaves its formation. `Units.alive` is false for extracted units, so they cannot act, be targeted, see or be
  counted as standing; they stay in the unit list. Extracting while carrying the item secures it.
- **Recover** (`doRecover`): 1 AP; the unit becomes the carrier (secured at once if there is no zone); noise radius
  4 at the unit. A carrier who dies **drops** the item on its tile (`kill`, `drop` event); anyone can pick it up
  again.
- **Hold** counts in `objectiveRoundEnd`, after the round end, i.e. at the end of each full round (after the enemy
  phase): +1 when the zone has a living squad member and no living hostile; a contested or empty zone just does not
  count (no reset). An `objective` event reports `held`, `rounds` and `contested`.
- **Deadline**: optional `turns`. At the end of round `turns` the objective fails if the battle is not yet over.
  No current map sets it.
- Only squad units may `extract` or `recover` (`bad_intent` / `no_target` for a Syndicate unit).

`Battle.checkOutcome` runs after every intent, every kill and every `objectiveRoundEnd`, in this order; the first
match ends the battle with `outcome = { winner, round, reason }` (and an `outcome` event):

| Check | Winner | `reason` |
|---|---|---|
| deadline passed (`failed`) | enemy | `timer` |
| `recover` and the item secured | squad | `recovered` |
| `hold` and `held ≥ rounds` | squad | `held` |
| no living hostile, kind ≠ `recover` | squad | `eliminated` |
| no squad unit left on the map (dead or extracted): `extract` with `extracted ≥ needed` | squad | `extracted` |
| … otherwise | enemy | `squad lost` |

After that every intent is refused with `battle_over`. Without a deadline there is no round limit (the balance sim
stops at `--rounds`, default 40, and scores a draw). Units have a `down` flag that nothing sets: there is no
bleed-out, HP 0 is death. Per-map objectives are listed in [11](11-maps-and-level-design.md#objectives).
