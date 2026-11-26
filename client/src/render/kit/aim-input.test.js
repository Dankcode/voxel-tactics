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
        setLevel(top){this.cutLevel=top;},
        aim:new AimController(),aimPointer:{locked:true,unavailable:false},
    });
    g.aim.snap({x:10,y:.5,h:2.35});g.freeAim={...g.aim.current};return g;
}

test('direct-cursor hover steers aim on canvas, ignores HUD elements, and right-drag orbits camera',()=>{
    const g=aimingGame();const pointed=[],orbited=[];
    g.aimFromPointer=(x,y)=>pointed.push([x,y]);
    g.cameraDirector.orbitAim=(dx,dy)=>orbited.push([dx,dy]);
    g.onHover({clientX:640,clientY:360});
    assert.deepEqual(pointed,[[640,360]]);
    g.onHover({clientX:1200,clientY:680,target:{closest:sel=>sel==='#hud > *'?{}:null}});
    assert.equal(pointed.length,1,'moving over HUD widgets does not steer aim');
    g.orbitDrag={sx:640,sy:360,x:640,y:360,moved:false};
    g.onHover({clientX:660,clientY:350});
    assert.deepEqual(orbited,[[20,-10]]);
    assert.equal(g.orbitDrag.moved,true);
});

test('first click in shoot mode fires immediately at current aim point while drag release never fires',()=>{
    const g=aimingGame();let shot;
    g.intent=p=>{shot=p;};
    g.dragging={moved:true};
    g.onClick({clientX:100,clientY:100});
    assert.equal(shot,undefined,'drag release never fires');
    g.dragging=null;g.aim.setTarget({x:20,y:5,h:1});
    g.onClick({clientX:100,clientY:100});
    assert.deepEqual(shot.aim.point,g.freeAim,'direct click fires the active reticle point without capture');
});

test('aim entry auto-frames visible hostiles and falls back to soldier facing when none are visible',()=>{
    const g=aimingGame(),u=g.selectedUnit();u.facing='e';let framed;
    g.frameAim=(unit,p)=>{framed={...p};};
    const enemy={id:'e0',x:12,y:2,z:0,parts:{torso:{}}};
    g.visibleTargets=()=>[enemy];g.battle.unit=id=>id===enemy.id?enemy:null;g.views=new Map();
    g.enterTargeting();
    assert.equal(g.framedTargetId,'e0');assert.equal(g.aimPick?.unitId,'e0');
    g.visibleTargets=()=>[];g.aimPick=null;g.framedTargetId=null;
    g.enterTargeting();
    assert.deepEqual(framed,g.aim.current);
    assert.deepEqual(framed,{x:8.5,y:.5,h:u.z+2.1});assert.equal(g.aimPick,null);
});

test('aim entry supports diagonal soldier facing',()=>{
    const g=aimingGame(),u=g.selectedUnit();u.facing='nw';let framed;
    g.aimPointer.request=()=>{};g.frameAim=(unit,p)=>{framed={...p};};
    g.scene.camera={getWorldDirection:()=>{throw Error('aim entry must not use the tactical camera');}};
    g.enterTargeting();
    assert.ok(Math.abs(framed.x-(.5-8/Math.sqrt(2)))<1e-9);assert.ok(Math.abs(framed.y-(.5-8/Math.sqrt(2)))<1e-9);assert.equal(framed.h,u.z+2.1);
});

test('suppression fires only at the unit passively detected under the reticle',()=>{
    const g=aimingGame(),target={id:'e1',side:'enemy'};let intent,toast;
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

test('the displayed centre trace reaches beyond the steering point and real shot projectiles disperse inside the cone', () => {
    const store = new VoxelStore(48,8,8);
    store.fill(0,0,0,47,7,0,MAT.bedrock);
    const battle = new Battle({mission:{id:'aim-range',store,rooms:[],buildings:[],spawns:{
        player:[{x:2,y:3,z:0}],enemy:[{type:'cultist',pos:{x:24,y:3,z:0},group:0}]
    }},squad:[{type:'grenadier'}],seed:2});
    const g = aimingGame(), u = battle.unit('p0');
    Object.assign(g,{battle,selectedUnit:()=>u,isVisible:()=>true});
    const point = {x:10.5,y:3.5,h:2.35};
    const muzzle = g.aimMuzzle(u,point);
    g.updateAimPick(u,muzzle,point);
    const aim = {point};
    const events = battle.apply({type:'shoot',unitId:u.id,weaponId:g.mode.weaponId,aim,by:'*'}).events;
    const shot = events.find(e=>e.t==='shot');
    assert.ok(g.aimTrace.t>18);
    assert.equal(g.aimPick.unitId,'e0');
    assert.equal(shot.projectiles.length,3);
    for (const pr of shot.projectiles) {
        const d=[pr.to.x-shot.muzzle.x,pr.to.y-shot.muzzle.y,pr.to.h-shot.muzzle.h];
        const a=[point.x-shot.muzzle.x,point.y-shot.muzzle.y,point.h-shot.muzzle.h];
        const cos=(d[0]*a[0]+d[1]*a[1]+d[2]*a[2])/(Math.hypot(...d)*Math.hypot(...a));
        assert.ok(Math.acos(Math.min(1,cos))*180/Math.PI <= 4, 'projectile stays within burst cone');
    }
    assert.ok(events.findIndex(e=>e.t==='damage')>events.indexOf(shot));
});

test('left and right peeks keep the reticle on the same target and use the authoritative muzzle',async()=>{
    const {CameraDirector}=await import('../../anim/CameraDirector.js');
    const {chooseMuzzle,occupiedBy,traceProjectile}=await import('../../../../shared/battle/Ballistics.js');
    const THREE=await import('three');
    for(const cell of [{x:11,y:20,z:1},{x:9,y:20,z:1}]){
        const store=new VoxelStore(40,40,10);
        for(let y=0;y<40;y++)for(let x=0;x<40;x++){store.set(x,y,0,MAT.bedrock);store.set(x,y,1,MAT.grass);}
        const battle=new Battle({mission:{id:'peek-aim',store,rooms:[],buildings:[],spawns:{player:[{x:10,y:20,z:1}],enemy:[{type:'cultist',pos:{x:10,y:8,z:1},group:0}]}},squad:[{type:'grenadier'}],seed:2});
        const g=aimingGame(),u=battle.unit('p0'),enemy=battle.unit('e0'),camera=new CameraDirector({aspect:16/9});camera.store=store;
        Object.assign(g,{battle,selectedUnit:()=>u,isVisible:()=>true,peek:null,views:new Map(),cutins:{beginAim(){}},cameraDirector:camera,hud:{equipment:{open:false},renderTarget(){}},focusFloor(){}});
        const p={x:enemy.x+.5,y:enemy.y+.5,h:enemy.z+2.02};g.freeAim={...p};g.aim.snap(p);g.rawAim={...p};g.frameAim(u,p);
        camera.track(new THREE.Vector3(p.x,p.h,p.y),1/60);
        const quaternion=camera.cam.quaternion.clone();
        g.aim.vel=[.2,-.1,.3];g.setPeek(cell);
        assert.deepEqual(g.aim.vel,[.2,-.1,.3],'translation does not change the aim spring velocity');
        g.stepAim(0);
        assert.deepEqual(g.freeAim,p,'the world aim point does not slide off the target');
        assert.deepEqual(g.aim.target,p);assert.deepEqual(g.rawAim,p);
        assert.equal(g.aimPick?.unitId,enemy.id,'hit detection is refreshed from the new muzzle');
        const shooter={...u,...cell},muzzle=chooseMuzzle(store,shooter,p,{occupied:occupiedBy(battle,u)});
        assert.deepEqual(g.aimOrigin(u),muzzle,'the preview and submitted shot use the same origin');
        const d=[p.x-muzzle.x,p.y-muzzle.y,p.h-muzzle.h],length=Math.hypot(...d);
        assert.equal(traceProjectile(battle,muzzle,d.map(v=>v/length),length+1,{ignore:u.id}).unit?.id,enemy.id);
        assert.ok(camera.cam.quaternion.angleTo(quaternion)<1e-9,'the camera translates without rotating');
        assert.ok(camera.clear(camera.cam.position),'the translated camera remains out of solid voxels');
        g.setPeek(null);g.stepAim(0);
        assert.deepEqual(g.freeAim,p,'returning home keeps the same target');
        assert.ok(camera.cam.quaternion.angleTo(quaternion)<1e-9,'returning home also preserves the viewing direction');
        g.moveAim(30,0);g.stepAim(1/60);
        assert.ok(camera.cam.quaternion.angleTo(quaternion)<1e-9,'reticle aim steady-cam avoids unwanted spin loops');
        camera.orbitAim(30,0);
        assert.ok(camera.cam.quaternion.angleTo(quaternion)>1e-4,'explicit orbit rotates the shoulder camera');
    }
});

test('rapid clicks submit only one shot while the first action is pending',async()=>{
    const g=aimingGame(),unit=g.selectedUnit(),submissions=[];
    let resolveSubmit;
    Object.assign(g,{
        battle:{outcome:false,activeSide:'player',shotAp:()=>1},
        actionPending:false,
        session:{local:true,playerId:'player',submit:intent=>{submissions.push(intent);return new Promise(resolve=>{resolveSubmit=resolve;});}},
        player:{idle:()=>true,enqueue:()=>{},whenIdle:()=>Promise.resolve()},
        overlays:{clearRange(){},clearPath(){},showCover(){}},
        hud:{cursorTip(){},toast(){},refresh(){}},
        views:new Map(),cameraDirector:{},options:{autoNext:false},aiRunning:false,
        canAct:Game.prototype.canAct,
    });
    unit.ap=0;g.setMode=()=>{};
    const first=g.confirmFire(),second=g.confirmFire();
    assert.equal(submissions.length,1,'the second click is rejected before the first submission resolves');
    assert.ok(g.actionPending);assert.equal(g.canAct(),false);
    resolveSubmit({ok:true,events:[]});await first;await second;
    assert.equal(g.actionPending,false);
});

test('shooting renders the complete map without reticle-driven floor cuts',()=>{
    const g=aimingGame(),u=g.selectedUnit(),levels=[];
    u.z=1;u.facing='e';
    Object.assign(g,{
        battle:{mission:{meta:{streetDatum:1},buildings:[{x0:0,y0:0,w:8,d:8,storeys:2}]}},
        options:{buildingView:'auto'},levelLocked:false,cutLevel:4,
        setLevel(top){levels.push(top);this.cutLevel=top;},
        frameAim(){},aimPointer:{request(){},unavailable:true},
    });
    g.enterTargeting();assert.equal(g.cutLevel,Infinity);
    g.focusFloor=()=>{throw Error('aim tracking must not cut map floors');};
    g.aimMuzzle=()=>({x:u.x+.5,y:u.y+.5,h:u.z+2.35});g.updateAimPick=()=>{};
    g.cameraDirector={phase:null};g.views=new Map();g.cutins={beginAim(){}};
    g.stepAim(0);assert.deepEqual(levels,[Infinity]);
});

test('aimMuzzle respects manual peek vs auto step-out, aimAtPart updates origin first, and bestTargetPart picks exposed limbs', async () => {
    const { CameraDirector } = await import('../../anim/CameraDirector.js');
    const THREE = await import('three');
    const store = new VoxelStore(32, 32, 10);
    store.fill(0, 0, 0, 31, 31, 0, 'grass');
    store.fill(0, 12, 1, 31, 16, 1, 'concrete');
    // Cover wall blocking p0=(10,20,z=0) straight ahead except via step-out to (11,20,z=0); half cover in front of elevated e0=(9,14,z=1) blocks torso while leaving head exposed.
    store.fill(8, 19, 1, 10, 19, 3, 'concrete');
    store.fill(8, 15, 2, 10, 15, 2, 'concrete');
    const battle = new Battle({ mission: { id: 'peek-best', store, rooms: [], buildings: [], spawns: { player: [{ x: 10, y: 20, z: 0 }], enemy: [{ type: 'cultist', pos: { x: 9, y: 14, z: 1 }, group: 0 }] } }, squad: [{ type: 'grenadier' }], seed: 2 });
    const g = aimingGame(), u = battle.unit('p0'), enemy = battle.unit('e0');
    const camera = new CameraDirector({ aspect: 16 / 9 }); camera.store = store;
    Object.assign(g, { battle, selectedUnit: () => u, isVisible: () => true, peek: null, views: new Map(), cutins: { beginAim() {} }, cameraDirector: camera, hud: { equipment: { open: false }, renderTarget() {}, renderTargets() {} }, focusFloor() {} });

    // auto step-out when peek is null, suppressed when manual peek is active
    const targetPt = { x: enemy.x + 0.5, y: enemy.y + 0.5, h: enemy.z + 2.53 };
    assert.deepEqual(g.aimMuzzle(u, targetPt).step, { x: 11, y: 20, z: 0 });
    g.peek = { x: 10, y: 20, z: 0 };
    assert.equal(g.aimMuzzle(u, targetPt).step, undefined);
    g.peek = null;

    // bestTargetPart picks exposed head when torso behind half cover is blocked
    const chosen = g.bestTargetPart(u, enemy);
    assert.equal(chosen.part, 'head');

    // frameAim smoothly translates an already-following shoulder camera without rotating when stance key changes
    g.framedTargetId = enemy.id;
    const openLook = { x: 12.5, y: 14.5, h: 2.35 };
    g.frameAim(u, openLook);
    camera.track(new THREE.Vector3(openLook.x, openLook.h, openLook.y), 1 / 60);
    const q0 = camera.cam.quaternion.clone();
    const pos0 = camera.cam.position.clone();
    g.aimAtPart('head');
    assert.equal(g.aimOrigin(u).x, 11.5);
    assert.equal(g.aimPick?.unitId, enemy.id);
    assert.ok(camera.cam.quaternion.angleTo(q0) < 1e-6, 'step-out preserves viewing direction');
    assert.ok(camera.cam.position.distanceTo(pos0) > 0.1, 'camera translates to step-out stance');
});
