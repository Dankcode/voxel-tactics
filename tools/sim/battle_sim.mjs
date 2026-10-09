#!/usr/bin/env node
// Headless balance simulator (PLAN-01 rev 2 §15): AI vs AI on real missions, aggregated weapon,
// throwable, destruction, breach and formation statistics, plus the formation A/B comparison.
//
//   node tools/sim/battle_sim.mjs --seeds 24 [--scenario cedar-close|proving-grounds|all]
//        [--squad standard] [--rounds 40] [--formations-compare] [--gate] [--json out.json]
import fs from 'node:fs';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattle, SCENARIOS } from '../../shared/session/Scenarios.js';
import { runAiSide } from '../../shared/battle/Ai.js';
import { WEAPONS, THROWABLES } from '../../shared/content/weapons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
}, []));
const SEEDS = Number(args.seeds) || 16, ROUNDS = Number(args.rounds) || 40;
const scenarios = args.scenario === 'all' ? SCENARIOS.map(m => ({ scenario: m.id }))
    : [{ scenario: SCENARIOS.some(m => m.id === args.scenario) ? args.scenario : 'proving-grounds' }];

function runOne(desc, { formations }) {
    const b = createBattle(desc);
    const t = Date.now();
    while (!b.outcome && b.round <= ROUNDS) {
        runAiSide(b, 'player', { formations });
        if (!b.outcome) runAiSide(b, 'enemy');
    }
    return {
        winner: b.outcome?.winner || 'draw', reason: b.outcome?.reason || 'round cap', objective: b.objective.kind, rounds: b.round, ms: Date.now() - t,
        survivors: b.unitsOf('player').length, enemiesLeft: b.unitsOf('enemy').length, stats: b.stats,
        playerDamage: b.units.filter(u => u.side === 'player').reduce((s, u) => s + u.stats.damage, 0)
    };
}

function aggregate(runs) {
    const w = {}, th = {}, f = {};
    let voxels = 0, fires = 0, breaches = 0, reactions = 0;
    for (const r of runs) {
        for (const [id, s] of Object.entries(r.stats.weapons)) { const a = w[id] ||= { shots: 0, projectiles: 0, hits: 0, damage: 0, kills: 0, ap: 0, voxels: 0 }; for (const k in a) a[k] += s[k] || 0; }
        for (const [id, s] of Object.entries(r.stats.throwables)) { const a = th[id] ||= { thrown: 0, unitDamage: 0, voxels: 0 }; for (const k in a) a[k] += s[k] || 0; }
        for (const [id, s] of Object.entries(r.stats.formations)) { const a = f[id] ||= { declared: 0, phasesActive: 0, dissolved: 0, breaches: 0 }; for (const k in a) a[k] += s[k] || 0; }
        voxels += r.stats.voxelsDestroyed; fires += r.stats.fires; breaches += r.stats.breaches; reactions += r.stats.reactions;
    }
    const n = runs.length || 1;
    return {
        battles: runs.length, objective: runs[0]?.objective, reasons: runs.reduce((a, r) => (a[`${r.winner}:${r.reason}`] = (a[`${r.winner}:${r.reason}`] || 0) + 1, a), {}), playerWinRate: runs.filter(r => r.winner === 'player').length / n, draws: runs.filter(r => r.winner === 'draw').length / n,
        avgRounds: runs.reduce((s, r) => s + r.rounds, 0) / n, avgSurvivors: runs.reduce((s, r) => s + r.survivors, 0) / n, avgMs: runs.reduce((s, r) => s + r.ms, 0) / n,
        weapons: w, throwables: th, formations: f, perBattle: { voxels: voxels / n, fires: fires / n, breaches: breaches / n, reactions: reactions / n }
    };
}

const pct = v => `${(v * 100).toFixed(0)}%`.padStart(5);
function printReport(title, agg) {
    console.log(`\n== ${title} — ${agg.battles} battles`);
    console.log(`player win ${pct(agg.playerWinRate)} · draws ${pct(agg.draws)} · avg rounds ${agg.avgRounds.toFixed(1)} · survivors ${agg.avgSurvivors.toFixed(2)} · ${agg.avgMs.toFixed(0)} ms/battle`);
    console.log(`objective ${agg.objective} · outcomes ${Object.entries(agg.reasons).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`per battle: voxels ${agg.perBattle.voxels.toFixed(1)} · fires ${agg.perBattle.fires.toFixed(1)} · breaches ${agg.perBattle.breaches.toFixed(2)} · reactions ${agg.perBattle.reactions.toFixed(1)}`);
    console.log('weapon            shots  proj-hit  dmg/shot  dmg/AP  kills/shot  voxels');
    for (const [id, s] of Object.entries(agg.weapons).sort((a, b) => b[1].shots - a[1].shots)) {
        console.log(`${(WEAPONS[id]?.name || id).padEnd(16)} ${String(s.shots).padStart(6)}  ${s.projectiles ? pct(s.hits / s.projectiles) : '    –'}    ${(s.damage / Math.max(1, s.shots)).toFixed(2).padStart(6)}  ${(s.damage / Math.max(1, s.ap)).toFixed(2).padStart(6)}      ${(s.kills / Math.max(1, s.shots)).toFixed(3)}  ${String(s.voxels).padStart(6)}`);
    }
    for (const [id, s] of Object.entries(agg.throwables)) console.log(`${(THROWABLES[id]?.name || id).padEnd(16)} thrown ${s.thrown} · unit dmg/throw ${(s.unitDamage / Math.max(1, s.thrown)).toFixed(2)} · voxels/throw ${(s.voxels / Math.max(1, s.thrown)).toFixed(1)}`);
    for (const [id, s] of Object.entries(agg.formations)) console.log(`formation ${id}: declared ${s.declared} · phases active ${s.phasesActive} · dissolved ${s.dissolved} · breaches ${s.breaches}`);
}

/** Run a list of [desc, formations] jobs across worker threads (deterministic per job). */
async function runAll(jobs) {
    const n = Math.max(1, Math.min(Number(args.workers) || os.cpus().length, jobs.length));
    if (n === 1) return jobs.map(([d, f]) => runOne(d, { formations: f }));
    const results = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { worker: true }, argv: process.argv.slice(2) });
        const feed = () => { if (next >= jobs.length) { w.terminate(); resolve(); return; } const i = next++; w.postMessage({ i, job: jobs[i] }); };
        w.on('message', m => { results[m.i] = m.result; feed(); });
        w.on('error', reject);
        feed();
    })));
    return results;
}

if (!isMainThread && workerData?.worker) {
    parentPort.on('message', ({ i, job }) => parentPort.postMessage({ i, result: runOne(job[0], { formations: job[1] }) }));
} else await main();

async function main() {
const report = { args, scenarios: [] };
let gateFail = false;
for (const sc of scenarios) {
    const descs = Array.from({ length: SEEDS }, (_, i) => ({ ...sc, seed: i + 1, squad: args.squad || 'standard' }));
    const compare = !!args['formations-compare'];
    const all = await runAll([...descs.map(d => [d, true]), ...(compare ? descs.map(d => [d, false]) : [])]);
    const withF = all.slice(0, descs.length);
    const aggF = aggregate(withF);
    printReport(`${sc.scenario} (formations on)`, aggF);
    const entry = { scenario: sc, formationsOn: aggF };
    if (args['formations-compare']) {
        const without = all.slice(descs.length);
        const aggN = aggregate(without);
        printReport(`${sc.scenario} (formations off)`, aggN);
        const delta = aggF.playerWinRate - aggN.playerWinRate;
        console.log(`\nformation win-rate delta: ${(delta * 100).toFixed(1)} pts (gate: +2 … +8 pooled, never > +12 per scenario, never < −3)`);
        entry.formationsOff = aggN; entry.formationDelta = delta;
        if (delta > 0.12 || delta < -0.03) gateFail = true;
    }
    report.scenarios.push(entry);
}
if (args.json) { fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true }); fs.writeFileSync(args.json, JSON.stringify(report, null, 1)); console.log(`\nwrote ${args.json}`); }
if (args.gate && gateFail) { console.error('balance gate failed'); process.exit(1); }
}
