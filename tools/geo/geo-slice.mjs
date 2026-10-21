#!/usr/bin/env node
// Floor-plan slice of one geo building (all its wings) at a storey: walls, glass, doors, stairs, furniture, rooms.
//   node tools/geo/geo-slice.mjs --export blender-export.json --building helix-steam-mentorship-academy --storey 0 --out plan.ppm
import { readFile, writeFile } from 'node:fs/promises';
import { buildGeoDistrict } from '../../shared/mission/GeoDistrict.js';
import { materialById } from '../../shared/voxel/Materials.js';
const args = process.argv.slice(2), get = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const geo = JSON.parse(await readFile(get('--export'), 'utf8'));
const ms = buildGeoDistrict({ geo, id: 'slice', objectiveName: get('--objective', null) });
const group = get('--building'), storey = Number(get('--storey', 0)), recs = ms.buildings.filter(b => b.group === group || b.id === group);
if (!recs.length) throw Error(`no building ${group}: ${[...new Set(ms.buildings.map(b => b.group))].join(', ')}`);
const pad = 3, x0 = Math.min(...recs.map(b => b.x0)) - pad, y0 = Math.min(...recs.map(b => b.y0)) - pad, x1 = Math.max(...recs.map(b => b.x0 + b.w)) + pad, y1 = Math.max(...recs.map(b => b.y0 + b.d)) + pad;
const z = recs[0].baseZ + 3 * storey + 1, S = 8, W = (x1 - x0) * S, H = (y1 - y0) * S, px = Buffer.alloc(W * H * 3, 255);
const roomOf = new Map(); ms.rooms.filter(r => recs.some(b => b.id === r.buildingId) && r.storey === storey).forEach((r, i) => r.cells.forEach(([x, y]) => roomOf.set(`${x},${y}`, i)));
const hue = i => [[230, 200, 170], [190, 220, 190], [190, 205, 235], [235, 215, 160], [215, 190, 225], [200, 230, 225], [240, 190, 190]][i % 7];
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = materialById(ms.store.get(x, y, z))?.key || 'air', below = materialById(ms.store.get(x, y, z - 1))?.key;
    let c = k === 'air' ? (roomOf.has(`${x},${y}`) ? hue(roomOf.get(`${x},${y}`)) : below && below !== 'air' ? [215, 215, 210] : [255, 255, 255])
        : k === 'glass' ? [80, 160, 220] : k.startsWith('door') ? [40, 170, 60] : k.startsWith('stairs') || k === 'steel_stair' ? [230, 140, 30]
        : ['brick', 'concrete_wall', 'stucco', 'siding', 'concrete'].includes(k) ? [40, 40, 45] : [150, 110, 80];
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const i = (((y - y0) * S + dy) * W + (x - x0) * S + dx) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
}
await writeFile(get('--out', 'plan.ppm'), Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), px]));
console.log(recs.map(b => `${b.id} ${b.x0},${b.y0} ${b.w}×${b.d} front ${b.front} rooms ${b.rooms.filter(r => r.storey === storey).length} doors ${b.doors.filter(d => d.storey === storey).length}`).join('\n'));
