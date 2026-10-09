import { solveWaveFunctionCollapse } from '../generation/WaveFunctionCollapse.js';
const key=(x,y)=>`${x},${y}`;
export function solveFloor(b,program,prior={},seed=1,tolerance=0.25) {
    const {w,d}=b,mid=Math.floor(d/2),hall=[];
    for(let y=mid-1;y<=mid+1;y++)for(let x=1;x<w-1;x++)hall.push([x,y]);
    const rooms=program.rooms;
    if(!Array.isArray(rooms)||rooms.length<2||rooms.length>8)throw Error('floor.program: requires 2–8 room regions plus circulation');
    const bays=[],walls=[];
    for(const y of [mid-2,mid+2])for(let x=1;x<w-1;x++)walls.push([x,y]);
    for(let row=0;row<2;row++) {
        const count=row===0?Math.ceil(rooms.length/2):Math.floor(rooms.length/2),y0=row===0?1:mid+3,y1=row===0?mid-3:d-2;
        const total=w-2-(count-1);let x0=1;
        for(let col=0;col<count;col++) {
            const width=Math.floor(total/count)+(col<total%count?1:0),x1=x0+width-1,cells=[];
            if(width<2||y1-y0+1<2)throw Error(`floor.area: ${b.id} footprint cannot fit programme`);
            for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)cells.push([x,y]);
            bays.push({cells,x0,x1,y0,y1,row,col});
            if(col<count-1)for(let y=y0;y<=y1;y++)walls.push([x1+1,y]);
            x0=x1+2;
        }
    }
    const bayByCell=new Map(bays.flatMap((bay,i)=>bay.cells.map(c=>[key(...c),i]))),nodes=[],domains=new Map(),weights=new Map();
    const area=bays.reduce((n,bay)=>n+bay.cells.length,0),sum=rooms.reduce((n,r)=>n+(r.areaShare||1),0);
    for(const [i,bay] of bays.entries()) for(const [x,y] of bay.cells) {
        const id=key(x,y),neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(c=>bayByCell.get(key(...c))===i).map(c=>({id:key(...c),direction:'same'}));
        if(id===key(...bay.cells[0]))for(let j=0;j<bays.length;j++)if(j!==i)neighbors.push({id:key(...bays[j].cells[0]),direction:`different:${i}:${j}`});
        nodes.push({id,neighbors});
        const allowed=rooms.filter(r=>Math.abs(bay.cells.length/area-(r.areaShare||1)/sum)<=((r.areaShare||1)/sum)*tolerance).map(r=>r.id);
        if(!allowed.length) {if(tolerance===0.25)return solveFloor(b,program,prior,seed,0.4);throw Error(`floor.area: no room fits bay ${i} within repaired ±40% area tolerance`);}
        domains.set(id,allowed);
        const center=[(bay.x0+bay.x1)/2/w,(bay.y0+bay.y1)/2/d];
        weights.set(id,Object.fromEntries(rooms.map(r=>{const p=prior.rooms?.find(p=>p.kind===r.kind),cx=p?.center?.[0]??0.5,cy=p?.center?.[1]??0.5;return[r.id,p?1/(0.05+Math.hypot(center[0]-cx,center[1]-cy)):1];})));
    }
    const required=(program.adjacencies||[]).filter(([a,c])=>a!=='hall'&&c!=='hall');
    let assignment;
    try {assignment=solveWaveFunctionCollapse({nodes,tiles:rooms.map(r=>({id:r.id,weight:1})),domains,nodeWeights:(nodeId,tileId)=>weights.get(nodeId)?.[tileId],seed:`${b.id}:floor:${program.floor}:${seed}`,compatible:(a,c,direction)=> {
        if(direction==='same')return a===c;
        if(a===c)return false;
        const [,i,j]=direction.split(':').map(Number),touch=bays[i].row===bays[j].row&&Math.abs(bays[i].col-bays[j].col)===1;
        return touch||!required.some(([u,v])=>u===a&&v===c||u===c&&v===a);
    }});}catch(error){if(tolerance===0.25)return solveFloor(b,program,prior,seed,0.4);throw Error(`floor.constraints: ${b.id}/${program.floor}: ${error.message}`);}
    const regions=bays.map(bay=>({...bay,...rooms.find(r=>r.id===assignment.get(key(...bay.cells[0])))}));
    const doors=[];
    for(const r of regions) {
        const y=r.row===0?mid-2:mid+2;
        doors.push({x:Math.floor((r.x0+r.x1)/2),y,room:r.id,locked:r.gameplay===false});
        if(r.gameplay!==false&&r.x1-r.x0>=3)doors.push({x:r.x1-1,y,room:r.id,locked:false});
    }
    for(const [a,c] of program.adjacencies || []) {
        if(a==='hall'||c==='hall')continue;
        const ra=regions.find(r=>r.id===a),rb=regions.find(r=>r.id===c);
        if(!ra||!rb||ra.row!==rb.row||Math.abs(ra.col-rb.col)!==1)throw Error(`floor.adjacency: ${a} must touch ${c}`);
        const left=ra.col<rb.col?ra:rb;
        doors.push({x:left.x1+1,y:Math.floor((left.y0+left.y1)/2),room:a,other:c,locked:ra.gameplay===false||rb.gameplay===false});
    }
    return {floor:program.floor,rooms:[{id:'hall',kind:'hall',gameplay:true,cells:hall},...regions],walls,doors,core:{mid,x:2},areaTolerance:tolerance,repairs:tolerance===0.4?[{kind:'relax-room-area',from:0.25,to:0.4}]:[]};
}
