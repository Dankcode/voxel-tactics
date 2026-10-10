import { MAT } from '../voxel/Materials.js';
import { validateLadders } from '../world/LadderAttachment.js';
/** A single supported facade structure. Three-cell flights alternate between two 3×2 platforms. */
export function compileFireEscape(m,b,doorAt) {
 if(b.storeys<2)return;
 const s=m.store,x=b.x0+b.w,a=b.y0+b.floors[0].core.mid-3,c=a+5,base=m.G;
 if(x+3>=s.width||a<1||c+2>=s.depth)throw Error(`escape.bounds: ${b.id}`);
 const posts=[[x+3,a],[x+3,c+1]],members=[];
 for(const [px,py] of posts)for(let z=base+1;z<=b.top;z++)s.set(px,py,z,MAT.steel_post);
 for(let floor=1;floor<=b.storeys;floor++) {
  const y=floor%2?a:c,z=base+3*floor,platform=[];
  for(let dx=0;dx<3;dx++)for(let dy=0;dy<2;dy++){s.set(x+dx,y+dy,z,MAT.grate);platform.push([x+dx,y+dy,z]);members.push([x+dx,y+dy,z]);}
  // Two outer posts and wall brackets tie the structure to the facade.
  s.set(x+3,y,z,MAT.steel_post);s.set(x,y,z-1,MAT.steel_post);
  for(let dy=0;dy<2;dy++)s.set(x+3,y+dy,z+1,MAT.railing);
  for(let py=a;py<=c+1;py++){s.set(x,py,z,MAT.grate);members.push([x,py,z]);}
  const dy=b.y0+b.floors[0].core.mid;
  if(floor<b.storeys)doorAt(x-1,dy,floor,'e');else {s.set(x-1,dy,z+1,0);s.set(x-1,dy,z+2,0);}
  b.escapes.push({floor,toRoof:floor===b.storeys,foot:{x:x+1,y:a-1,z:base},landing:{x,y,z},platform});
  if(floor<b.storeys) {
   const sign=floor%2?1:-1,start=floor%2?a+1:c;
   for(let k=1;k<=3;k++) {
    const dx=floor%2?1:2;
    const py=start+sign*k,h=z+k;
    s.set(x+dx,py,h,MAT.steel_stair);members.push([x+dx,py,h]);
    for(let q=1;q<=2;q++)s.set(x+dx,py,h+q,0);
   }
  }
 }
 // Attached drop ladder: the first landing edge supplies the backing column.
 for(let z=base+1;z<base+3;z++)s.set(x+1,a,z,MAT.steel_post);
 for(let z=base+1;z<=base+3;z++)s.set(x+1,a-1,z,MAT.ladder);
 m.reserve(x-1,a-3,x+4,c+3);
 // Connectivity alone would keep a platform attached to a door even after its stand was destroyed.
 // Explicit stand dependencies make losing both ground posts drop the complete escape, not the building.
 (s.supportGroups??=[]).push({posts:posts.map(([px,py])=>[px,py,base+1]),members});
 validateLadders(s);
}
