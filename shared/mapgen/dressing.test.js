import test from 'node:test';
import assert from 'node:assert/strict';
import {solveDressing} from './DressingSolver.js';
import {visionProfile,inWatchSector,watchSector} from '../battle/WatchSector.js';
import {createUnit} from '../battle/Units.js';

test('dressing WFC is seeded, room-specific and prevents adjacent dense kits',()=>{
    const rooms=[{kind:'office',cells:[[0,0],[0,1]]},{kind:'office',cells:[[2,0],[2,1]]},{kind:'hall',cells:[[1,0],[1,1]]}];
    const run=seed=>[...solveDressing(rooms,{},seed).values()];
    assert.deepEqual(run(9),run(9));
    for(let seed=0;seed<20;seed++) {const kits=run(seed);assert.ok(!(kits[0].density==='dense'&&kits[1].density==='dense'));assert.deepEqual(kits[2].items,[]);}
});
test('watch sector is planar and equipment changes width and reach',()=>{
    const u=createUnit('marksman','player',{x:5,y:5,z:1},'p');
    assert.ok(visionProfile(u,'longrifle').halfAngleDeg<visionProfile(u,'handcannon').halfAngleDeg);
    assert.ok(visionProfile(u,'longrifle').range>visionProfile(u,'handcannon').range);
    const sector=watchSector(u,{x:5,y:0});
    assert.equal(inWatchSector(u,sector,{x:5,y:2,z:10}),true);
    assert.equal(inWatchSector(u,sector,{x:5,y:8,z:1}),false);
});
