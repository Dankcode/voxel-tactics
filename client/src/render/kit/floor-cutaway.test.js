import test from 'node:test';
import assert from 'node:assert/strict';
import {floorCutLevels,zoomCutLevel} from '../FloorCutaway.js';
test('zoom depth traverses roof, third, second and first floors on an elevated datum',()=>{
    const mission={meta:{streetDatum:4,cutLevels:[4,7,10,13,Infinity]},buildings:[{storeys:3}]};
    assert.deepEqual(floorCutLevels(mission),[4,7,10,13,Infinity]);
    assert.equal(zoomCutLevel(mission,50),Infinity);
    assert.equal(zoomCutLevel(mission,30),13);
    assert.equal(zoomCutLevel(mission,23),10);
    assert.equal(zoomCutLevel(mission,8),7);
});

test('PLAN-10: focusing a unit picks the cut of its own storey',async()=>{
    const {unitCutLevel}=await import('../FloorCutaway.js');
    const mission={meta:{streetDatum:4,cutLevels:[4,7,10,13,Infinity]},buildings:[{storeys:3,x0:10,y0:10,w:8,d:8}]};
    assert.equal(unitCutLevel(mission,{x:2,y:2,z:4}),null,'outdoors on the street: zoom decides');
    assert.equal(unitCutLevel(mission,{x:12,y:12,z:4}),7,'ground floor');
    assert.equal(unitCutLevel(mission,{x:12,y:12,z:7}),10,'first floor');
    assert.equal(unitCutLevel(mission,{x:12,y:12,z:10}),13,'second floor');
    assert.equal(unitCutLevel(mission,{x:12,y:12,z:13}),Infinity,'roof');
    assert.equal(unitCutLevel(mission,{x:2,y:2,z:1}),4,'underground: the street datum cut');
    assert.equal(unitCutLevel(mission,{x:2,y:2,z:7}),10,'on an outdoor deck above the street');
});
