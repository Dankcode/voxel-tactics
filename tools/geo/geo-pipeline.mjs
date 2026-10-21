#!/usr/bin/env node
// The real-place map pipeline, every stage in a fixed order, every parameter from tools/geo/places.json.
//
//   node tools/geo/geo-pipeline.mjs place <id> --lat <lat> --lon <lon> [--name ..]  any building → a places.json entry
//   node tools/geo/geo-pipeline.mjs blender <id>                 print the Blender MCP call that fetches the place
//   node tools/geo/geo-pipeline.mjs install <id> --export <file> [--reference <png>]
//   node tools/geo/geo-pipeline.mjs catalog                      regenerate shared/mission/generated/GeoCatalog.js
//   node tools/geo/geo-pipeline.mjs build <id>                   build + audit report + slate (output/geo/<id>/)
//   node tools/geo/geo-pipeline.mjs audit <id>                   district gates + design gates on seeds 1–4 (exit 1 on a fail)
//   node tools/geo/geo-pipeline.mjs bake <id>                    baked map packages + building prefabs
//   node tools/geo/geo-pipeline.mjs all <id> [--export <file>]   install → catalog → build → audit → bake
//
// Stages:   1 fetch (Blender + BlenderGIS: OSM + USGS 3DEP, padded)   2 install   3 catalog
//           4 build: frame → straighten (full grid) → crop → terrain → streets → lots → buildings → fill → props → cover
//           5 audit   6 bake (client/public/geo/<id>/baked-s<seed>.json, client/public/assets/buildings/<id>/*.json)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PLACES = join(ROOT, 'tools/geo/places.json');
const [stage, id] = process.argv.slice(2).filter(a => !a.startsWith('--')), args = process.argv.slice(2);
const opt = k => args.includes(k) ? args[args.indexOf(k) + 1] : null;
const places = JSON.parse(readFileSync(PLACES, 'utf8')).places;
const place = id ? places.find(p => p.id === id) : null;
if (id && !place && !['catalog', 'place'].includes(stage)) { console.error(`geo-pipeline: no place "${id}" in tools/geo/places.json`); process.exit(2); }
const run = (...a) => execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...a], { stdio: 'inherit' });

const stages = {
    // any building's coordinates → a places.json entry centred on it (the map window is ±size/2 metres, 30 m padding)
    place() {
        const lat = Number(opt('--lat')), lon = Number(opt('--lon')), size = Number(opt('--size') || 160), name = opt('--name') || id;
        if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) throw Error('place: node tools/geo/geo-pipeline.mjs place <id> --lat <lat> --lon <lon> [--name "<landmark>"] [--size 160] [--theme Landmark]');
        if (size / 0.9 > 192) throw Error(`place: ${size} m is wider than the 192-cell map limit (≈ 172 m)`);
        const all = JSON.parse(readFileSync(PLACES, 'utf8')), h = size / 2;
        const entry = { id, name, theme: opt('--theme') || 'Landmark', objectiveName: opt('--objective') || name, text: opt('--text') || `${name}, rebuilt 1:1 from OpenStreetMap, Wikidata and USGS 3DEP.`,
            import: { lat, lon, window: [-h, h, -h, h], pad: 30, dem: opt('--dem') || 'USGS10m', demStep: 3 }, tagOverrides: {}, build: { straighten: 'grid' }, bakeSeeds: [1] };
        all.places = all.places.filter(p => p.id !== id).concat(entry);
        writeFileSync(PLACES, JSON.stringify(all, null, 2) + '\n');
        console.log(`place: ${id} added (${lat}, ${lon}, ${size} m) — next: node tools/geo/geo-pipeline.mjs blender ${id}`);
    },
    blender() {
        const i = place.import, out = `${ROOT}/output/geo/${place.id}`;
        console.log(`# Blender MCP (run_blender_python) — blender_status first; the call returns at once, poll ${out}/geo-status.json
REPO = ${JSON.stringify(ROOT)}
ns = {}; exec(open(REPO + '/tools/geo/blender_geo_import.py').read(), ns)
ns['start'](lat=${i.lat}, lon=${i.lon}, extent=(${i.window.join(', ')}), pad=${i.pad ?? 30}, out=${JSON.stringify(out)},
            scene=${JSON.stringify('GEO_' + place.id.replace(/[^a-z0-9]+/gi, '_'))}, save_blend=${JSON.stringify(place.id + '.blend')}, dem_step=${i.demStep ?? 3}, dem=${JSON.stringify(i.dem || 'USGS10m')})
# on an Overpass error after the DEM stage: exec the script again, then ns['resume'](${JSON.stringify(out)}, 'osm')
# then: node tools/geo/geo-pipeline.mjs all ${place.id} --export ${out}/blender-export.json --reference ${out}/reference-topdown.png`);
    },
    install() {
        const exp = opt('--export'); if (!exp) throw Error('install: --export <blender-export.json> is required');
        const geo = JSON.parse(readFileSync(resolve(exp), 'utf8'));
        if (geo.dem && /USGS|3DEP/i.test(geo.dem.source || '') && geo.dem.kind !== 'dtm') { geo.dem.kind = 'dtm'; console.log('install: 3DEP export marked dtm'); }
        const dir = join(ROOT, 'client/public/geo', place.id); mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'geo.json'), JSON.stringify(geo, null, 1));
        const ref = opt('--reference'); if (ref && existsSync(ref)) copyFileSync(ref, join(dir, 'reference.png'));
        console.log(`install: ${dir}/geo.json (${geo.buildings?.length} buildings, ${geo.highways?.length} ways, window ${JSON.stringify(geo.window || geo.extent)})`);
    },
    catalog() {
        const have = places.filter(p => existsSync(join(ROOT, 'client/public/geo', p.id, 'geo.json')));
        const v = p => p.id.replace(/[^a-z0-9]+(.)/gi, (_, c) => c.toUpperCase()).replace(/^[^a-z]+/i, '');
        const src = `// GENERATED by tools/geo/geo-pipeline.mjs catalog from tools/geo/places.json — edit places.json, not this file.
// Geo imports (faithful 1:1 real places): BlenderGIS exports under client/public/geo/<id>/geo.json, built at load by
// GeoDistrict (or loaded from a baked package). tools/geo/README.md has the steps.
${have.map(p => `import ${v(p)} from '../../../client/public/geo/${p.id}/geo.json' with { type: 'json' };`).join('\n')}

export const GEO_MAPS = Object.freeze([
${have.map(p => `    { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, theme: ${JSON.stringify(p.theme)}, objectiveName: ${JSON.stringify(p.objectiveName)},
      text: ${JSON.stringify(p.text)},
      reference: ${JSON.stringify(`/geo/${p.id}/reference.png`)}, geo: ${v(p)},
      tagOverrides: ${JSON.stringify(p.tagOverrides || {})}, build: ${JSON.stringify(p.build || {})}, bakeSeeds: ${JSON.stringify(p.bakeSeeds || [1])} }`).join(',\n')}
]);
`;
        writeFileSync(join(ROOT, 'shared/mission/generated/GeoCatalog.js'), src);
        console.log(`catalog: ${have.length} places → shared/mission/generated/GeoCatalog.js`);
    },
    async build() {
        const { GEO_MAPS } = await import(join(ROOT, 'shared/mission/generated/GeoCatalog.js'));
        const { buildPlace } = await import(join(ROOT, 'shared/mission/GeoMaps.js'));
        const g = GEO_MAPS.find(x => x.id === place.id); if (!g) throw Error('build: run install + catalog first');
        const t0 = performance.now(), m = buildPlace(g, 1, { audit: true }), ms = Math.round(performance.now() - t0), rep = m.meta.geoReport;
        const out = join(ROOT, 'output/geo', place.id); mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'report.json'), JSON.stringify({ ms, gates: m.meta.geoGates?.gates, report: { ...rep, junctions: undefined, roadLines: undefined } }, null, 1));
        const { slatePPM } = await import(join(ROOT, 'tools/geo/slate.mjs')), s = m.store, W = s.width, D = s.depth;
        writeFileSync(join(out, 'slate.ppm'), slatePPM(s));
        console.log(`build: ${place.id} ${W}×${D}×${s.height} in ${ms} ms · ${rep.buildings.length} buildings · straighten ${JSON.stringify(rep.straighten)} · gates ${JSON.stringify(m.meta.geoGates?.gates)} → ${out}`);
    },
    async audit() {
        const { MAPS } = await import(join(ROOT, 'shared/mission/Maps.js'));
        const def = MAPS.find(d => d.id === place.id); let bad = 0;
        for (const seed of [1, 2, 3, 4]) {
            const m = def.build({ seed }).metrics, failing = Object.entries(m.gates).filter(([, ok]) => !ok).map(([k]) => k);
            console.log(`audit: ${place.id}#${seed} ${failing.length ? 'FAIL ' + failing.join(', ') : 'ok'} (cover gap ${m.coverGap}, outdoor cover ${m.outdoorCover.toFixed(3)}, sight ${m.sightlineMedian.toFixed(1)})`);
            if (failing.length || m.coverGap > 6 || m.spawnSafe !== 1) bad++;
        }
        if (bad) process.exit(1);
    },
    async bake() {
        const { GEO_MAPS } = await import(join(ROOT, 'shared/mission/generated/GeoCatalog.js'));
        const { buildPlace, placeSource } = await import(join(ROOT, 'shared/mission/GeoMaps.js'));
        const { GEO_GENERATOR_VERSION } = await import(join(ROOT, 'shared/mission/GeoDistrict.js'));
        const { bakeMission } = await import(join(ROOT, 'shared/mission/BakedMaps.js'));
        const { bakePlacePrefabs } = await import(join(ROOT, 'shared/mapgen/geo/BuildingPrefab.js'));
        const g = GEO_MAPS.find(x => x.id === place.id), dir = join(ROOT, 'client/public/geo', place.id);
        let first = null;
        for (const seed of g.bakeSeeds || [1]) {
            const m = buildPlace(g, seed); first ||= m;
            const bake = bakeMission(m, { id: g.id, seed, generator: GEO_GENERATOR_VERSION, source: placeSource(g) });
            writeFileSync(join(dir, `baked-s${seed}.json`), JSON.stringify(bake));
            console.log(`bake: ${dir}/baked-s${seed}.json`);
        }
        const pdir = join(ROOT, 'client/public/assets/buildings', place.id); mkdirSync(pdir, { recursive: true });
        const prefabs = bakePlacePrefabs(first, { place: place.id });
        for (const pf of prefabs) writeFileSync(join(pdir, `${pf.id.split('--')[1]}.json`), JSON.stringify(pf));
        // the library index (every place's prefabs)
        const idxFile = join(ROOT, 'client/public/assets/buildings/index.json');
        const idx = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, 'utf8')) : { format: 'voxel-tactics/building-prefab-index@1', prefabs: [] };
        idx.prefabs = idx.prefabs.filter(p => p.place !== place.id).concat(prefabs.map(pf => ({ id: pf.id, place: place.id, name: pf.name, program: pf.program, storeys: pf.storeys, size: pf.size, front: pf.front, rooms: pf.rooms.length, file: `/assets/buildings/${place.id}/${pf.id.split('--')[1]}.json`, generator: GEO_GENERATOR_VERSION })));
        writeFileSync(idxFile, JSON.stringify(idx, null, 1));
        console.log(`bake: ${prefabs.length} building prefabs → ${pdir}`);
    },
    all() {
        if (opt('--export')) run('install', place.id, '--export', opt('--export'), ...(opt('--reference') ? ['--reference', opt('--reference')] : []));
        run('catalog'); run('build', place.id); run('audit', place.id); run('bake', place.id);
    }
};
if (!stages[stage]) { console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); process.exit(2); }
await stages[stage]();
