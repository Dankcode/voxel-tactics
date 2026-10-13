import {remixParameters,solveDistrictParts} from '../mapgen/DistrictRemix.js';
import {dressDistrictStreets} from '../mapgen/StreetDressing.js';
import {createMap} from './modern/MapKit.js';
import {MAT} from '../voxel/Materials.js';
import {DOWNTOWN_PROPS} from './PropCatalog.js';
import {reachable,nodeKey,pathTo} from '../world/PathSearch.js';
import {AGENT_PROFILES} from '../world/TraversalRules.js';

/** Bounds are gameplay geometry, rather than an invisible rectangular extension. */
export function districtParameters({width=96,depth=72,shape='rectangle',remix}={}) {
 const result={width:Math.max(96,Math.min(128,Math.round(Number(width)||96))),depth:Math.max(72,Math.min(96,Math.round(Number(depth)||72))),shape:['rectangle','L','T'].includes(shape)?shape:'rectangle'};
 if(remix)result.remix=remixParameters(remix);return result;
}
export function districtContains(p,x,y) {
 if(x<0||y<0||x>=p.width||y>=p.depth)return false;
 if(p.shape==='L')return x<64||y<48;
 if(p.shape==='T')return y<48||(x>=28&&x<68);
 return true;
}
function applyBoundary(m,p) {
 for(let y=0;y<p.depth;y++)for(let x=0;x<p.width;x++)if(!districtContains(p,x,y))for(let z=0;z<m.store.height;z++)m.store.set(x,y,z,0);
}
function connector(m,id,cells,template='district-promenade') {
 for(const c of cells)m.reserve(c.x-1,c.y-1,c.x+1,c.y+1);
 return {id,template,cells,sockets:[cells[0],cells.at(-1)]};
}
function lane(m,id,x,y,dx,dy,length,z) {
 const cells=Array.from({length},(_,i)=>({x:x+dx*i,y:y+dy*i,z}));
 for(const c of cells){m.store.set(c.x,c.y,z,MAT.paving);for(let h=1;h<=2;h++)m.store.set(c.x,c.y,z+h,0);}
 return connector(m,id,cells);
}
/** Merge adjacent shells through a wide shared passage, retaining each shop's room ownership. */
export function mergeDistrictBuildings(m,a,b) {
 if(a.baseZ!==b.baseZ||a.x0+a.w!==b.x0)throw Error('Mall parcels require aligned adjacent shells');
 const y=Math.max(a.y0,b.y0)+Math.floor(Math.min(a.d,b.d)/2),z=a.baseZ,cells=[];
 for(let x=b.x0-2;x<=b.x0+1;x++)for(let dy=0;dy<3;dy++){
  m.store.set(x,y+dy,z,MAT.ceramic);
  for(let h=1;h<=2;h++){m.store.set(x,y+dy,z+h,0);delete m.hints[`${x},${y+dy},${z+h}`];}
  m.reserve(x,y+dy,x,y+dy);
 }
 // Shared-side external exits now open into the adjoining interior. Keep their landings clear.
 for(const building of [a,b])for(const e of building.exits||[]){const [dx,dy]={n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]}[e.side];for(let i=1;i<=2;i++)for(let h=1;h<=2;h++){
  const x=e.x+dx*i,yy=e.y+dy*i;if(x>=a.x0&&x<b.x0+b.w&&yy>=a.y0&&yy<a.y0+a.d){m.store.set(x,yy,z+h,0);delete m.hints[`${x},${yy},${z+h}`];}
 }}
 for(let x=b.x0-2;x<=b.x0+1;x++)cells.push({x,y:y+1,z});
 a.mergedWith=[b.id];b.mergedWith=[a.id];
 return connector(m,`${a.id}-${b.id}`,cells,'merged-retail-passage');
}
function raisedPark(m) {
 const s=m.store;
 // Nested rounded terraces rise one voxel per contour. Existing ground autotiling rounds the edge pieces.
 for(let y=8;y<=32;y++)for(let x=60;x<=89;x++){
  const r=Math.hypot((x-74.5)/16,(y-20)/14);
  const z=r<=.62?4:r<=.76?3:r<=.9?2:1;
  for(let h=2;h<=z;h++)s.set(x,y,h,h===z?MAT.lawn:MAT.soil);
 }
 const routes=[];
 for(const [x,y,dx,dy] of [[62,18,1,0],[72,31,0,-1]]){
  const cells=[];for(let i=0;i<3;i++)for(let w=0;w<2;w++){
   const px=x+dx*i-dy*w,py=y+dy*i+dx*w,z=i+2;
   for(let h=2;h<=4;h++)s.set(px,py,h,h<=z?(h===z?MAT.stairs_stone:MAT.paving):0);
   m.reserve(px-1,py-1,px+1,py+1);if(w===0)cells.push({x:px,y:py,z});
  }routes.push(connector(m,`park-steps-${x}-${y}`,cells,'terraced-park-stairs'));
 }
 for(const [x,y] of [[66,13],[83,14],[65,27],[83,27]])m.tree(x,y,'round',s.topSolid(x,y));
 for(const [x,y] of [[68,18],[80,23],[73,12],[73,27],[86,20],[62,25]]) {
  const z=s.topSolid(x,y);if(z<=4)m.line(x,y,2,'x','crate',1,z);
 }
 // Raised paths, rather than a flat field of scattered benches.
 for(let x=66;x<=83;x++)s.set(x,20,4,MAT.paving);
 for(let y=13;y<=27;y++)s.set(75,y,4,MAT.paving);
 return routes;
}
function drainage(m) {
 const s=m.store,routes=[];
 const pieces=[{id:'west-drain',x:8,y:43,dx:1,dy:0,n:49},{id:'drain-turn',x:56,y:43,dx:0,dy:1,n:23},{id:'south-drain',x:56,y:65,dx:-1,dy:0,n:23}];
 const carve=(x,y)=>{for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
  const xx=x+dx,yy=y+dy;for(let h=2;h<=4;h++)s.set(xx,yy,h,0);s.set(xx,yy,1,MAT.paving);m.reserve(xx,yy,xx,yy);
 }};
 for(const p of pieces)for(let i=0;i<p.n;i++)carve(p.x+p.dx*i,p.y+p.dy*i);
 for(const p of pieces){const cells=[];for(let i=0;i<p.n;i++){
  const x=p.x+p.dx*i,y=p.y+p.dy*i;s.set(x,y,1,MAT.water);cells.push({x:x-p.dy*2,y:y+p.dx*2,z:1});
 }routes.push(connector(m,p.id,cells,'open-drainage-bank'));}
 for(const r of routes)for(const c of r.cells)s.set(c.x,c.y,c.z,MAT.paving);
 // Bank sockets use a common junction landing, including the inside corner of the turn.
 routes.push(lane(m,'north-turn-bank',54,45,1,0,5,1),lane(m,'south-turn-bank',54,63,1,0,5,1));
 for(const [x,y,dx,dy] of [[5,41,1,0],[30,69,0,-1],[59,53,-1,0]]){
  const cells=[];for(let i=0;i<4;i++)for(let w=0;w<3;w++){
   const px=x+dx*i-dy*w,py=y+dy*i+dx*w,z=4-i;
   for(let h=z+1;h<=6;h++)s.set(px,py,h,0);s.set(px,py,z,MAT.stairs_stone);m.reserve(px-1,py-1,px+1,py+1);if(w===1)cells.push({x:px,y:py,z});
  }routes.push(connector(m,`drain-stairs-${x}-${y}`,cells,'drainage-access-stairs'));
 }
 for(const [x,y,dx,dy] of [[20,40,0,-1],[59,58,1,0],[42,68,0,1]]){
  const l=m.ladder(x,y,dx,dy);routes.push({id:`drain-ladder-${x}`,template:'bank-service-ladder',sockets:[{x,y,z:l.foot},{x:x+dx,y:y+dy,z:l.top}]});
 }
 // Supported surface crossings preserve two cells of headroom on the banks below.
 for(const [id,x,y,dx,dy,n] of [['drain-road-bridge',32,39,0,1,9],['drain-service-bridge',51,56,1,0,11]]){
  const cells=[];for(let i=0;i<n;i++)for(let w=-1;w<=1;w++){
   const px=x+dx*i-dy*w,py=y+dy*i+dx*w;s.set(px,py,4,MAT.paving);m.reserve(px,py,px,py);
   if(w===0)cells.push({x:px,y:py,z:4});
   if(Math.abs(w)===1&&i>0&&i<n-1)s.set(px,py,5,MAT.railing);
  }routes.push(connector(m,id,cells,'surface-bank-bridge'));
 }
 // Low banks furnish cover without blocking the continuous dry walking paths.
 for(let x=12;x<=51;x+=5)m.line(x,46,2,'x','crate',1,1);
 for(let y=49;y<64;y+=5)m.line(53,y,1,'x','crate',1,1);
 return routes;
}
function dress(m) {
 for(const b of m.buildings)if(b.w>=20){const cells=[];for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++)for(let h=1;h<=2;h++){
  const x=b.x0+Math.floor(b.w/2)+dx,y=b.y0+Math.floor(b.d/2)+dy,z=b.top+h;m.store.set(x,y,z,MAT.appliance);cells.push([x,y,z]);
 }m.object('rooftop_ac',cells,{axis:'x',dir:1,size:[2,2]});}
 for(const b of m.buildings){for(const dx of [2,5])for(const dy of [2,5])m.decorAt(dx===2?'rooftop_vent':'cable_spool',b.x0+dx,b.y0+dy,{z:b.top+1});m.decorAt('wall_sign',b.x0-.5,b.y0+3,{z:b.baseZ+2,free:true});}
}
export function buildLargeDistrict({seed=1,theme='park',...options}={}) {
 const p=districtParameters({...options,shape:options.shape||(theme==='mall'?'L':theme==='drainage'?'T':'rectangle')}),datum=theme==='drainage'?4:1;
 const id={park:'park-district',mall:'mall-district',drainage:'drainage-district'}[theme];
 const m=createMap({id,...p,height:18,seed,datum,ground:'paving'});
 const building=spec=>{for(let y=spec.y0-2;y<=spec.y0+spec.d+1;y++)for(let x=spec.x0-2;x<=spec.x0+spec.w+1;x++)if(!districtContains(p,x,y))return null;return m.building({...spec,furnish:spec.furnish===false?false:remix.furnish,
  ...(remix.wall!=='mixed'?{wall:remix.wall}:{}),
  ...(remix.corners!=='mixed'?{rounded:remix.corners==='rounded'}:{}),
  ...(remix.glazing!=='mixed'?{glaze:Object.fromEntries(['sales','office','lobby','meeting','hall','dining','galley','warehouse','workshop','loading','storeroom'].map(k=>[k,remix.glazing]))}:{})});};
 applyBoundary(m,p);
 m.roadX(34,38);m.roadY(57,60,0,38);
 const connectors=[];
 const remix=remixParameters(p.remix||options.remix||{pedestrian:'normal'}),assignments=[];
 const candidates=[
  {id:'north-retail-0',x0:7,y0:7,w:12,d:13},
  {id:'north-retail-1',x0:24,y0:5,w:12,d:15},
  {id:'north-retail-3',x0:42,y0:9,w:12,d:13},
  {id:'south-retail-0',x0:7,y0:45,w:14,d:12},
  {id:'south-retail-1',x0:26,y0:48,w:13,d:11},
  {id:'south-retail-2',x0:45,y0:46,w:12,d:12},
  {id:'park-edge-0',x0:68,y0:44,w:12,d:13},
  {id:'park-edge-1',x0:83,y0:47,w:11,d:11}];
 if(theme==='mall'){
  const a=building({id:'market-west',program:'shop',x0:7,y0:7,w:24,d:22,rounded:false,furnish:false});
  const b=building({id:'market-east',program:'shop',x0:31,y0:7,w:24,d:22,rounded:false,furnish:false});
  if(remix.merges)connectors.push(mergeDistrictBuildings(m,a,b));
  if(remix.furnish)for(const shop of [a,b])for(let x=shop.x0+4;x<shop.x0+shop.w-3;x+=5)for(const y of [15,21])m.line(x,y,2,'x','cabinet');
  candidates.splice(0,3);
 }
 if(theme!=='drainage'){if(remix.terrain!=='flat')connectors.push(...raisedPark(m));}
 else {
  connectors.push(...drainage(m));
  candidates.splice(3);
  candidates.push({id:'bank-side-depot',x0:7,y0:52,w:16,d:14},{id:'canal-repair',x0:73,y0:52,w:16,d:14});
 }
 for(let x=98;x+12<p.width;x+=14)candidates.push({id:`east-extension-${x}`,x0:x,y0:9,w:10,d:17});
 if(p.depth>=92)for(let x=7;x+15<p.width;x+=25)candidates.push({id:`south-extension-${x}`,x0:x,y0:79,w:14,d:11});
 let eligible=candidates.filter(spec=>{for(let y=spec.y0-2;y<=spec.y0+spec.d+1;y++)for(let x=spec.x0-2;x<=spec.x0+spec.w+1;x++)if(!districtContains(p,x,y))return false;return true;});
 if(remix.placement==='noise-wfc')m.rng.shuffle(eligible);
 const picked=eligible.slice(0,Math.max(0,remix.buildingCount-m.buildings.length-(remix.elevated?1:0)));
 for(const spec of solveDistrictParts(picked,remix,seed)){
  // Vary frontage offsets only within a protected parcel, never by overlapping voxel shells.
  const shift=remix.placement==='noise-wfc'?m.rng.int(0,1):0;
  const b=building({...spec,x0:spec.x0+shift,baseZ:datum,front:remix.placement==='noise-wfc'?['n','s','e','w'][m.rng.int(0,3)]:'s',rounded:m.rng.next()>.45,wall:remix.parts==='mixed'?['brick','stucco','concrete_wall','siding'][m.rng.int(0,3)]:undefined});
  if(b)assignments.push({id:b.id,program:b.program,storeys:b.storeys,noiseOffset:shift});
 }
 if(remix.elevated){
  // An independently supported bridge parcel above the reserved promenade; the route below stays two cells tall.
  const z=datum+3;
  for(let y=23;y<=35;y++)for(let x=30;x<=49;x++){m.store.set(x,y,z,MAT.grate);m.reserve(x,y,x,y);}
  for(const x of [30,49])for(const y of [23,35])for(let h=datum+1;h<z;h++)m.store.set(x,y,h,MAT.steel_post);
  for(let i=0;i<3;i++)for(let w=0;w<2;w++){
   const x=30+w,y=38-i,h=datum+1+i;
   for(let zz=datum+1;zz<=z;zz++)m.store.set(x,y,zz,zz<=h?(zz===h?MAT.stairs_stone:MAT.concrete):0);
   m.reserve(x-1,y-1,x+1,y+1);
  }
  const b=building({id:'bridge-retail',foundation:false,program:remix.parts==='industrial'?'garage':'shop',x0:34,y0:24,w:12,d:9,baseZ:z,storeys:1,rounded:false});
  connectors.push({id:'elevated-parcel-access',template:'supported-bridge-building',sockets:[{x:30,y:39,z:datum},{x:30,y:35,z}],cells:[{x:30,y:39,z:datum},{x:30,y:38,z:datum+1},{x:30,y:37,z:datum+2},{x:30,y:36,z},{x:30,y:35,z}]});
  for(const [x,y] of [[33,26],[39,29],[45,31]])m.line(x,y,2,'x','crate',2,datum);
  for(let y=24;y<=34;y++)m.store.set(49,y,z+1,MAT.railing);
  for(let x=32;x<=48;x++)m.store.set(x,35,z+1,MAT.railing);
  assignments.push({id:b.id,program:b.program,storeys:1,elevated:true});
 }
 // A reserved continuous surface route stitches dense parcels together.
 connectors.push(lane(m,'retail-promenade',5,33,1,0,50,datum));
 m.reserve(1,23,5,32);
 if(remix.pedestrian!=='none'){m.line(0,24,2,'y','crate',2,datum);m.line(0,30,2,'y','crate',2,datum);}
 if(remix.pedestrian!=='none')m.line(50,34,2,'x','crate',2,datum);
 if(theme==='drainage'&&remix.pedestrian!=='none')m.line(18,39,1,'x','crate',2,datum);
 const streetObjects=dressDistrictStreets(m,remix);
 const functionalProps={supply:{layout:'line',len:[1,2],w:2,context:'any',stack:()=>['crate','crate']},bins:DOWNTOWN_PROPS.bins,newsstand:DOWNTOWN_PROPS.newsstand};
 if(remix.pedestrian!=='none')m.scatter(functionalProps,{maxGap:remix.pedestrian==='light'?8:4,targetShare:remix.pedestrian==='light'?0.10:0.22,...(remix.pedestrian==='light'?{budget:Math.floor(p.width*p.depth/160)}:{}),blocked:(x,y)=>!districtContains(p,x,y)||y>=34&&y<=38||x>=57&&x<=60});
 dress(m);applyBoundary(m,p);
 const result=m.finish({name:{park:'Park District',mall:'Market Arcade',drainage:'Drainage Quarter'}[theme],spawns:{player:[{x:2,y:25,z:datum},{x:2,y:27,z:datum},{x:3,y:26,z:datum},{x:4,y:25,z:datum},{x:4,y:27,z:datum},{x:3,y:29,z:datum}],enemy:[{type:'warden_foe',group:0,at:{x:45,y:15,z:datum}},{type:'cultist',group:1,at:{x:50,y:theme==='drainage'?45:59,z:theme==='drainage'?1:1}}]},objective:{kind:'eliminate',text:'Secure the district through its linked parcels and alternate elevation routes.'},meta:{generatorVersion:'district-noise-wfc-v2',remix,streetObjects,partAssignments:assignments,theme:'Large districts',lighting:'overcast',streetDatum:datum,footprint:p,connectionParcels:connectors,cutLevels:[4,7,10,13,Infinity],defaultCut:datum+3,floorNames:datum===4?{4:'Drainage banks',7:'Street district',10:'Upper interiors',13:'High floors'}:{4:'Street interiors',7:'Upper / bridge interiors',10:'Third floors',13:'High roofs'},designDecisions:[`Playable ${p.shape} footprint: ${p.width} × ${p.depth}; cells outside it are removed.`, 'Dense seeded infill retains narrow alleys and reserved pedestrian connectors.',theme==='mall'?'Adjacent retail parcels merge through a three-wide indoor passage.':theme==='drainage'?'Only the drainage theme excavates lower banks, with elemental water and service ladders.':'Rounded planted contours connect to stair promenades and neighboring retail.']}});
 const search=reachable(result.store,result.spawns.player[0],Infinity,AGENT_PROFILES.player);
 const failures=connectors.flatMap(c=>c.sockets.filter(s=>!search.costs.has(nodeKey(s))).map(s=>({connector:c.id,socket:s})));
 result.meta.connectorValidation={pass:failures.length===0,failures};
 if(failures.length)throw Error(`${id}: unreachable district sockets ${JSON.stringify(failures)}`);
 const root=connectors[0],network=reachable(result.store,root.sockets[0],Infinity,AGENT_PROFILES.player);
 result.meta.parcelLinks=connectors.slice(1).map(c=>({from:root.id,to:c.id,path:pathTo(network,c.sockets[0])}));
 if(result.meta.parcelLinks.some(l=>!l.path.length))throw Error(`${id}: disconnected parcel network`);
 result.meta.parcelGraph=result.meta.parcelLinks.map(l=>[l.from,l.to]);
 result.meta.parcelAssignments=result.buildings.map(b=>({id:b.id,program:b.program,bounds:{x:b.x0,y:b.y0,w:b.w,d:b.d},mergedWith:b.mergedWith||[]}));
 return result;
}
export const buildParkDistrict=o=>buildLargeDistrict({...o,theme:'park'});
export const buildMallDistrict=o=>buildLargeDistrict({...o,theme:'mall'});
export const buildDrainageDistrict=o=>buildLargeDistrict({...o,theme:'drainage'});
