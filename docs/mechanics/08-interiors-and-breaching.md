# 08 · Interiors and breaching

Buildings are places to fight through: rooms with doors, reveal on entry, noise that is muffled by walls, and an
XCOM-style breach. Code: `Battle.doMove` / `openDoorsOnStep` / `doDoor` / `revealRoom` / `breachPoints` /
`validateBreach` / `doBreach` / `noise`, building generation in `shared/mission/modern/ModernBuilder.js`.

## Rooms

- `ModernBuilder.buildModern` writes a room id into `VoxelStore.rooms` for the air voxels at floor + 1 and floor + 2
  of every room cell, per storey. Partitions and doorway cells belong to no room (−1); outdoors is −1.
- A unit's room is the room id at its z + 1 (`Battle.roomOf`). Room records live in `mission.rooms`:
  `{ id, buildingId, storey, kind, gameplay, cells, floorZ, lit, doors }`.
- Warehouse rooms default to dim; other rooms default to lit. Specs can override lighting by room kind or for
  the whole building ([03](03-cover-and-sight.md#other-modifiers-tied-to-position)).
- Building layout (programs, partitions, door placement so most rooms have two ways in, glazing, furniture with a
  connectivity guard, stairs) is described in `docs/LEVELS.md` and [11](11-maps-and-level-design.md).

Bathrooms, baths, restrooms and utility rooms default to `gameplay: false`. Their doors remain locked, they have no exterior glazing or exits, and they are excluded from stairs, enemy room spawns, furnishing connectivity and breach targets. `gameplayRooms` explicitly promotes a kind for an objective; `closedRooms` closes additional unused kinds. Combat-room connectivity and metrics count playable rooms only. Surrounding walls retain normal elemental destruction rules.

## Doors

| Material | Movement | Sight | Bullets | Cover readout |
|---|---|---|---|---|
| `door` (closed) | walk through; opens for free when stepped into | blocks | blocks (hp 4, flammable) | counts (0.08 pane) |
| `door_locked` | blocked; cannot open or breach | blocks | blocks (permanent door) | counts (0.08 pane) |
| `door_open` | walk through | passes | passes | none |

- Doors fill floor + 1 and floor + 2 of the doorway cell. Interior doors are placed on partitions (a spanning tree
  over room adjacency, then extra doors for second ways in); exterior doors are the entry plus a back and a side
  door where the program allows; warehouse and garage roller doors are ordinary doors with a render hint.
- `door` intent: open 0 AP, close 1 AP, unit within Chebyshev 1 of the door cell (`doDoor`).

## Reveal

A room is revealed (for the squad only, once) when:

- a squad unit **steps into** it (`revealRoomOf` every step);
- a squad unit **steps into a doorway**: the room straight across the door is revealed (`openDoorsOnStep`);
- a squad unit **opens** a door with the door action: every room on the 4 sides of the door cell (`doDoor`);
- the room is **breached** (`doBreach`);
- an enemy inside it becomes **visible** to the squad (`updateVisibility`).

The client tints unrevealed room cells; nothing in the rules hides occupants ([12](12-co-op-and-determinism.md)).

## Noise indoors

Noise radii are listed in [01](01-turn-flow.md#pods-alerting-and-noise). The only indoor rule: a listener **inside a
room** hears a source outside that room at 0.6 × the radius. A listener outdoors is never muffled, and closed doors
make no extra difference.

## Breach

A breach is one intent that opens a room, surprises unready defenders and gives every entrant a free shot.

**Breach points** (`Battle.breachPoints`, what the HUD's Breach button lists): every **closed** `door` of any
building with |dx|, |dy| ≤ 2 and |dz| ≤ 1 from the unit, that has a room on one of its four sides other than the
unit's own room.

**Validation** (`validateBreach`): every participant (`unitIds`, default just `unitId`) is alive, on the active side,
is owned by the commanding player (or local hot-seat), appears once in the list,
has **≥ 1 AP** and stands within Chebyshev 2 (|dz| ≤ 1) of the door; there is a room beyond. Door entry needs a
closed door; charge entry needs some participant carrying a Breaching Charge and any non-air voxel at the target
(intent level: a wall works too; the HUD only offers doors).

**Resolution** (`doBreach`, in order):

1. Back-shot cut-in for the whole group.
2. Entry:
   - **door**: the door opens; noise 12 at the door (×0.5 with an active Breach Stack);
   - **charge**: the first participant with a charge spends it; it detonates at the door (floor + 1.5) as a
     Breaching Charge explosion (power 16, radius 1.7, geo, 4 damage, noise 16; [05](05-destruction.md)).
3. The room is revealed.
4. **Defenders** = every living unit of the other side whose room is the breached room. Unalerted defenders get
   `surprised` (1 round) and lose any overwatch; then the defenders' pods are alerted.
5. Each participant, in `unitIds` order: pays **1 AP**; moves to the free room cell nearest the door that it can
   reach within path cost 12 (not limited by its mobility), stepping through doors and triggering overwatch on the
   way (surprised defenders cannot react; alerted ones on overwatch can); then, if its **current** weapon is
   ballistic and loaded, takes one **breach shot** at the visible defender with the lowest HP (torso), with breach
   spread (÷1.15, ÷1.1 more with an active Breach Stack). The breach shot costs no AP but uses ammo.
6. Breach Stack formations of the participants dissolve.

Consequences worth knowing:

- `surprised` = −1 AP on the defender's next turn and no reactions until then.
- **The initial charge blast protects the participating breachers** from damage, element statuses and knockback.
  Other nearby units are still affected, including squadmates outside the participant list. Chained explosive
  props, falls and defender reactions remain dangerous. A charge placed with an ordinary `throw` has friendly fire.
- Entrants do not reveal rooms step by step and make no move noise during the entry.
- Units with a melee weapon selected, or an empty magazine, enter without shooting.

Not implemented from PLAN-01 §12.5: window vaults, kick-in of locked doors (there are no locked doors), ceiling
drops, smoke entries, entry-type aim modifiers, defenders acting last.
