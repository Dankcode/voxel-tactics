// An authored two-tile-radius corner. The diagonal modules share one analytic arc, never four unrelated fillets.
// The 2×2 footprint reserves every cell touched by its wall band; diagonal proximity alone never creates cover.
import { MAT, AIR } from './Materials.js';
const cache=new Map();
function clip(poly,axis,limit,keepGreater){
    const out=[],inside=p=>keepGreater?p[axis]>=limit-1e-9:p[axis]<=limit+1e-9;
    for(let i=0;i<poly.length;i++){
        const a=poly[i],b=poly[(i+1)%poly.length],ia=inside(a),ib=inside(b);
        if(ia)out.push(a);
        if(ia!==ib){const t=(limit-a[axis])/(b[axis]-a[axis]);out.push(a.map((v,j)=>j===axis?limit:v+(b[j]-v)*t));}
    }
    return out;
}
export function doubleCurveFootprint({turn=0,dx=0,dy=0,kind='wall'}){
    const key=`${turn}:${dx}:${dy}:${kind}`;if(cache.has(key))return cache.get(key);
    const points=[],radius=['floor','apron'].includes(kind)?2:1.7;
    for(let i=0;i<=32;i++){const a=Math.PI+i*Math.PI/64;points.push([2+radius*Math.cos(a),2+radius*Math.sin(a)]);}
    if(kind==='floor')points.push([2,2]);
    else if(kind==='apron')points.unshift([0,0]);
    else for(let i=32;i>=0;i--){const a=Math.PI+i*Math.PI/64;points.push([2+1.3*Math.cos(a),2+1.3*Math.sin(a)]);}
    let poly=points.map(([x,y])=>{for(let i=0;i<turn;i++)[x,y]=[2-y,x];return[x,y]});
    poly=clip(clip(clip(clip(poly,0,dx,true),0,dx+1,false),1,dy,true),1,dy+1,false);
    poly=poly.map(([x,y])=>[Math.max(0,Math.min(1,x-dx)),Math.max(0,Math.min(1,y-dy))]);
    // Clip intersections may repeat a vertex exactly; strip these before triangulation/ray tests.
    poly=poly.filter((p,i)=>Math.hypot(p[0]-poly[(i+1)%poly.length][0],p[1]-poly[(i+1)%poly.length][1])>1e-8);
    cache.set(key,poly);return poly;
}
export function curveCell(store,x,y,z){const spec=store.curveCells?.get(`${x},${y},${z}`);return spec&&store.get(x,y,z)===spec.material?spec:null;}
export const curvePiece=spec=>`double_curve_${spec.kind}_${spec.turn}_${spec.dx}_${spec.dy}`;
/** NW=0, NE=1, SE=2, SW=3. A floor module follows the same outer arc as its wall/cover. */
export function stampDoubleCurve(store,{x,y,z,turn=0,height=2,wall='concrete_wall',floor='concrete',underlay=null,preserveFloor=false}){
    if(!Number.isInteger(turn)||turn<0||turn>3||![x,y,z,height].every(Number.isInteger)||height<0||!MAT[wall]||!MAT[floor])throw Error('Invalid double-tile curve');
    if(!store.inBounds(x,y,z)||!store.inBounds(x+1,y+1,z+height))throw Error('Double-tile curve outside map');
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)for(let h=0;h<=height;h++){
        const kind=h===0?'floor':'wall',material=h===0&&preserveFloor?(store.get(x+dx,y+dy,z)||MAT[floor]):MAT[h===0?floor:wall],spec={turn,dx,dy,kind,material};
        if(h===0&&z===(store.datum??1))spec.underlay=underlay??store.curveCells.get(`${x+dx},${y+dy},${z}`)?.underlay??store.get(x+dx,y+dy,z)??MAT.concrete;
        const key=`${x+dx},${y+dy},${z+h}`,poly=doubleCurveFootprint(spec);
        store.set(x+dx,y+dy,z+h,poly.length>=3?material:AIR);
        if(poly.length>=3)store.curveCells.set(key,spec);else store.curveCells.delete(key);
        store.version++;
        store.markDirty(x+dx,y+dy,z+h);store.surfaceCache.delete(x+dx+(y+dy)*store.width);
        for(const cache of store.profileSurfaceCache.values())cache.delete(x+dx+(y+dy)*store.width);
    }
}

/** Opt-in building treatment; straight runs and interior partitions remain untouched. */
export function curveBuildingCorners(store,building,{wall=building.wall||'concrete_wall',floor='ceramic',roof='concrete',hints=null}={}){
    if(!building.rounded||building.w<5||building.d<5)return;
    const {x0,y0,w,d,baseZ,storeys}=building;
    for(let s=0;s<=storeys;s++)for(const [turn,x,y]of [[0,x0,y0],[1,x0+w-2,y0],[2,x0+w-2,y0+d-2],[3,x0,y0+d-2]]){
        // Never cut a doorway, stair step or landing out of an existing floor plan.
        const protectedCells=[...(building.doors||[]),...(building.stairs||[]).flatMap(run=>[run.before,...run.cells,run.after])].filter(Boolean);
        if(protectedCells.some(p=>p.x>=x&&p.x<x+2&&p.y>=y&&p.y<y+2))continue;
        stampDoubleCurve(store,{x,y,z:baseZ+s*3,turn,height:s===storeys?0:2,wall,floor:s===storeys?roof:floor,preserveFloor:true,underlay:s===0?store.get(turn===0||turn===3?x0-1:x0+w,turn<2?y0:y0+d-1,baseZ):null});
        if(hints)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)for(let h=0;h<=(s===storeys?0:2);h++){
            const key=`${x+dx},${y+dy},${baseZ+s*3+h}`;
            if(!store.get(x+dx,y+dy,baseZ+s*3+h))delete hints[key];
        }
    }
}

/** Round paved inside corners at road junctions. Asphalt remains continuous underneath the raised curb. */
export function roundRoadCorners(store,{z=store.datum??1,blocked=()=>false}={}){
 const road=(x,y)=>[MAT.asphalt,MAT.road_mark].includes(store.get(x,y,z));
 const paved=(x,y)=>[MAT.concrete,MAT.paving].includes(store.get(x,y,z));
 const used=new Set();let count=0;
 for(let y=1;y<store.depth-2;y++)for(let x=1;x<store.width-2;x++){
  if(![0,1,2,3].every(i=>paved(x+i%2,y+(i>>1))&&!blocked(x+i%2,y+(i>>1))&&!used.has(`${x+i%2},${y+(i>>1)}`)))continue;
  for(let turn=0;turn<4;turn++){
   const west=turn===0||turn===3,north=turn<2;
   if(![0,1].every(i=>road(west?x-1:x+2,y+i)&&road(x+i,north?y-1:y+2)))continue;
   const floor=store.get(x,y,z)===MAT.paving?'paving':'concrete';
   stampDoubleCurve(store,{x,y,z,turn,height:0,floor,underlay:MAT.asphalt});
   for(let i=0;i<4;i++)used.add(`${x+i%2},${y+(i>>1)}`);count++;break;
  }
 }
 return count;
}
