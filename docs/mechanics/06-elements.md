# 06 · Elements and statuses

A voxel elemental system carried over from vibe-game: fire burns and spreads through flammable voxels, water douses
and wets, cold freezes water into walkable ice, heat melts it, wind fans fire and clears smoke, earth (concussion)
cracks stone. Code: `shared/elements/Elements.js` (`ElementField`, `STATUS_DEFS`, `elementStatusesFor`),
`shared/elements/ElementIds.js`, hooks in `Battle.js`.

## Ids

- **Attack elements** (`ELEMENT_IDS`): `pyro`, `hydro`, `cryo`, `anemo`, `geo`.
- **Material element** (every material has one, `ElementIds.ELEMENTS`): VOID 0, GEO 1, HYDRO 2, ANEMO 3, CRYO 4,
  PYRO 5, STRUCTURE 6. In play it is read by traversal (a HYDRO surface needs `wade`) and is otherwise flavour; the
  element rules key off material flags (`flammable`, `freezeTo`, `meltTo`, `family`), not this id.

## Where elements come from

| Element | Delivered by |
|---|---|
| `pyro` | Flamethrower rays, Incendiary Grenade, fuel drum / fuel pump / light fixture explosions |
| `hydro` | Extinguisher Grenade, water drum |
| `cryo` | Cryo Canister |
| `anemo` | Concussion Grenade |
| `geo` | Frag Grenade, Breaching Charge |

An element arrives as a sphere (`ElementField.applyArea`): voxels whose centre is within radius (squared distance ≤
r² + 0.75) of the point. Radius = the blast radius for grenades and explosions, 0.6 when an elemental projectile hits
a unit, 0.8 when it hits a voxel.

## Field state (`ElementField`)

- `fires`: burning voxel → rounds left.
- `surfaces`: a standable surface voxel → `{ effect: 'burning' | 'wet' | 'frozen', rounds }`.
- `smoke`: air voxel → rounds left.

All three are part of the lockstep hash ([12](12-co-op-and-determinism.md)).

## What each element does

| Element | To voxels in the area | To units hit | Voxel damage ×family |
|---|---|---|---|
| `pyro` | ice / deep ice **melt** (to `water` / `deep_water`); flammable voxels **ignite** (3 rounds) unless their surface is wet or they are protected ground; surfaces become `burning` (2 rounds) | `burning`, unless `wet` | wood 1.5, plant 3, ice 3 |
| `hydro` | fires **extinguished**; lava → stone floor; non-liquid surfaces become `wet` (3 rounds) | `wet` (removes `burning`) | everything 0 except earth 0.3, ice 0.5 |
| `cryo` | water / deep water with air above **freeze** (to `ice` / `deep_ice`); otherwise fires extinguished and `wet` surfaces become `frozen` (3 rounds) | `frozen` if wet, else `chilled` | glass 1.5, ice 0 |
| `anemo` | smoke in the area cleared; every burning voxel in the area ignites its 6 neighbours (if flammable and not wet) | none (the Concussion Grenade's knockback is separate) | plant 1.5, glass 1.5 |
| `geo` | none (concussion works through the voxel damage multipliers) | `stunned` | stone 2, glass 2, earth 1.5, metal 1.5, wood 1.2 |

"Surface" means a walkable or liquid voxel with nothing solid directly above it.

### Surface combinations (`combineSurface`, ported from vibe-game)

| Current \ incoming | `burning` | `wet` | `frozen` |
|---|---|---|---|
| none | burning | wet | frozen |
| `wet` | removed | wet | frozen |
| `burning` | burning | removed | wet |
| `frozen` | wet | wet | frozen |

## Round tick (`ElementField.tick`, from `Battle.roundEnd`)

Once per round, after the enemy phase, using the battle RNG:

1. **Fires** (in sorted key order): a fire on a voxel that is no longer flammable goes out. Otherwise the voxel
   loses 1 HP; at 0 it is removed cleanly, with no ash or debris (
   [05](05-destruction.md)); else its rounds tick down and it burns out at 0. Each fire then has a
   `B.fireSpreadChance` = **0.3** chance to try to ignite one random face neighbour (cap 220 fires).
2. **Surfaces** lose a round; removed at 0.
3. **Smoke** loses a round; removed at 0.

Burned-out voxels trigger a structural settle and fall checks. Then every unit standing on a `burning` surface or on
a burning voxel catches `burning`.

Fire and the fuel drum: a burning fuel drum (1 HP, flammable) detonates when its HP reaches zero, using the
normal explosion and chain rules ([05](05-destruction.md#explosive-materials)).

## Units and the elements

- Ending a move on a `burning` surface → `burning`; on a `wet` surface → `wet` (`doMove`). Wading in water does
  not make a unit wet. A `frozen` surface has no effect on units or movement.
- Pyro damage against a `wet` unit is reduced by 1, and `burning` cannot be applied to a wet unit (`addStatus`).
- Element statuses are applied on every elemental hit, even one that deals 0 damage.

## Statuses

<!-- generated:statuses -->
| status | rounds | data fields | tags |
|---|---|---|---|
| `burning` | 2 | dotPerRound: 3; removes: — | fire |
| `wet` | 2 | removes: burning | water |
| `chilled` | 2 | maxStacks: 2; apPerStack: -1 | cold |
| `frozen` | 1 | rooted: true | cold |
| `stunned` | 1 | apPenalty: -2 | concussion |
| `bleeding` | 3 | dotPerRound: 2 | wound |
| `suppressed` | 1 | accuracyMult: 0.6 | fear |
| `braced` | 1 | armorBonus: 4 | buff |
| `staggered` | 1 | accuracyMult: 0.8; untilOwnTurn: true | move |
| `surprised` | 1 | apPenalty: -1; noReaction: true | breach |
| `panicked` | 1 | apMult: 0.5; noAbilities: true | stress |
<!-- /generated:statuses -->

How each is actually used (`Battle.startSide`, `Units.js`, `Battle.checkReactions`, `Battle.validate`). Durations
tick at the start of the **owner's** turn, after AP is computed ([01](01-turn-flow.md)).

| Status | Effect in play | Applied by |
|---|---|---|
| `burning` | 3 torso damage (`B.burningDamage`, pierce 99) at the start of each own turn | pyro hits, fire surfaces / voxels, debug |
| `wet` | removes and blocks `burning`; pyro damage −1; cryo freezes instead of chilling | hydro, wet surfaces |
| `chilled` | −1 AP per stack on the next turn (max 2 stacks) | cryo on a dry unit |
| `frozen` | tiles per AP = 0 (cannot move; a move in progress stops) through its affected own turn, removed at side end | cryo on a wet unit |
| `stunned` | −2 AP on the next turn | geo hits (Frag Grenade, Breaching Charge) |
| `suppressed` | accuracy × 0.6 (spread ×1.67) | Suppressive Fire ability ([07](07-units-and-classes.md)); 2 rounds |
| `braced` | +4 armour on every part | Shield Wall (1 round: through the opponent's phase) |
| `surprised` | −1 AP on the next turn; cannot take overwatch reactions | unalerted defenders of a breached room (1 round) |
| `panicked` | next turn's AP halved (rounded up); abilities refused while present | stress breakdown (1 round) |
| `staggered` | accuracy × 0.8 (`Units.accuracyMult`) for the rest of the turn and any overwatch reaction in the opponent's phase; removed at the start of its next turn | landing a jump down ([02](02-movement.md#jumping-down)), 1 round |
| `bleeding` | 2 torso damage (pierce 99) per own turn | nothing in play (debug `status` op only) |

Duration details:

- Burning DOT retains its pyro damage type and wet damage reduction, but does not apply fresh element statuses.
  Burning therefore ends after two own-turn damage ticks unless a new hit or burning surface refreshes it.
- Panic halves AP on the next own turn and prevents abilities throughout that turn. Its final zero-round entry
  remains until side end, as do rooted and accuracy statuses (freezing and suppression).
- `braced` still expires at the next own-turn start, protecting the preceding opponent phase.

## PLAN-09: chill vs freeze

Cryo freezes only **wet** units (rooted, −2 AP, +20 to be hit). On a dry unit it chills: −30 % movement per AP per
stack (`B.chillMobility`, `Units.js:mobilityPerAp`); chill no longer costs AP.
