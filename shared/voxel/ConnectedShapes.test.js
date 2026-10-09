import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from './VoxelStore.js';
import { MAT } from './Materials.js';
import { wallMask, wallFootprint, containsPoint, liquidFootprint } from './ConnectedShapes.js';
import { castRay, lineOfSight } from './Raycast.js';
import { coverAt, COVER } from './Cover.js';
import { traceProjectile } from '../battle/Ballistics.js';
import { ElementField } from '../elements/Elements.js';
import { reachable, nodeKey, VAULT_COST } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
const fresh=()=>new VoxelStore(32,32,8);

test('all 16 connection masks reach exactly their neighbour edges, with rounded exposed corners',()=>{
    for(let mask=0;mask<16;mask++) {
        const p=wallFootprint(mask);
        assert.ok(p.every(([x,y])=>x>=0&&x<=1&&y>=0&&y<=1));
        assert.ok(containsPoint(p,.5,.5));
        for(const [bit,x,y] of [[1,.999,.5],[2,.5,.999],[4,.001,.5],[8,.5,.001]])
            assert.equal(containsPoint(p,x,y),!!(mask&bit),`mask ${mask}, edge ${bit}`);
    }
    assert.equal(containsPoint(wallFootprint(0),.301,.301),false,'isolated post has a rounded corner');
});

test('mixed walls and openings join across chunks; diagonal-only walls never bridge',()=>{
    const s=fresh();s.set(15,15,2,MAT.stucco);s.set(16,16,2,MAT.brick);
    assert.equal(wallMask(s,15,15,2),0);
    s.set(16,15,2,MAT.glass);s.set(15,14,2,MAT.concrete_wall);
    assert.equal(wallMask(s,15,15,2),9);
    s.takeDirtyChunks();s.set(16,15,2,MAT.air);
    assert.ok(s.takeDirtyChunks().includes('0,0,0'),'neighbour chunk rebuilt');
    assert.equal(wallMask(s,15,15,2),8);
});

test('rays hit the visible wall surface and pass the empty part of its cell',()=>{
    const s=fresh();s.set(5,5,2,MAT.stucco);
    let hit=castRay(s,{x:2.5,y:5.5,h:2.5},{x:9.5,y:5.5,h:2.5});
    assert.equal(hit.hit.x,5); assert.ok(Math.abs(hit.point.x-5.3)<1e-6);
    assert.equal(castRay(s,{x:2.5,y:5.1,h:2.5},{x:9.5,y:5.1,h:2.5}).hit,null);
    assert.ok(lineOfSight(s,{x:2.5,y:5.1,h:2.5},{x:9.5,y:5.1,h:2.5}));
    s.set(5,4,2,MAT.brick);s.set(5,6,2,MAT.stucco);
    assert.ok(castRay(s,{x:2.5,y:5.1,h:2.5},{x:9.5,y:5.1,h:2.5}).hit);
});

test('start-cell and vertical rays use the same partial silhouette',()=>{
    const s=fresh();s.set(5,5,2,MAT.stucco);
    assert.equal(castRay(s,{x:5.1,y:5.1,h:2.5},{x:6,y:5.1,h:2.5},{skipStart:false}).hit,null);
    assert.equal(castRay(s,{x:5.1,y:5.1,h:5},{x:5.1,y:5.1,h:1}).hit,null);
    assert.ok(castRay(s,{x:5.5,y:5.5,h:5},{x:5.5,y:5.5,h:1}).hit);
});

test('cover distinguishes a connected wall, low wall, narrow end, open door, and destroyed section',()=>{
    const s=fresh();
    for(let y=4;y<=6;y++)for(let z=2;z<=3;z++)s.set(5,y,z,MAT.stucco);
    assert.equal(coverAt(s,4,5,1).e,COVER.FULL);
    s.set(5,5,3,MAT.air);assert.equal(coverAt(s,4,5,1).e,COVER.HALF);
    s.set(5,5,2,MAT.air);assert.equal(coverAt(s,4,5,1).e,COVER.NONE);
    for(let z=2;z<=3;z++)s.set(5,5,z,MAT.door_open);
    assert.equal(coverAt(s,4,5,1).e,COVER.NONE);
    const post=fresh();for(let z=2;z<=3;z++)post.set(5,5,z,MAT.stucco);
    assert.equal(coverAt(post,4,5,1).e,COVER.HALF,'narrow post never grants full cover');
});

test('glass shatters only when the projectile crosses its actual pane',()=>{
    const s=fresh();s.set(5,5,2,MAT.glass);
    const battle={store:s,units:[]};
    assert.equal(traceProjectile(battle,{x:2,y:5.1,h:2.5},[1,0,0],8).glass.length,0);
    const hit = traceProjectile(battle,{x:5.5,y:2,h:2.5},[0,1,0],8);
    assert.equal(hit.kind, 'none', 'glass is cosmetic: the ray carries on');
    assert.equal(hit.glass.length, 1);
});

test('connected water has no cover, freezes to physical ice and melts while preserving shoreline joins',()=>{
    const s=fresh();s.set(5,5,2,MAT.water);s.set(6,5,2,MAT.deep_water);
    const before=liquidFootprint(s,5,5,2);
    assert.equal(coverAt(s,4,5,1).e,COVER.NONE);
    assert.equal(castRay(s,{x:2,y:5.5,h:2.5},{x:9,y:5.5,h:2.5}).hit,null);
    const f=new ElementField(s);f.applyArea('cryo',5.5,5.5,2.5,.6);
    assert.equal(s.get(5,5,2),MAT.ice);assert.deepEqual(liquidFootprint(s,5,5,2),before);
    assert.equal(coverAt(s,4,5,1).e,COVER.HALF);
    assert.ok(castRay(s,{x:2,y:5.5,h:2.5},{x:9,y:5.5,h:2.5}).hit);
    f.applyArea('pyro',5.5,5.5,2.5,.6);assert.equal(s.get(5,5,2),MAT.water);
    assert.equal(coverAt(s,4,5,1).e,COVER.NONE);
});

test('grouped cover joins into runs: a lone post is half cover, a joined run is full; bullets pass beside a post',()=>{
    const s=fresh();
    for (const z of [2,3]) s.set(6,4,z,MAT.sandbag);
    assert.equal(coverAt(s,6,5,1).n,COVER.HALF,'lone 2-high stack');
    assert.equal(castRay(s,{x:2,y:4.08,h:2.5},{x:10,y:4.08,h:2.5}).hit,null,'a shot grazing the post margin passes');
    for (const x of [5,7]) for (const z of [2,3]) s.set(x,4,z,MAT.sandbag);
    assert.equal(coverAt(s,6,5,1).n,COVER.FULL,'joined run');
    s.set(6,4,2,MAT.hedge); s.set(6,4,3,0);
    assert.equal(coverAt(s,6,5,1).n,COVER.NONE,'a hedge hides you but stops nothing');
});

test('units cannot stand on thin walls or low cover; they vault one-high cover and go round taller walls',()=>{
    const s=fresh();
    for (let y=0;y<32;y++) for (let x=0;x<32;x++) s.set(x,y,1,MAT.lawn);
    for (let y=0;y<32;y++) s.set(10,y,2,MAT.brick);                    // a garden wall across the whole map
    assert.equal(s.surfaces(10,5).length,0,'no standing on top of the wall');
    let r=reachable(s,{x:8,y:5,z:1},Infinity,AGENT_PROFILES.player);
    assert.ok(r.costs.has(nodeKey({x:11,y:5,z:1})),'vaults the low wall');
    assert.ok(Math.abs(r.costs.get(nodeKey({x:11,y:5,z:1}))-r.costs.get(nodeKey({x:9,y:5,z:1}))-VAULT_COST)<1e-9);
    for (let y=0;y<32;y++) s.set(10,y,3,MAT.brick);                    // two high: no vault
    r=reachable(s,{x:8,y:5,z:1},Infinity,AGENT_PROFILES.player);
    assert.ok(!r.costs.has(nodeKey({x:11,y:5,z:1})),'a full-height wall must be gone round');
});

test('ice over deep water melts back into deep water; shallow ice into shallows',()=>{
    const s=fresh();s.set(5,5,2,MAT.deep_water);s.set(6,5,2,MAT.water);
    const f=new ElementField(s);f.applyArea('cryo',6,5.5,2.5,1.2);
    assert.equal(s.get(5,5,2),MAT.deep_ice);assert.equal(s.get(6,5,2),MAT.ice);
    assert.deepEqual(liquidFootprint(s,5,5,2),liquidFootprint(s,5,5,2));
    f.applyArea('pyro',6,5.5,2.5,1.2);
    assert.equal(s.get(5,5,2),MAT.deep_water);assert.equal(s.get(6,5,2),MAT.water);
});
