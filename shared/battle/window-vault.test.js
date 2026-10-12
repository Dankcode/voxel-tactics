import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../mission/modern/MapKit.js';
import { Battle } from './Battle.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { canVault } from '../world/PathSearch.js';
import { packMission,unpackMission } from '../session/MissionSnapshot.js';
import { coverAt,COVER } from '../voxel/Cover.js';
const dirs={n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]};
test('a normal move automatically vaults a furnished building window into interior cover and back',()=>{
    const m=createMap({id:'window-entry',width:30,depth:30,seed:27});
    const building=m.building({id:'house',program:'house',x0:8,y0:8,w:12,d:12,storeys:2,baseZ:1,front:'s'});
    const windows=building.windows.filter(w=>w.storey===0&&!w.full);
    assert.ok(windows.length);
    for(const w of windows){const [dx,dy]=dirs[w.side];assert.ok(m.store.surfaces(w.x-dx,w.y-dy).some(s=>s.z===1&&s.headroom>=2),'window landing is reserved from furniture');}
    const w=windows[0],[dx,dy]=dirs[w.side],from={x:w.x+dx,y:w.y+dy,z:1},to={x:w.x-dx,y:w.y-dy,z:1};
    assert.deepEqual(canVault(m.store,from,-dx,-dy),to);
    const mission=m.finish({name:'Window entry',spawns:{player:[from],enemy:[{type:'cultist',group:0,pos:{x:27,y:27,z:1}}]},objective:{kind:'eliminate'}});
    const original=packMission(mission);
    const build=()=>new Battle({mission:unpackMission(original),squad:[{type:'vanguard'}],seed:27});
    const a=build(),b=build(),intent={type:'move',unitId:'p0',to};
    const before=a.unit('p0').ap,r=a.apply(intent);assert.ok(r.ok,r.reason);
    const movement=r.events.find(e=>e.t==='move'&&e.unitId==='p0');assert.deepEqual(movement.kinds,['vault']);assert.deepEqual(movement.windowVaults,[true]);
    assert.equal(a.unit('p0').ap,before-1);assert.equal(a.store.get(w.x,w.y,3),AIR);assert.equal(a.store.get(w.x,w.y,2),MAT.stucco);
    assert.ok(a.revealedRooms.has(a.roomOf(a.unit('p0'))));assert.equal(coverAt(a.store,to.x,to.y,to.z)[w.side],COVER.HALF);
    assert.ok(b.apply(intent).ok);assert.equal(a.hash(),b.hash());
    const back=a.apply({type:'move',unitId:'p0',to:from});assert.ok(back.ok,back.reason);assert.equal(back.events.find(e=>e.t==='move').windowVaults[0],true);
    a.light.dispose();b.light.dispose();
});
