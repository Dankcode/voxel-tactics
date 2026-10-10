import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionAsync } from '../src/MissionBuilder.js';
import { unpackMission } from '../../shared/session/MissionSnapshot.js';
import { createBattle } from '../../shared/session/Scenarios.js';
test('generated mission builds outside the event loop and snapshot peers remain deterministic', {timeout:60000}, async()=>{
 let ticks=0;const timer=setInterval(()=>ticks++,10);
 let packed;try{packed=await buildMissionAsync({scenario:'operation',seed:7,squad:'standard'});}finally{clearInterval(timer);}
 assert.ok(ticks>3,'server timer remains responsive while generation runs');
 const desc={scenario:'operation',seed:7,squad:'standard'};
 const a=createBattle(desc,unpackMission(packed)),b=createBattle(desc,unpackMission(structuredClone(packed)));
 assert.equal(a.hash(),b.hash());const u=a.unit('p0'),to=[...a.reach(u,3).nodes.values()].find(n=>n.x!==u.x||n.y!==u.y);
 const intent={type:'move',unitId:u.id,to:{x:to.x,y:to.y,z:to.z}};assert.ok(a.apply(intent).ok);assert.ok(b.apply(intent).ok);assert.equal(a.hash(),b.hash());
});
