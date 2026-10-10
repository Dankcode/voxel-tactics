import test from 'node:test';
import assert from 'node:assert/strict';
import { InteriorVisibility } from '../InteriorVisibility.js';

test('unrevealed interiors and inner door cells are hidden while the exterior shell remains',()=>{
    const revealed=new Set();let fog=true;
    const mission={buildings:[{id:'house',x0:0,y0:0,w:7,d:5}],rooms:[
        {id:0,buildingId:'house',floorZ:1,cells:[[1,2],[2,2]]},
        {id:1,buildingId:'house',floorZ:1,cells:[[4,2],[5,2]]}]};
    const v=new InteriorVisibility(mission,revealed,()=>fog);
    assert.ok(v.hiddenAt(1,2,1));assert.ok(v.hiddenAt(3,2,2));
    assert.equal(v.hiddenAt(0,2,2),false,'exterior door remains selectable');
    revealed.add(0);assert.equal(v.hiddenAt(1,2,2),false);
    assert.equal(v.hiddenAt(3,2,2),false,'door adjoining revealed room becomes visible');
    assert.ok(v.hiddenAt(4,2,2));assert.equal(v.concealedRooms().length,1);
    fog=false;assert.equal(v.hiddenAt(4,2,2),false);assert.equal(v.concealedRooms().length,0);
});

test('window sight cells lose their mask without permanently revealing the room',()=>{
 const seen=new Set(['2,2,1']),v=new InteriorVisibility({rooms:[{id:0,floorZ:1,cells:[[2,2],[5,2]]}]},new Set(),()=>true,seen);
 assert.equal(v.hiddenAt(2,2,2),false);assert.equal(v.hiddenAt(5,2,2),true);
 seen.clear();assert.equal(v.hiddenAt(2,2,2),true);
});
