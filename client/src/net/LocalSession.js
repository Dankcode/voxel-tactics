// Single-machine session: intents go straight into the local Battle. Hot-seat co-op is the same session
// with the 'by' check disabled (every local player may command every squad member).
import { createBattle, squadFor } from '../../../shared/session/Scenarios.js';

import { generateDebugMap } from '../../../shared/mapgen/DebugGenerator.js';
import { Battle } from '../../../shared/battle/Battle.js';
import { profileForDesc } from '../../../shared/session/Playstyle.js';
import { loadAiProfile } from './AiCache.js';
import { preloadBaked } from '../../../shared/mission/BakedMaps.js';
import { PLACE_IDS } from '../../../shared/mission/PlaceMaps.js';

export class LocalSession {
    static async create(desc) {
        if (desc.debugMap) {
            if (!desc.debug) throw Error('Map builder requires a local debug session');
            const mission = generateDebugMap({ ...desc.debugMap, seed: desc.seed ?? 1 });
            return new LocalSession(desc, new Battle({ mission, squad: squadFor(desc), seed: desc.seed ?? 1, debug: true }));
        }
        // PLAN-09: the AI adapts to the squad's cached playstyle (server cache, else this browser's copy).
        if (desc.aiProfile === undefined) desc = { ...desc, aiProfile: profileForDesc(await loadAiProfile().catch(() => null)) };
        // real places: the baked package (instant load), when there is one for this seed; otherwise built live
        if (PLACE_IDS.has(desc.scenario)) await preloadBaked(desc.scenario, desc.seed ?? 1);
        return new LocalSession(desc, createBattle(desc));
    }
    constructor(desc, battle) { this.desc = desc; this.battle = battle; this.local = true; this.playerId = '*'; }
    async submit(intent) { return this.battle.apply(this.battle.asyncCoop && intent.type==='endTurn' && intent.side==='player' ? {type:'personalEnd',owner:'player',by:'*'} : { ...intent, by: '*' }); }
    restart() { const { aiProfile, ...desc } = this.desc; void aiProfile; return LocalSession.create(desc); }   // re-read the latest profile
    canAct() { return true; }
}
