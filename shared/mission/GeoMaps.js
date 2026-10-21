// The geo-import maps as map definitions (Maps.js lists them). Each loads its baked package when one is registered
// and still matches the generator and the place's source data, and otherwise builds live (BlenderGIS → GeoDistrict).
import { GEO_MAPS } from './generated/GeoCatalog.js';
import { buildGeoDistrict, GEO_GENERATOR_VERSION } from './GeoDistrict.js';
import { bakedMission, fingerprint } from './BakedMaps.js';

const sources = new Map();
/** The source fingerprint of a catalog place: its export and every catalog parameter that changes the build. */
export function placeSource(g) {
    if (!sources.has(g.id)) sources.set(g.id, fingerprint(JSON.stringify([g.geo, g.tagOverrides || {}, g.objectiveName || null, g.build || {}])));
    return sources.get(g.id);
}
/** Live build of a catalog place (what a bake freezes). */
export function buildPlace(g, seed = 1, extra = {}) {
    return buildGeoDistrict({ geo: g.geo, id: g.id, name: g.name, objectiveName: g.objectiveName, tagOverrides: g.tagOverrides || {}, ...(g.build || {}), seed, audit: false, ...extra });
}
export const GEO_IDS = new Set(GEO_MAPS.map(g => g.id));
export function geoMapDefs() {
    return GEO_MAPS.map(g => ({ id: g.id, name: g.name, theme: g.theme, text: g.text, concept: g.reference, geo: true,
        build: (options = {}) => { const seed = options.seed ?? 1; return bakedMission(g.id, seed, { generator: GEO_GENERATOR_VERSION, source: placeSource(g) }) ?? buildPlace(g, seed); } }));
}
