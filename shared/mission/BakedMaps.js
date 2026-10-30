// Baked map packages: a generated map frozen into a file the game loads instead of regenerating it. A bake is the
// finished mission (voxels, rooms, building records, spawns, objective, render hints, road paint) packed with the
// co-op snapshot format (MissionSnapshot.packMission), plus
//   palette     the material key of every id used, so a bake survives the material table growing or reordering
//   generator   the generator version it was made with, and
//   source      a hash of the inputs (the BlenderGIS export + catalog overrides)
// so a stale bake (the generator or the place changed since) is ignored and the map is generated live instead.
//
// Loading is synchronous once a bake is registered: the browser registers it with preloadBaked() before the
// battle is created (LocalSession.create is async), Node reads it from disk (registerBakedFile in tools/server).
import { packMission, unpackMission } from '../session/MissionSnapshot.js';
import { MATERIALS, MAT } from '../voxel/Materials.js';

export const BAKED_FORMAT = 'voxel-tactics/baked-map@1';
const REGISTRY = new Map();
const keyOf = (id, seed) => `${id}#${seed}`;

/** FNV-1a over a string (hex): the source fingerprint of a place. */
export function fingerprint(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Freeze a built mission. */
export function bakeMission(mission, { id = mission.id, seed, generator, source }) {
    const packed = packMission(mission);
    const used = new Set();
    for (let i = 1; i < packed.store.voxels.length; i += 4) used.add(packed.store.voxels[i]);
    for (const h of Object.values(packed.visual?.hints || {})) for (const m of h.materials || []) used.add(m);
    for(const [,spec]of packed.store.curveCells||[]){used.add(spec.material);if(spec.underlay!=null)used.add(spec.underlay);}
    const palette = Object.fromEntries([...used].sort((a, b) => a - b).map(i => [i, MATERIALS[i]?.key ?? 'air']));
    return { format: BAKED_FORMAT, id, seed, generator, source, palette, bakedAt: null, mission: packed };
}

/** Make a bake loadable (validates the format). */
export function registerBaked(bake) {
    if (bake?.format !== BAKED_FORMAT) throw Error(`baked map: unknown format ${bake?.format}`);
    REGISTRY.set(keyOf(bake.id, bake.seed), bake);
    return bake;
}
export function hasBaked(id, seed) { return REGISTRY.has(keyOf(id, seed)); }
export function clearBaked() { REGISTRY.clear(); }

/** The baked mission for (id, seed), or null when none is registered or it is stale (generator/source mismatch). */
export function bakedMission(id, seed, { generator, source } = {}) {
    const bake = REGISTRY.get(keyOf(id, seed));
    if (!bake) return null;
    if (generator && bake.generator !== generator || source && bake.source !== source) return null;
    // material ids → today's ids through the palette
    const remap = new Map(Object.entries(bake.palette).map(([i, k]) => [Number(i), MAT[k] ?? (k === 'air' ? 0 : null)]));
    if ([...remap.values()].some(v => v == null)) return null;   // a material that no longer exists: regenerate
    const snap = structuredClone(bake.mission);
    const v = snap.store.voxels;
    for (let i = 1; i < v.length; i += 4) v[i] = remap.get(v[i]);
    for (const h of Object.values(snap.visual?.hints || {})) if (h.materials) h.materials = h.materials.map(m => remap.get(m) ?? m);
    for(const [,spec] of snap.store.curveCells || []){spec.material=remap.get(spec.material)??spec.material;if(spec.underlay!=null)spec.underlay=remap.get(spec.underlay)??spec.underlay;}
    const mission = unpackMission(snap);
    mission.meta = { ...mission.meta, baked: { generator: bake.generator, source: bake.source } };
    return mission;
}

/** Browser: fetch and register the bake for a map/seed (resolves false when there is none). */
export async function preloadBaked(id, seed, { base = '/places', fetchFn = globalThis.fetch } = {}) {
    if (hasBaked(id, seed) || !fetchFn) return hasBaked(id, seed);
    try {
        const res = await fetchFn(`${base}/${id}/baked-s${seed}.json`);
        if (!res.ok) return false;
        registerBaked(await res.json());
        return true;
    } catch { return false; }
}
