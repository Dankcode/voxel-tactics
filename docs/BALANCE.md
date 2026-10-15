# Balance notes

Numbers come from `tools/sim/battle_sim.mjs` (AI vs AI). Raw output of the latest 100-seed run is in
`docs/balance-sim-proving-grounds-100.txt`. Tunables: `shared/content/weapons.js`, `shared/content/balance.js`,
`shared/content/formations.js`.

## Pass 1 → pass 2 (2026-10-06)

The first run (12 seeds) had 32-round battles and armour that cancelled most hits (blunderbuss pellets 2 dmg
against 2–6 armour: 0 kills; repeater 7 hits for 0 damage against plate). Changes:

- Armour lowered about one-third across the board (plate torso 6 → 4, light torso 2 → 1, limbs 0–3).
- Repeater 4 → 5 dmg; blunderbuss 2 → 3 dmg per pellet; long rifle 10 → 12 dmg but spread 0.45° → 0.6°;
  hand cannon 5 → 6; shortbow 5 → 6 (pierce 2); musket 6 → 7 (spread 1.8°); crossbow spread 0.9° → 1.3°;
  flasks and powder bomb damage up (fire 4, frost 3, gale 2, bomb 8); fire lance range 6 → 8, spread 5° → 4.2°.

## Current state (100 seeds, Proving Grounds, standard squad vs 9 hostiles)

| | formations on | formations off |
|---|---|---|
| player win | 76 % | 74 % |
| avg rounds | 19.9 | 20.6 |
| survivors | 1.45 | 1.41 |

Formation win-rate delta **+2.0 pts** — inside the gate (+2 … +8). Before the AI only formed a Shield Line
behind cover facing known enemies, the delta was **−25 pts**: the gate caught a formation that, used blindly,
clustered soldiers in the open for the grenades.

| weapon | proj-hit | dmg/shot | dmg/AP | kills/shot | notes |
|---|---|---|---|---|---|
| Long Rifle | 90 % | 10.8 | 3.69 | 0.58 | strongest per AP; watch it |
| Repeater | 55 % | 7.1 | 3.57 | 0.33 | best voxel damage after the blunderbuss |
| Blunderbuss | 38 % | 6.3 | 3.28 | 0.40 | close range; chews cover (66 voxels) |
| Crossbow | 82 % | 5.5 | 2.76 | 0.32 | |
| Cult Musket | 87 % | 5.6 | 2.82 | 0.18 | |
| Shortbow | 81 % | 4.6 | 2.34 | 0.14 | |
| Siege Maul | 100 % | 8.9 | 4.43 | 0.23 | melee |
| Fire Lance | 28 % | 2.8 | 1.38 | 0.17 | buffed after this run (range 8, spread 4.2°) — re-run |
| Powder Bomb | — | 6.3 / throw | — | — | 17 voxels per throw |

Hit rates look high because the AI only shoots when its estimate is good; the human-side numbers will be lower.

## Outdoor cover pass (2026-10-06, 40 seeds, Proving Grounds)

`shared/mission/CoverScatter.js` now adds ~60 props to the Proving Grounds and ~90–130 to each burg. The largest
open square shrank from 12 to 7 tiles (Proving Grounds) and from 8–12 to 4–10 (burgs). Fights got slower and
closer to the plan's target band:

| | before (100 seeds) | after (40 seeds) |
|---|---|---|
| player win | 76 % | 63 % (+5 % draws) |
| avg rounds | 19.9 | 21.0 |
| Cult Musket hit | 87 % | 75 % |
| Repeater hit | 55 % | 48 % |
| Long Rifle dmg/AP | 3.69 | 3.61 |

Still inside PLAN-01 §15.3 (starter kit wins 55–75 %). Re-run `npm run sim:formations`: the formation delta
was measured before the cover pass.

## Real-object cover, non-walkable pitched roofs (2026-10-07, 30 seeds)

The cover pass now places only catalogue objects (`PropCatalog.js`), and pitched roofs can't be stood on.
Player win rate 57 % (+3 % draws), 20.3 rounds, Long Rifle 3.46 dmg/AP, Repeater 3.65. That is at the low edge
of the 55–75 % band. If it drifts below, lower `targetShare` in the cover pass or cut a pod.

## Next

- Re-run after the fire lance change; check the long rifle (3 AP) against the repeater.
- Run `npm run sim:all` across every map (denser maps, more indoor fights).
- Human check (PLAN-01 §15.5): play 6 missions, compare with the bot numbers.

## Present-day maps (2026-10-08, 2 seeds each, standard squad, formations on, 20-round cap)

A first smoke run (`npm run sim:all`): every map plays to an outcome without errors. Player win rates on this tiny
sample: Cedar Close 50 %, Main Street 50 %, Harbor Yard 100 %, Route 9 Stop 100 %, Training Facility 0 % (one draw).
Battles take 14–16 rounds. Enemy counts per map are set in each map file (`spawns.enemy`); before tuning, run at
least 24 seeds per map and pick the target (PLAN-01 §15.3: starter kit wins 55–75 %). The old generated-burg
numbers were removed with the burg generator.

## PLAN-07 combat feel (2026-10-15): data for manual tuning

Leon tunes balance by hand; these AI-vs-AI runs (`tools/sim/battle_sim.mjs --rounds 30`, standard squad, formations
on) are recorded as a starting point, not a target that was hit. The 12–16 seed samples swing about ±12 pts.

| Run | Change | Cedar Close | Civic District | Downtown Core | Dockside Yards |
|---|---|---|---|---|---|
| A | penetration, breakable cover, 7-hostile district pods; old spreads | 75 % · 12.1 rds | 33 % · 23.3 rds | 50 % · 22.8 rds | 67 % · 24.2 rds |
| B | spreads × 2.5 (AK 1.3°) | 92 % · 13.3 | 83 % · 26.2 | — | — |
| C | AK 0.9° | 56 % · 13.8 | 50 % · 25.0 | 42 % · 23.3 | — |
| D | AK 1.1°, 6-hostile pods | 88 % · 14.3 | 81 % · 25.7 | 83 % · 24.7 | — |
| **E (shipped)** | AK 1.0°, 7-hostile pods | 81 % · 14.9 | 50 % · 25.8 | 19 % · 23.7 | — |

Observations:
- Cedar Close is dominated by the cultists' AK spread: 0.9° → 56 %, 1.0° → 81 %, 1.1° → 88 %.
- The 96 × 72 districts run 23–26 rounds against the 30-round cap (long walks between pods); Downtown is the hardest
  (dense city blocks, enemies indoors).
- Voxels destroyed per battle rose from 14 (before PLAN-07) to 31–57.
- Shipped values: AR 1.0°, Marksman 0.6°, Carbine 0.8°, AK 1.0°, Pistol 1.4°, Sniper 0.3°, Shotgun 4°; district pods
  3 + 2 + 2 (`shared/mapgen/district/Pods.js`). Raw output: re-run with the command above.
