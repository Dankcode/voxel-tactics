import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../Game.js';
import { AimController } from '../../ui/AimController.js';
import { Battle } from '../../../../shared/battle/Battle.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { MAT } from '../../../../shared/voxel/Materials.js';

function aimingGame(){
    const g=Object.create(Game.prototype),unit={id:'p0',x:0,y:0,z:0};
    Object.assign(g,{
        battle:{},mode:{kind:'shoot',weaponId:'repeater'},debug:{},options:{aimSensitivity:.5},
        selectedUnit:()=>unit,controllable:()=>true,canAct:()=>true,
        hud:{equipment:{open:false},cursorTip:()=>{}},
        scene:{renderer:{domElement:{clientHeight:720}}},cameraDirector:{cam:{fov:38}},
        aim:new AimController(),aimPointer:{locked:true,unavailable:false},
    });
    g.aim.snap({x:10,y:.5,h:2.35});g.freeAim={...g.aim.current};return g;
}

test('locked aim uses movement deltas even when the physical cursor coordinates stay fixed',()=>{
    const g=aimingGame(),e={clientX:640,clientY:360,movementX:100,movementY:20};
    g.onHover(e);const first={...g.aim.target};g.onHover(e);
    assert.ok(g.aim.target.y>first.y);assert.ok(g.aim.target.h<first.h);
    g.aimPointer.locked=false;const before={...g.aim.target};
    g.onHover({...e,clientX:1200});assert.deepEqual(g.aim.target,before,'moving over HUD cannot drag the aim');
});

test('the first click captures, a locked click fires the current reticle point, and fallback drag never fires',()=>{
    const g=aimingGame();let captures=0,shot;
    g.aimPointer.request=()=>captures++;g.intent=p=>shot=p;
    g.aimPointer.locked=false;g.onClick({clientX:100,clientY:100});
    assert.equal(captures,1);assert.equal(shot,undefined);
    g.aimPointer.locked=true;g.aim.setTarget({x:20,y:5,h:1});
    g.onClick({clientX:100,clientY:100});
    assert.deepEqual(shot.aim.point,g.freeAim,'fires the lagged reticle, not the desired destination or stale screen coordinates');
    g.aimPointer.locked=false;g.aimPointer.unavailable=true;shot=undefined;
    g.aimDrag={x:100,y:100};g.onHover({clientX:160,clientY:130});g.onClick({clientX:160,clientY:130});
    assert.equal(shot,undefined);assert.equal(captures,1);
});

test('aim entry follows the soldier facing without selecting a spotted enemy',()=>{
    const g=aimingGame(),u=g.selectedUnit();u.facing='e';let framed;
    g.battle.enemiesOf=()=>{throw Error('aim entry must not search for enemies');};g.isVisible=()=>{throw Error('aim entry must not test target visibility');};
    g.aimAt=()=>{throw Error('aim entry must not lock on');};g.aimPointer.request=()=>{};
    g.scene.camera={getWorldDirection:()=>{throw Error('aim entry must not use the tactical camera');}};g.frameAim=(unit,p)=>{framed={...p};};
    g.enterTargeting();
    assert.ok(g.freeAimManual);assert.deepEqual(framed,g.aim.current);
    assert.deepEqual(framed,{x:8.5,y:.5,h:u.z+2.1});assert.ok(g.aimPick==null);assert.ok(g.rawAim==null);
});

test('aim entry supports diagonal soldier facing',()=>{
    const g=aimingGame(),u=g.selectedUnit();u.facing='nw';let framed;
    g.aimPointer.request=()=>{};g.frameAim=(unit,p)=>{framed={...p};};
    g.scene.camera={getWorldDirection:()=>{throw Error('aim entry must not use the tactical camera');}};
    g.enterTargeting();
    assert.ok(Math.abs(framed.x-(.5-8/Math.sqrt(2)))<1e-9);assert.ok(Math.abs(framed.y-(.5-8/Math.sqrt(2)))<1e-9);assert.equal(framed.h,u.z+2.1);
});

test('suppression fires only at the unit passively detected under the reticle',()=>{
    const g=aimingGame(),target={id:'e1'};let intent,toast;
    g.mode.suppress=true;g.battle.unit=id=>id===target.id?target:null;g.intent=p=>{intent=p;};g.hud.toast=s=>{toast=s;};
    g.confirmFire();assert.equal(intent,undefined);assert.match(toast,/reticle on an enemy/);
    g.aimPick={unitId:target.id,part:'head'};g.confirmFire();
    assert.deepEqual(intent,{type:'ability',abilityId:'suppress',targetId:target.id});
});

test('mouse aim never snaps depth or body parts even while a target is under the ray',()=>{
    const store=new VoxelStore(40,40,10);
    for(let y=0;y<40;y++)for(let x=0;x<40;x++){store.set(x,y,0,MAT.bedrock);store.set(x,y,1,MAT.grass);}
    const battle=new Battle({mission:{id:'free-aim',store,rooms:[],buildings:[],spawns:{player:[{x:10,y:20,z:1}],enemy:[{type:'cultist',pos:{x:25,y:20,z:1},group:0}]}},squad:[{type:'grenadier'}],seed:2});
    const g=aimingGame(),u=battle.unit('p0'),enemy=battle.unit('e0'),origin={x:u.x+.5,y:u.y+.5,h:u.z+2.35};
    Object.assign(g,{battle,selectedUnit:()=>u,isVisible:()=>true});g.options.aimAssist='strong';
    g.aim.snap({x:enemy.x+.5,y:enemy.y+.45,h:origin.h});g.freeAim={...g.aim.current};g.rawAim=null;
    g.moveAim(1,0);
    assert.deepEqual(g.aim.target,g.rawAim,'the reticle keeps the exact mouse-derived point and distance');
    assert.equal(g.aimPick?.unitId,enemy.id,'hit detection remains passive and does not move the reticle');
});

test('left and right peeks preserve camera angle and refresh muzzle-based hit detection',async()=>{
    const {CameraDirector}=await import('../../anim/CameraDirector.js');
    const THREE=await import('three');
    for(const cell of [{x:11,y:20,z:1},{x:9,y:20,z:1}]){
        const store=new VoxelStore(40,40,10);
        for(let y=0;y<40;y++)for(let x=0;x<40;x++){store.set(x,y,0,MAT.bedrock);store.set(x,y,1,MAT.grass);}
        const battle=new Battle({mission:{id:'peek-aim',store,rooms:[],buildings:[],spawns:{player:[{x:10,y:20,z:1}],enemy:[{type:'cultist',pos:{x:10,y:8,z:1},group:0}]}},squad:[{type:'grenadier'}],seed:2});
        const g=aimingGame(),u=battle.unit('p0'),enemy=battle.unit('e0'),camera=new CameraDirector({aspect:16/9});camera.store=store;
        Object.assign(g,{battle,selectedUnit:()=>u,isVisible:()=>true,peek:null,views:new Map(),cutins:{beginAim(){}},cameraDirector:camera,hud:{equipment:{open:false},renderTarget(){}}});
        const p={x:enemy.x+.5,y:enemy.y+.5,h:enemy.z+2.02};g.freeAim={...p};g.aim.snap(p);g.rawAim={...p};g.frameAim(u,p);
        camera.track(new THREE.Vector3(p.x,p.h,p.y),1/60);
        const origin=g.aimOrigin(u),before=new THREE.Vector3(p.x-origin.x,p.h-origin.h,p.y-origin.y),distance=before.length(),quaternion=camera.cam.quaternion.clone();before.normalize();
        g.aim.vel=[.2,-.1,.3];g.setPeek(cell);
        assert.deepEqual(g.aim.vel,[.2,-.1,.3],'translation does not change the aim spring velocity');
        g.stepAim(0);
        const nextOrigin=g.aimOrigin(u),after=new THREE.Vector3(g.freeAim.x-nextOrigin.x,g.freeAim.h-nextOrigin.h,g.freeAim.y-nextOrigin.y);
        assert.ok(Math.abs(after.length()-distance)<1e-9,'peek preserves aim distance');
        assert.ok(after.normalize().angleTo(before)<1e-9,'peek preserves ballistic direction');
        assert.ok(camera.cam.quaternion.angleTo(quaternion)<1e-9,`peek translates the camera without rotating it: ${JSON.stringify({cell,angle:camera.cam.quaternion.angleTo(quaternion),side:g.aimStance.side,position:camera.cam.position.toArray(),look:camera.look.toArray()})}`);
        assert.deepEqual(g.aim.target,g.freeAim);assert.deepEqual(g.rawAim,g.freeAim);
        assert.equal(g.aimPick,null,'the old strafe hit result is not retained');
        assert.ok(camera.clear(camera.cam.position),'the translated camera remains out of solid voxels');
        g.setPeek(null);g.stepAim(0);
        assert.ok(camera.cam.quaternion.angleTo(quaternion)<1e-9,'returning home also preserves the viewing direction');
        g.moveAim(30,0);g.stepAim(1/60);
        assert.ok(camera.cam.quaternion.angleTo(quaternion)>1e-4,'the next mouse movement resumes normal camera turning');
    }
});
