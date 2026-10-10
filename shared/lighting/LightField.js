import { CHUNK } from '../voxel/VoxelStore.js';
import { materialById } from '../voxel/Materials.js';
const DIRS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const chunk=(x,y,z)=>`${Math.floor(x/CHUNK)},${Math.floor(y/CHUNK)},${Math.floor(z/CHUNK)}`;
/** Integer maximum-light propagation, radius eight. Shared by rules and both rendering paths. */
export class LightField {
 constructor(store,{timeOfDay='day',decor=[],fires=null}={}) {
  this.store=store;this.timeOfDay=timeOfDay;this.decor=decor;this.fires=fires;this.values=new Uint8Array(store.mat.length);this.sources=new Map();this.dirty=new Set();this.fireSignature='';
  for(let z=0;z<store.height;z++)for(let y=0;y<store.depth;y++)for(let x=0;x<store.width;x++){const light=store.material(x,y,z).light;if(light)this.sources.set(`${x},${y},${z}`,light);this.dirty.add(chunk(x,y,z));}
  this.listener=(x,y,z,before,after)=>{const k=`${x},${y},${z}`,light=materialById(after).light;if(light)this.sources.set(k,light);else this.sources.delete(k);this.invalidate(x,y,z);};store.listeners.add(this.listener);this.flush();
 }
 invalidate(x,y,z){for(let h=0;h<this.store.height;h+=CHUNK)for(let dy=-8;dy<=8;dy+=8)for(let dx=-8;dx<=8;dx+=8)if(this.store.inBounds(Math.max(0,x+dx),Math.max(0,y+dy),h))this.dirty.add(chunk(Math.max(0,x+dx),Math.max(0,y+dy),h));}
 ambient(x,y,z) {
  if(z<(this.store.datum||1))return 0;
  for(let h=z+1;h<this.store.height;h++)if(this.store.isOpaque(x,y,h))return 0;
  return ['night','night-ops'].includes(this.timeOfDay)?2:['dawn','dusk'].includes(this.timeOfDay)?4:7;
 }
 flush() {
  const signature=[...(this.fires?.keys()||[])].sort().join(';');
  if(signature!==this.fireSignature){for(const k of [...(this.fireSignature?this.fireSignature.split(';'):[]),...(this.fires?.keys()||[])])this.invalidate(...k.split(',').map(Number));this.fireSignature=signature;}
  if(!this.dirty.size)return [];
  const dirty=new Set(this.dirty);this.dirty.clear();const s=this.store;
  for(const k of dirty){const [cx,cy,cz]=k.split(',').map(Number);for(let z=cz*CHUNK;z<Math.min(s.height,(cz+1)*CHUNK);z++)for(let y=cy*CHUNK;y<Math.min(s.depth,(cy+1)*CHUNK);y++)for(let x=cx*CHUNK;x<Math.min(s.width,(cx+1)*CHUNK);x++)this.values[s.index(x,y,z)]=this.ambient(x,y,z);}
  const sources=[...this.sources].map(([k,n])=>[...k.split(',').map(Number),Math.min(15,7+n*2)]);
  for(const k of this.fires?.keys()||[])sources.push([...k.split(',').map(Number),15]);
  for(const d of this.decor)if(['lamp','streetlight','floodlight'].includes(d.kind)&&s.isSolid(Math.round(d.x),Math.round(d.y),d.z-1))sources.push([Math.round(d.x),Math.round(d.y),d.z,13]);
  for(const [sx,sy,sz,level] of sources) {
   const queue=[[sx,sy,sz,level,0]],seen=new Set();
   for(let i=0;i<queue.length;i++){const [x,y,z,n,r]=queue[i];if(!s.inBounds(x,y,z)||r>8||n<=0)continue;const index=s.index(x,y,z);if(seen.has(index))continue;seen.add(index);
    if(dirty.has(chunk(x,y,z)))this.values[index]=Math.max(this.values[index],n);
    if(r>0&&s.isOpaque(x,y,z))continue;
    for(const [dx,dy,dz]of DIRS)queue.push([x+dx,y+dy,z+dz,n-2,r+1]);
   }
  }
  // Lighting changes rebuild colour buffers of affected chunks, with no additional lights/draw calls.
  for(const k of dirty)s.dirtyChunks.add(k);return [...dirty];
 }
 at(x,y,z){this.flush();return this.store.inBounds(x,y,z)?this.values[this.store.index(x,y,z)]:0;}
 dark(x,y,z){return this.at(x,y,z+1)<4;}
 tint(x,y,z){this.flush();let n=this.store.inBounds(x,y,z)?this.values[this.store.index(x,y,z)]:0;for(const [dx,dy,dz]of DIRS)if(this.store.inBounds(x+dx,y+dy,z+dz))n=Math.max(n,this.values[this.store.index(x+dx,y+dy,z+dz)]);const k=.52+n/20;return[k*.9,k*.96,k];}
 dispose(){this.store.listeners.delete(this.listener);}
}
