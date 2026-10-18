import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../Game.js';
import { AimController } from '../../ui/AimController.js';

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

test('aim entry selects an available target, otherwise provides a free aim point; Tab rechecks available targets',()=>{
    const g=aimingGame(),targets=[{id:'e1'},{id:'e2'}];let focused;
    g.targetsFor=()=>targets;g.aimPointer.request=()=>{};
    g.aimAt=(u,target,part,opts)=>{focused={target,part,opts};};
    g.enterTargeting();assert.equal(focused.target.id,'e1');assert.equal(focused.opts.frame,true);
    g.targetInfo={target:targets[0],part:'head'};g.cycleTarget();
    assert.equal(focused.target.id,'e2');assert.equal(focused.part,'head');
    g.targetsFor=()=>[];g.frameAim=(u,p)=>{focused={point:p};};g.enterTargeting();
    assert.ok(g.freeAimManual);assert.deepEqual(focused.point,g.aim.current);assert.equal(g.targets.length,0);
});
