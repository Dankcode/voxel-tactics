import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../mission/modern/MapKit.js';
import { buildParkDistrict, buildMallDistrict, buildDrainageDistrict } from '../mission/LargeDistricts.js';
import { initDistrict, tagRect } from './district/Core.js';
import { registerRoads } from './StreetDressing.js';
import { evaluateDistrictGates } from './DistrictGates.js';
import { evaluateHoldZone } from './district/HoldZone.js';
import { finishDistrict } from './district/District.js';
import { buildSunkenJunction, buildSunkenBoulevard } from '../mission/ConnectingDistricts.js';
import { MAT } from '../voxel/Materials.js';

const finish = m => m.finish({name:'Regression fixture',spawns:{player:[{x:2,y:2,z:1}],enemy:[]},objective:{kind:'eliminate'}});

test('road ownership detects buildings before and after registration, even if tags and ground snapshots change',()=>{
    for(const buildingFirst of [false,true]) {
        const m=createMap({id:'road-ownership',width:40,depth:40,height:16,seed:1});initDistrict(m,{});
        const build=()=>m.building({id:'illegal',program:'office',x0:8,y0:14,w:14,d:14,storeys:1,front:'s'});
        m.roadX(18,22);
        if(buildingFirst)build();
        registerRoads(m,[{id:'main',axis:'x',lo:18,hi:22,from:0,to:39,z:1,kind:'main',sidewalk:2}]);
        if(!buildingFirst)build();
        tagRect(m,{x0:8,y0:14,w:14,d:14},'building',{force:true});
        for(let y=14;y<28;y++)for(let x=8;x<22;x++)m.district.ground[x+y*40]=m.store.topSolid(x,y);
        const g=evaluateDistrictGates(finish(m),m);
        assert.equal(g.gates.roadAir,false);
        assert.ok(g.metrics.roadAir>0);
        assert.ok(g.samples.roadAir.some(c=>c.x>=8&&c.x<22));
    }
});

test('district finalization rejects failing gates; explicit report mode retains diagnostics',()=>{
    const m=createMap({id:'invalid-district',width:24,depth:24,height:10,seed:7});initDistrict(m,{});
    const mission=finish(m);
    assert.throws(()=>finishDistrict(mission,m,{}),e=>e.message.includes('seed 7')&&e.districtGates.gates.landUse===false);
    assert.equal(mission.meta.districtGates.pass,false);
    assert.equal(finishDistrict(mission,m,{}, {enforce:false}).pass,false);
});

test('authored upper road crossings retain clearance and registered edge fixtures',()=>{
    for(const build of [buildSunkenJunction,buildSunkenBoulevard]) {
        const m=build({seed:27});
        assert.equal(m.meta.districtGates.gates.roadAir,true,m.id);
    }
});

test('interior hold checks remove soft furniture and actually apply three deterministic blasts',()=>{
    const m=createMap({id:'indoor-destruction',width:40,depth:40,height:12,seed:1});initDistrict(m,{});
    m.building({id:'hall',program:'shop',x0:6,y0:6,w:26,d:26,storeys:1,furnish:false,rounded:false});
    const zone={x0:15,y0:15,x1:21,y1:21,z:1,kind:'interior'};
    for(let y=16;y<=20;y+=2)for(let x=16;x<=20;x+=2)m.store.set(x,y,2,MAT.crate);
    const mission=finish(m), original=mission.store.clone.bind(mission.store),clones=[];
    mission.store.clone=()=>{const c=original();clones.push(c);return c;};
    const hash=mission.store.hash(),r=evaluateHoldZone(mission,zone);
    assert.equal(clones[0].get(18,18,2),0,'indoor crates removed in durability clone');
    assert.ok(r.details.softRemoved>=9);
    assert.equal(r.details.blasts.length,3);
    assert.ok(r.details.blasts.some(b=>b.destroyed>0));
    assert.notEqual(clones[1].hash(),hash,'blast clone actually destroyed cover');
    assert.equal(mission.store.hash(),hash,'validation does not damage the playable mission');
    assert.deepEqual(evaluateHoldZone(mission,zone),r,'validation is deterministic');
});

test('traffic none excludes repair vehicles and debug metadata includes every placed vehicle',()=>{
    for(const build of [buildParkDistrict,buildMallDistrict,buildDrainageDistrict]) {
        const m=build({seed:27,remix:{traffic:'none',pedestrian:'none'}});
        assert.equal(m.meta.district.vehicles,0,m.id);
        assert.ok(!m.meta.district.repairs.some(r=>r.piece==='abandoned_car'),m.id);
        assert.equal(m.meta.districtGates.pass,true,`${m.id}: ${JSON.stringify(m.meta.districtGates)}`);
        assert.equal(m.metrics.pass,true,`${m.id}: ${JSON.stringify(m.metrics.gates)}`);
    }
    const m=buildParkDistrict({seed:27});
    assert.equal(m.meta.streetObjects.filter(o=>o.kind).length,m.meta.district.vehicles);
});
