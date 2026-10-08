#!/usr/bin/env node
// Map design report (PLAN-01 rev 2 §13.7): build every mission and print its metrics and gates.
//   node tools/mission/report.mjs [--seeds 3] [--ascii cedar-close]
import { buildMission, SCENARIOS } from '../../shared/session/Scenarios.js';
import { MATERIALS } from '../../shared/voxel/Materials.js';

const argv = process.argv.slice(2);
const seeds = Number(argv[argv.indexOf('--seeds') + 1]) || 2;
const asciiId = argv.includes('--ascii') ? argv[argv.indexOf('--ascii') + 1] : null;
const rows = [];
const descs = SCENARIOS.map(m => ({ scenario: m.id, id: m.id }));
for (const d of descs) for (let seed = 1; seed <= seeds; seed++) {
    const t = Date.now();
    const m = buildMission({ ...d, seed });
    const x = m.metrics;
    rows.push([`${d.id}#${seed}`, `${m.store.width}x${m.store.depth}`, x.buildings, x.rooms, (x.coverDensity * 100).toFixed(0) + '%', (x.fullCoverShare * 100).toFixed(0) + '%',
        (x.interiorShare * 100).toFixed(0) + '%', x.killingField, x.sightlineMedian.toFixed(0), x.lanes, (x.breachability * 100).toFixed(0) + '%', x.spawnSafe ? 'yes' : 'NO',
        Object.entries(x.gates).filter(([, ok]) => !ok).map(([k]) => k).join(',') || 'PASS', `${Date.now() - t}ms`]);
    if (asciiId === d.id && seed === 1) {
        const s = m.store;
        const g = { lawn: '.', asphalt: '=', road_mark: '-', concrete: ':', paving: ':', gravel: ':', deck: '_', oak_floor: '_', ceramic: '_', stucco: 'P', brick: 'B', concrete_wall: 'C', siding: 'T', sofa: 'f', cabinet: 'f', bed: 'f', desk: 'f', appliance: 'f', planter: 'p', privacy_fence: '|', chainlink: '|', car_body: 'v', car_cabin: 'v', container: 'K', dumpster: 'd', jersey: 'j', bench: 'f', bin: 'o', pump: 'P', pallet: 'c', shelving: 'f', grass: '.', road: '=', cobble: '=', soil: '.', forest_floor: ',', sand: ':', water: '~', deep_water: '≈', city_wall: '#', stone: 'S', plaster: 'P', timber: 'T', plank: '_', stone_floor: '_', roof: '^', glass: 'G', leaves: '*', hedge: 'h', crate: 'c', furniture: 'f', sandbag: 'b', barrel_powder: 'k', lantern: 'L' };
        for (let y = 0; y < s.depth; y++) { let line = ''; for (let xx = 0; xx < s.width; xx++) line += g[MATERIALS[s.get(xx, y, s.topSolid(xx, y))].key] ?? '?'; console.log(line); }
    }
}
const head = ['mission', 'size', 'bldg', 'rooms', 'cover', 'full', 'indoor', 'open', 'sight', 'lanes', 'breach', 'spawn ok', 'failing gates', 'build'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
const fmt = r => r.map((c, i) => String(c).padEnd(widths[i])).join('  ');
console.log(fmt(head)); console.log(widths.map(w => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(fmt(r));
