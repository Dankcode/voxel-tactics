import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { BuildingView } from '../BuildingView.js';
import { pickVisibleTile } from '../TilePicking.js';
import { buildRoofGeometry } from './RoofBuilder.js';
import { InteriorVisibility } from '../InteriorVisibility.js';
function house() {
    const store=new VoxelStore(16,16,12);store.fill(0,0,0,15,15,1,'concrete');
    for(let y=4;y<=10;y++)for(let x=4;x<=10;x++) {
        store.setKey(x,y,4,'oak_floor');store.setKey(x,y,7,'roof');
        if(x===4||x===10||y===4||y===10)for(const z of [2,3,5,6])store.setKey(x,y,z,'brick');
    }
    const b={id:'house',x0:4,y0:4,w:7,d:7,baseZ:1,storeys:2,top:7};
    const mission={store,buildings:[b],rooms:[{id:0,buildingId:'house',floorZ:1,cells:[[7,7]]}]};
    return {store,b,mission,view:new BuildingView(mission)};
}
test('auto cutaway persists beside a building; manual interiors is stable independently of movement',()=>{
    const {view}=house();assert.ok(view.update({unit:{x:3,y:7,z:1}}));assert.equal(view.hiddenAt(4,7,3),false);assert.ok(view.hiddenAt(7,7,7));
    assert.equal(view.update({unit:{x:2,y:7,z:1}}),false);assert.equal(view.update({unit:{x:1,y:7,z:1}}),false);
    assert.ok(view.update({unit:{x:-1,y:7,z:1}}));assert.equal(view.hiddenAt(4,7,3),false);
    view.update({unit:{x:0,y:0,z:1},mode:'interiors'});assert.equal(view.hiddenAt(4,7,2),false);
    assert.equal(view.update({unit:{x:15,y:15,z:1},mode:'interiors'}),false);
    view.update({mode:'exterior'});assert.equal(view.hiddenAt(7,7,7),false);
});
test('picking through a cut roof reaches the active interior floor and leaves gameplay state unchanged',()=>{
    const {view,store,mission}=house(),fog=new InteriorVisibility(mission,new Set()),hash=store.hash();
    const from={x:7.5,y:7.5,h:11.5},to={x:7.5,y:7.5,h:.1};
    const outside=pickVisibleTile(store,from,to);assert.equal(outside.voxel.z,7);
    view.update({mode:'interiors',cutZ:4});const pick=pickVisibleTile(store,from,to,{buildingView:view});
    assert.deepEqual(pick.cell,{x:7,y:7,z:1});assert.equal(store.hash(),hash);assert.ok(fog.hiddenAt(7,7,2));
    view.update({mode:'interiors',cutZ:7});assert.deepEqual(pickVisibleTile(store,from,to,{buildingView:view}).cell,{x:7,y:7,z:4});
});
test('visible walls and windows allow interior floor selection',()=>{
    const {view,store}=house();store.setKey(4,7,3,'glass');view.update({mode:'interiors',cutZ:4});
    assert.equal(view.hiddenAt(4,7,2),false);assert.equal(view.hiddenAt(4,7,3),false);
    assert.equal(view.pickHiddenAt(4,7,3),true);
    const result=pickVisibleTile(store,{x:2.5,y:7.5,h:5.5},{x:9.5,y:7.5,h:.5},{buildingView:view,cutZ:4});
    assert.ok(result.cell.x>4&&result.cell.x<10);assert.equal(result.cell.z,1);
});
test('pitched roof mesh respects the same building cutaway as the picker',()=>{
    const {view,store}=house();assert.ok(buildRoofGeometry(store,0,0,0));
    view.update({mode:'interiors',cutZ:4});assert.equal(buildRoofGeometry(store,0,0,0,Infinity,(x,y,z)=>view.hiddenAt(x,y,z)),null);
});

test('auto-selection of an outside teammate keeps an occupied building cut away',()=>{
    const {view}=house(),inside={x:7,y:7,z:1},outside={x:0,y:0,z:1};
    view.update({unit:inside,units:[inside,outside]});
    assert.equal(view.update({unit:outside,units:[inside,outside]}),false);
    assert.ok(view.hiddenAt(7,7,7));
});

test('manual Interiors cuts the roof even when the selected soldier stands on it',()=>{
    const {view}=house();view.update({unit:{x:7,y:7,z:7},mode:'interiors'});
    assert.ok(view.hiddenAt(7,7,7));assert.equal(view.hiddenAt(7,7,4),false);
});

test('zoom-selected floors override soldier proximity and zooming out restores roofs',()=>{
    const {view}=house();
    view.update({mode:'auto',zoomFloor:1,unit:{x:0,y:0,z:1}});
    assert.equal(view.hiddenAt(7,7,4),true);assert.equal(view.hiddenAt(4,7,3),false);
    view.update({mode:'auto',zoomFloor:2});assert.equal(view.hiddenAt(7,7,4),false);assert.equal(view.hiddenAt(7,7,7),true);
    view.update({mode:'auto',zoomFloor:0});assert.equal(view.hiddenAt(7,7,7),false);
});
