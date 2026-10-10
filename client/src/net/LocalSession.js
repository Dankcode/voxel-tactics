// Single-machine session: intents go straight into the local Battle. Hot-seat co-op is the same session
// with the 'by' check disabled (every local player may command every squad member).
import { createBattle, squadFor } from '../../../shared/session/Scenarios.js';

import { generateDebugMap } from '../../../shared/mapgen/DebugGenerator.js';
import { Battle } from '../../../shared/battle/Battle.js';

export class LocalSession {
    static async create(desc) {
        if (desc.debugMap) {
            if (!desc.debug) throw Error('Map builder requires a local debug session');
            const mission = generateDebugMap({ ...desc.debugMap, seed: desc.seed ?? 1 });
            return new LocalSession(desc, new Battle({ mission, squad: squadFor(desc), seed: desc.seed ?? 1, debug: true }));
        }
        return new LocalSession(desc, createBattle(desc));
    }
    constructor(desc, battle) { this.desc = desc; this.battle = battle; this.local = true; this.playerId = '*'; }
    async submit(intent) { return this.battle.apply({ ...intent, by: '*' }); }
    restart() { return LocalSession.create(this.desc); }
    canAct() { return true; }
}
