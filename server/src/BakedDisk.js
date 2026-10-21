// Node side of baked map packages: register client/public/geo/<id>/baked-s<seed>.json from disk (server workers,
// tools). The browser fetches the same file (BakedMaps.preloadBaked).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerBaked, hasBaked } from '../../shared/mission/BakedMaps.js';
import { GEO_IDS } from '../../shared/mission/GeoMaps.js';

const ROOT = fileURLToPath(new URL('../../client/public/geo/', import.meta.url));
export function registerBakedFromDisk(id, seed) {
    if (!GEO_IDS.has(id) || hasBaked(id, seed)) return hasBaked(id, seed);
    const file = `${ROOT}${id}/baked-s${seed}.json`;
    if (!existsSync(file)) return false;
    try { registerBaked(JSON.parse(readFileSync(file, 'utf8'))); return true; } catch { return false; }
}
