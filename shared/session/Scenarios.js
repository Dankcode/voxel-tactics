// Scenario descriptors → missions. The same descriptor builds the same mission on every client and on the
// server (lockstep), so a descriptor + the ordered intent list fully describes a battle.
//
// desc: { scenario: map id, seed, squad?: string[] | squadKey, debug? }
import { MAPS, DEFAULT_MAP, mapById } from '../mission/Maps.js';
import { SQUADS, CALLSIGNS } from '../content/units.js';
import { Battle } from '../battle/Battle.js';

export const SCENARIOS = MAPS.map(({ id, name, theme, text }) => ({ id, name, theme, text }));

/** A known map id, or the default map. Server rooms sanitise client descriptors with this. */
export function scenarioId(id) { return mapById(id) ? id : DEFAULT_MAP; }

export function buildMission(desc) {
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
