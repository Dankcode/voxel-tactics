#!/usr/bin/env node
// Build a faithful geo district from a BlenderGIS export and write a review slate.
//   node tools/geo/geo-build.mjs --export output/.../blender-export.json --id baton-rouge-third-street \
//        --name "Third Street · Baton Rouge" --objective "Fuqua Hardware Store Building" --out output/.../geo
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildGeoDistrict } from '../../shared/mission/GeoDistrict.js';
import { slatePPM } from './slate.mjs';

const args = process.argv.slice(2), get = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const geo = JSON.parse(await readFile(resolve(get('--export')), 'utf8'));
const out = resolve(get('--out', 'geo-out')); await mkdir(out, { recursive: true });
const t0 = performance.now();
const mission = buildGeoDistrict({ geo, id: get('--id', 'geo-district'), name: get('--name', 'Geo District'), objectiveName: get('--objective', null), seed: Number(get('--seed', 1)), straighten: args.includes('--raw') ? null : 'grid', tagOverrides: get('--tags') ? JSON.parse(await readFile(resolve(get('--tags')), 'utf8')) : {} });
const ms = Math.round(performance.now() - t0);
const s = mission.store, W = s.width, D = s.depth, rep = mission.meta.geoReport;
// slate: top material colour × hill shade (PPM; convert with any image tool)
await writeFile(`${out}/slate.ppm`, slatePPM(s));
// ground-only height map (z of the terrain under everything)
const gz = Buffer.alloc(W * D); const g = mission.meta.geoReport;
await writeFile(`${out}/report.json`, JSON.stringify({ ms, size: [W, D, s.height], gates: mission.meta.geoGates, report: rep, buildings: mission.buildings.map(b => ({ id: b.id, group: b.group, x0: b.x0, y0: b.y0, w: b.w, d: b.d, baseZ: b.baseZ, storeys: b.storeys, rooms: b.rooms.length, stairs: b.stairs.length, exits: b.exits?.length })) }, null, 1));
console.log(`geo: built ${mission.id} ${W}×${D}×${s.height} in ${ms} ms — ${rep.buildings.length} buildings (${mission.buildings.length} wing records), terrain ${JSON.stringify(rep.terrain)}`);
const avg = k => (rep.buildings.reduce((a, b) => a + b[k], 0) / rep.buildings.length).toFixed(3);
console.log(`geo: outline IoU vs OSM polygon min ${Math.min(...rep.buildings.map(b => b.polygonIoU)).toFixed(3)} mean ${avg('polygonIoU')}, roomed share mean ${avg('roomShare')}; reach ${rep.reach.filter(r => r.entered).length}/${rep.reach.length}; gates ${JSON.stringify(mission.meta.geoGates?.gates)}`);
