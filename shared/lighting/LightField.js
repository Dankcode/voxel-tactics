import { CHUNK } from '../voxel/VoxelStore.js';
import { materialById } from '../voxel/Materials.js';
const DIRS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const DECOR_HEIGHT={streetlight:3,floodlight:4,floor_lamp:1,nightstand:0,price_sign:3,motel_sign:4,canopy:0,lamp:1};
const chunk=(x,y,z)=>`${Math.floor(x/CHUNK)},${Math.floor(y/CHUNK)},${Math.floor(z/CHUNK)}`;
/** Integer maximum-light propagation, radius eight. Shared by rules and both rendering paths. */
export class LightField {
 constructor(store,{timeOfDay='day',decor=[],fires=null}={}) {
  this.store=store;this.timeOfDay=timeOfDay;this.decor=decor;this.fires=fires;this.values=new Uint8Array(store.mat.length);this.colors=new Uint32Array(store.mat.length);this.sources=new Map();this.dirty=new Set();this.fireSignature='';
  this._cw=Math.ceil(store.width/CHUNK);this._cd=Math.ceil(store.depth/CHUNK);this._ch=Math.ceil(store.height/CHUNK);
  this._dirtyGrid=new Uint8Array(this._cw*this._cd*this._ch);
  this._stamp=new Int32Array(store.mat.length);this._stampId=0;
  this._qx=new Int16Array(10000);this._qy=new Int16Array(10000);this._qz=new Int16Array(10000);this._qn=new Int8Array(10000);this._qr=new Int8Array(10000);
  this._skyAmbient=['night','night-ops'].includes(this.timeOfDay)?2:['dawn','dusk'].includes(this.timeOfDay)?4:7;
  for(let z=0;z<store.height;z++)for(let y=0;y<store.depth;y++)for(let x=0;x<store.width;x++){const light=store.material(x,y,z).light;if(light)this.sources.set(`${x},${y},${z}`,light);this.dirty.add(chunk(x,y,z));}
  this.listener=(x,y,z,before,after)=>{const k=`${x},${y},${z}`,light=materialById(after).light;if(light)this.sources.set(k,light);else this.sources.delete(k);this.invalidate(x,y,z);};store.listeners.add(this.listener);this.flush();
 }
 invalidate(x,y,z){for(let h=0;h<this.store.height;h+=CHUNK)for(let dy=-8;dy<=8;dy+=8)for(let dx=-8;dx<=8;dx+=8)if(this.store.inBounds(Math.max(0,x+dx),Math.max(0,y+dy),h))this.dirty.add(chunk(Math.max(0,x+dx),Math.max(0,y+dy),h));}
 ambient(x,y,z) {
  if(z<(this.store.datum||1))return 0;
  for(let h=z+1;h<this.store.height;h++)if(this.store.isOpaque(x,y,h))return 0;
  return this._skyAmbient;
 }
 flush() {
  const signature=[...(this.fires?.keys()||[])].sort().join(';');
  if(signature!==this.fireSignature){for(const k of [...(this.fireSignature?this.fireSignature.split(';'):[]),...(this.fires?.keys()||[])])this.invalidate(...k.split(',').map(Number));this.fireSignature=signature;}
  if(!this.dirty.size)return [];
  const dirty=new Set(this.dirty);this.dirty.clear();const s=this.store,W=s.width,D=s.depth,H=s.height,WD=W*D,datum=s.datum||1,sky=this._skyAmbient;
  const cw=this._cw,cd=this._cd,dg=this._dirtyGrid;dg.fill(0);
  let minCx=cw,maxCx=-1,minCy=cd,maxCy=-1,minCz=this._ch,maxCz=-1;
  const dirtyList=[];
  const dirtyCols=new Set();
  for(const k of dirty){
   const [cx,cy,cz]=k.split(',').map(Number);
   if(cx<0||cy<0||cz<0||cx>=cw||cy>=cd||cz>=this._ch)continue;
   dg[(cz*cd+cy)*cw+cx]=1;dirtyList.push([cx,cy,cz,k]);dirtyCols.add(cy*cw+cx);
   if(cx<minCx)minCx=cx;if(cx>maxCx)maxCx=cx;if(cy<minCy)minCy=cy;if(cy>maxCy)maxCy=cy;if(cz<minCz)minCz=cz;if(cz>maxCz)maxCz=cz;
  }
  if(!dirtyList.length)return [];
  // Snapshot old light values in dirty chunks so unchanged neighbor chunks skip mesh rebuilds.
  const prevSnapshots=dirtyList.map(([cx,cy,cz])=>{
   const x0=cx*CHUNK,y0=cy*CHUNK,z0=cz*CHUNK,x1=Math.min(W,x0+CHUNK),y1=Math.min(D,y0+CHUNK),z1=Math.min(H,z0+CHUNK);
   const n=(x1-x0)*(y1-y0)*(z1-z0),vals=new Uint8Array(n),cols=new Uint32Array(n);
   let p=0;for(let z=z0;z<z1;z++)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const idx=(z*D+y)*W+x;vals[p]=this.values[idx];cols[p]=this.colors[idx];p++;}
   return vals.length?{vals,cols,x0,y0,z0,x1,y1,z1}:null;
  });
  // Fast top-down ambient pass per dirty (cx, cy) column (O(H) instead of O(H^2)).
  const zMaxAll=Math.min(H-1,(maxCz+1)*CHUNK-1),zMinAll=minCz*CHUNK;
  for(const colKey of dirtyCols){
   const cy=Math.floor(colKey/cw),cx=colKey-cy*cw,x0=cx*CHUNK,y0=cy*CHUNK,x1=Math.min(W,x0+CHUNK),y1=Math.min(D,y0+CHUNK);
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    let blocked=false;
    for(let h=H-1;h>zMaxAll;h--)if(s.isOpaque(x,y,h)){blocked=true;break;}
    for(let z=zMaxAll;z>=zMinAll;z--){
     if(dg[(Math.floor(z/CHUNK)*cd+cy)*cw+cx]){
      const idx=(z*D+y)*W+x;
      this.values[idx]=(blocked||z<datum)?0:sky;
      this.colors[idx]=0x99bad6;
     }
     if(!blocked&&s.isOpaque(x,y,z))blocked=true;
    }
   }
  }
  const sources=[...this.sources].map(([k,n])=>[...k.split(',').map(Number),Math.min(15,7+n*2),s.material(...k.split(',').map(Number)).color]);
  for(const k of this.fires?.keys()||[])sources.push([...k.split(',').map(Number),15,0xff833e]);
  for(const d of this.decor)if(Object.hasOwn(DECOR_HEIGHT,d.kind)&&s.isSolid(Math.round(d.x),Math.round(d.y),d.z-1))sources.push([Math.round(d.x),Math.round(d.y),Math.min(H-1,d.z+DECOR_HEIGHT[d.kind]),13,0xffd49b]);
  const bx0=minCx*CHUNK,bx1=(maxCx+1)*CHUNK-1,by0=minCy*CHUNK,by1=(maxCy+1)*CHUNK-1,bz0=minCz*CHUNK,bz1=(maxCz+1)*CHUNK-1;
  const stamp=this._stamp,qx=this._qx,qy=this._qy,qz=this._qz,qn=this._qn,qr=this._qr;
  for(const [sx,sy,sz,level,color] of sources) {
   if(sx+8<bx0||sx-8>bx1||sy+8<by0||sy-8>by1||sz+8<bz0||sz-8>bz1)continue;
   const cx0=Math.max(0,Math.floor((sx-8)/CHUNK)),cx1=Math.min(cw-1,Math.floor((sx+8)/CHUNK));
   const cy0=Math.max(0,Math.floor((sy-8)/CHUNK)),cy1=Math.min(cd-1,Math.floor((sy+8)/CHUNK));
   const cz0=Math.max(0,Math.floor((sz-8)/CHUNK)),cz1=Math.min(this._ch-1,Math.floor((sz+8)/CHUNK));
   let touchesDirty=false;
   for(let cz=cz0;cz<=cz1&&!touchesDirty;cz++)for(let cy=cy0;cy<=cy1&&!touchesDirty;cy++)for(let cx=cx0;cx<=cx1;cx++)if(dg[(cz*cd+cy)*cw+cx]){touchesDirty=true;break;}
   if(!touchesDirty)continue;
   if(++this._stampId>=0x7fffffff){stamp.fill(0);this._stampId=1;}
   const sid=this._stampId;
   let head=0,tail=0;
   qx[tail]=sx;qy[tail]=sy;qz[tail]=sz;qn[tail]=level;qr[tail]=0;tail++;
   while(head<tail){
    const x=qx[head],y=qy[head],z=qz[head],n=qn[head],r=qr[head];head++;
    if(x<0||y<0||z<0||x>=W||y>=D||z>=H||r>8||n<=0)continue;
    const index=z*WD+y*W+x;
    if(stamp[index]===sid)continue;stamp[index]=sid;
    const cIdx=(Math.floor(z/CHUNK)*cd+Math.floor(y/CHUNK))*cw+Math.floor(x/CHUNK);
    if(dg[cIdx]&&(n>this.values[index]||n===this.values[index]&&color<this.colors[index])){this.values[index]=n;this.colors[index]=color;}
    if(r>0&&s.isOpaque(x,y,z))continue;
    const nn=n-2,nr=r+1;
    if(nn>0&&nr<=8){
     for(let d=0;d<6;d++){
      qx[tail]=x+DIRS[d][0];qy[tail]=y+DIRS[d][1];qz[tail]=z+DIRS[d][2];qn[tail]=nn;qr[tail]=nr;tail++;
     }
    }
   }
  }
  // Only chunks whose baked light actually changed need a mesh rebuild.
  for(let ci=0;ci<dirtyList.length;ci++){
   const snap=prevSnapshots[ci];if(!snap)continue;
   const {vals,cols,x0,y0,z0,x1,y1,z1}=snap;
   let p=0,changed=false;
   for(let z=z0;z<z1&&!changed;z++)for(let y=y0;y<y1&&!changed;y++)for(let x=x0;x<x1;x++){
    const idx=(z*D+y)*W+x;
    if(this.values[idx]!==vals[p]||this.colors[idx]!==cols[p]){changed=true;break;}
    p++;
   }
   if(changed)s.dirtyChunks.add(dirtyList[ci][3]);
  }
  return [...dirty];
 }
 at(x,y,z){this.flush();return this.store.inBounds(x,y,z)?this.values[this.store.index(x,y,z)]:0;}
 dark(x,y,z){return this.at(x,y,z+1)<4;}
 tint(x,y,z){this.flush();let color=0x99bad6;let n=this.store.inBounds(x,y,z)?this.values[this.store.index(x,y,z)]:0;for(const [dx,dy,dz]of DIRS)if(this.store.inBounds(x+dx,y+dy,z+dz)){const i=this.store.index(x+dx,y+dy,z+dz);if(this.values[i]>n){n=this.values[i];color=this.colors[i];}} const k=.52+n/20;const rgb=[color>>16&255,color>>8&255,color&255],max=Math.max(...rgb)||1;return rgb.map(c=>k*(.65+.35*c/max));}
 dispose(){this.store.listeners.delete(this.listener);}
}
