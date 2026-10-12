# 12 · Co-op and determinism

Online co-op is deterministic lockstep: the server compiles the mission and sends an RLE voxel snapshot to peers, which apply the
same ordered list of intents. Code: `shared/session/Scenarios.js`, `shared/session/MissionSnapshot.js`, `server/src/MissionRoom.js`,
`client/src/net/OnlineSession.js`, `client/src/net/LocalSession.js`, `Battle.hash`.

## Determinism contract

- `shared/` has no DOM, no THREE, no `Math.random`, no `Date.now`. All battle randomness (cone samples, grenade
  scatter, fire spread) comes from one RNG, `createRng(hashString(`battle:${seed}:${mission.id}`))`
  (`shared/util/Rng.js`, a mulberry32-style generator; `hashString` is FNV-1a).
- Hit estimates use their own throwaway RNG seeded from the shot geometry, so previewing never advances the battle
  RNG (`Ballistics.estimateShot`).
- Mission generation uses `createRng(hashString(`${mapId}:${seed}`))`; iteration orders are fixed (sorted fire keys,
  sorted explosion cells).
- **Descriptor** (`Scenarios.createBattle`): `{ scenario, seed, squad, debug? }` → map, squad (`SQUADS` preset or a
  list of class ids, call signs dealt in order) and `Battle`. Local sessions use the descriptor to build the map. Co-op uses the authoritative compiled mission + descriptor + ordered intents.
- Assumption, not enforced: every peer's JS engine produces bit-identical results for `Math.hypot`, `Math.tan`,
  `Math.cos`, `Math.sin`, `Math.atan2` on the same inputs. The spec leaves their precision to the implementation
  (unlike `Math.sqrt`), so mixed browsers could desync in principle; the hash check below would show it.

## Intents

Every state change is an intent applied by `Battle.apply(intent)`: validate, then mutate, then `afterAction`
(visibility, outcome). Types: `move`, `shoot`, `melee`, `throw`, `overwatch`, `reload`, `switchWeapon`, `face`,
`ability`, `door`, `breach`, `formation`, `formation_break`, `endTurn`, `owners`, `debug`. The result carries the
event log slice the client animates.

## The room (`MissionRoom`)

- `onCreate`: the server sanitises the descriptor and validates all packs before generation. Invalid packs return error 4211 with the soldier number and placement reason. Mission generation runs in a worker (two active jobs, eight waiting, 30-second timeout), then the server builds the authoritative `Battle`, max **4** clients. The init message carries the RLE compiled mission snapshot, including voxel HP, room tags and support groups.
- **Seats** (`reassignOwners`): on every join and leave, squad units are dealt round-robin to the connected players
  (`P1`, `P2`, …) in roster order. The deal includes dead units, so the living split can be uneven. It is committed
  as an `owners` intent so every peer agrees; clients may not send `owners`.
- **Intents** (`onIntent`): the server stamps `by` with the sender's player id (overriding anything the client
  sent), applies the intent to its own battle, and on success appends `{ seq, intent, nonce }` to the log and
  broadcasts it plus `hash` (the battle hash after that intent). Rejections go back to the sender only with the
  reason.
- **End turn votes**: an `endTurn` from a player adds a vote (only during the squad phase). While votes < connected
  players, the room broadcasts `votes` and the sender gets `waiting_for_team`. When everyone has voted (or a leaver
  makes the count complete) the server commits `endTurn` for the squad and runs the **enemy phase itself**
  (`runEnemyTurn`: every enemy, up to 6 `decide` intents each, then `endTurn` for the enemy), streaming each AI intent.
  Votes cannot be withdrawn.
- **Join / reconnect**: a joiner receives `init` with the descriptor, compiled mission snapshot, its player id, the full intent log and the
  player list; `OnlineSession.connect` replays the log. A dropped client gets 60 s to reconnect
  (`allowReconnection`); after that it is removed, its votes dropped, and the squad re-dealt.

## The client

- `OnlineSession`: hydrates `init.mission` and builds the battle with `init.desc`, replays the log, then applies every streamed intent in `seq`
  order (out-of-order arrivals are only logged). Local actions are sent with a nonce and resolve when the server's
  echo or rejection comes back; the client never applies its own intents before the server orders them. A `hash`
  that differs from the local `battle.hash()` at the same `seq` is reported as `desync` in the console; there is no
  resync.
- `LocalSession`: applies intents directly with `by: '*'` (hot-seat: anyone may command any squad unit); the client
  runs the AI and the auto end turn.

## What the hash covers (`Battle.hash`)

Materials and HP of every voxel; complete unit state (including ownership, body parts, ammo, items, Will,
statuses, overwatch, buffs, alert state and formations); round, active side and outcome; revealed rooms; objective progress (rounds held, extracted units, the item's position, carrier and secured
flag, the failed flag); element field; formation records and next ID; RNG state; controllers; debug mode; event sequence. Render caches and
presentation-only data are excluded. State divergence is detected before it affects damage or position.

## Debug intents

`{ type: 'debug', op, … }` intents (`DebugOps.js`: ap, heal, kill, god, stress, status, refill, teleport, spawn,
destroy, place, explode, element, smoke, reveal, alert, endSide, controlSide) go through `apply` like any other and
stay deterministic, but `validate` refuses them with `debug_disabled` unless the battle was built with
`debug: true`. Locally that is `?debug=1` or the menu checkbox. Online the creator must explicitly enable debug in the descriptor; only the original host (`P1`) can submit
debug intents. Guests are rejected before mutation. Accepted debug intents are broadcast and replayed normally.
Debug operations intentionally bypass individual soldier ownership for the host.

## What is and isn't cheat-proof

The server re-validates every intent with the shared rules, so a client cannot spend AP it doesn't have, move
further than allowed, fire without ammo, act out of turn, command a unit whose `unitId` it doesn't own, or end the
squad's turn alone. It is **not** cheat-proof:

- Every peer holds the full state: enemy positions, unrevealed rooms and fog of war are client-side presentation.
- Free-aim points can be fired at without a sight requirement, preserving terrain destruction. Unit-targeted shots
  require squad sight and suppression must use the paid ability.
- Group formation and breach intents check all participant ownership. A formation breakup resolves its acting
  soldier and checks both turn and ownership of every member.
- Desyncs are detected, not corrected.

PvP would need server-filtered state (PLAN-01 M13); the README says the same.

## Test-ground descriptors

A descriptor may carry `test` settings (custom hostile roster, alerted pods, eliminate objective, round deadline,
time of day; see [TEST-GROUND](../TEST-GROUND.md)). The server validates them in `sanitizeDesc` before building
the mission, sends the untouched compiled mission, and every peer applies the same settings in `createBattle`, so
the starting hash matches. Hostile placement uses only the mission, the settings and the seed.
