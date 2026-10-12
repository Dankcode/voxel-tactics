# Elemental playtest and scene roadmap

## This battle test

Assault carries Earth Cover: choose an empty, supported, visible tile within 6; pay 1 AP / 2 Will to create one destructible dry-stone voxel. It uses the normal collision, cover, raycast and terrain invalidation path. Cover persists until destroyed. Cannot overwrite doors, furniture, liquids or a unit, or create floating cover. The tactical choice is whether to protect an approach or deny an enemy route; placement requires two empty voxels above the raised block; stair/ladder approaches, door aprons, and grated landings are excluded so vaulting remains available on valid placements.

Grenadier carries Water Mend: choose a living injured ally (self allowed) within 6 and line of sight; pay 1 AP / 2 Will to restore up to 8 HP, remove burning and apply wet for one own turn. It does not revive, restore disabled limbs or refill Will. Wet remains subject to normal elemental interactions. The test distinguishes terrain manipulation from support rather than adding more gun damage.

Overwatch: select a direction, preview highlighted surface tiles, then commit the remaining AP. The sector is a horizontal wedge, independent of target elevation; LOS and spotting distance still apply. One reaction per own turn, paid ammunition, movement triggers only. Weapon range determines reach (capped by spotting), weapon category determines width, heavy/plate armour reduces width. No client-controlled angle or range. Spotting remains panoramic for this test; the loadout explicitly labels the reaction sector separately from spotting. Future helmets/optics need authored modifiers before adding a directional spotting rule.

Loadout shows every weapon, ammo, AP, damage, range and spread, armour, consumables and the reaction sector. Selecting a loadout weapon makes it the overwatch weapon. All test units use one shared soldier art folder, while gameplay classes/teams remain distinct through names, equipment and rings.

The transparent extraction of the supplied sheet is stored with the packed atlas. Several directional frames are mirrored or approximated and firing repeats an aiming pose; the reference has no true death animation. Vault/climb clips use the supplied matching poses. Shooting uses the shoulder camera and large back-shot illustration already supported by the cut-in timeline. This is pose-based test art, not finished 8-direction animation.

## Environment assets and WFC

The attachment is a soldier sheet, not an exterior concept. Exterior layout therefore continues to come from the existing Cedar Close, Signal House and Subway Crossing image packages. Keep source-image analysis offline: record footprints, road masks, elevation, entry points and required routes as site data; WFC varies compatible architecture inside those constraints. A replacement exterior reference can be added through that same package pipeline.

New baked kit pieces: aid station, tool chest, server rack lower/upper, checkpoint sign, rooftop vent and cable spool. Furniture writes cabinet/appliance collision with per-voxel render hints; decor is visual only. They use the current modern materials and cell/pivot contracts. `npm run kit:bake` produces the shared GLB and manifest; runtime geometry is a fallback. `tools/art/pack_test_soldier.py` reproduces the sprite packing with Pillow.

Interior dressing now has a separate WFC pass over rooms. Domains constrain kits to room kind; hall is empty circulation; adjacency forbids two dense kits next to one another. Recipes reference pre-authored furniture. Actual placement still checks door/stair aprons, footprint capacity, occupancy and connectivity. The seed includes the building/floor furnishing RNG. Generated image maps place roof vents and optional checkpoint/industrial dressing from their existing layout.

Next asset batches (author before enabling):

| Batch | Modules | Tactical role / constraint |
| --- | --- | --- |
| Exterior street | curb straight/corner, storefront glass/door, shutter, bench, bus shelter, car wreck | Match sidewalk sockets and preserve two flank routes; breakable glass and vehicle hazards |
| Exterior yard | fence/gate, retaining wall, planter, shed, rooftop machinery | Half/full cover mix, vaultable boundaries, roof access preserved |
| Interior domestic | kitchen run/corner, living furniture, bedrooms, bathroom doorway | Room-kind domains, doors reserved, avoid coverless long corridors |
| Interior commercial | office workstations, reception, shop aisles, service counter | Sparse/dense adjacency, ballistic cover authored per cell |
| Interior industrial | racks, lockers, workbench, drums, power cabinet | Destructibility and elemental material tags; hazardous items outside insertion aprons |

Every module needs footprint, rotation, sockets, material IDs, cover height, destruction behavior, navigation clearances, visual bounds and a stable asset ID. Bake art from those metadata; never infer gameplay solidity from a picture. Future interaction intents (power shutoff, water valve, unlock shutter) need shared validators and explicit state/events, then offline/online replay tests before UI activation.

Map acceptance: same seed and content version produce same grid; verify all gameplay rooms and objectives reachable, stairs/doors clear, cover density/flank routes valid, spawns unoccupied, source constraints respected. Keep generation failures visible rather than silently bypassing gates. Use the existing debug map builder for new seeds and programme/storey variants.

## Noncombat scenes: separate application boundary

Do not mount these in `Game`, `Battle`, or the mission event queue during battle testing. Implement later under `client/src/noncombat/` with an independent scene controller and separate persistent campaign schema. Only a frozen, validated mission descriptor crosses into combat; only a signed/validated result crosses back. No campaign renderer, timer, inventory mutation or socket subscription should run during combat.

| Scene | Player loop | State / transitions |
| --- | --- | --- |
| Operations hub | inspect squad, injuries, bonds; choose research or upgrades | Campaign save; hub → roster/workshop/operations |
| Roster & equipment | compare loadouts, optics, armour and elemental disciplines | Draft equipment IDs; validate into mission descriptor on launch |
| Workshop | craft/repair, inspect module upgrades | Explicit transactions; no mid-battle economy changes |
| Regional operations | choose a contract, see risk/reward and map seed | Mission draft; operations → briefing |
| Briefing & staging | preview objectives, assign soldiers, ready up | Lobby state; launch only once all required players ready |
| Debrief | review injuries, replay moments, salvage and objectives | Idempotent result application; debrief → hub |

Initial prototype for these scenes should be a separate entry point with fixture data. Prove navigation/save/load there before connecting battle results. Pause campaign balance until combat and map-generation tests stabilize.

## Multiplayer roadmap

Existing functionality is battle co-op via Colyseus: shared squad, per-unit ownership, server-ordered intents, deterministic peers, state hashes, end-turn votes and server AI. Keep the battle protocol focused on combat; these ability intents follow the same ordered path.

1. Harden battle co-op: test Earth Cover/Water Mend and watch sectors on two peers; reject forged targets, abilities and weapon IDs before ordering; freeze content version/map package hashes in join handshake. Cover reconnect, event-log replay/snapshot parity, disconnect turn voting, ownership reassignment and stale/duplicate command handling. Expose desync as a recoverable error with a server snapshot.
2. Separate staging room: host/join code, player seats, ownership draft, loadout validation, map/seed selection, ready votes. Lobby protocol emits one immutable launch descriptor. Keep chat optional and rate limited; no dependency on battle HUD.
3. Separate campaign co-op: host-owned campaign save, transaction IDs, ready votes for campaign transitions, authorization for inventory/research. Bind each mission result to campaign/mission/version and apply it exactly once.
4. PvP only after those gates: simultaneous hidden deployment, side ownership, authoritative fog-filtered messages, anti-cheat threat model, reconnect deadline and match results. Current lockstep peers have full state, so they are unsuitable for hidden-information competitive play without a protocol redesign.

Acceptance gates: unauthorized unit control rejected; two clients converge after terrain manipulation and healing; a disconnected player cannot permanently block turns; reconnect restores terrain HP, statuses, ammo, RNG and ownership; duplicate result/intent does not double spend; campaign screens never touch active battle state. Internet deployment, matchmaking, account identity, chat and PvP are planned, not enabled in this change.

## Door discovery and squad phases

Player phases retain four AP per soldier. Finish soldier spends unused AP and selects a ready squadmate; an exhausted squad prompts End Turn instead of automatically handing control to enemies. Enemy Activity and round banners frame the two squad phases.

Closed doors block ordinary player movement. Kick door costs one AP and reveals its adjacent rooms; coordinated breach remains another deliberate entry action. Windows reveal cells in current squad line of sight without permanently discovering the room. Unseen interior geometry stays dim under a flat translucent mask. Enemies require current squad line of sight and disappear when it is blocked. Kick/breach events permanently discover the room layout; physical objective markers remain concealed outside known cells. Exterior doors remain visible as interaction targets; discovered rooms remain known after closing a door.

First contact activates one deterministic scatter per enemy pod. Defenders move up to six traversal-cost units toward cover without spending their normal enemy-phase AP. Scatter respects occupied cells and closed doors, and can trigger directional overwatch. Enemies already visible at mission start are treated as deployed.

## Overwatch accuracy visualization

Direction selection and committed watches use filled tiles instead of sector borders. Teal marks an estimated reaction hit of at least 65%; amber marks below 65%. Tile estimates use 32 deterministic samples from the existing ballistic tracer against a standard standing body, including reaction spread, weapon/range, wounds, elevation, lighting and physical cover. They never use or change the battle RNG, ammo or AP. These are potential per-projectile hits, not a guarantee against a particular moving enemy.

Exposed wall, door, furniture and cover faces also receive filled colors. Their colors show unobstructed aim quality at that surface's distance, since a solid wall cannot hold a standing target. Highlight geometry follows connected collision footprints, respects the active storey cut and smoke/LOS, and excludes concealed interiors. Preview probability samples are cached while changing direction, then invalidated with battle events or soldier/equipment changes.

## Tactical camera and sprite presentation

The tactical default is a perspective camera with 45° elevation, 45° diagonal yaw, 38° vertical FOV and distance 27. Zoom changes framing while retaining elevation; manual orbit remains available. Mission entry centres the first soldier instead of overriding modern maps with a distant overview. This is a visual XCOM-style preset, not a claim about exact proprietary camera constants.

Field sprites face the active camera in both axes, keeping the packed atlas foot baseline at the grid position and the drawn proportions intact. Camera-relative facing still selects the atlas row. Ground rings and movement/collision remain on the world grid. Health bars follow camera up above the sprite instead of overlapping its head. The source sheet still approximates the eight facing directions; true authored side/back animation remains an art task.


## Equipment preparation and tactical UI

The deployment menu now prepares a 6×5 pack for each soldier. Each grenade/gadget has a footprint; placements can rotate and move and must fit without overlaps. The frozen descriptor carries those placements into local and online missions; the server and peers validate the same pack. Using an item removes one footprint. This is mission preparation, separate from the deferred campaign inventory. No economy or persistent ownership is implemented.

The selected soldier panel holds weapons, reload controls, and clickable packed items. The bottom dock holds skills and tactical commands. Medical kits heal a living ally within 1.5 tiles (including self) for 8 HP at 1 AP and cannot repair disabled limbs. Breaching charges route to deliberate breach selection.

The camera widget contains only four arrows: left/right rotate the camera and up/down change the inspected floor. Keyboard and mouse panning and orbiting remain available. Inventory cells and item footprints use a tight 1-pixel gap in preparation and battle.

## Bug audit corrections (2026-10-11)

Earth Cover checks clearance above its non-walkable block and excludes grated landings, stair/ladder access and door approaches. Rejected casts leave AP, Will, RNG and terrain unchanged. A regression covers the Signal House upper fire-escape landing.

Both Medical Kit and Water Mend restore torso HP only by the actual HP healed, preserve disabled parts, and permit self-healing. Water Mend still extinguishes burning and applies wet.

Inventory choice is intentionally class-independent for the prototype. The 6×5 footprint is the capacity rule; per-item caps and class restrictions are balance decisions not introduced by this audit. Invalid placements are validated before room generation and reported with a soldier-specific error.

Interior vision is computed once at movement completion while per-step spotting, scatter and overwatch continue normally. Rendering uses indexed room membership rather than scanning room/cell lists per voxel. Scatter ID ties use plain code-unit comparison.

Room generation runs in workers with two simultaneous jobs, eight waiting jobs, and a 30-second timeout. Co-op init carries an RLE snapshot of the compiled mission; clients hydrate exact voxel materials, HP, room tags and support groups instead of generating the layout again. Battle math retains the existing cross-engine floating-point assumption and hash checks.

Subway Crossing layer gates now cover seeds 1–16. Optional drops seen by starting enemies are closed and recorded as repairs; stairs and manholes remain open.

## Implementation update — 2026-10-12

Battle co-op hardening is implemented: protocol/content fingerprint checks, compiled map hash verification, expected sequence validation, player-scoped command receipts, immediate disconnected-seat reassignment, connected-only turn votes, automatic reconnection, and authoritative replay recovery. Recovery uses the compiled initial map plus the complete ordered command log; it validates the resulting battle hash before exposing the restored battle. This restores terrain damage, unit/body HP, statuses, ammunition, RNG, watch sectors and ownership together. Recovery cost grows with the mission log; compact state checkpoints remain future work.

The separate `staging.html` entry point supports room codes, seats, host mission/seed edits, ownership drafting, validated 6×5 equipment packs and ready votes. Edits reset readiness. Launch freezes the descriptor and ownership map, creates a mission room and issues private seat tickets. Joining order does not change player identities or assignments. The battle menu's Host button now opens this briefing flow; direct battle rooms remain available for admin tests.

The separate `campaign.html` / `client/src/noncombat/` prototype provides headquarters, roster, workshop, regional operations, briefing and debrief navigation with versioned local save/load. Fixture transactions and mission completions are idempotent. It imports no Game or combat renderer and does not consume live battle results. Craft costs and completion data are demonstrative fixtures, not campaign balance. Authoritative campaign co-op progression, production result signatures, internet matchmaking and PvP remain gated roadmap work.

Validation includes real two-peer Earth Cover, Water Mend and watch-sector commands; rejected forged abilities/weapons/ownership; duplicate/stale commands; map/replay verification; reconnect and disconnect voting; staging readiness reset, invalid equipment, ticket checks and reverse-order joins; and campaign save/transaction validation. Run `npm run build` to refresh the shared content fingerprint and all entry points, then `npm test` and `npm run server`. Open `/staging.html` or `/campaign.html` from the battle menu. All peers must use the rebuilt client.

### Quick map testing update

Online Host now launches the selected map directly; the separate optional briefing can launch immediately without party readiness. Zoom depth controls cutaways (distance ≥36: roofs; zoom toward 8: descend through storeys to floor one). Named Lower/Higher floor buttons override the current cut until the next wheel scroll; Rotate left/right remain click actions, and keyboard arrows still pan. Show outside only is a fixed-label toggle. Floor changes update the building mask before rebuilding, avoiding duplicate full-map rebuilds. The optional art override is requested only when present in the build. Walking, vaulting and enemy scatter shatter crossed glazing deterministically, preserving solid sill cover.
