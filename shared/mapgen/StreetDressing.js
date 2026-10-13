import {MAT} from '../voxel/Materials.js';
export const VEHICLE_SPECS=Object.freeze({car:{length:4,width:2,axles:2},abandoned_car:{length:4,width:2,axles:2},truck:{length:6,width:2,axles:2},bus:{length:8,width:2,axles:3},semitrailer:{length:10,width:2,axles:4},eighteen_wheeler:{length:12,width:2,axles:5}});
/** A whole object and its exact tactical footprint share one descriptor. */
export function placeStreetVehicle(m,type,x,y,{axis='x',z=m.G}={}) {
 const spec=VEHICLE_SPECS[type];if(!spec)throw Error(`Unknown street vehicle ${type}`);
 const cells=[];
 for(let i=0;i<spec.length;i++)for(let j=0;j<spec.width;j++){
  const px=x+(axis==='x'?i:j),py=y+(axis==='x'?j:i);
  if(!m.store.inBounds(px,py,z)||m.store.topSolid(px,py)!==z||m.keep.has(`${px},${py}`))return null;
  for(let h=1;h<=2;h++)if(m.store.get(px,py,z+h)!==0)return null;
 }
 for(let i=0;i<spec.length;i++)for(let j=0;j<spec.width;j++){
  const px=x+(axis==='x'?i:j),py=y+(axis==='x'?j:i);
  m.store.set(px,py,z+1,MAT.car_body);cells.push([px,py,z+1]);
  if(type!=='abandoned_car'&&(type!=='car'||i===1||i===2)){m.store.set(px,py,z+2,MAT.car_cabin);cells.push([px,py,z+2]);}
 }
 m.object(type,cells,{axis,dir:1,size:[spec.length,spec.width],tint:type==='abandoned_car'?[.27,.25,.22]:type==='bus'?[.18,.4,.5]:null});
 m.reserve(x-1,y-1,x+(axis==='x'?spec.length:spec.width),y+(axis==='x'?spec.width:spec.length));
 return {type,x,y,z,axis,length:spec.length,width:spec.width};
}
/** Vehicles follow curb bays and loading lanes; the central lane and crossings remain free. */
export function dressDistrictStreets(m,{traffic='normal',pedestrian='light'}={}) {
 const objects=[],spacing=traffic==='heavy'?14:traffic==='light'?26:20;
 const types=['car','abandoned_car','truck','bus','semitrailer','eighteen_wheeler'];
 if(traffic!=='none')for(let x=7,i=0;x<m.store.width-12;x+=spacing,i++){
  const type=types[(i+Math.floor(m.rng.next()*types.length))%types.length];
  const v=placeStreetVehicle(m,type,x,i%2?37:34);if(v)objects.push(v);
 }
 // Loading courts give the large vehicles a purpose and avoid parking trucks on footpaths.
 if(traffic!=='none')for(const [type,x,y] of [['eighteen_wheeler',7,22],['semitrailer',33,22],['truck',72,58],['bus',69,34]]){const v=placeStreetVehicle(m,type,x,y);if(v)objects.push(v);}
 if(m.G===1&&traffic!=='none'){
  // A rear service road uses marked curb bays, keeping a continuous three-tile driving lane.
  for(let y=63;y<=67;y++)for(let x=0;x<m.store.width;x++)if(m.store.topSolid(x,y)===1){m.store.set(x,y,1,MAT.asphalt);if(y>=65)m.reserve(x,y,x,y);}
  for(const [i,[type,x]] of [['car',7],['abandoned_car',16],['truck',25],['semitrailer',36],['eighteen_wheeler',51],['bus',69]].entries()){
   if(traffic==='light'&&i>2)break;const v=placeStreetVehicle(m,type,x,63);if(v)objects.push(v);
  }
 }
 const interval=pedestrian==='normal'?8:12;
 if(pedestrian!=='none')for(let x=8;x<m.store.width-3;x+=interval)for(const y of [31,41]){
  if(m.keep.has(`${x},${y}`)||m.store.topSolid(x,y)!==m.G||m.buildings.some(b=>x>=b.x0-2&&x<b.x0+b.w+2&&y>=b.y0-2&&y<b.y0+b.d+2))continue;
  const piece=['supply_crates','bike_rack','utility_cabinet','parcel_locker'][Math.floor(m.rng.next()*4)];
  const material=piece==='supply_crates'?MAT.crate:piece==='bike_rack'?MAT.chainlink:MAT.appliance;
  const cells=[];for(let dx=0;dx<2;dx++){m.store.set(x+dx,y,m.G+1,material);cells.push([x+dx,y,m.G+1]);}
  m.object(piece,cells,{axis:'x',dir:1,size:[2,1]});m.reserve(x-1,y-1,x+2,y+1);objects.push({type:piece,x,y,z:m.G});
 }
 if(pedestrian!=='none')for(const x of [24,75])if(m.store.topSolid(x,40)===m.G&&!m.buildings.some(b=>x>=b.x0-2&&x<b.x0+b.w+2&&40>=b.y0-2&&40<b.y0+b.d+2)){
  // The shelter roof and panels are real cover cells, with an open pedestrian landing.
  const cells=[];for(let dx=0;dx<3;dx++)for(let h=1;h<=2;h++){m.store.set(x+dx,40,m.G+h,MAT.car_cabin);cells.push([x+dx,40,m.G+h]);}
  m.object('transit_shelter',cells,{axis:'x',dir:1,size:[3,1]});m.reserve(x-1,39,x+3,41);objects.push({type:'transit_shelter',x,y:40,z:m.G});
 }
 return objects;
}
