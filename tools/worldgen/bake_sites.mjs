#!/usr/bin/env node
// Bake mission sites from vibe-game's world generator into client/public/missions/sites/*.json.
// The client and the server load these instead of running the 3–8 s generator per mission.
//   node tools/worldgen/bake_sites.mjs [locationId ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSite, listLocations } from '../../shared/mission/WorldSites.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'client/public/missions/sites');
fs.mkdirSync(out, { recursive: true });
const wanted = process.argv.slice(2);
const index = [];
for (const loc of listLocations()) {
    if (wanted.length && !wanted.includes(loc.id)) continue;
    const t = Date.now();
    const site = generateSite(loc.id);
    fs.writeFileSync(path.join(out, `${loc.id}.json`), JSON.stringify(site));
    index.push({ id: loc.id, name: loc.name, type: loc.type, themeId: loc.themeId, buildings: site.buildings.length, cols: site.cols, rows: site.rows });
    console.log(`${loc.id.padEnd(10)} ${loc.name.padEnd(12)} ${site.buildings.length} buildings, ${site.decorations.length} decorations, ${Date.now() - t} ms`);
}
if (!wanted.length) fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
