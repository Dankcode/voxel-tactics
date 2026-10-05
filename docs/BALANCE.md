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

## Next

- Re-run after the fire lance change; check the long rifle (3 AP) against the repeater.
- Run `npm run sim:world` across all ten burgs (denser maps, more indoor fights).
- Human check (PLAN-01 §15.5): play 6 missions, compare with the bot numbers.

## Generated burgs (3 seeds each, standard squad vs 10 hostiles, formations on)

Player win rate is about **35 %** across the ten burgs (0–67 % per burg; 9–24 rounds). Dense towns (Bois,
Morokov) are hardest: short sightlines, two pods indoors, and more hostiles than the Proving Grounds. Before
tuning world missions, decide the target (PLAN-01 §15.3: starter kit wins 55–75 %) and either cut a pod or add a
fifth soldier — `chooseSpawns()` in `shared/mission/WorldMission.js` controls pod count.
