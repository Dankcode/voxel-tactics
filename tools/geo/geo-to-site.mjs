#!/usr/bin/env node
// Geo import (experiment): BlenderGIS export → recorded site.json for the existing mapgen pipeline.
//   node tools/geo/geo-to-site.mjs --export output/geo-baton-rouge/third-street/blender-export.json \
//        --id baton-rouge-third-street --name "Third Street · Baton Rouge" --objective "Fuqua Hardware Store Building" \
//        --out output/geo-baton-rouge/third-street/site.json
//   npm run mapgen -- --image output/geo-baton-rouge/third-street/reference-topdown.png \
//        --site output/geo-baton-rouge/third-street/site.json --offline --install
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { geoExportToSite } from '../../shared/mapgen/GeoSite.js';
import { validateSite } from '../../shared/mapgen/PackageBuilder.js';

const args = process.argv.slice(2), get = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
if (!args.includes('--export')) throw Error('Usage: node tools/geo/geo-to-site.mjs --export blender-export.json --id map-id [--name ...] [--objective "OSM name"] [--theme Downtown] [--time dusk] [--out site.json]');
const geo = JSON.parse(await readFile(resolve(get('--export')), 'utf8'));
const { site, report } = geoExportToSite(geo, {
    id: get('--id', 'geo-site'), name: get('--name', 'Geo Site'), theme: get('--theme', 'Downtown'), timeOfDay: get('--time', 'dusk'),
    objectiveName: get('--objective', null), maxDimension: Number(get('--max', 192)),
});
validateSite(site);
const out = resolve(get('--out', 'site.json'));
await writeFile(out, JSON.stringify(site, null, 1));
await writeFile(out.replace(/\.json$/, '.report.json'), JSON.stringify(report, null, 1));
console.log(`geo: ${site.buildings.length} parcels from ${geo.buildings.length} OSM footprints (${report.merged.length} merged, ${report.dropped.length} dropped, ${report.clipped.length} clipped), ${site.roads.length} road pieces, ${site.parking.length} parking`);
console.log(`geo: frame ${site.frame.width.toFixed(1)}×${site.frame.height.toFixed(1)} cells, objective ${site.objectiveBuilding}, terrain relief ${report.terrain?.reliefM ?? '?'} m (recorded only)`);
console.log(`geo: wrote ${out}`);
