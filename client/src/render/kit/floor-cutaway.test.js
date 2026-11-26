import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {floorCutLevels,zoomCutLevel} from '../FloorCutaway.js';
import {CameraRig} from '../CameraRig.js';
import {Game} from '../../Game.js';
import {VoxelStore} from '../../../../shared/voxel/VoxelStore.js';
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

test('wheel zoom disregards manual floor buttons, zooms toward cursor, and reaches 1st floor at max zoom',()=>{
    const store=new VoxelStore(24,24,18);
    store.fill(0,0,0,23,23,4,'concrete');
    const mission={meta:{streetDatum:4,cutLevels:[4,7,10,13,Infinity]},store,buildings:[{id:'b0',x0:8,y0:8,w:6,d:6,baseZ:6,storeys:3}]};
    const rig=new CameraRig(16/9);
    rig.setBounds(24,24);
    rig.target.set(12,5,12);
    rig.distanceTarget=42;
    const voxelView={cutZ:Infinity,chunks:new Map(),setCut(v){this.cutZ=v;}};
    const g=Object.create(Game.prototype);
    Object.assign(g,{
        battle:{mission,store,units:[],unitsOf:()=>[]},
        options:{buildingView:'exterior'},
        cutLevel:Infinity,
        levelLocked:true,
        levelSource:'manual',
        buildingView:{buildings:mission.buildings,update:()=>false},
        voxelView,
        cameraDirector:{cutZ:Infinity},
        scene:{rig,setCut(v){this.cutLevel=v;},zoom(f,a){rig.zoom(f,a);},cutLevel:Infinity},
        roadMarks:{setCut(){}},
        hud:{floorLabelCalls:0,updateFloorLabel(){this.floorLabelCalls++;},refresh(){throw Error('zoom must not full-refresh HUD');}},
        selectedUnit:()=>null,
        refreshRange(){}
    });

    const anchor=new THREE.Vector3(20,5,20);
    g.zoomMap(0.65,anchor);
    assert.equal(g.levelLocked,false,'mouse wheel zoom releases manual floor lock');
    assert.equal(g.levelSource,null,'mouse wheel zoom clears manual levelSource');
    assert.equal(g.options.buildingView,'auto','mouse wheel zoom overrides exterior-only lock');
    assert.ok(rig.target.x>12&&rig.target.z>12,'zoom-in pulls target toward mouse cursor anchor');
    assert.equal(g.renderCut(g.cutLevel),Infinity,'global cut stays Infinity so elevated 1st floors stay intact');
    assert.ok(g.hud.floorLabelCalls>=1,'zoom only updates floor label without flashing HUD');

    g.zoomMap(0.05,anchor);
    assert.equal(rig.distanceTarget,8,'max zoom clamps at MIN_DIST=8');
    assert.equal(g.cutLevel,7,'max zoom always selects 1st floor cut');

    const zoomedOutBefore=rig.target.clone();
    g.zoomMap(10,anchor);
    assert.equal(g.cutLevel,Infinity,'zooming all the way out restores roofs');
    assert.equal(rig.target.x,zoomedOutBefore.x,'zoom-out keeps horizontal target stable');
});

test('left-drag pans camera and suppresses release click; shift+right-drag orbits camera',()=>{
    const rig=new CameraRig(16/9);rig.setBounds(40,40);rig.target.set(20,2,20);rig.update(0);
    const yaw0=rig.yaw;
    let clicked=0;
    const g=Object.create(Game.prototype);
    Object.assign(g,{
        battle:{},mode:{kind:'move'},debug:{},hud:{equipment:{open:false}},
        selectedUnit:()=>null,controllable:()=>false,canAct:()=>false,
        scene:{
            rig,
            rayAt(px,py){return rig.camera&&{ray:{origin:new THREE.Vector3(px/50,20,py/50),direction:new THREE.Vector3(0,-1,0)}};}
        }
    });
    g.dragging={button:0,mode:'pan',x:100,y:100,sx:100,sy:100,moved:false,grab:new THREE.Vector3(2,2,2)};
    g.updateDrag({clientX:160,clientY:140});
    assert.equal(g.dragging.moved,true);
    assert.ok(rig.target.x<20,'left-drag pans world target cleanly');
    g._suppressClickUntil=performance.now()+200;
    g.onClick({clientX:160,clientY:140});
    assert.equal(clicked,0,'drag release click is suppressed');

    g.dragging={button:2,mode:'orbit',x:200,y:200,sx:200,sy:200,moved:false,grab:null};
    g.updateDrag({clientX:240,clientY:210});
    assert.notEqual(rig.yaw,yaw0,'shift+right-drag orbit changes yaw');
});
