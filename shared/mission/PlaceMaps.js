// The real-place maps as map definitions (Maps.js lists them). Each loads its baked package when one is registered
// and still matches the importer and the place's layers, and otherwise builds live (Geo-voxel layers → PlaceImport).
import { PLACE_MAPS } from './generated/PlaceCatalog.js';
import { buildPlaceMission, PLACE_GENERATOR_VERSION } from './PlaceImport.js';
import { bakedMission, fingerprint } from './BakedMaps.js';

const sources = new Map();
/** The source fingerprint of a catalog place: its layers and every catalog parameter that changes the build. */
export function placeSource(g) {
    if (!sources.has(g.id)) sources.set(g.id, fingerprint(JSON.stringify([g.layers, g.theme, g.objectiveName || null, g.build || {}])));
    return sources.get(g.id);
}
/** Live build of a catalog place (what a bake freezes). */
export function buildCatalogPlace(g, seed = 1, extra = {}) {
    return buildPlaceMission({ layers: g.layers, id: g.id, name: g.name, theme: g.theme, objectiveName: g.objectiveName, ...(g.build || {}), seed, audit: false, ...extra });
}
export const PLACE_IDS = new Set(PLACE_MAPS.map(g => g.id));
export function placeMapDefs() {
    return PLACE_MAPS.map(g => ({ id: g.id, name: g.name, theme: g.theme, text: g.text, concept: g.reference, place: true,
        build: (options = {}) => { const seed = options.seed ?? 1; return bakedMission(g.id, seed, { generator: PLACE_GENERATOR_VERSION, source: placeSource(g) }) ?? buildCatalogPlace(g, seed); } }));
}
