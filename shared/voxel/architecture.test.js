import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from './VoxelStore.js';
import { MAT } from './Materials.js';
import { canStep } from '../world/TraversalRules.js';
import { reachable, nodeKey, canVault, stepKind, VAULT_COST } from '../world/PathSearch.js';
import { coverAt, COVER } from './Cover.js';
import { castRay } from './Raycast.js';
import { curvedCornerFootprint, containsPoint } from './ConnectedShapes.js';
import { buildArchitectureYard } from '../mission/ArchitectureYard.js';
import { packMission, unpackMission } from '../session/MissionSnapshot.js';
function lane() {const s=new VoxelStore(12,12,8);s.fill(0,0,0,11,11,1,'concrete');return s;}
test('full glass admits ordinary walking at the same cost as empty ground and supplies no cover',()=>{
    const s=lane(),start={x:5,y:6,z:1},to={x:5,y:4,z:1};
    const empty=reachable(s,start,20).costs.get(nodeKey(to));
    for(let x=0;x<12;x++)for(const z of [2,3])s.set(x,5,z,MAT.glass);
    assert.ok(canStep(s,start,{x:5,y:5,z:1}));
    assert.equal(reachable(s,start,20).costs.get(nodeKey(to)),empty);
    assert.equal(stepKind(s,start,{x:5,y:5,z:1}),'walk');
    assert.equal(coverAt(s,5,6,1).n,COVER.NONE);
    assert.equal(s.surfaces(5,5).some(c=>c.z===3),false,'glass is not a standable roof');
});
test('a glazed solid sill supplies half cover and requires a vault rather than walking onto it',()=>{
    const s=lane(),from={x:5,y:6,z:1},to={x:5,y:4,z:1};
    for(let x=0;x<12;x++){s.set(x,5,2,MAT.concrete_wall);s.set(x,5,3,MAT.glass);}
    assert.equal(canStep(s,from,{x:5,y:5,z:1}),false);
    assert.deepEqual(canVault(s,from,0,-1),to);
    assert.equal(stepKind(s,from,to),'vault');
    assert.equal(reachable(s,from,10,{width:1,clearance:2,maxStep:1,stairs:true,doors:true}).costs.get(nodeKey(to)),VAULT_COST);
    assert.equal(coverAt(s,5,6,1).n,COVER.HALF);
    assert.equal(reachable(s,from,Infinity,undefined,{vault:false}).costs.has(nodeKey(to)),false);
});
test('curved building bends preserve tangent joins and rays hit the rounded surface',()=>{
    const s=lane();s.set(5,5,2,MAT.stucco);s.set(6,5,2,MAT.stucco);s.set(5,6,2,MAT.stucco);
    const p=curvedCornerFootprint(3);
    assert.equal(containsPoint(p,.4,.4),false,'outside of the bend is empty');
    assert.ok(containsPoint(p,.65,.65));assert.ok(containsPoint(p,.999,.5));assert.ok(containsPoint(p,.5,.999));
    const hit=castRay(s,{x:5.1,y:5.1,h:2.5},{x:5.95,y:5.95,h:2.5},{skipStart:false});
    assert.ok(Math.abs(hit.point.x-(6-.7/Math.sqrt(2)))<.003);
    s.set(5,5,2,MAT.glass);const pane=castRay(s,{x:5.1,y:5.1,h:2.5},{x:5.95,y:5.95,h:2.5},{skipStart:false,blocks:(s,x,y,z)=>s.get(x,y,z)===MAT.glass});
    assert.ok(Math.abs(pane.point.x-(6-.5175/Math.sqrt(2)))<.003);
});
test('Architecture Yard provides both traversal lanes and round-trips its facade hints for co-op',()=>{
    const m=buildArchitectureYard(),s=m.store;
    const walking=reachable(s,{x:8,y:34,z:1},10),vaulting=reachable(s,{x:20,y:34,z:1},10);
    assert.equal(walking.costs.get('8,32,1'),2);assert.equal(vaulting.costs.get('20,32,1'),VAULT_COST);
    const copy=unpackMission(packMission(m));assert.equal(copy.store.hash(),s.hash());
    assert.deepEqual(copy.visual.hints,m.visual.hints);
    assert.ok(new Set(Object.values(m.visual.hints).map(h=>h.windowStyle)).size>=4);
});
