#!/usr/bin/env node
// Real places: import Geo-voxel exports into the game, and keep the catalog, profiles and bakes in step.
// The real-world side (OSM, terrain, footprints, tenants, road paint) is Geo-voxel's job — this repo only imports.
//
//   node tools/places/places.mjs import <layers.json|source.json|blender-export.json> --id <id> --name "<name>"
//                                       --theme <theme> [--objective "<building>"] [--text "<briefing>"]
//                                       [--reference <png>] [--geo-voxel <path to the Geo-voxel checkout>]
//                                                          layers.json is used as is; a source (the app's / `fetch`'s
//                                                          source.json or a Blender export) is built by Geo-voxel first
//                                                          (`geo-voxels build`). Then the layers are copied in, the
//                                                          catalog entry added or refreshed: catalog → profiles →
//                                                          audit → bake
//   node tools/places/places.mjs catalog                   regenerate shared/mission/generated/PlaceCatalog.js
//   node tools/places/places.mjs profiles                  regenerate shared/mapgen/geo/PlaceProfiles.generated.js
//   node tools/places/places.mjs audit [<id>]              build with the district gates and report
//   node tools/places/places.mjs bake [<id>]               baked map packages + building prefabs
//   node tools/places/places.mjs list
//
// Themes: Downtown · Suburbs · Strip centre · Industrial · Roadside · Landmark (PlaceImport THEME_FAMILY decides the
// parcel mixes that fill the open land; Landmark keeps open lawn as grounds).
// Geo-voxel: `geo-voxels build <export> --out <dir>` writes <dir>/layers.json; the app's place export is a map.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIST = join(ROOT, 'tools/places/places.json'), PUBLIC = join(ROOT, 'client/public/places');
const args = process.argv.slice(2), stage = args[0];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
const readList = () => JSON.parse(readFileSync(LIST, 'utf8'));
const writeList = l => writeFileSync(LIST, JSON.stringify(l, null, 2) + '\n');
const mod = p => import(pathToFileURL(join(ROOT, p)).href);
const camel = id => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[0-9]/, c => `p${c}`);

/** Round every float to 3 decimals (paint quads and centrelines arrive with 15): a third of the bytes, same map. */
function compact(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
    if (Array.isArray(v)) return v.map(compact);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x)]));
    return v;
}

const stages = {
    async import() {
        const file = positional[0], id = opt('--id');
        if (!file || !id || !/^[a-z0-9-]+$/.test(id)) throw Error('import: <map.json|layers.json> --id <lower-case-id> required');
        const { readLayers } = await mod('shared/mission/PlaceImport.js');
        let input = JSON.parse(readFileSync(file, 'utf8'));
        if (input?.format === 'geo-voxels/map@1') throw Error('import: this is a built map.json (geo-voxels/map@1: voxels, no layers). Export source.json from the Geo-voxel app (or `geo-voxels fetch`) and import that, or import the layers.json of `geo-voxels build`.');
        if (!input?.layers && !String(input?.format || '').startsWith('geo-voxels/layers') && Array.isArray(input?.buildings) && Array.isArray(input?.highways)) {
            // a real-place source: Geo-voxel builds it (the game never generates real places itself)
            const gv = resolve(opt('--geo-voxel') || join(ROOT, '..', 'Geo-voxel')), cli = join(gv, 'bin/geo-voxels.mjs');
            if (!existsSync(cli)) throw Error(`import: ${file} is a source; Geo-voxel is needed to build it (looked for ${cli}; pass --geo-voxel <path>)`);
            const out = mkdtempSync(join(tmpdir(), 'place-'));
            const { spawnSync } = await import('node:child_process');
            const r = spawnSync(process.execPath, [cli, 'build', resolve(file), '--out', out], { stdio: 'inherit' });
            if (r.status) throw Error('import: geo-voxels build failed');
            input = JSON.parse(readFileSync(join(out, 'layers.json'), 'utf8'));
        }
        const layers = compact(readLayers(input));
        mkdirSync(join(PUBLIC, id), { recursive: true });
        writeFileSync(join(PUBLIC, id, 'layers.json'), JSON.stringify(layers));
        if (opt('--reference')) copyFileSync(opt('--reference'), join(PUBLIC, id, 'reference.png'));
        const list = readList(), old = list.places.find(p => p.id === id) || {};
        const entry = { bakeSeeds: [1], build: {}, ...old, id,
            name: opt('--name') || old.name || id, theme: opt('--theme') || old.theme || 'Downtown',
            objectiveName: opt('--objective') ?? old.objectiveName ?? null,
            text: opt('--text') || old.text || `${opt('--name') || id}, built by Geo-voxel from open data.`,
            source: { tool: 'Geo-voxel', format: layers.format, file: file.split('/').slice(-3).join('/'), size: [layers.frame.width, layers.frame.depth], buildings: layers.buildings.length, imported: new Date().toISOString().slice(0, 10) } };
        list.places = list.places.some(p => p.id === id) ? list.places.map(p => (p.id === id ? entry : p)) : list.places.concat(entry);
        writeList(list);
        console.log(`import: ${id} · ${layers.frame.width}×${layers.frame.depth} · ${layers.buildings.length} buildings, ${layers.roads.length} streets, ${layers.lots.length} lots`);
        await stages.catalog();
        await run('profiles'); await run('audit', id); await run('bake', id);
    },
    async catalog() {
        const list = readList(), have = list.places.filter(p => existsSync(join(PUBLIC, p.id, 'layers.json')));
        const src = `// GENERATED by tools/places/places.mjs catalog from tools/places/places.json — edit places.json, not this file.
// Real places: Geo-voxel layers (client/public/places/<id>/layers.json) built at load by PlaceImport (or loaded from a
// baked package). tools/places/README.md has the steps.
${have.map(p => `import ${camel(p.id)} from '../../../client/public/places/${p.id}/layers.json' with { type: 'json' };`).join('\n')}

export const PLACE_MAPS = Object.freeze([
${have.map(p => `    { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, theme: ${JSON.stringify(p.theme)}, objectiveName: ${JSON.stringify(p.objectiveName ?? null)},
      text: ${JSON.stringify(p.text || '')},
      reference: ${existsSync(join(PUBLIC, p.id, 'reference.png')) ? JSON.stringify(`/places/${p.id}/reference.png`) : 'null'}, layers: ${camel(p.id)},
      build: ${JSON.stringify(p.build || {})}, bakeSeeds: ${JSON.stringify(p.bakeSeeds || [1])} }`).join(',\n')}
]);
`;
        writeFileSync(join(ROOT, 'shared/mission/generated/PlaceCatalog.js'), src);
        console.log(`catalog: ${have.length} places → shared/mission/generated/PlaceCatalog.js`);
    },
    async profiles() {
        const { PLACE_MAPS } = await mod('shared/mission/generated/PlaceCatalog.js');
        const { bakedProfiles } = await mod('shared/mapgen/geo/PlaceProfiles.source.js');
        const out = bakedProfiles(PLACE_MAPS);
        writeFileSync(join(ROOT, 'shared/mapgen/geo/PlaceProfiles.generated.js'), `// GENERATED by tools/places/places.mjs profiles from the place catalog — do not edit by hand.\n// Real-place statistics per generator family (PLAN-15): storey counts by use and footprint depth ratios.\nexport const PLACE_PROFILES = Object.freeze(${JSON.stringify(out, null, 1)});\n`);
        console.log(Object.entries(out).map(([f, p]) => `profiles: ${f}: ${p.places.join(', ')} · ${p.ratios.length} footprints · ${Object.values(p.all).reduce((a, b) => a + b, 0)} heights`).join('\n'));
    },
    async audit() {
        const { PLACE_MAPS } = await mod('shared/mission/generated/PlaceCatalog.js');
        const { buildCatalogPlace } = await mod('shared/mission/PlaceMaps.js');
        const { MAPS } = await mod('shared/mission/Maps.js');
        let bad = 0;
        for (const g of PLACE_MAPS.filter(g => !positional[0] || g.id === positional[0])) for (const seed of g.bakeSeeds || [1]) {
            const t = Date.now(), ms = buildCatalogPlace(g, seed, { audit: true }), r = ms.meta.placeReport;
            const gates = Object.entries(ms.meta.placeGates?.gates || {}).filter(([, ok]) => !ok).map(([k]) => k);
            const unreached = (r.reach || []).filter(b => !b.entered).map(b => b.id);
            const metrics = MAPS.find(d => d.id === g.id)?.build({ seed }).metrics;
            const mf = metrics ? Object.entries(metrics.gates).filter(([, ok]) => !ok).map(([k]) => k) : [];
            console.log(`audit: ${g.id}#${seed} ${Date.now() - t} ms · ${r.buildings.length} real + ${r.parcels.newBuildings.length} parcel buildings · mixes ${r.parcels.mixes.map(x => `${x.mix}×${x.n}`).join(' ') || '—'}`
                + ` · district ${gates.length ? 'FAIL ' + gates.join(', ') : 'ok'} · mission ${mf.length ? 'FAIL ' + mf.join(', ') : 'ok'}${metrics ? ` (cover gap ${metrics.coverGap}, outdoor ${metrics.outdoorCover.toFixed(3)})` : ''}${unreached.length ? ` · unreached ${unreached.join(', ')}` : ''}`);
            if (gates.length || mf.length || unreached.length) bad++;
        }
        if (bad) process.exitCode = 1;
    },
    async bake() {
        const { PLACE_MAPS } = await mod('shared/mission/generated/PlaceCatalog.js');
        const { buildCatalogPlace, placeSource } = await mod('shared/mission/PlaceMaps.js');
        const { PLACE_GENERATOR_VERSION } = await mod('shared/mission/PlaceImport.js');
        const { bakeMission } = await mod('shared/mission/BakedMaps.js');
        const { bakePlacePrefabs } = await mod('shared/mapgen/geo/BuildingPrefab.js');
        const idxFile = join(ROOT, 'client/public/assets/buildings/index.json');
        const idx = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, 'utf8')) : { format: 'voxel-tactics/building-prefab-index@1', prefabs: [] };
        for (const g of PLACE_MAPS.filter(g => !positional[0] || g.id === positional[0])) {
            let first = null;
            for (const seed of g.bakeSeeds || [1]) {
                const m = buildCatalogPlace(g, seed); first ||= m;
                writeFileSync(join(PUBLIC, g.id, `baked-s${seed}.json`), JSON.stringify(bakeMission(m, { id: g.id, seed, generator: PLACE_GENERATOR_VERSION, source: placeSource(g) })));
                console.log(`bake: client/public/places/${g.id}/baked-s${seed}.json`);
            }
            // the real (mapped) buildings as reusable prefabs; parcel-built ones are the game's own, not the place's
            const pdir = join(ROOT, 'client/public/assets/buildings', g.id); mkdirSync(pdir, { recursive: true });
            const prefabs = bakePlacePrefabs({ ...first, buildings: first.buildings.filter(b => !b.parcelBuilt) }, { place: g.id });
            for (const pf of prefabs) writeFileSync(join(pdir, `${pf.id.split('--')[1]}.json`), JSON.stringify(pf));
            const keep = new Set(prefabs.map(pf => `${pf.id.split('--')[1]}.json`));
            for (const f of readdirSync(pdir)) if (f.endsWith('.json') && !keep.has(f)) unlinkSync(join(pdir, f));   // buildings the place no longer has
            idx.prefabs = idx.prefabs.filter(p => p.place !== g.id).concat(prefabs.map(pf => ({ id: pf.id, place: g.id, name: pf.name, program: pf.program, storeys: pf.storeys, size: pf.size, front: pf.front, rooms: pf.rooms.length, file: `/assets/buildings/${g.id}/${pf.id.split('--')[1]}.json`, generator: PLACE_GENERATOR_VERSION })));
            console.log(`bake: ${prefabs.length} building prefabs → client/public/assets/buildings/${g.id}`);
        }
        const ids = new Set(PLACE_MAPS.map(g => g.id));
        idx.prefabs = idx.prefabs.filter(p => ids.has(p.place));
        writeFileSync(idxFile, JSON.stringify(idx, null, 1));
    },
    async list() {
        for (const p of readList().places) console.log(`${p.id.padEnd(34)} ${p.theme.padEnd(13)} ${p.name}${existsSync(join(PUBLIC, p.id, 'layers.json')) ? '' : '  (no layers)'}`);
    }
};
// each stage in its own process: the catalog module a stage imports is the one the previous stage wrote
async function run(...a) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...a], { stdio: 'inherit' });
    if (r.status) process.exitCode = r.status;
}
if (!stages[stage]) { console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n')); process.exit(2); }
await stages[stage]();
