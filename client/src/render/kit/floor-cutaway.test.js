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
