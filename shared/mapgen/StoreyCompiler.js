import { compileFireEscape } from './FireEscape.js';
// The floor graph, shell and vertical circulation all compile into the same collision/cover matrix.
import { MAT, AIR } from '../voxel/Materials.js';
import { createStairRun } from '../world/StairRun.js';
import { furnish } from '../mission/modern/ModernBuilder.js';
import { createRng, hashString } from '../util/Rng.js';
const key=(x,y)=>`${x},${y}`;

export function compileBuilding(m,b) {
    const {store,ctx}=m,{x0,y0,w,d,storeys}=b,top=m.G+3*storeys;
    if(storeys<1||storeys>4||b.floors.length!==storeys)throw Error('compile.storeys: requires all 1–4 floor layouts');
    const out={id:b.id,name:b.id,program:b.program,role:b.program,x0,y0,w,d,baseZ:m.G,top,storeys,front:b.front,wall:'stucco',rooms:[],doors:[],windows:[],stairs:[],escapes:[],approach:[],exits:[]};
    const world=([x,y])=>[x+x0,y+y0];
    for(let y=y0;y<y0+d;y++)for(let x=x0;x<x0+w;x++) {
        for(let z=m.G;z<=top+2;z++)store.set(x,y,z,AIR);
        for(let s=0;s<=storeys;s++) {
            const fz=m.G+s*3;store.set(x,y,fz,s===storeys?MAT.concrete:MAT.oak_floor);
            if(s<storeys&&(x===x0||y===y0||x===x0+w-1||y===y0+d-1))for(let h=1;h<=2;h++)store.set(x,y,fz+h,MAT.stucco);
        }
    }
    for(const f of b.floors) {
        const fz=m.G+3*f.floor;
        for(const [x,y] of f.walls.map(world))for(let h=1;h<=2;h++)store.set(x,y,fz+h,MAT.stucco);
        for(const r of f.rooms) {
            const rec={id:ctx.nextRoomId(),buildingId:b.id,storey:f.floor,kind:r.kind,gameplay:r.gameplay!==false,cells:r.cells.map(world),floorZ:fz,lit:true,doors:[]};
            for(const [x,y] of rec.cells) {
                for(let h=1;h<=2;h++)store.rooms[store.index(x,y,fz+h)]=rec.id;
                if(['bathroom','restroom','kitchen','utility'].includes(r.kind))store.set(x,y,fz,MAT.ceramic);
            }
            out.rooms.push(rec);ctx.rooms.push(rec);
        }
        for(const door of f.doors) {
            const x=x0+door.x,y=y0+door.y;
            for(let h=1;h<=2;h++)store.set(x,y,fz+h,door.locked?MAT.door_locked:MAT.door);
            out.doors.push({x,y,z:fz,storey:f.floor,locked:door.locked,exterior:false});
        }
        for(const panel of b.facade)if(panel.kind==='window') {
            const x=x0+panel.x,y=y0+panel.y;store.set(x,y,fz+2,MAT.glass);
            out.windows.push({x,y,z:fz+2,storey:f.floor});
        }
    }
    const doorAt=(x,y,floor,side)=> {
        const z=m.G+3*floor;for(let h=1;h<=2;h++)store.set(x,y,z+h,MAT.door);
        const rec={x,y,z,storey:floor,side,exterior:true};out.doors.push(rec);return rec;
    };
    const mid=b.floors[0].core.mid;
    for(const [x,side,dx] of [[x0,'w',-1],[x0+w-1,'e',1]]) {
        const e=doorAt(x,y0+mid,0,side);out.exits.push(e);out.approach.push([x+dx,e.y],[x+2*dx,e.y]);
        m.reserve(x+Math.min(0,2*dx),e.y-1,x+Math.max(0,2*dx),e.y+1);
    }
    out.entry=out.exits[0];
    const hallSet=new Set(b.floors[0].rooms.find(r=>r.kind==='hall').cells.map(c=>key(...world(c))));
    // Alternating parallel runs make a compact switchback core; upper holes never eat the next flight.
    for(let s=0;s<storeys-1;s++) {
        const fz=m.G+3*s,even=s%2===0;
        const run=createStairRun({origin:{x:x0+(even?2:4),y:y0+mid+(even?-1:1)},direction:even?'east':'west',rise:3,baseZ:fz,footprintSet:hallSet});
        if(!run)throw Error(`compile.stairs: ${b.id} floor ${s} cannot fit core`);
        for(const c of [run.before,run.cells[0],run.cells[1]])store.set(c.x,c.y,fz+3,AIR);
        for(const c of run.cells) {
            for(let z=fz+1;z<=c.z;z++)store.set(c.x,c.y,z,MAT.stairs_stone);
            for(let h=1;h<=2;h++)store.set(c.x,c.y,c.z+h,AIR);
        }
        out.stairs.push({storey:s,...run});
    }
    for(let y=y0;y<y0+d;y++)for(let x=x0;x<x0+w;x++)if(x===x0||x===x0+w-1||y===y0||y===y0+d-1)store.set(x,y,top+1,MAT.stucco);
    compileFireEscape(m,{...b,...out,floors:b.floors},doorAt);
    if(storeys===1) {
        store.set(x0,y0+1,top+1,AIR);
        out.roofAccess=m.ladder(x0-1,y0+1,1,0);
    }
    for(const f of b.floors) {
        const rooms=out.rooms.filter(r=>r.storey===f.floor),floorSet=new Set(rooms.filter(r=>r.gameplay).flatMap(r=>r.cells.map(c=>key(...c))));
        const keepFree=new Set(rooms.find(r=>r.kind==='hall').cells.map(c=>key(...c))),obstacles=new Set();
        for(const dr of out.doors.filter(dr=>dr.storey===f.floor&&!dr.locked)) {
            floorSet.add(key(dr.x,dr.y));
            for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)keepFree.add(key(dr.x+dx,dr.y+dy));
        }
        for(const run of out.stairs)if(run.storey===f.floor||run.storey===f.floor-1)for(const c of [run.before,...run.cells,run.after]){keepFree.add(key(c.x,c.y));obstacles.add(key(c.x,c.y));}
        furnish(store,{floorSet,rooms,fz:m.G+3*f.floor,keepFree,obstacles,rng:createRng(hashString(`${m.id}:${m.seed}:${b.id}:${f.floor}`)),hints:ctx.hints,decor:ctx.decor,wfc:true});
    }
    out.floorCells=out.rooms.filter(r=>r.storey===0&&r.gameplay).flatMap(r=>r.cells);
    m.buildings.push(out);return out;
}
