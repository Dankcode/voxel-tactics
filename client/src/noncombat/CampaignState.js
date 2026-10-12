import { normalizeInventory } from '../../../shared/inventory/Inventory.js';
export const CAMPAIGN_SCHEMA=1;
export function fixtureCampaign() {
    return {schema:CAMPAIGN_SCHEMA,id:'fixture-campaign',revision:0,screen:'hub',materials:12,
        roster:[{id:'soldier-1',name:'Ash',type:'vanguard',inventory:[]},{id:'soldier-2',name:'Brook',type:'grenadier',inventory:[]}],
        applied:[],workshop:[],mission:null,completed:[]};
}
export function loadCampaign(text) {
    const s=JSON.parse(text);
    if(s.schema!==CAMPAIGN_SCHEMA||typeof s.id!=='string'||!Number.isInteger(s.revision)||s.revision<0||!Number.isInteger(s.materials)||s.materials<0||!Array.isArray(s.roster)||!Array.isArray(s.applied)||!Array.isArray(s.workshop)||!Array.isArray(s.completed))throw Error('Invalid campaign save or unsupported schema');
    if(!['hub','roster','workshop','operations','briefing','debrief'].includes(s.screen))throw Error('Invalid campaign screen');
    for(const soldier of s.roster) {if(!['vanguard','grenadier','marksman','warden'].includes(soldier.type)||typeof soldier.id!=='string')throw Error('Invalid soldier');soldier.inventory=normalizeInventory(soldier.inventory);}
    return structuredClone(s);
}
export function transact(state, id, action) {
    if(typeof id!=='string'||!id.length)throw Error('Transaction ID required');
    if(state.applied.includes(id))return state;
    const next=structuredClone(state);action(next);next.applied.push(id);next.revision++;return next;
}
export function workshopFixture(state,id) {
    return transact(state,id,s=>{if(s.materials<2)throw Error('Not enough fixture materials');s.materials-=2;s.workshop.push({id,item:'medkit',status:'complete'});});
}
export function fixtureLaunch(state,id,seed) {
    return transact(state,id,s=>{if(s.mission)throw Error('Resolve the current fixture mission first');s.mission={campaignId:s.id,missionId:id,revision:s.revision+1,seed,squad:s.roster.map(r=>r.type),inventories:s.roster.map(r=>normalizeInventory(r.inventory))};s.screen='briefing';});
}
export function applyFixtureResult(state,result) {
    if(result.campaignId!==state.id)throw Error('Result does not match this campaign mission');
    if(state.completed.includes(result.missionId))return state;
    if(!state.mission||result.campaignId!==state.id||result.missionId!==state.mission.missionId||result.revision!==state.mission.revision)throw Error('Result does not match this campaign mission');
    return transact(state,`result:${result.missionId}`,s=>{s.completed.push(result.missionId);s.mission=null;s.screen='debrief';});
}
