# Headless AI-vs-AI & Playstyle Adaptation Report

- Generated: `2026-11-24T06:50:02.977Z`
- Mode: `all` | Biomes: `8` | Seeds/epoch: `2` | Epochs: `2` | Total Matches: `384`
- Total runtime: `409.88s`

## 1. Biome Matrix (Baseline AI vs AI)

| Biome | Matches | Alpha Win% | Bravo Win% | Avg Rnds | Alpha Hit% | Bravo Hit% | Avg Dist | Avg Spread | Climb | Headshots (A/B) | Cover Broken | HighGround% | Indoor% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| downtown | 2 | 50% | 50% | 12.5 | 42.6% | 64.5% | 14.09m | 2.14t | 0.82t | 18/1 | 3 | 15% | 73% |
| industrial | 2 | 50% | 0% | 13 | 43.6% | 26.1% | 15.87m | 2.31t | 0.53t | 15/0 | 0.5 | 21% | 77% |
| suburb | 2 | 50% | 50% | 13.5 | 35.3% | 56.1% | 16.8m | 2.24t | 0.56t | 10/3 | 1.5 | 22% | 83% |
| harbor | 2 | 50% | 50% | 11 | 37.2% | 50.0% | 15.47m | 2.34t | 0.69t | 27/1 | 1.5 | 9% | 67% |
| winter_outpost | 2 | 100% | 0% | 13 | 51.0% | 52.6% | 14.46m | 2.41t | 0.48t | 40/2 | 4 | 2% | 73% |
| old_quarter | 2 | 50% | 50% | 16 | 31.5% | 63.0% | 14.52m | 1.49t | 0.55t | 14/1 | 4.5 | 8% | 92% |
| metro_hub | 2 | 0% | 100% | 14 | 37.7% | 54.9% | 9.47m | 3.06t | 0.85t | 22/2 | 1 | 0% | 71% |
| arid_compound | 2 | 50% | 50% | 11.5 | 39.8% | 46.2% | 13.33m | 1.94t | 0.63t | 22/0 | 1 | 0% | 78% |

## 2. Mutual Co-Evolution (Alpha AI vs Bravo AI)

| Epoch | Matches | Alpha Win% | Bravo Win% | Draws | Avg Rnds | Alpha Hit% | Bravo Hit% | Bravo Observed Alpha | Alpha Observed Bravo |
|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 0 | 16 | 50.0% | 43.8% | 1 | 13.06 | 40.4% | 52.7% | Loud, Exposed, Elementalist, Breacher | Room fighter, Loud, Flanker, High-ground |
| 1 | 16 | 25.0% | 68.8% | 1 | 12.13 | 38.4% | 55.2% | Loud, Patient, Exposed, Never waits | Room fighter, Loud, Flanker, Cover discipline |
| 2 | 16 | 50.0% | 50.0% | 0 | 12.38 | 36.6% | 51.6% | Loud, Breacher, Never waits, Patient | Room fighter, Loud, Flanker, High-ground |

## 3. Adaptation vs Distinct Player Archetypes

| Archetype | Bravo Win% (Base -> Adapted) | Delta | Avg Enemy Dmg (Base -> Adapted) | Detected Playstyle | Top Counter Weights (>=1.15) |
|---|---:|---:|---:|---|---|
| Cautious Overwatching Marksmen | 37.5% -> 50.0% | +12.5% | 116.94 -> 116.19 | Loud, Exposed, Patient, Never waits | recoilDiscipline=1.58, closeIn=1.53 |
| Aggressive Door Breachers | 62.5% -> 68.8% | +6.3% | 109.38 -> 102.75 | Loud, Exposed, Never waits, Breacher | recoilDiscipline=1.62, doorWatch=1.59, closeIn=1.3, flankGuard=1.23 |
| Overwatch Turtle | 62.5% -> 56.3% | -6.2% | 124.38 -> 113.88 | Loud | recoilDiscipline=1.47, flankGuard=1.26, spread=1.2 |
| Demolitions & Elementalist | 50.0% -> 56.3% | +6.3% | 112.81 -> 112.19 | Loud, Elementalist, Never waits, Patient | spread=1.84, closeIn=1.68, recoilDiscipline=1.51 |
| Mobile Flanker Skirmishers | 62.5% -> 56.3% | -6.2% | 111.31 -> 116.06 | Loud, Never waits, Controlled bursts | recoilDiscipline=1.64, flankGuard=1.3, closeIn=1.27 |
