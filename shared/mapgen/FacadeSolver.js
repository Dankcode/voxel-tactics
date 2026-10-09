import { solveFacadeWave } from '../generation/WaveFunctionCollapse.js';

export function solveFacade(b, floors, seed) {
    const slots=[];
    for(let x=0;x<b.w;x++)slots.push({x,y:0});
    for(let y=1;y<b.d;y++)slots.push({x:b.w-1,y});
    for(let x=b.w-2;x>=0;x--)slots.push({x,y:b.d-1});
    for(let y=b.d-2;y>0;y--)slots.push({x:0,y});
    slots.forEach((s,i)=>{s.id=String(i);s.neighbors=[String((i+slots.length-1)%slots.length),String((i+1)%slots.length)];});
    // One wave across the facade keeps vertical window stacks aligned. A service room on any floor closes its stack.
    const fixedWalls=slots.filter(({x,y})=> {
        if((x===0||x===b.w-1)&&(y===0||y===b.d-1))return true;
        const ix=x===0?1:x===b.w-1?b.w-2:x,iy=y===0?1:y===b.d-1?b.d-2:y;
        return floors.some(f=>!f.rooms.some(r=>r.gameplay!==false&&r.cells.some(([a,c])=>a===ix&&c===iy)));
    }).map(s=>s.id);
    const wave=solveFacadeWave({slots,fixedWalls,seed:`${b.id}:facade:${seed}`});
    return slots.map(s=>({x:s.x,y:s.y,kind:wave.get(s.id)}));
}
