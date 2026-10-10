import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { Battle } from './Battle.js';
import { watchSector, inWatchSector } from './WatchSector.js';
import { buildWatchPreview, watchAccuracy, watchBand } from './WatchPreview.js';

function fixture() {
    const store=new VoxelStore(28,14,8);
    for(let y=0;y<14;y++)for(let x=0;x<28;x++){store.set(x,y,0,MAT.bedrock);store.set(x,y,1,MAT.grass);}
    return new Battle({mission:{id:'watch-preview',name:'Watch preview',store,rooms:[],buildings:[],meta:{},spawns:{player:[{x:2,y:7,z:1}],enemy:[{type:'cultist',pos:{x:27,y:0,z:1}}]}},squad:[{type:'vanguard'}],seed:1});
}

test('watch accuracy uses reaction ballistics, distinguishes distance and wounds, and never mutates battle',()=>{
    const b=fixture(),u=b.unit('p0'),hash=b.hash();
    const near=watchAccuracy(b,u,{x:4,y:7,z:1},'blunderbuss');
    const far=watchAccuracy(b,u,{x:11,y:7,z:1},'blunderbuss');
    assert.ok(near>far,`${near} > ${far}`);assert.equal(watchBand(near),'high');assert.equal(watchBand(far),'low');
    assert.equal(b.hash(),hash);assert.equal(watchAccuracy(b,u,{x:4,y:7,z:1},'blunderbuss'),near);
    u.parts.armL.disabled=true;u.parts.armR.disabled=true;
    const healthy=fixture();
    assert.ok(watchAccuracy(b,u,{x:6,y:7,z:1},'blunderbuss')<watchAccuracy(healthy,healthy.unit('p0'),{x:6,y:7,z:1},'blunderbuss'));
});

test('filled watch preview includes wall faces, respects wedge, occlusion, hidden interiors and storey cuts',()=>{
    const b=fixture(),u=b.unit('p0');
    for(let y=0;y<14;y++)for(let z=2;z<=4;z++)b.store.set(7,y,z,MAT.stone);
    const sector=watchSector(u,{x:10,y:7},'blunderbuss'),cache=new Map();
    const data=buildWatchPreview(b,u,sector,{cutZ:4,cache});
    assert.ok(data.tiles.length);assert.ok(data.faces.length,'watched wall is filled');
    assert.ok(data.tiles.every(c=>inWatchSector(u,sector,c)&&c.x<7),'no tiles behind opaque wall');
    assert.ok(data.faces.every(f=>f.x===7&&f.points.every(p=>p[0]<7.5&&p[2]<=4)),'only exposed near faces below cut');
    const count=cache.size;
    assert.deepEqual(buildWatchPreview(b,u,sector,{cutZ:4,cache}),data);assert.equal(cache.size,count);
    const hidden=buildWatchPreview(b,u,sector,{hidden:(x)=>x>=7,cutZ:4});
    assert.equal(hidden.faces.length,0);assert.ok(hidden.tiles.every(c=>c.x<7));
    assert.deepEqual(buildWatchPreview(b,u,null),{tiles:[],faces:[]});
});
