import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImageMap, validateSite } from '../mapgen/PackageBuilder.js';
import { CEDAR_IMAGE_SITE } from './generated/CedarImage.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { MAT } from '../voxel/Materials.js';
import { planRows, PROGRAMS } from './modern/ModernBuilder.js';

test('image study preserves combat flow while locking non-gameplay rooms', () => {
    const m=buildImageMap(CEDAR_IMAGE_SITE,{seed:4});
    const search=reachable(m.store,m.spawns.player[0],Infinity);
    const slate=m.visual.slate;
    assert.equal(slate.worldUnitsPerTile,1);
    assert.deepEqual(slate.matrix,Array.from(m.store.mat));
    for(const layer of slate.layers) for(let y=0;y<slate.depth;y++) for(let x=0;x<slate.width;x++) assert.equal(layer.tiles[y][x],m.store.get(x,y,layer.z));
    assert.ok(m.metrics.pass,JSON.stringify(m.metrics));
    const closed=m.rooms.filter(r=>!r.gameplay);assert.equal(closed.length,2);
    for(const room of closed) assert.ok(room.cells.every(([x,y])=>!search.costs.has(nodeKey({x,y,z:room.floorZ}))));
    for(const b of m.buildings) for(const d of b.doors.filter(d=>d.locked)) {
        assert.equal(m.store.get(d.x,d.y,d.z+1),MAT.door_locked);
        assert.equal(m.store.isSolid(d.x,d.y,d.z+1),true);
    }
    for(const e of m.spawns.enemy) assert.notEqual(m.rooms[m.store.roomAt(e.pos.x,e.pos.y,e.pos.z+1)]?.gameplay,false);
});

test('author may promote a bathroom to gameplay; image geometry and blocked flow fail validation', () => {
    const p=planRows(14,11,PROGRAMS.house,{gameplayRooms:['bathroom']});
    assert.ok(p.rooms.find(r=>r.kind==='bathroom').gameplay);
    assert.ok(!p.doors.some(d=>d.locked));
    const overlap=structuredClone(CEDAR_IMAGE_SITE);overlap.buildings[1].bounds=overlap.buildings[0].bounds;
    assert.throws(()=>validateSite(overlap),/overlapping/);
    const blocked=structuredClone(CEDAR_IMAGE_SITE);blocked.flow[0]=[0.07,0.23];
    assert.throws(()=>buildImageMap(blocked),/waypoint.*blocked/);
});

test('reference compiler uses industrial architecture and cover instead of a suburb template', () => {
    const reference={version:1,id:'industrial-reference-test',theme:'Industrial',timeOfDay:'night',name:'Freight Intercept',
        buildings:[{id:'depot',bounds:[0.18,0.15,0.63,0.5],program:'warehouse',front:'s'}],
        surfaces:[{bounds:[0,0,1,1],material:'concrete'},{bounds:[0,0.7,1,0.85],material:'asphalt'}],
        insertion:[0.08,0.94],flow:[[0.68,0.74],[0.68,0.4],[0.68,0.08]]};
    const mission=buildImageMap(reference,{seed:3});
    assert.equal(mission.buildings[0].program,'warehouse');
    assert.equal(mission.meta.timeOfDay,'night');assert.equal(mission.meta.theme,'Industrial');
    assert.ok(mission.rooms.every(r=>r.kind!=='living'&&r.kind!=='bathroom'));
    assert.deepEqual(mission.visual.slate.flow,mission.meta.flow);
});
