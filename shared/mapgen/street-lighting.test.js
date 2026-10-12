import test from 'node:test';
import assert from 'node:assert/strict';
import {VoxelStore} from '../voxel/VoxelStore.js';
import {planStreetLighting,organizeStreetLights} from './StreetLighting.js';
import {createMap} from '../mission/modern/MapKit.js';
import {rasterRoadNetwork,smoothRoad} from './RoadGeometry.js';
function street(){const s=new VoxelStore(56,32,12);s.fill(0,0,0,55,31,1,'concrete');s.fill(0,12,1,55,18,1,'asphalt');return s;}
test('road lights repeat along two curbs, face the carriageway, and never stand in it',()=>{
    const s=street(),lights=planStreetLighting(s);assert.ok(lights.length>=6);
    assert.deepEqual(lights,planStreetLighting(s));
    assert.ok(lights.every(l=>[11,19].includes(l.y)&&l.planned));
    for(const y of [11,19]){const row=lights.filter(l=>l.y===y);for(let i=1;i<row.length;i++)assert.equal(row[i].x-row[i-1].x,12);}
    assert.ok(lights.filter(l=>l.y===11).every(l=>Math.abs(l.yaw)<1e-8));
    assert.ok(lights.filter(l=>l.y===19).every(l=>Math.abs(Math.abs(l.yaw)-Math.PI)<1e-8));
});
test('lights avoid doors, buildings, and the full vertical pole clearance',()=>{
    const s=street();s.setKey(16,11,4,'brick');
    const buildings=[{x0:28,y0:2,w:10,d:10,doors:[{x:27,y:10,exterior:true}]}];
    for(const l of planStreetLighting(s,buildings)) {
        assert.ok(l.x!==16||l.y!==11);assert.ok(Math.hypot(l.x-27,l.y-10)>=3);
        assert.ok(!(l.x>=28&&l.x<38&&l.y>=2&&l.y<12));
    }
});
test('curved route lights preserve global spacing and source road stations',()=>{
    const s=new VoxelStore(70,50,12);s.fill(0,0,0,69,49,1,'concrete');
    const roads=[{id:'curve',width:6,points:smoothRoad([[2,8],[24,8],[40,24],[44,47]])}];
    for(const c of rasterRoadNetwork(roads,70,50))s.setKey(c.x,c.y,1,c.material);
    const lights=planStreetLighting(s,[],{roads});assert.ok(lights.length>=5);
    assert.ok(lights.every(l=>l.route==='curve'));
    for(let i=0;i<lights.length;i++)for(let j=i+1;j<lights.length;j++)assert.ok(Math.hypot(lights[i].x-lights[j].x,lights[i].y-lights[j].y)>=8);
});
test('the finish pass replaces scattered lamps instead of retaining duplicates',()=>{
    const m=createMap({id:'light-test',width:56,depth:32});m.ground(0,12,55,18,'asphalt');m.decorAt('streetlight',5,5);m.decorAt('streetlight',6,6);
    const lights=organizeStreetLights(m);assert.deepEqual(m.ctx.decor,lights);assert.ok(!lights.some(l=>l.y===5||l.y===6));
});
