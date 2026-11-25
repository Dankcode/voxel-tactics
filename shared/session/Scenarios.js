import {districtParameters,DISTRICT_MAP_IDS} from '../mission/LargeDistricts.js';
import { spreadInsertion } from './Insertion.js';
import { normalizeInventory } from '../inventory/Inventory.js';
// Scenario descriptors → missions. Local sessions generate from a descriptor; co-op sessions hydrate
// the server's compiled mission, then replay the ordered intent list.
//
// desc: { scenario: map id, seed, squad?: string[] | squadKey, debug?, operation?, inventories?, test? }
// `test` is the admin test ground (custom hostile roster and mission overrides, see TestGround.js).
import { MAPS, mapById, FIXTURE_IDS, plotForMap } from '../mission/Maps.js';
import { PLOT_FAMILIES } from '../mapgen/PlotCatalogue.js';
import { SQUADS, CALLSIGNS, CLASSES } from '../content/units.js';
import { Battle } from '../battle/Battle.js';
import { generateOperation, operationOptions } from '../mapgen/Generator.js';
import { compileV3Map } from '../mapgen/ExteriorCompiler.js';
import { profileForDesc } from './Playstyle.js';
import { sanitizeTest, applyTestGround } from './TestGround.js';

export const SCENARIOS = MAPS.map(({ id, name, theme, text }) => ({ id, name, theme, text }));
/** PLAN-10: what players choose — a theme (plot family); the map itself is generated fresh from it and a seed. */
export const THEMES = Object.freeze(Object.entries(PLOT_FAMILIES).map(([id, f]) => ({ id, name: f.theme || f.name, text: f.text })));
/** The two test rigs still offered in the admin Test ground (not in Play). */
export const FIXTURES = Object.freeze(SCENARIOS.filter(s => FIXTURE_IDS.includes(s.id)));
export { plotForMap };
/** The generated-map game mode (PLAN-04): every operation is generated from a plot family and a seed. */
export const OPERATION_ID = 'operation';

/** A known map id (or the operation mode), else the default map. Server rooms sanitise client descriptors with this. */
/** PLAN-10: an unknown or missing id falls back to the generated game (a theme), never to a fixed map. */
export function scenarioId(id) { return id === OPERATION_ID || mapById(id) ? id : OPERATION_ID; }

/** Sanitise a whole descriptor (server rooms and deep links). */
export function sanitizeDesc(d = {}) {
    const scenario = scenarioId(d.scenario);
    const seed = Number.isInteger(Number(d.seed)) && Number(d.seed) >= 0 && Number(d.seed) <= 0xffffffff ? Number(d.seed) : 1;
    const out = { scenario, seed: seed || 1, squad: d.squad || 'standard', debug: d.debug === true, intel: d.intel === true, asyncCoop: d.asyncCoop === true, support: d.support === 'orbital_laser' ? 'orbital_laser' : 'carpet_bomb' };
    if (DISTRICT_MAP_IDS.includes(scenario)&&d.district) out.district=districtParameters(scenario==='terrace-district'?{...d.district,shape:'rectangle'}:d.district);
    if (scenario === OPERATION_ID) out.operation = operationOptions(d.operation);
    if (typeof d.campaignOpId === 'string' && /^[a-z0-9-]+$/.test(d.campaignOpId) && d.campaignOpId.length <= 40) out.campaignOpId = d.campaignOpId;
    if (d.inventories!==undefined) {
        const size=Array.isArray(out.squad)?out.squad.length:(SQUADS[out.squad]||SQUADS.standard).length;
        if(!Array.isArray(d.inventories)||d.inventories.length>size)throw Error('Invalid inventory: expected one pack per soldier');
        out.inventories=d.inventories.map((p,i)=>{try{return normalizeInventory(p);}catch(e){throw Error(`Invalid inventory for soldier ${i+1}: ${e.message}`);}});
    }
    const test = sanitizeTest(d.test);
    if (test) out.test = test;
    // PLAN-09: the player's cached playstyle; the AI tunes itself from it (same numbers on every peer).
    const aiProfile = profileForDesc(d.aiProfile);
    if (aiProfile) out.aiProfile = aiProfile;
    squadFor(out); // Validate unit types before any expensive generation.
    return out;
}

// Generated operations & compiled missions are LRU-cached (cloning mutable stores/structures per battle) so preview -> play -> restart stays instantaneous.
const operationCache = new Map();
const missionCache = new Map();
const operationKey = desc => JSON.stringify({ ...operationOptions(desc.operation), seed: desc.seed ?? 1 });
const missionKey = desc => {
    const id = scenarioId(desc.scenario);
    return JSON.stringify({ id, seed: desc.seed ?? 1, ...(id === OPERATION_ID ? operationOptions(desc.operation) : desc.district || {}) });
};
const setLru = (map, k, v, max = 4) => {
    if (map.has(k)) map.delete(k);
    map.set(k, v);
    while (map.size > max) map.delete(map.keys().next().value);
};
export function cloneMission(m) {
    return {
        ...m,
        store: m.store.clone(),
        rooms: structuredClone(m.rooms || []),
        buildings: structuredClone(m.buildings || []),
        spawns: structuredClone(m.spawns || { player: [], enemy: [] }),
        objective: structuredClone(m.objective || null),
        meta: structuredClone(m.meta || {}),
        visual: structuredClone(m.visual || {}),
        metrics: structuredClone(m.metrics || null)
    };
}
/** Generate (or fetch) an operation's data: { site, layout, design }. Deterministic per descriptor. */
export function operationFor(desc) {
    const key = operationKey(desc);
    if (!operationCache.has(key)) {
        const { site, layout, design, mission } = generateOperation({ ...operationOptions(desc.operation), seed: desc.seed ?? 1 });
        setLru(operationCache, key, { site, layout, design });
        if (mission) setLru(missionCache, missionKey({ ...desc, scenario: OPERATION_ID }), mission);
    }
    return operationCache.get(key);
}

export function buildMission(desc) {
    const key = missionKey(desc);
    if (!missionCache.has(key)) {
        const built = scenarioId(desc.scenario) === OPERATION_ID
            ? compileV3Map(structuredClone(operationFor(desc)), { seed: desc.seed ?? 1 })
            : mapById(scenarioId(desc.scenario)).build({ ...desc.district, seed: desc.seed ?? 1 });
        setLru(missionCache, key, built);
    }
    return cloneMission(missionCache.get(key));
}

export function squadFor(desc) {
    const list = Array.isArray(desc.squad) ? desc.squad : (SQUADS[desc.squad] || SQUADS.standard);
    if(!list.length||list.length>6||list.some(type=>!Object.hasOwn(CLASSES,type)))throw Error('Invalid squad');
    return list.map((type, i) => ({ type, owner: 'player', name: CALLSIGNS[i % CALLSIGNS.length], ...(desc.inventories?.[i] ? {inventory:normalizeInventory(desc.inventories[i])} : {}) }));
}

export function createBattle(desc, mission = null) {
    const squad=squadFor(desc);
    mission ||= buildMission(desc);
    mission.spawns.player=spreadInsertion(mission.store,mission.spawns.player);
    // The test ground applies to the compiled mission on every peer (and the server) alike.
    const enemies = desc.test ? applyTestGround(mission, sanitizeTest(desc.test), desc.seed ?? 1) : null;
    return new Battle({ mission, squad, seed: desc.seed ?? 1, debug: !!desc.debug, enemies, intel: !!desc.intel, asyncCoop: !!desc.asyncCoop, support: desc.support, testArsenal:!!desc.test, aiProfile: desc.aiProfile || null, biomeMemory: desc.aiProfile?.biomeMemory || null });
}
