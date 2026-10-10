import { MAT } from '../voxel/Materials.js';
import { validateLadders } from '../world/LadderAttachment.js';
/** Facade-mounted metal landings, with alternating attached ladders between each storey. */
export function compileFireEscape(m,b,doorAt) {
 if(b.storeys<2)return;
 const s=m.store,x=b.x0+b.w,mid=b.y0+b.floors[0].core.mid,base=m.G;
 if(x+3>=s.width||mid-2<1||mid+2>=s.depth)throw Error(`escape.bounds: ${b.id}`);
 const members=[],anchors=[];
 for(let floor=1;floor<=b.storeys;floor++) {
  const z=base+3*floor,platform=[];
  for(let dx=0;dx<3;dx++)for(let dy=-1;dy<=1;dy++) {
   const p=[x+dx,mid+dy,z];s.set(...p,MAT.grate);platform.push(p);members.push(p);
   if(dx===0)anchors.push([x-1,mid+dy,z]);
  }
  // Low outer rail leaves both ladder sockets and the facade doorway open.
  for(let dy=-1;dy<=1;dy++){const p=[x+2,mid+dy,z+1];s.set(...p,MAT.railing);members.push(p);}
  if(floor<b.storeys)doorAt(x-1,mid,floor,'e');
  else {s.set(x-1,mid,z+1,0);s.set(x-1,mid,z+2,0);}
  const y=mid+(floor%2?-2:2),fromZ=z-3;
  b.escapes.push({floor,toRoof:floor===b.storeys,foot:{x,y,z:fromZ},landing:{x,y:mid+(floor%2?-1:1),z},platform,ladder:{x,y,fromZ,toZ:z}});
 }
 // Alternating sockets keep runs separate, allowing PathSearch to stop at every floor.
 for(const e of b.escapes) {
  const {x,y,fromZ,toZ}=e.ladder;
  if(e.floor>1){const p=[x,y,fromZ];s.set(...p,MAT.grate);members.push(p);b.escapes[e.floor-2].platform.push(p);}
  for(let z=fromZ+1;z<=toZ;z++){s.set(x,y,z,MAT.ladder);members.push([x,y,z]);anchors.push([x-1,y,z]);}
 }
 m.reserve(x-1,mid-4,x+4,mid+4);
 // The floor slabs and continuous wall backing carry the landings; no free-standing stair tower.
 (s.supportGroups??=[]).push({posts:[],anchors,members});
 validateLadders(s);
}
