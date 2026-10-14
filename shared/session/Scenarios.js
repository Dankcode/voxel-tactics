import {districtParameters,DISTRICT_MAP_IDS} from '../mission/LargeDistricts.js';
import { spreadInsertion } from './Insertion.js';
import { normalizeInventory } from '../inventory/Inventory.js';
// Scenario descriptors → missions. Local sessions generate from a descriptor; co-op sessions hydrate
// the server's compiled mission, then replay the ordered intent list.
//
// desc: { scenario: map id, seed, squad?: string[] | squadKey, debug?, operation?, inventories?, test? }
// `test` is the admin test ground (custom hostile roster and mission overrides, see TestGround.js).
import { MAPS, DEFAULT_MAP, mapById } from '../mission/Maps.js';
import { SQUADS, CALLSIGNS, CLASSES } from '../content/units.js';
import { Battle } from '../battle/Battle.js';
import { generateOperation, operationOptions } from '../mapgen/Generator.js';
import { compileV3Map } from '../mapgen/ExteriorCompiler.js';
import { sanitizeTest, applyTestGround } from './TestGround.js';

export const SCENARIOS = MAPS.map(({ id, name, theme, text }) => ({ id, name, theme, text }));
/** The generated-map game mode (PLAN-04): every operation is generated from a plot family and a seed. */
export const OPERATION_ID = 'operation';

/** A known map id (or the operation mode), else the default map. Server rooms sanitise client descriptors with this. */
export function scenarioId(id) { return id === OPERATION_ID || mapById(id) ? id : DEFAULT_MAP; }

/** Sanitise a whole descriptor (server rooms and deep links). */
export function sanitizeDesc(d = {}) {
    const scenario = scenarioId(d.scenario);
    const seed = Number.isInteger(Number(d.seed)) && Number(d.seed) >= 0 && Number(d.seed) <= 0xffffffff ? Number(d.seed) : 1;
    const out = { scenario, seed: seed || 1, squad: d.squad || 'standard', debug: d.debug === true, intel: d.intel === true, asyncCoop: d.asyncCoop === true, support: d.support === 'orbital_laser' ? 'orbital_laser' : 'carpet_bomb' };
    if (DISTRICT_MAP_IDS.includes(scenario)&&d.district) out.district=districtParameters(scenario==='terrace-district'?{...d.district,shape:'rectangle'}:d.district);
    if (scenario === OPERATION_ID) out.operation = operationOptions(d.operation);
    if (d.inventories!==undefined) {
        const size=Array.isArray(out.squad)?out.squad.length:(SQUADS[out.squad]||SQUADS.standard).length;
        if(!Array.isArray(d.inventories)||d.inventories.length>size)throw Error('Invalid inventory: expected one pack per soldier');
        out.inventories=d.inventories.map((p,i)=>{try{return normalizeInventory(p);}catch(e){throw Error(`Invalid inventory for soldier ${i+1}: ${e.message}`);}});
    }
    const test = sanitizeTest(d.test);
    if (test) out.test = test;
    squadFor(out); // Validate unit types before any expensive generation.
    return out;
}

// Generated operations are cached as data (site, layout after repairs, design): a preview in the menu and the
// battle that follows, or a restart, recompile the same layout instead of solving it again.
const operationCache = new Map();
const operationKey = desc => JSON.stringify({ ...operationOptions(desc.operation), seed: desc.seed ?? 1 });
/** Generate (or fetch) an operation's data: { site, layout, design }. Deterministic per descriptor. */
export function operationFor(desc) {
    const key = operationKey(desc);
    if (!operationCache.has(key)) {
        const { site, layout, design } = generateOperation({ ...operationOptions(desc.operation), seed: desc.seed ?? 1 });
        operationCache.set(key, { site, layout, design });
        while (operationCache.size > 4) operationCache.delete(operationCache.keys().next().value);
    }
    return operationCache.get(key);
}

export function buildMission(desc) {
    if (scenarioId(desc.scenario) === OPERATION_ID) return compileV3Map(structuredClone(operationFor(desc)), { seed: desc.seed ?? 1 });
    return mapById(scenarioId(desc.scenario)).build({ ...desc.district, seed: desc.seed ?? 1 });
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
    return new Battle({ mission, squad, seed: desc.seed ?? 1, debug: !!desc.debug, enemies, intel: !!desc.intel, asyncCoop: !!desc.asyncCoop, support: desc.support, testArsenal:!!desc.test });
}
