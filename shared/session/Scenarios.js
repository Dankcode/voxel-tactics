// Scenario descriptors → missions. The same descriptor builds the same mission on every client and on the
// server (lockstep), so a descriptor + the ordered intent list fully describes a battle.
import { buildProvingGrounds, PROVING_GROUNDS_ID } from '../mission/ProvingGrounds.js';
import { buildWorldMission } from '../mission/WorldMission.js';
import { SQUADS } from '../content/units.js';
import { Battle } from '../battle/Battle.js';

export const SCENARIOS = Object.freeze([
    { id: PROVING_GROUNDS_ID, name: 'Proving Grounds', text: 'Every system in one map: firing range, corridor bunker, powder shack, watchtower, pond, ice, hill.' },
    { id: 'world', name: 'Generated burg', text: 'A burg from vibe-game\'s world, upscaled ×2 with rebuilt, enterable buildings.' }
]);

/** desc: { scenario, siteId?, seed, squad?: string[] | squadKey } ; site: baked site JSON for world scenarios */
export function buildMission(desc, site = null) {
    if (desc.scenario === 'world') {
        if (!site) throw new Error('world scenario needs a site');
        return buildWorldMission(site, { seed: desc.seed ?? 1 });
    }
    return buildProvingGrounds({ seed: desc.seed ?? 1 });
}

export function squadFor(desc) {
    const list = Array.isArray(desc.squad) ? desc.squad : SQUADS[desc.squad || 'standard'];
    return list.map((type, i) => ({ type, owner: 'player', name: `${type[0].toUpperCase()}${type.slice(1)} ${i + 1}` }));
}

export function createBattle(desc, site = null) {
    const mission = buildMission(desc, site);
    return new Battle({ mission, squad: squadFor(desc), seed: desc.seed ?? 1 });
}
