// Scenario descriptors → missions. The same descriptor builds the same mission on every client and on the
// server (lockstep), so a descriptor + the ordered intent list fully describes a battle.
//
// desc: { scenario: map id, seed, squad?: string[] | squadKey, debug? }
import { MAPS, DEFAULT_MAP, mapById } from '../mission/Maps.js';
import { SQUADS, CALLSIGNS } from '../content/units.js';
import { Battle } from '../battle/Battle.js';
import { generateOperation, operationOptions } from '../mapgen/Generator.js';
import { compileV3Map } from '../mapgen/ExteriorCompiler.js';

export const SCENARIOS = MAPS.map(({ id, name, theme, text }) => ({ id, name, theme, text }));
/** The generated-map game mode (PLAN-04): every operation is generated from a plot family and a seed. */
export const OPERATION_ID = 'operation';

/** A known map id (or the operation mode), else the default map. Server rooms sanitise client descriptors with this. */
export function scenarioId(id) { return id === OPERATION_ID || mapById(id) ? id : DEFAULT_MAP; }

/** Sanitise a whole descriptor (server rooms and deep links). */
export function sanitizeDesc(d = {}) {
    const scenario = scenarioId(d.scenario);
    const seed = Number.isInteger(Number(d.seed)) && Number(d.seed) >= 0 && Number(d.seed) <= 0xffffffff ? Number(d.seed) : 1;
    const out = { scenario, seed: seed || 1, squad: d.squad || 'standard', debug: d.debug === true };
    if (scenario === OPERATION_ID) out.operation = operationOptions(d.operation);
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
    return mapById(scenarioId(desc.scenario)).build({ seed: desc.seed ?? 1 });
}

export function squadFor(desc) {
    const list = Array.isArray(desc.squad) ? desc.squad : (SQUADS[desc.squad] || SQUADS.standard);
    return list.map((type, i) => ({ type, owner: 'player', name: CALLSIGNS[i % CALLSIGNS.length] }));
}

export function createBattle(desc) {
    const mission = buildMission(desc);
    return new Battle({ mission, squad: squadFor(desc), seed: desc.seed ?? 1, debug: !!desc.debug });
}
