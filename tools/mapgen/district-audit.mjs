#!/usr/bin/env node
// Reproducible acceptance checks for Claude's district-mix pipeline.
// node tools/mapgen/district-audit.mjs --seeds 1,3,17,27 --determinism --out /tmp/district-audit.json
// node tools/mapgen/district-audit.mjs --maps park-district,mall-district --remix '{"objective":"hold"}'
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { MAPS } from '../../shared/mission/Maps.js';
import { DISTRICT_MAP_IDS } from '../../shared/mission/LargeDistricts.js';
import { packMission } from '../../shared/session/MissionSnapshot.js';

const { values: args } = parseArgs({ options: {
    seeds: { type: 'string', default: '1,3,17,27' }, maps: { type: 'string' }, remix: { type: 'string' },
    width: { type: 'string' }, depth: { type: 'string' }, shape: { type: 'string' },
    determinism: { type: 'boolean', default: false }, out: { type: 'string' }
} });
const ids = [...DISTRICT_MAP_IDS, 'sunken-junction', 'sunken-boulevard', 'freight-terraces'];
const selected = args.maps ? args.maps.split(',') : ids;
if (!selected.length || selected.some(id => !ids.includes(id))) throw Error(`Maps must be among: ${ids.join(', ')}`);
const seeds = args.seeds.split(',').map(Number);
if (seeds.some(s => !Number.isInteger(s) || s < 1 || s > 0xffffffff)) throw Error('Seeds must be integers from 1 to 4294967295');
const options = {};
if (args.remix) {
    options.remix = JSON.parse(args.remix);
    if (!options.remix || typeof options.remix !== 'object' || Array.isArray(options.remix)) throw Error('Remix must be a JSON object');
}
for (const name of ['width', 'depth']) if (args[name]) {
    if (!Number.isFinite(Number(args[name]))) throw Error(`${name} must be a number`);
    options[name] = Number(args[name]);
}
if (args.shape) {
    if (!['rectangle', 'L', 'T'].includes(args.shape)) throw Error('Shape must be rectangle, L or T');
    options.shape = args.shape;
}
const snapshotHash = m => createHash('sha256').update(JSON.stringify(packMission(m))).digest('hex');
const rows = [];
for (const id of selected) for (const seed of seeds) {
    const start = performance.now(), build = MAPS.find(m => m.id === id).build;
    try {
        const mission = build({ ...options, seed }), district = mission.meta.districtGates;
        const hash = snapshotHash(mission);
        const deterministic = args.determinism ? hash === snapshotHash(build({ ...options, seed })) : null;
        const gates = { ...mission.metrics.gates, ...Object.fromEntries(Object.entries(district.gates).map(([k,v]) => [`district.${k}`, v])),
            ...(mission.meta.connectorValidation ? { connectors: mission.meta.connectorValidation.pass } : {}),
            ...(args.determinism ? { deterministic } : {}) };
        rows.push({ id, seed, pass: Object.values(gates).every(Boolean), gates, hash, dimensions: [mission.store.width,mission.store.depth,mission.store.height],
            objective: mission.objective.kind, metrics: district.metrics, hold: district.hold, ms: Math.round(performance.now() - start) });
    } catch (error) {
        rows.push({ id, seed, pass: false, error: error.message, district: error.districtGates || null, ms: Math.round(performance.now() - start) });
    }
    const row = rows.at(-1), failures = Object.entries(row.gates || {}).filter(([,pass]) => !pass).map(([name]) => name);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${id} #${seed} (${row.ms} ms)${row.error ? `: ${row.error}` : failures.length ? `: ${failures.join(', ')}` : ''}`);
}
const report = { options, determinism: args.determinism, cases: rows.length, passed: rows.filter(r => r.pass).length, rows };
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.passed}/${report.cases} cases passed${args.out ? `; report: ${args.out}` : ''}`);
if (report.passed !== report.cases) process.exitCode = 1;
