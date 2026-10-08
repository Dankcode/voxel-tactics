// Single-machine session: intents go straight into the local Battle. Hot-seat co-op is the same session
// with the 'by' check disabled (every local player may command every squad member).
import { createBattle } from '../../../shared/session/Scenarios.js';

export class LocalSession {
    static async create(desc) { return new LocalSession(desc, createBattle(desc)); }
    constructor(desc, battle) { this.desc = desc; this.battle = battle; this.local = true; this.playerId = '*'; }
    async submit(intent) { return this.battle.apply({ ...intent, by: '*' }); }
    restart() { return LocalSession.create(this.desc); }
    canAct() { return true; }
}
