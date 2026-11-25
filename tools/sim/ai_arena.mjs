#!/usr/bin/env node
// Headless AI-vs-AI arena, co-evolution simulator & playstyle adaptation benchmark.
// Collects per-match tactical + ballistic telemetry across all map biomes, benchmarks
// symmetric AI co-evolution across epochs, and measures counter-adaptation against
// distinct human playstyle doctrines.
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

import { Battle } from '../../shared/battle/Battle.js';
import { runAiSide } from '../../shared/battle/Ai.js';
import { buildMission, sanitizeDesc, squadFor } from '../../shared/session/Scenarios.js';
import { spreadInsertion } from '../../shared/session/Insertion.js';
import { PLOT_IDS, PLOT_FAMILIES } from '../../shared/mapgen/PlotCatalogue.js';
import {
    ADAPTIVE_VERSION, BIOME_PRIORS, PLAYER_ARCHETYPES, TUNING_KEYS,
    analyzeSideBehavior, mergeSideProfile, counterTuningFrom, updateBiomeMemory
} from '../../shared/ai/AdaptivePolicy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const __filename = fileURLToPath(import.meta.url);
const r2 = x => Math.round((x || 0) * 100) / 100;
const r3 = x => Math.round((x || 0) * 1000) / 1000;

function runSingleMatch(job) {
    const t0 = Date.now();
    const {
        mode, epoch, biome, seed, rounds = 18, samples = 12,
        playerDoctrine = null, playerProfile = null, playerTuning = null,
        aiProfile = null, aiTuning = null, biomeMemory = null,
        label = ''
    } = job;

    let desc, mission, resolvedSeed = seed, lastErr = null;
    for (let retry = 0; retry < 8; retry++) {
        const trySeed = (seed + retry * 1009) >>> 0;
        try {
            desc = sanitizeDesc({ scenario: 'operation', operation: { plot: biome }, seed: trySeed, squad: 'standard' });
            mission = buildMission(desc);
            resolvedSeed = trySeed;
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
        }
    }
    if (lastErr) throw lastErr;
    mission.spawns.player = spreadInsertion(mission.store, mission.spawns.player);
    const squad = squadFor(desc);

    const battle = new Battle({
        mission,
        squad,
        seed: resolvedSeed,
        aiProfile,
        aiTuning,
        playerProfile,
        playerTuning,
        biomeMemory,
        controllers: { player: 'ai', enemy: 'ai' }
    });

    const pPolicy = {
        formations: playerDoctrine?.formations ?? true,
        breach: playerDoctrine?.breach ?? true,
        grenadeMinTargets: playerDoctrine?.grenadeMinTargets ?? 2,
        shootThreshold: playerDoctrine?.shootThreshold ?? 0.9,
        samples,
        doctrine: playerDoctrine
    };
    const ePolicy = {
        formations: true,
        samples
    };

    while (!battle.outcome && battle.round <= rounds) {
        runAiSide(battle, 'player', pPolicy);
        if (!battle.outcome) runAiSide(battle, 'enemy', ePolicy);
    }

    const playerSurvivors = battle.unitsOf('player').filter(u => !u.drone).length;
    const enemySurvivors = battle.unitsOf('enemy').filter(u => !u.drone).length;
    const winner = battle.outcome?.winner || (playerSurvivors > enemySurvivors ? 'player' : enemySurvivors > playerSurvivors ? 'enemy' : 'draw');
    const margin = playerSurvivors - enemySurvivors;

    const playerStyle = analyzeSideBehavior(battle, 'player');
    const enemyStyle = analyzeSideBehavior(battle, 'enemy');

    return {
        mode,
        label,
        epoch,
        biome,
        seed,
        resolvedSeed,
        objective: battle.objective?.kind || 'clear',
        winner,
        outcome: battle.outcome?.winner || 'cap',
        reason: battle.outcome?.reason || 'round cap',
        rounds: battle.round,
        ms: Date.now() - t0,
        playerSurvivors,
        enemySurvivors,
        margin,
        playerDamage: battle.units.filter(u => u.side === 'player').reduce((s, u) => s + (u.stats?.damage || 0), 0),
        enemyDamage: battle.units.filter(u => u.side === 'enemy').reduce((s, u) => s + (u.stats?.damage || 0), 0),
        aiTuningUsed: aiTuning || null,
        playerTuningUsed: playerTuning || null,
        player: playerStyle,
        enemy: enemyStyle
    };
}

if (!isMainThread) {
    parentPort.on('message', ({ id, job }) => {
        try {
            const result = runSingleMatch(job);
            parentPort.postMessage({ id, ok: true, result });
        } catch (err) {
            parentPort.postMessage({ id, ok: false, error: err?.stack || String(err) });
        }
    });
} else {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const k = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { out[k] = next; i++; }
        else out[k] = true;
    }
    return out;
}

class WorkerPool {
    constructor(size) {
        this.size = Math.max(1, size);
        this.workers = [];
        this.idle = [];
        this.queue = [];
        this.inflight = new Map();
        this.nextId = 1;
        this.closed = false;
        for (let i = 0; i < this.size; i++) this.#spawn();
    }
    #spawn() {
        const w = new Worker(__filename);
        w.on('message', msg => {
            const entry = this.inflight.get(msg.id);
            this.inflight.delete(msg.id);
            this.idle.push(w);
            this.#drain();
            if (entry) {
                if (msg.ok) entry.resolve(msg.result);
                else entry.reject(new Error(msg.error));
            }
        });
        w.on('error', err => {
            for (const [id, entry] of this.inflight.entries()) {
                if (entry.worker === w) {
                    this.inflight.delete(id);
                    entry.reject(err);
                }
            }
        });
        this.workers.push(w);
        this.idle.push(w);
    }
    run(job) {
        if (this.closed) return Promise.reject(new Error('Pool closed'));
        return new Promise((resolve, reject) => {
            this.queue.push({ job, resolve, reject });
            this.#drain();
        });
    }
    async mapAll(jobs) {
        return Promise.all(jobs.map(j => this.run(j)));
    }
    #drain() {
        while (!this.closed && this.idle.length && this.queue.length) {
            const w = this.idle.shift();
            const task = this.queue.shift();
            const id = this.nextId++;
            this.inflight.set(id, { worker: w, resolve: task.resolve, reject: task.reject });
            w.postMessage({ id, job: task.job });
        }
    }
    async close() {
        this.closed = true;
        await Promise.all(this.workers.map(w => w.terminate()));
        this.workers = [];
        this.idle = [];
    }
}

function summarizeMatches(matches) {
    const n = Math.max(1, matches.length);
    const pWins = matches.filter(m => m.winner === 'player').length;
    const eWins = matches.filter(m => m.winner === 'enemy').length;
    const draws = matches.filter(m => m.winner === 'draw').length;

    const sideSummary = sideKey => {
        let shots = 0, projs = 0, hits = 0, headshots = 0, pierced = 0;
        let coverDestroyed = 0, flush = 0, flankShots = 0, overwatch = 0, reactions = 0;
        let explosives = 0, elements = 0, breaches = 0, tiles = 0;
        let inCover = 0, exposed = 0, highGround = 0, indoor = 0, endTurns = 0;
        let distW = 0, distN = 0, spreadW = 0, climbW = 0;
        const modes = { single: 0, burst: 0, auto: 0 };
        const bands = { close: 0, mid: 0, long: 0 };
        const traitSums = Object.fromEntries(Object.keys((matches[0]?.[sideKey]?.traits) || {}).map(k => [k, 0]));

        for (const m of matches) {
            const s = m[sideKey];
            if (!s) continue;
            const mm = s.metrics;
            shots += mm.shots;
            projs += mm.projectiles;
            hits += mm.hits;
            headshots += mm.headshots;
            pierced += mm.pierced;
            coverDestroyed += mm.coverDestroyed;
            flush += mm.flushShots;
            flankShots += mm.flankShots;
            overwatch += mm.overwatch;
            reactions += mm.reactions;
            explosives += mm.explosives;
            elements += mm.elements;
            breaches += mm.breaches;
            tiles += mm.tilesMoved;
            inCover += mm.inCover;
            exposed += mm.exposed;
            highGround += mm.highGroundTurns;
            indoor += mm.indoorTurns;
            endTurns += mm.inCover + mm.exposed + mm.unseen;
            if (mm.shotsWithTarget > 0 && mm.avgShotDist != null) {
                distW += mm.avgShotDist * mm.shotsWithTarget;
                distN += mm.shotsWithTarget;
            }
            if (mm.shots > 0 && mm.avgSpread != null) spreadW += mm.avgSpread * mm.shots;
            if (mm.shots > 0 && mm.avgRecoilClimb != null) climbW += mm.avgRecoilClimb * mm.shots;
            for (const k of ['single', 'burst', 'auto']) modes[k] += mm.fireModes?.[k] || 0;
            for (const k of ['close', 'mid', 'long']) bands[k] += mm.rangeBandHits?.[k] || 0;
            for (const [k, v] of Object.entries(s.traits || {})) traitSums[k] = (traitSums[k] || 0) + v;
        }
        const traits = Object.fromEntries(Object.entries(traitSums).map(([k, v]) => [k, r2(v / n)]));
        return {
            shotsPerMatch: r2(shots / n),
            hitRate: projs ? r3(hits / projs) : 0,
            headshotRate: hits ? r3(headshots / hits) : 0,
            headshots,
            pierced,
            avgShotDist: distN ? r2(distW / distN) : 0,
            avgSpread: shots ? r2(spreadW / shots) : 0,
            avgRecoilClimb: shots ? r2(climbW / shots) : 0,
            fireModes: modes,
            rangeBandHits: bands,
            coverDestroyedPerMatch: r2(coverDestroyed / n),
            flushPerMatch: r2(flush / n),
            flankShotsPerMatch: r2(flankShots / n),
            overwatchPerMatch: r2(overwatch / n),
            reactionsPerMatch: r2(reactions / n),
            explosivesPerMatch: r2(explosives / n),
            elementsPerMatch: r2(elements / n),
            breachesPerMatch: r2(breaches / n),
            tilesMovedPerMatch: r2(tiles / n),
            coverRate: (inCover + exposed) ? r3(inCover / (inCover + exposed)) : 0,
            highGroundRate: endTurns ? r3(highGround / endTurns) : 0,
            indoorRate: endTurns ? r3(indoor / endTurns) : 0,
            traits
        };
    };

    return {
        matches: matches.length,
        playerWins: pWins,
        enemyWins: eWins,
        draws,
        playerWinRate: r3(pWins / n),
        enemyWinRate: r3(eWins / n),
        avgRounds: r2(matches.reduce((s, m) => s + m.rounds, 0) / n),
        avgMs: Math.round(matches.reduce((s, m) => s + m.ms, 0) / n),
        avgPlayerDamage: r2(matches.reduce((s, m) => s + m.playerDamage, 0) / n),
        avgEnemyDamage: r2(matches.reduce((s, m) => s + m.enemyDamage, 0) / n),
        player: sideSummary('player'),
        enemy: sideSummary('enemy')
    };
}

async function runBiomeMatrix(pool, { biomes, seeds, rounds, samples, matchLog }) {
    const jobs = [];
    for (const biome of biomes) {
        for (let s = 1; s <= seeds; s++) {
            jobs.push({
                mode: 'biome-matrix',
                label: 'baseline',
                epoch: 0,
                biome,
                seed: s,
                rounds,
                samples
            });
        }
    }
    const results = await pool.mapAll(jobs);
    matchLog.push(...results);

    const byBiome = {};
    for (const biome of biomes) {
        const sub = results.filter(m => m.biome === biome);
        byBiome[biome] = {
            theme: PLOT_FAMILIES[biome]?.theme || biome,
            ...summarizeMatches(sub)
        };
    }
    return { overall: summarizeMatches(results), byBiome };
}

async function runCoEvolution(pool, { biomes, seeds, epochs, rounds, samples, matchLog }) {
    let alphaProfileOfBravo = null;
    let bravoProfileOfAlpha = null;
    let alphaBiomeMem = {};
    let bravoBiomeMem = {};
    const epochHistory = [];

    for (let epoch = 0; epoch <= epochs; epoch++) {
        const jobs = [];
        for (const biome of biomes) {
            const alphaTuning = epoch === 0 ? null : counterTuningFrom(alphaProfileOfBravo, { biome, biomeMemory: alphaBiomeMem });
            const bravoTuning = epoch === 0 ? null : counterTuningFrom(bravoProfileOfAlpha, { biome, biomeMemory: bravoBiomeMem });
            for (let s = 1; s <= seeds; s++) {
                const seed = epoch * 100 + s;
                jobs.push({
                    mode: 'coevolution',
                    label: `epoch-${epoch}`,
                    epoch,
                    biome,
                    seed,
                    rounds,
                    samples,
                    playerProfile: alphaProfileOfBravo,
                    playerTuning: alphaTuning,
                    aiProfile: bravoProfileOfAlpha,
                    aiTuning: bravoTuning,
                    biomeMemory: bravoBiomeMem
                });
            }
        }
        const results = await pool.mapAll(jobs);
        matchLog.push(...results);

        for (const m of results) {
            bravoProfileOfAlpha = mergeSideProfile(bravoProfileOfAlpha, m.player, {
                biome: m.biome,
                outcome: m.outcome,
                won: m.winner === 'enemy'
            });
            alphaProfileOfBravo = mergeSideProfile(alphaProfileOfBravo, m.enemy, {
                biome: m.biome,
                outcome: m.outcome,
                won: m.winner === 'player'
            });
            bravoBiomeMem = updateBiomeMemory(bravoBiomeMem, m.biome, m.aiTuningUsed, m.winner === 'enemy', Math.max(1, Math.abs(m.margin)));
            alphaBiomeMem = updateBiomeMemory(alphaBiomeMem, m.biome, m.playerTuningUsed, m.winner === 'player', Math.max(1, Math.abs(m.margin)));
        }

        const avgEnemyTuning = Object.fromEntries(TUNING_KEYS.map(k => {
            const vals = results.map(m => m.aiTuningUsed?.[k] ?? 1);
            return [k, r2(vals.reduce((a, b) => a + b, 0) / vals.length)];
        }));
        const avgPlayerTuning = Object.fromEntries(TUNING_KEYS.map(k => {
            const vals = results.map(m => m.playerTuningUsed?.[k] ?? 1);
            return [k, r2(vals.reduce((a, b) => a + b, 0) / vals.length)];
        }));

        epochHistory.push({
            epoch,
            summary: summarizeMatches(results),
            alphaHeadline: alphaProfileOfBravo?.headline || [],
            bravoHeadline: bravoProfileOfAlpha?.headline || [],
            alphaObservedTraits: alphaProfileOfBravo?.traits || null,
            bravoObservedTraits: bravoProfileOfAlpha?.traits || null,
            avgAlphaTuning: avgPlayerTuning,
            avgBravoTuning: avgEnemyTuning
        });
    }

    return {
        epochs: epochHistory,
        finalAlphaProfileOfBravo: alphaProfileOfBravo,
        finalBravoProfileOfAlpha: bravoProfileOfAlpha,
        alphaBiomeMemory: alphaBiomeMem,
        bravoBiomeMemory: bravoBiomeMem
    };
}

async function runArchetypeBenchmark(pool, { biomes, seeds, epochs, rounds, samples, matchLog }) {
    const archetypeIds = Object.keys(PLAYER_ARCHETYPES).filter(id => id !== 'balanced');
    const resultsByArchetype = {};

    for (const archId of archetypeIds) {
        const doctrine = PLAYER_ARCHETYPES[archId];
        // Epoch 0 baseline evaluation on seeds 1..seeds
        const baselineJobs = [];
        for (const biome of biomes) {
            for (let s = 1; s <= seeds; s++) {
                baselineJobs.push({
                    mode: 'archetypes',
                    label: `${archId}:baseline`,
                    epoch: 0,
                    biome,
                    seed: s,
                    rounds,
                    samples,
                    playerDoctrine: doctrine,
                    aiProfile: null,
                    aiTuning: null
                });
            }
        }
        const baselineMatches = await pool.mapAll(baselineJobs);
        matchLog.push(...baselineMatches);

        let enemyProfile = null;
        let biomeMem = {};
        const trainHistory = [];

        // Observe & train over Epochs 1..epochs
        for (const m of baselineMatches) {
            enemyProfile = mergeSideProfile(enemyProfile, m.player, {
                biome: m.biome, outcome: m.outcome, won: m.winner === 'enemy'
            });
            biomeMem = updateBiomeMemory(biomeMem, m.biome, null, m.winner === 'enemy', Math.max(1, Math.abs(m.margin)));
        }

        for (let epoch = 1; epoch <= epochs; epoch++) {
            const trainJobs = [];
            for (const biome of biomes) {
                const tuning = counterTuningFrom(enemyProfile, { biome, biomeMemory: biomeMem });
                for (let s = 1; s <= seeds; s++) {
                    trainJobs.push({
                        mode: 'archetypes',
                        label: `${archId}:train-${epoch}`,
                        epoch,
                        biome,
                        seed: epoch * 100 + s,
                        rounds,
                        samples,
                        playerDoctrine: doctrine,
                        aiProfile: enemyProfile,
                        aiTuning: tuning,
                        biomeMemory: biomeMem
                    });
                }
            }
            const trainMatches = await pool.mapAll(trainJobs);
            matchLog.push(...trainMatches);
            for (const m of trainMatches) {
                enemyProfile = mergeSideProfile(enemyProfile, m.player, {
                    biome: m.biome, outcome: m.outcome, won: m.winner === 'enemy'
                });
                biomeMem = updateBiomeMemory(biomeMem, m.biome, m.aiTuningUsed, m.winner === 'enemy', Math.max(1, Math.abs(m.margin)));
            }
            trainHistory.push({ epoch, summary: summarizeMatches(trainMatches) });
        }

        // Apples-to-apples adapted evaluation on exact same seeds 1..seeds with learned profile & memory
        const evalJobs = [];
        const counterWeightsByBiome = {};
        for (const biome of biomes) {
            const tuning = counterTuningFrom(enemyProfile, { biome, biomeMemory: biomeMem });
            counterWeightsByBiome[biome] = tuning;
            for (let s = 1; s <= seeds; s++) {
                evalJobs.push({
                    mode: 'archetypes',
                    label: `${archId}:adapted`,
                    epoch: epochs,
                    biome,
                    seed: s,
                    rounds,
                    samples,
                    playerDoctrine: doctrine,
                    aiProfile: enemyProfile,
                    aiTuning: tuning,
                    biomeMemory: biomeMem
                });
            }
        }
        const adaptedMatches = await pool.mapAll(evalJobs);
        matchLog.push(...adaptedMatches);

        const baseSum = summarizeMatches(baselineMatches);
        const adaptSum = summarizeMatches(adaptedMatches);
        const meanCounter = Object.fromEntries(TUNING_KEYS.map(k => [
            k, r2(biomes.reduce((acc, b) => acc + (counterWeightsByBiome[b][k] ?? 1), 0) / Math.max(1, biomes.length))
        ]));
        resultsByArchetype[archId] = {
            id: archId,
            name: doctrine.name,
            baseline: baseSum,
            adapted: adaptSum,
            enemyWinRateDelta: r3(adaptSum.enemyWinRate - baseSum.enemyWinRate),
            enemyDamageDelta: r2(adaptSum.avgEnemyDamage - baseSum.avgEnemyDamage),
            detectedHeadline: enemyProfile?.headline || [],
            detectedTraits: enemyProfile?.traits || {},
            meanCounterTuning: meanCounter,
            trainHistory
        };
    }
    return resultsByArchetype;
}

function buildLearnedPriors({ biomeMatrix, coevolution, archetypes }) {
    const learnedBiomeMemory = coevolution?.bravoBiomeMemory || {};
    const mergedPriors = {};
    for (const biome of PLOT_IDS) {
        const staticP = BIOME_PRIORS[biome] || {};
        const memD = learnedBiomeMemory[biome]?.deltas || {};
        const m = {};
        for (const k of TUNING_KEYS) {
            const v = (staticP[k] ?? 1) * (memD[k] ?? 1);
            if (Math.abs(v - 1) >= 0.03) m[k] = r2(Math.max(0.6, Math.min(1.85, v)));
        }
        mergedPriors[biome] = m;
    }
    const archetypeCounters = {};
    if (archetypes) {
        for (const [id, data] of Object.entries(archetypes)) {
            archetypeCounters[id] = {
                name: data.name,
                detectedHeadline: data.detectedHeadline,
                enemyWinRateBaseline: data.baseline.enemyWinRate,
                enemyWinRateAdapted: data.adapted.enemyWinRate,
                enemyWinRateDelta: data.enemyWinRateDelta,
                counterTuning: data.meanCounterTuning
            };
        }
    }
    return {
        version: ADAPTIVE_VERSION,
        generatedAt: new Date().toISOString(),
        staticBiomePriors: BIOME_PRIORS,
        learnedBiomeMemory,
        effectiveBiomePriors: mergedPriors,
        biomeObservedStats: biomeMatrix ? Object.fromEntries(Object.entries(biomeMatrix.byBiome).map(([b, s]) => [b, {
            matches: s.matches, avgRounds: s.avgRounds,
            playerHitRate: s.player.hitRate, enemyHitRate: s.enemy.hitRate,
            avgShotDist: s.player.avgShotDist, avgSpread: s.player.avgSpread,
            coverDestroyed: s.player.coverDestroyedPerMatch + s.enemy.coverDestroyedPerMatch,
            highGroundRate: r3((s.player.highGroundRate + s.enemy.highGroundRate) / 2),
            indoorRate: r3((s.player.indoorRate + s.enemy.indoorRate) / 2)
        }])) : null,
        archetypeCounters
    };
}

function buildMarkdownReport(report) {
    const lines = [];
    lines.push('# Headless AI-vs-AI & Playstyle Adaptation Report');
    lines.push('');
    lines.push(`- Generated: \`${report.meta.generatedAt}\``);
    lines.push(`- Mode: \`${report.meta.mode}\` | Biomes: \`${report.meta.biomes.length}\` | Seeds/epoch: \`${report.meta.seeds}\` | Epochs: \`${report.meta.epochs}\` | Total Matches: \`${report.meta.totalMatches}\``);
    lines.push(`- Total runtime: \`${(report.meta.elapsedMs / 1000).toFixed(2)}s\``);
    lines.push('');

    if (report.biomeMatrix) {
        lines.push('## 1. Biome Matrix (Baseline AI vs AI)');
        lines.push('');
        lines.push('| Biome | Matches | Alpha Win% | Bravo Win% | Avg Rnds | Alpha Hit% | Bravo Hit% | Avg Dist | Avg Spread | Climb | Headshots (A/B) | Cover Broken | HighGround% | Indoor% |');
        lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
        for (const [b, s] of Object.entries(report.biomeMatrix.byBiome)) {
            lines.push(`| ${b} | ${s.matches} | ${(s.playerWinRate * 100).toFixed(0)}% | ${(s.enemyWinRate * 100).toFixed(0)}% | ${s.avgRounds} | ${(s.player.hitRate * 100).toFixed(1)}% | ${(s.enemy.hitRate * 100).toFixed(1)}% | ${s.player.avgShotDist}m | ${s.player.avgSpread}t | ${s.player.avgRecoilClimb}t | ${s.player.headshots}/${s.enemy.headshots} | ${r2(s.player.coverDestroyedPerMatch + s.enemy.coverDestroyedPerMatch)} | ${(s.player.highGroundRate * 100).toFixed(0)}% | ${(s.enemy.indoorRate * 100).toFixed(0)}% |`);
        }
        lines.push('');
    }

    if (report.coevolution) {
        lines.push('## 2. Mutual Co-Evolution (Alpha AI vs Bravo AI)');
        lines.push('');
        lines.push('| Epoch | Matches | Alpha Win% | Bravo Win% | Draws | Avg Rnds | Alpha Hit% | Bravo Hit% | Bravo Observed Alpha | Alpha Observed Bravo |');
        lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
        for (const ep of report.coevolution.epochs) {
            const s = ep.summary;
            lines.push(`| ${ep.epoch} | ${s.matches} | ${(s.playerWinRate * 100).toFixed(1)}% | ${(s.enemyWinRate * 100).toFixed(1)}% | ${s.draws} | ${s.avgRounds} | ${(s.player.hitRate * 100).toFixed(1)}% | ${(s.enemy.hitRate * 100).toFixed(1)}% | ${(ep.bravoHeadline || []).join(', ') || 'neutral'} | ${(ep.alphaHeadline || []).join(', ') || 'neutral'} |`);
        }
        lines.push('');
    }

    if (report.archetypes) {
        lines.push('## 3. Adaptation vs Distinct Player Archetypes');
        lines.push('');
        lines.push('| Archetype | Bravo Win% (Base -> Adapted) | Delta | Avg Enemy Dmg (Base -> Adapted) | Detected Playstyle | Top Counter Weights (>=1.15) |');
        lines.push('|---|---:|---:|---:|---|---|');
        for (const a of Object.values(report.archetypes)) {
            const top = Object.entries(a.meanCounterTuning)
                .filter(([, v]) => v >= 1.15)
                .sort((x, y) => y[1] - x[1])
                .slice(0, 4)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ') || 'balanced';
            lines.push(`| ${a.name} | ${(a.baseline.enemyWinRate * 100).toFixed(1)}% -> ${(a.adapted.enemyWinRate * 100).toFixed(1)}% | ${a.enemyWinRateDelta >= 0 ? '+' : ''}${(a.enemyWinRateDelta * 100).toFixed(1)}% | ${a.baseline.avgEnemyDamage} -> ${a.adapted.avgEnemyDamage} | ${(a.detectedHeadline || []).join(', ') || 'neutral'} | ${top} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

async function main() {
    const argv = parseArgs(process.argv.slice(2));
    const mode = String(argv.mode || 'all');
    const biomes = argv.biomes ? String(argv.biomes).split(',').map(s => s.trim()).filter(b => PLOT_IDS.includes(b)) : [...PLOT_IDS];
    const epochs = Math.max(1, Number(argv.epochs) || 3);
    const seeds = Math.max(1, Number(argv.seeds) || 2);
    const rounds = Math.max(6, Number(argv.rounds) || 18);
    const samples = Math.max(6, Number(argv.samples) || 12);
    const workers = Math.max(1, Number(argv.workers) || Math.min(8, Math.max(2, os.cpus().length - 1)));
    const outPath = path.resolve(ROOT, String(argv.out || 'tools/sim/data/arena-report.json'));
    const outDir = path.dirname(outPath);

    await fs.mkdir(outDir, { recursive: true });
    const tStart = Date.now();
    const pool = new WorkerPool(workers);
    const matchLog = [];

    let biomeMatrix = null;
    let coevolution = null;
    let archetypes = null;

    try {
        if (mode === 'all' || mode === 'biome-matrix') {
            biomeMatrix = await runBiomeMatrix(pool, { biomes, seeds, rounds, samples, matchLog });
        }
        if (mode === 'all' || mode === 'coevolution') {
            coevolution = await runCoEvolution(pool, { biomes, seeds, epochs, rounds, samples, matchLog });
        }
        if (mode === 'all' || mode === 'archetypes') {
            archetypes = await runArchetypeBenchmark(pool, { biomes, seeds, epochs, rounds, samples, matchLog });
        }
    } finally {
        await pool.close();
    }

    const report = {
        meta: {
            version: ADAPTIVE_VERSION,
            generatedAt: new Date().toISOString(),
            mode,
            biomes,
            seeds,
            epochs,
            rounds,
            samples,
            workers,
            totalMatches: matchLog.length,
            elapsedMs: Date.now() - tStart
        },
        biomeMatrix,
        coevolution,
        archetypes
    };

    const priors = buildLearnedPriors(report);
    const md = buildMarkdownReport(report);

    const jsonlPath = path.join(outDir, 'arena-matches.jsonl');
    const mdPath = path.join(outDir, 'arena-report.md');
    const priorsPath = path.join(outDir, 'learned-priors.json');

    await Promise.all([
        fs.writeFile(outPath, JSON.stringify(report, null, 2)),
        fs.writeFile(jsonlPath, matchLog.map(m => JSON.stringify(m)).join('\n') + '\n'),
        fs.writeFile(mdPath, md),
        fs.writeFile(priorsPath, JSON.stringify(priors, null, 2))
    ]);

    if (argv['write-priors']) {
        const modPath = path.resolve(ROOT, 'shared/ai/LearnedPriors.js');
        const entries = PLOT_IDS.map(b => {
            const raw = priors.effectiveBiomePriors[b] || {};
            const gentle = {};
            for (const [k, v] of Object.entries(raw)) {
                const blended = r2(Math.max(0.82, Math.min(1.35, 1 + (v - 1) * 0.5)));
                if (Math.abs(blended - 1) >= 0.02) gentle[k] = blended;
            }
            return `    ${b}: Object.freeze(${JSON.stringify(gentle)})`;
        }).join(',\n');
        const modSrc = `// Distilled per-biome AI posture priors derived from headless AI-vs-AI simulations
// (\`npm run ai:arena -- --write-priors\`). Blended gently with \`BIOME_PRIORS\` and live player adaptation.
export const ARENA_PRIORS_META = Object.freeze({
    version: ${ADAPTIVE_VERSION},
    source: 'tools/sim/ai_arena.mjs',
    generatedAt: ${JSON.stringify(priors.generatedAt)},
    matches: ${matchLog.length}
});

export const ARENA_BIOME_PRIORS = Object.freeze({
${entries}
});

/** Merge a stored per-biome win/loss memory map with an optional override layer. */
export function mergeBiomeMemory(base = null, override = null) {
    if (!base && !override) return null;
    const out = {};
    for (const src of [base, override]) {
        if (!src || typeof src !== 'object') continue;
        for (const [biome, rec] of Object.entries(src)) {
            if (!rec || typeof rec !== 'object') continue;
            out[biome] = {
                matches: Number(rec.matches) || 0,
                wins: Number(rec.wins) || 0,
                winRate: Number(rec.winRate) || 0,
                deltas: { ...(out[biome]?.deltas || {}), ...(rec.deltas || {}) }
            };
        }
    }
    return Object.keys(out).length ? out : null;
}
`;
        await fs.writeFile(modPath, modSrc);
        console.log(`Updated baked priors: ${path.relative(ROOT, modPath)}`);
    }

    console.log(md);
    console.log(`Saved: ${path.relative(ROOT, outPath)}, ${path.relative(ROOT, jsonlPath)}, ${path.relative(ROOT, mdPath)}, ${path.relative(ROOT, priorsPath)}`);
}
