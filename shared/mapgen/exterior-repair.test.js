import test from 'node:test';
import assert from 'node:assert/strict';
import {Field} from './Fields.js';
import {classifyBays,solveBays} from './ExteriorSolver.js';
function solve(protectedCells=new Set(),pin=true) {
    const plot={family:'downtown',LW:1,LD:1,W:8,D:8,lots:[{lx:0,ly:0,x0:0,y0:0}]};
    const ground={cls:new Array(64).fill('carriageway'),mat:new Array(64).fill('asphalt')};
    const bayGrid=classifyBays(8,8,ground,()=>false,protectedCells);
    const field=new Field(8,8,5),prior=new Field(8,8,1);
    return solveBays({plot,bayGrid,lotPool:()=> 'carriageway',roadAxis:()=> 'x',fields:{play:{dist:field,flank:field},prior:{green:prior,paved:prior}},seed:1,pins:pin?new Map([['2,2','jersey_n']]):new Map(),objectiveAt:{x:7,y:7}});
}
test('a physically compatible cover repair is honored even when its decorative pool is open-only',()=>{
    assert.equal(solve(new Set(),false).get('2,2'),'open');assert.equal(solve().get('2,2'),'jersey_n');
});
test('a corrective cover pin cannot override a protected circulation cell',()=>{
    assert.notEqual(solve(new Set(['4,4','5,4','4,5','5,5'])).get('2,2'),'jersey_n');
});
