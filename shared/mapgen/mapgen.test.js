import test from 'node:test';
import assert from 'node:assert/strict';
import { solveWaveFunctionCollapse } from '../generation/WaveFunctionCollapse.js';
import { solveSite, footprintIoU } from './SiteSolver.js';
import { designLevel } from './LevelDesigner.js';
import { solveFloor } from './FloorSolver.js';
import { buildPackagedMap } from './PackageBuilder.js';
import { MAP_PACKAGES } from '../mission/generated/PackageCatalog.js';
import { CEDAR_IMAGE_SITE } from '../mission/generated/CedarImage.js';
import { damageVoxel, settleUnsupported } from '../voxel/Destruction.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { createBattle } from '../session/Scenarios.js';

test('WFC honours fixed cells and domains, reports contradictions, and repeats weighted solves',()=> {
    const args={nodes:[{id:'a',neighbors:[{id:'b',direction:'edge'}]},{id:'b'}],tiles:[{id:'wall'},{id:'window'}],compatible:(a,b)=>a!==b,fixed:new Map([['a','wall']]),domains:new Map([['b',['window']]]),seed:9};
    assert.deepEqual([...solveWaveFunctionCollapse(args)],[['a','wall'],['b','window']]);
    assert.deepEqual(solveWaveFunctionCollapse(args),solveWaveFunctionCollapse(args));
    assert.throws(()=>solveWaveFunctionCollapse({...args,fixed:new Map([['a','wall'],['b','wall']])}),/domain|contradictory/);
});

test('content extents use one scale for both axes; small footprints upscale the entire scene',()=> {
    const site=structuredClone(CEDAR_IMAGE_SITE);site.frame={width:60,height:30};
    const layout=solveSite(site);
    assert.equal(layout.width-6,Math.ceil(site.frame.width*layout.transform.scale));
    assert.equal(layout.depth-6,Math.ceil(site.frame.height*layout.transform.scale));
    assert.ok(Math.abs((layout.width-6)/(layout.depth-6)-2)<0.04);
    assert.equal(layout.buildings.length,site.buildings.length);
    assert.ok(layout.congruence.every(c=>c.iou>=0.85));
    const small=structuredClone(CEDAR_IMAGE_SITE);small.frame={width:24,height:20};
    const repaired=solveSite(small);assert.ok(repaired.repairs.some(r=>r.kind==='uniform-upscale'));
    assert.ok(repaired.buildings.every(b=>b.w>=11&&b.d>=11));
});

test('small footprint contacts are repaired and audited instead of dropping a building',()=> {
    const site=structuredClone(CEDAR_IMAGE_SITE);site.frame={width:58,height:40};
    site.buildings[0].bounds=[0.08,0.2,0.43,0.55];site.buildings[1].bounds=[0.42,0.2,0.77,0.55];
    const layout=solveSite(site);assert.equal(layout.buildings.length,2);
    assert.ok(layout.repairs.some(r=>r.kind==='split-contact'));
    assert.ok(layout.buildings.every(b=>footprintIoU(b,layout.reference.find(r=>r.id===b.id))>=0.85));
});

test('20 seeds × three room programmes solve with valid areas, adjacencies and fixed circulation',()=> {
    for(const program of ['house','office','warehouse'])for(let seed=1;seed<=20;seed++) {
        const site={...structuredClone(CEDAR_IMAGE_SITE),buildings:[{...CEDAR_IMAGE_SITE.buildings[0],program,storeys:4}]};
        const layout=solveSite(site,seed),design=designLevel(site,layout),b=layout.buildings[0];
        const f=solveFloor(b,design.programs[0],{},seed),hall=f.rooms.find(r=>r.kind==='hall');
        assert.equal(f.rooms.length,5);assert.equal(hall.cells.length,(b.w-2)*3);
        const area=f.rooms.filter(r=>r.kind!=='hall').reduce((n,r)=>n+r.cells.length,0);
        for(const r of f.rooms.filter(r=>r.kind!=='hall')) {
            assert.ok(Math.abs(r.cells.length/area-r.areaShare)<=r.areaShare*f.areaTolerance+1e-9);
            assert.ok(f.doors.some(d=>d.room===r.id&&d.locked===(r.gameplay===false)));
        }
        const adjacency=structuredClone(design.programs[0]);adjacency.adjacencies.push([adjacency.rooms[0].id,adjacency.rooms[1].id]);
        const linked=solveFloor(b,adjacency,{},seed);assert.ok(linked.doors.some(d=>d.other));
    }
});

test('saved four-storey packages build identically and survive a local ground-wall collapse',()=> {
    const pkg=MAP_PACKAGES.find(p=>p.manifest.id==='signal-house');assert.ok(pkg);
    for(const seed of [1,2,3,4]) {
        const a=buildPackagedMap(pkg,{seed}),b=buildPackagedMap(pkg,{seed});
        assert.equal(a.store.hash(),b.store.hash());assert.deepEqual(a.spawns,b.spawns);assert.deepEqual(a.visual,b.visual);assert.ok(a.metrics.pass);
        assert.equal(a.buildings[0].storeys,4);assert.equal(a.buildings[0].stairs.length,3);
    }
    const m=buildPackagedMap(pkg),b=m.buildings[0];
    for(let x=b.x0+2;x<b.x0+6;x++)for(let z=2;z<=3;z++)damageVoxel(m.store,x,b.y0,z,100);
    settleUnsupported(m.store);
    const search=reachable(m.store,m.spawns.player[0],Infinity,AGENT_PROFILES.player);
    assert.ok(m.rooms.filter(r=>r.gameplay&&r.storey===3).every(r=>r.cells.some(([x,y])=>search.costs.has(nodeKey({x,y,z:r.floorZ})))));
    assert.ok(m.store.isSolid(b.x0+8,b.y0+2,10),'supported upper slab remains');
});

test('a packaged recover mission completes through replayed gameplay intents on matching peers',()=> {
    const a=createBattle({scenario:'signal-house',seed:3,debug:true}),b=createBattle({scenario:'signal-house',seed:3,debug:true});
    const item=a.objective.item;
    const intents=[{type:'debug',op:'teleport',unitId:'p0',to:{x:item.x,y:item.y,z:item.z}},{type:'recover',unitId:'p0'}];
    for(const intent of intents){const ra=a.apply(intent),rb=b.apply(intent);assert.ok(ra.ok,JSON.stringify(ra));assert.ok(rb.ok);assert.equal(a.hash(),b.hash());}
    assert.equal(a.outcome?.winner,'player');assert.equal(a.outcome?.reason,'recovered');
});

test('an impossible adjacency reports a named constraint without silently changing the programme',()=> {
    const site=structuredClone(CEDAR_IMAGE_SITE),layout=solveSite(site),p=designLevel(site,layout).programs[0];
    p.adjacencies=[['living','kitchen'],['living','study'],['living','bathroom']];
    assert.throws(()=>solveFloor(layout.buildings[0],p),/floor.constraints/);
});
