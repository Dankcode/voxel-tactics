# 09 · Formations

Two to four soldiers in a shape get a bonus while they hold it, pay a cost, and are countered by area attacks.
Code: `shared/battle/Formations.js`, data `shared/content/formations.js`, hooks throughout `Battle.js`.

<!-- generated:formations -->
| id | name | members | slots [right, forward] | bonus (data) | cost | decay / static phase | needs door |
|---|---|---|---|---|---|---|---|
| `wedge` | Wedge | 2–4 | [0,0] [-1,-1] [1,-1] [0,-2] | counterattack true | mobilityPerAp 0 | — | — |
| `file` | Patrol File | 2–4 | [0,0] [0,-2] [0,-4] [0,-6] | repositionOnAmbush true | mobilityPerAp 0.2 | — | — |
| `line` | Skirmish Line | 2–4 | [0,0] [-2,0] [2,0] [4,0] | counterattack true | mobilityPerAp -0.2 | — | — |
| `shield_line` | Shield Line | 2–4 | [0,0] [1,0] [-1,0] [2,0] | frontSpreadMult 1.3 | mobilityPerAp -0.5 | 0.34 | — |
| `breach_stack` | Breach Stack | 2–4 | [0,0] [0,-1] [0,-2] [0,-3] | breachAccuracyMult 1.1, doorNoiseMult 0.5 | — | — | yes |
| `crossfire` | Crossfire | 2–2 | none (≥ 4 apart) | reactionSpreadMult 1, extraReactions 1 | — | — | — |

| rule | value |
|---|---|
| `cohesionLossPerStray` | 35 |
| `cohesionRegain` | 50 |
| `fullAt` | 80 |
| `halfAt` | 50 |
| `maxAccuracyBonus` | 1.15 |
| `maxDefenseBonus` | 1.3 |
| `perSoldiers` | 4 |
<!-- /generated:formations -->

## Planning and assembly

The player drop-up sends `{ type: 'formation_plan', unitId, template, facing }`. It highlights slots around the leader without relocating anyone. Walk another teammate onto an exact highlighted slot to activate the formation; an assembling formation has no benefit. The normal side cap and doorway requirement apply. See [the loadout guide](../TACTICAL-LOADOUT.md#formation-assembly).

## Legacy declarations (`Formations.validate`, `declare`)

- Intent: `{ type: 'formation', unitId, template, memberIds, leaderId?, facing? }` (facing n / e / s / w; the client uses the
  hovered tile or the camera direction). The leader defaults to the first member.
- Every member is alive, owned by the commanding player, on the active side, not already in a formation;
  member IDs must be unique and the leader must be a listed member; the member count is within the template's
  min–max.
- **Cap**: a side may have at most max(1, floor(side size ÷ 4)) formations at once (`perSoldiers` 4). Side size
  counts every unit of that side, dead ones included, so a standard 4-soldier squad gets exactly one.
- **Slot templates** (Shield Line, Breach Stack): slots are `[right, forward]` offsets from the leader in the
  formation's facing frame, placed on the surface nearest the leader's height. Each slot must have a surface within
  ±1 voxel of the leader with headroom ≥ 2. A member counts as **in slot** within Chebyshev 1 and ±1 voxel. A member
  not exactly on its slot (including height) must be within Chebyshev **3** and have ≥ 1 AP.
- Breach Stack also needs the leader to have a breach point (a closed door within 2 tiles,
  [08](08-interiors-and-breaching.md)).
- Declare assigns members at their existing positions. It never teleports or charges a flat alignment AP; out-of-slot members immediately reduce cohesion.
- **Crossfire**: exactly 2 members, both already **on overwatch**, at least 4 tiles apart, with overlapping cones
  (`conesOverlap` samples each cone's axis every 1.5 tiles from 2 tiles out and tests it against the other cone). On
  declare retains their overwatch; reactions use the persistent ammunition-limited rules.

## Cohesion and tiers

- Starts at 100 − 35 × (members out of slot). `recompute` after every member move and loss can only **lower** it
  (to 100 − 35 × strays); at the start of the formation's own side it regains **+50** (cap 100) if nobody is out of
  slot.
- Tier: **full** (1) at ≥ 80, **half** (0.5) at ≥ 50, **none** (0) below 50. A `broken` event fires when it drops
  below 50. Bonuses scale with the tier; Breach Stack and Crossfire bonuses need tier > 0.
- Crossfire cohesion is always 100.

## Effects

| Formation | Effect (code) | Cost |
|---|---|---|
| Wedge / Skirmish Line | Eligible members return fire with real ammo after a hostile attack hits a surviving member | requires sight, range, ammo and cohesion |
| Patrol File | Unseen incoming fire permits a move toward cover or increased separation | consumes real movement AP |
| Shield Line | A member **in its slot** attacked from the formation's **front 90°** (shooter direction within 45° of the facing): attacker spread × min(1.3, 1 + 0.3 × tier × decay), decay = max(0, 1 − 0.34 × static phases) (`defenseSpreadMult`) | −0.5 tiles per AP for every member (`mobilityPenalty`) |
| Breach Stack | breach shots: spread ÷ 1.1 on top of the normal breach ÷ 1.15 (cap `maxAccuracyBonus` 1.15 does not bind); door entry noise × 0.5 | must form at a door; dissolves after the breach |
| Crossfire | reaction spread × 1.0 instead of 1.3; persistent ammunition-limited reactions | both must already be on overwatch (all AP); dissolves at the start of its own side's next turn, or when a member's overwatch ends and a member moves or is lost |

**Static decay** (Shield Line): at the end of each of its own side's turns, `staticPhases` +1 unless the leader moved
2+ steps that turn (then it resets to 0). After 3 static turns the defence bonus is gone (1 − 0.34 × 3 = −0.02 → 0).

## Group move

A `move` intent with `group: true` (automatic for an assembled leader in the client) for the **leader** of a slot formation moves the
leader, then each other member paths to its slot (or a free neighbour) and moves there with a normal `doMove` if it
can afford it from its own AP, including movement-only AP. The leader preview is capped by the least remaining member movement budget. Members' moves trigger overwatch like any move.

## Dissolution

A formation dissolves when: a member dies or breaks down and fewer than `min` remain (`onUnitLost`; the leader passes
to the next member); it is ordered (`formation_break`, 0 AP); a Breach Stack member breaches; a Crossfire's side
starts a new turn; a Crossfire member without overwatch is found on recompute.

## The clustered counter (`Formations.isClustered`)

Any unit, in a formation or not, with **2 or more living allies within Chebyshev 2 and ±1 voxel** is clustered.
Blasts treat it with radius + `B.clusteredRadiusBonus` (1) and damage × `B.clusteredDamageMult` (1.25)
([04](04-ballistics-and-weapons.md#blast-damage-to-units-battleblastunits)).

## Differences from PLAN-01 §14

The plan's numbers are not what shipped: members must be within 3 tiles of their slots (plan: 4); Shield Line is a
spread multiplier ×1.3 for attackers (plan: +10 defence) at −0.5 tiles per AP (plan: −1 mobility, no dash); static
decay is 34 % of the bonus per static turn (plan: −5 defence per phase); Sprint and stun do not break formations
(a breakdown does remove the panicking member); co-op accept / opt-in flows do not exist (legacy declarations and group moves check every member's ownership).

## PLAN-09: free swaps, narrow spaces, switching, enemy formations

`formation_swap` trades slots (and tiles) with a squadmate or takes an empty spot for free; `formation_switch`
reshapes a formation without breaking it; a group move that leaves a slot without standing room is refused with
`formation_blocked`. Single-tile enemy pods use Shield Line (dug in) and Wedge (advancing on an intel lead).
See [../PLAN-09-intel-ai-hit-chance-monsters.md](../PLAN-09-intel-ai-hit-chance-monsters.md) §6.
