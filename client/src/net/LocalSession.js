// Single-machine session: intents go straight into the local Battle. Hot-seat co-op is the same session
// with the 'by' check disabled (every local player may command every squad member).
import { createBattle } from '../../../shared/session/Scenarios.js';

export async function loadSite(siteId) {
    const r = await fetch(`/missions/sites/${siteId}.json`);
    if (!r.ok) throw new Error(`site ${siteId} not found`);
    return r.json();
}

export class LocalSession {
    static async create(desc) {
        const site = desc.scenario === 'world' ? await loadSite(desc.siteId) : null;
        return new LocalSession(desc, createBattle(desc, site));
    }
    constructor(desc, battle) { this.desc = desc; this.battle = battle; this.local = true; this.playerId = '*'; }
    async submit(intent) { return this.battle.apply({ ...intent, by: '*' }); }
    restart() { return LocalSession.create(this.desc); }
    canAct() { return true; }
}
