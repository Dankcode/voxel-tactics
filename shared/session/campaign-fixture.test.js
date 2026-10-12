import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCampaign,loadCampaign,workshopFixture,fixtureLaunch,applyFixtureResult } from '../../client/src/noncombat/CampaignState.js';
test('campaign fixture transactions and results are idempotent and save/load validates packs',()=>{
    const original=fixtureCampaign();let state=workshopFixture(original,'craft-1');
    assert.equal(original.materials,12);assert.equal(state.materials,10);assert.equal(workshopFixture(state,'craft-1'),state);
    state=fixtureLaunch(state,'mission-1',27);const result={campaignId:state.id,missionId:'mission-1',revision:state.mission.revision};
    assert.throws(()=>applyFixtureResult(state,{...result,campaignId:'different'}),/does not match/);
    state=applyFixtureResult(state,result);assert.equal(applyFixtureResult(state,result),state);
    assert.deepEqual(loadCampaign(JSON.stringify(state)),state);
    assert.throws(()=>loadCampaign(JSON.stringify({...state,schema:999})),/unsupported schema/);
    const invalid=fixtureCampaign();invalid.roster[0].inventory=[{id:'kit',itemId:'medkit',x:5,y:4,rotated:false}];
    assert.throws(()=>loadCampaign(JSON.stringify(invalid)),/outside pack/);
});
