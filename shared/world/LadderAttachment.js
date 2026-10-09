import { MAT } from '../voxel/Materials.js';
const DIRS=[[1,0],[0,1],[-1,0],[0,-1]];
/** One fixed backing side for the complete connected column, also used by the renderer. */
export function ladderAttachment(store,x,y,z) {
    if(store.get(x,y,z)!==MAT.ladder)return null;
    let lo=z,hi=z;while(store.get(x,y,lo-1)===MAT.ladder)lo--;while(store.get(x,y,hi+1)===MAT.ladder)hi++;
    return DIRS.find(([dx,dy])=>{for(let h=lo;h<=hi;h++)if(!store.isSolid(x+dx,y+dy,h))return false;return true;})||null;
}
export function validateLadders(store) {
    for(let z=0;z<store.height;z++)for(let y=0;y<store.depth;y++)for(let x=0;x<store.width;x++)if(store.get(x,y,z)===MAT.ladder&&store.get(x,y,z-1)!==MAT.ladder&&!ladderAttachment(store,x,y,z))throw Error(`ladder.attachment: unsupported column ${x},${y},${z}`);
    return true;
}
