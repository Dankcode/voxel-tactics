# PLAN-09: Intel-driven AI, XCOM hit chance, playstyle cache, monsters, formations and killstreaks

Status: implemented 2026-10-16. Tests: `shared/battle/enemy-ai.test.js`, `shared/battle/formations-strikes.test.js`,
`client/src/render/kit/damage-decals.test.js` (edge chips). Full suite green except the long `maps.test.js`, which
passes when run test by test.

Health is lower than in XCOM, so **intel decides fights**. The enemy now plays for information and position instead of
charging, uses the squad's own gadgets and elements against it, and adapts to how *you* play across matches.

## 1. XCOM 2-style hit chance (overwatch and NPC shots)

`shared/battle/HitChance.js` `hitChance(battle, shooter, target, weapon, { reaction, breach, from, at })`
returns `{ chance, crit, mods, cover, flanked }`. Player shots keep Phoenix Point free aim (the cone); **overwatch
reactions (both sides) and every NPC shot roll this chance**.

| Term | Value (balance.js) |
|---|---|
| Base aim | accuracy × `aimScale` 80 (Sharpshooter 80, Gunman 44) |
| Wounds / statuses on the shooter | arm −15 each, head −10, suppressed −30, staggered −15, on fire −15, panicked −25, stress ≥75 −10 |
| Buffs | deadeye +25, breach +10, scope +10 |
| Range | ≤3 tiles +10 (−10 for snipers); past effective range −40 per range (cap −60) |
| Height | 2+ voxels above +20; target 2+ above −10 |
| Target cover | full −40, half −20 (×0.5 if the round would go through it) |
| Target state | smoke −20, darkness −15 (image maps, >4 tiles), braced −10, Shield Line front −10, frozen +20, stunned +10 |
| Overwatch | × `overwatchAimMult` 0.7 |
| Crit | flanked target +40, sniper +10; crits deal × `critDamageMult` 1.5 |

Rolling (`Battle.fireWeapon`): one roll per round (pellets of a shell share it). A hit flies at the first visible
body part (head on a crit); a miss is thrown 0.7–1.6 m wide, half of them low into cover, so misses still chew up
walls. The `shot` event carries `chance`, `crit`, `rolls`, `cover`, `dist`; the cut-in subtitle shows
"NN% to hit", overwatch floats "OVERWATCH NN%", crits float "CRITICAL".

## 2. Elements: chill vs freeze

Cryo on a **wet** unit freezes it: rooted, −2 AP, +20 to be hit. Cryo on a **dry** unit only chills it:
−30 % movement per AP per stack (`chillMobility`), no AP loss (`Units.mobilityPerAp`).

## 3. Enemy brain (`shared/battle/EnemyAi.js`)

- **Intel, not omniscience.** `battle.enemyIntel[playerId] = { x, y, z, round, source }` is filled by sightings
  (`recordSightings`, after every action) and noise (`noise`). Searching an empty last-known spot marks it `lost`.
  NPCs hunt the remembered position for 3–5 rounds; nobody known → a cautious sweep, never a charge.
- **Tile choice by hit chance both ways.** Pass 1 scores cover, flanks, range, hazards, spacing, rooms, door lines
  and **known overwatch cones**; pass 2 re-scores the best 20 with line of sight, the squad's chance on that tile and
  the NPC's chance from it, and checks the walk itself against overwatch (`battle.overwatchThreats`).
- **Hide and ambush.** Wounded (≤50 % HP), outnumbered, or pushed by an aggressive squad with no ≥55 % shot →
  break line of sight (room interiors score extra), then overwatch the approach.
- **Pod roles** (`podRole`): anchor holds cover, flanker works around (off the pod–target line), support stays back
  and throws.
- **Shooting.** Takes ≥70 % shots (≥45 % for a likely kill) immediately; with worse odds it repositions first; after
  moving it fires at ≥30 %, else overwatches.
- **Gadgets and elements** (`gadget`): cryo on soaked targets (freeze) or bunched dry ones (chill), water to set up a
  pod-mate's cryo or put out a burning friend, fire on dug-in or bunched dry targets, frags on clusters, smoke on
  itself when caught in the open, Earth Cover walls (`earthCover`) when exposed.
- **New kits:** Gunman fire + water, Lookout cryo + smoke, Enforcer smoke, Riot Guard gets Earth Cover.

## 4. Playstyle profile and the AI cache

`shared/session/Playstyle.js`: `playstyleFromBattle` reads the log into traits 0..1 — aggression, flanking,
overwatch, explosives, elements, stealth/intel, range, cover discipline (turn ends in cover, `stats.turnEnds`),
breach, melee. `mergeProfile` rolls a match into a moving average (≥30 % weight per match, last 10 matches kept).
`aiTuningFrom` turns traits into AI weights (1 = average, 0.5..2; confidence grows over the first 3 matches):

| Your habit | AI weight | What the AI does |
|---|---|---|
| flanking | flankGuard | values cover from several sides, sticks with the pod |
| overwatch | overwatchCaution | stays out of watched cones and paths |
| explosives / elements | spread | keeps apart; pods stop using formations at ≥1.5 |
| aggression | ambush | falls back into rooms to ambush |
| stealth | hunt | remembers leads longer, sweeps toward noise |
| long range | closeIn | breaks line of sight and closes |
| cover discipline | flush | flanks wider, throws fire/frags at dug-in targets |
| breaching | doorWatch | stays off door lines |
| melee | keepAway | keeps distance from brawlers |

**Determinism:** the profile travels in the scenario descriptor (`desc.aiProfile`, sanitized in `sanitizeDesc`),
so every lockstep peer builds the same AI; `aiTuning` is part of the battle hash.

**Cache file:** `server/data/ai-cache.json` (gitignored), `server/src/AiCache.js`:
`{ version, updatedAt, squad: profile, players: { name: profile } }` where a profile holds traits, headline,
last 10 matches, `tuning` and plain-language `adaptation` lines. Mission rooms inject the server's profile (players'
blended, else the squad's) and record the match on outcome. Local games load it via `GET /api/ai-cache` and post
`POST /api/ai-cache { style, meta }`; a browser copy (`localStorage`) covers static builds without the server.

**Post-match report:** new *Playstyle & AI* tab — this match's traits (with a marker for what the AI expected),
NPC/overwatch roll stats, and "How the AI adapts next match". `report.playstyle` is in the JSON download.

## 5. Walker monster

The four-legged **Wall Strider** is now a melee monster: `strider_claws` (16 dmg, pierce 4, knockback 2) and
**Wall Smash** (`smash`, 1 AP, 0 WP): two stacked blunt blasts (radius 1.7, `smashVoxelDamage` 40, no scorch, never the
floor it stands on) within 3 tiles of its legs, 12 damage + knockback to anyone behind. `decideMonster` claws what it
reaches, smashes through a wall between it and its prey when the prey is within 10 tiles or the walk is no shorter,
else stalks (climbing included). District maps add one strider pod on the street (`DISTRICT_PODS` group 5); a walker
that cannot fit its spawn is left out instead of failing the mission.

## 6. Formations

- **Free slot swaps** (`formation_swap { slot }`): select a member, its formation's spots light up (yours green,
  squadmates' blue, empty red); click a spot to trade places, or Shift+click a squadmate. No AP, no reactions.
  Taking slot 0 makes you the anchor; the anchor can only trade with a member.
- **Narrow spaces:** a group move whose destination leaves any slot without standing room is refused with
  `formation_blocked` ("formation too wide to fit here"). Break the formation, or **Switch** it from the Formation
  tab (`formation_switch { template, facing }`, no AP, same members) — e.g. to a Patrol File.
- **Enemy formations:** single-tile NPCs (never walkers) form a Shield Line when dug in facing visible soldiers and
  advance in a **Wedge** toward an intel lead; the wedge breaks on contact so they spread into cover. Leaders act
  first (`aiOrder`) so members follow the group move.

## 7. Killstreak strikes (`shared/battle/Strikes.js`)

The highlight is exactly the affected area (draped over roofs), and nothing outside it is hit.

| Strike | Highlight | Effect |
|---|---|---|
| Airstrike (`carpet_bomb`, intel rules) | one 21 × 7 corridor along the caster→target axis | 5 bombs at seeded spots inside it, radius 3.5, 40 dmg (10 at the corridor edge) |
| Orbital Laser | 33 × 5 band | everything standing in the band is cut down to the ground floor, 40 dmg |
| Commander Strike (classic) | radius-4 circle | blast 25 dmg, power 12 |

**Depth:** open ground keeps a crater **one level** deep; buildings lose up to two storeys from the top; strikes never
dig below the ground floor (no pits into basements).

## 8. Destruction look and materials

- Burned (sooty) side faces now also get **chipped, broken edges** (`edgeTexture`, opacity by soot level, tinted by
  material), XCOM-style blast wear next to the burn decal.
- **Brick** retextured (`tools/art/make_textures.py make_brick`): 18 courses × 6 stretchers per tile, per-brick
  colour and firing variation, pits, worn arrises, chipped corners, recessed sandy mortar, grime. Mobile copy
  regenerated.
