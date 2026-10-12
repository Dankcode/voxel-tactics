import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { occupiedCells, walkerFits, walkerContacts } from './Walker.js';
import { solveLeg, rayCapsule } from './WalkerIK.js';
import { rayUnit } from './Ballistics.js';
import { nodeKey, pathTo } from '../world/PathSearch.js';
import { createBattle } from '../session/Scenarios.js';
function arena(type='wall_strider',facade=false) {
    const store=new VoxelStore(24,24,16);store.fill(0,0,0,23,23,1,'concrete');
    if(facade)store.fill(10,2,2,20,20,6,'brick');
    return new Battle({mission:{id:'walkers',store,rooms:[],buildings:[],spawns:{player:[{x:3,y:3,z:1}],enemy:[{type,pos:{x:8,y:10,z:1},alerted:true}]}},squad:[{type:'marksman'}],seed:1});
}
test('walker feet reserve tiles; small soldiers cannot move into an occupied leg tile',()=>{
    const b=arena(),u=b.unit('e0');assert.equal(occupiedCells(u).length,5);assert.equal(b.occupant(u.x+1,u.y+1,u.z),u);
    assert.equal(b.apply({type:'move',unitId:'p0',to:{x:u.x+1,y:u.y+1,z:u.z}}).reason,'occupied');
    const large=arena('siege_weaver');assert.equal(occupiedCells(large.unit('e0')).length,7);
});
test('walker reaches a facade vertically and climbs onto a roof without ladders',()=>{
    const b=arena('wall_strider',true),u=b.unit('e0');b.startSide('enemy');
    const search=b.reach(u,30),wall={x:9,y:10,z:3},roof={x:11,y:10,z:6};
    assert.ok(search.nodes.has(nodeKey(wall)),'wall node');assert.ok(search.nodes.has(nodeKey(roof)),'roof node');
    const path=pathTo(search,roof);assert.ok(path.some((p,i)=>i&&p.x===path[i-1].x&&p.y===path[i-1].y&&p.z!==path[i-1].z));
    u.ap=20;assert.ok(b.apply({type:'move',unitId:u.id,to:wall}).ok);assert.ok(walkerContacts(b.store,u).every(c=>c.kind==='wall'));
    assert.equal(new Set(occupiedCells(u).map(c=>c.z)).size,3);assert.ok(walkerFits(b.store,u));
    u.ap=20;assert.ok(b.apply({type:'move',unitId:u.id,to:roof}).ok);assert.equal(u.z,6);
});
test('wide walkers reject narrow passages, blocked feet, and unsupported sky positions',()=>{
    const b=arena('siege_weaver'),u=b.unit('e0');
    assert.equal(walkerFits(b.store,u,{x:8,y:10,z:12}),false);
    assert.equal(walkerFits(b.store,u,u,c=>c.x===6&&c.y===10),false);
    b.store.fill(6,2,2,6,20,8,'brick');b.store.fill(10,2,2,10,20,8,'brick');
    assert.equal(walkerFits(b.store,u,{x:8,y:10,z:1}),false,'seven-tile body cannot squeeze through a three-tile corridor');
});
test('leg capsules can receive physical projectile hits outside the body tile',()=>{
    const b=arena(),u=b.unit('e0');
    const hit=rayUnit({x:9.5,y:4,h:2.08},[0,1,0],u,20,b.store);
    assert.equal(hit?.part,'legs');
    assert.ok(Number.isFinite(rayCapsule([0,0,0],[1,0,0],[4,0,-1],[4,0,1],.2)));
    const pose=solveLeg([0,0,2],[1,1,0]);assert.ok(Math.abs(Math.hypot(...pose.knee.map((v,i)=>v-pose.hip[i]))-1.8)<1e-6);
    assert.ok(Math.abs(Math.hypot(...pose.knee.map((v,i)=>v-pose.foot[i]))-1.8)<1e-6);
});
test('destroying wall support drops a climbing walker to a supported footprint',()=>{
    const b=arena('wall_strider',true),u=b.unit('e0');u.x=9;u.z=3;u.footprint=occupiedCells(u,{x:u.x,y:u.y,z:u.z},b.store);
    for(let z=2;z<=6;z++)for(let y=8;y<=12;y++)b.store.set(10,y,z,MAT.air||0);
    b.checkFalls();assert.ok(u.z<3||u.dead||u.down);
});
test('insertion spacing is deterministic and walker training spawns fit',()=>{
    const desc={scenario:'proving-grounds',seed:4};const a=createBattle(desc),b=createBattle(desc);
    const friends=a.unitsOf('player');for(let i=0;i<friends.length;i++)for(let j=0;j<i;j++)assert.ok(a.distance(friends[i],friends[j])>=3);
    for(const u of a.unitsOf('enemy').filter(u=>u.type.includes('strider')||u.type.includes('weaver')))assert.ok(walkerFits(a.store,u));
    assert.equal(a.hash(),b.hash());
});

test('climbing intents replay with identical footprints and hashes',()=>{
    const a=arena('wall_strider',true),b=arena('wall_strider',true);
    for(const i of [{type:'endTurn',side:'player'},{type:'move',unitId:'e0',to:{x:9,y:10,z:3}},{type:'endTurn',side:'enemy'},{type:'endTurn',side:'player'},{type:'move',unitId:'e0',to:{x:11,y:10,z:6}}]){
        assert.ok(a.apply(i).ok,JSON.stringify(i));assert.ok(b.apply(i).ok);assert.equal(a.hash(),b.hash());
    }
});
