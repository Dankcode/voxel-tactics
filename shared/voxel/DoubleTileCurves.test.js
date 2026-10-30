import test from 'node:test';
import assert from 'node:assert/strict';
import {VoxelStore} from './VoxelStore.js';
import {MAT,AIR} from './Materials.js';
import {doubleCurveFootprint,stampDoubleCurve,roundRoadCorners} from './DoubleTileCurves.js';
import {collisionFootprint,containsPoint,intersectCellShape} from './ConnectedShapes.js';
import {coverAgainst,COVER} from './Cover.js';
import {packMission,unpackMission} from '../session/MissionSnapshot.js';
import {createMap} from '../mission/modern/MapKit.js';

test('two-tile curves share exact clipped seams for every orientation and stay within cell bounds',()=>{
 for(let turn=0;turn<4;turn++)for(const kind of ['wall','floor']){
  const polys=Array.from({length:4},(_,i)=>doubleCurveFootprint({turn,kind,dx:i%2,dy:i>>1}));
  for(const poly of polys)for(const [x,y]of poly)assert.ok(x>=0&&x<=1&&y>=0&&y<=1);
  for(let row=0;row<2;row++){
   const a=polys[row*2].filter(p=>p[0]===1).map(p=>p[1]).sort(),b=polys[row*2+1].filter(p=>p[0]===0).map(p=>p[1]).sort();
   assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8));
  }
 }
});
test('visible curve and ballistic hit shape agree; the cut-out corner is empty',()=>{
 const s=new VoxelStore(10,10,8);stampDoubleCurve(s,{x:3,y:3,z:1});
 assert.ok(!containsPoint(collisionFootprint(s,3,3,2),.05,.05));
 assert.equal(intersectCellShape(s,3,3,2,[3.05,3,2.5],[0,1,0],0,1),null);
 assert.ok(intersectCellShape(s,3,4,2,[3,4.5,2.5],[1,0,0],0,1));
 assert.ok(!s.surfaces(3,3).some(p=>p.z===3),'no standing on the empty corner of a shaped wall top');
 s.set(3,4,2,AIR);assert.equal(s.get(3,4,2),AIR);assert.equal(collisionFootprint(s,3,4,2),null);
});
test('curved cover combines diagonal modules, flanks correctly and loses protection after destruction',()=>{
 const s=new VoxelStore(10,10,8);stampDoubleCurve(s,{x:3,y:3,z:1});
 assert.equal(coverAgainst(s,5,4,1,0,0),COVER.FULL);
 assert.equal(coverAgainst(s,5,4,1,9,4),COVER.NONE);
 stampDoubleCurve(s,{x:3,y:3,z:1,height:1});for(let y=3;y<=4;y++)for(let x=3;x<=4;x++)s.set(x,y,3,AIR);
 assert.equal(coverAgainst(s,5,4,1,0,0),COVER.HALF);
 for(let y=3;y<=4;y++)for(let x=3;x<=4;x++)s.set(x,y,2,AIR);
 assert.equal(coverAgainst(s,5,4,1,0,0),COVER.NONE);
});
test('curve shapes survive cloning and co-op mission snapshots without sharing mutable records',()=>{
 const s=new VoxelStore(10,10,8);stampDoubleCurve(s,{x:3,y:3,z:1,turn:2});
 for(const copy of [s.clone(),unpackMission(packMission({store:s})).store])assert.deepEqual([...copy.curveCells],[...s.curveCells]);
 const copy=s.clone();copy.curveCells.values().next().value.turn=1;assert.equal(s.curveCells.values().next().value.turn,2);
});
test('modern buildings are square by default; authored curves remain available',()=>{
 const m=createMap({id:'curve-test',width:35,depth:20});
 const plain=m.building({id:'ordinary',program:'office',x0:2,y0:3,w:12,d:10,storeys:1,furnish:false});
 const curved=m.building({id:'landmark',program:'office',x0:20,y0:3,w:12,d:10,storeys:1,furnish:false,edgeStyle:'curved'});
 assert.equal(plain.era,'modern');assert.equal(plain.rounded,false);assert.ok(m.store.squareCorners.has('2,3'));
 assert.equal(curved.rounded,true);assert.ok(m.store.curveCells.has('20,3,2'));
});

test('shape-only edits invalidate surface caches',()=>{
 const s=new VoxelStore(10,10,8);stampDoubleCurve(s,{x:3,y:3,z:1});
 s.profileSurfaceCache.set('human',new Map([[33,['stale']]]));const before=s.version;
 stampDoubleCurve(s,{x:3,y:3,z:1,turn:1});assert.ok(s.version>before);assert.equal(s.profileSurfaceCache.get('human').has(33),false);
});

test('curve prefabs preserve shapes under every rotation and reflection',async()=>{
 const {bakePrefab,stampPrefab,transformFor}=await import('../mapgen/geo/BuildingPrefab.js');
 const m=createMap({id:'source',width:24,depth:24});m.building({id:'round',program:'office',x0:3,y0:3,w:12,d:10,storeys:1,furnish:false,rounded:true});
 const mission={store:m.store,buildings:m.buildings,rooms:m.ctx.rooms,visual:{hints:m.ctx.hints,decor:m.ctx.decor}},prefab=bakePrefab(mission,'round');assert.ok(prefab.curves.length>0);
 for(const mirror of [false,true])for(let rot=0;rot<4;rot++){
  const dest=createMap({id:'dest',width:30,depth:30});stampPrefab(dest,prefab,{x:4,y:4,z:1,rot,mirror});
  const T=transformFor(prefab.size,{rot,mirror});
  for(const [x,y,z,spec]of prefab.curves){
   const [cx,cy]=T.cell([x,y]),actualSpec=dest.store.curveCells.get(`${cx+4},${cy+4},${z+1}`),actual=doubleCurveFootprint(actualSpec);
   if(spec.underlay!=null)assert.equal(collisionFootprint(dest.store,cx+4,cy+4,z+1),null);
   const expected=doubleCurveFootprint(spec).map(([px,py])=>{const [a,b]=T.point([x+px,y+py]);return[a-cx,b-cy];});
   assert.equal(actual.length,expected.length);
   for(const p of expected)assert.ok(actual.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-7));
  }
 }
});

test('diagonal curved timber reports penetrable cover rather than hard concrete',async()=>{
 const {hardCoverAgainst}=await import('./Cover.js');
 const s=new VoxelStore(10,10,8);stampDoubleCurve(s,{x:3,y:3,z:1,wall:'timber'});
 assert.deepEqual(hardCoverAgainst(s,5,4,1,0,0),{level:COVER.FULL,soft:true});
});


test('curved floors retain a complete square terrain layer without modifying the lower voxel',()=>{
 const s=new VoxelStore(12,12,8);s.datum=1;s.fill(0,0,0,11,11,1,'paving');const lower=s.get(3,3,0);
 stampDoubleCurve(s,{x:3,y:3,z:1,floor:'concrete'});
 assert.equal(s.get(3,3,0),lower);assert.equal(s.curveCells.get('3,3,1').underlay,MAT.paving);
 assert.equal(collisionFootprint(s,3,3,1),null);assert.ok(s.surfaces(3,3).some(p=>p.z===1)===false,'wall remains above the complete terrain');
 for(let turn=0;turn<4;turn++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const inside=doubleCurveFootprint({turn,dx,dy,kind:'floor'}),outside=doubleCurveFootprint({turn,dx,dy,kind:'apron'});
  for(const x of [.05,.35,.65,.95])for(const y of [.05,.35,.65,.95])assert.ok(containsPoint(inside,x,y)||containsPoint(outside,x,y),'ground has no uncovered cut-out');
 }
});
test('road intersections retain open carriageways and get four connected two-tile curb arcs',()=>{
 const m=createMap({id:'roads',width:20,depth:20,ground:'paving'});m.roadX(6,8);m.roadY(6,8);
 assert.ok([MAT.asphalt,MAT.road_mark].includes(m.store.get(5,7,1)));
 assert.equal(roundRoadCorners(m.store),4);
 assert.equal([...m.store.curveCells.values()].filter(s=>s.underlay===MAT.asphalt).length,16);
});

test('building curves preserve the actual adjoining floor and roof materials per tile and storey',async()=>{
 const {curveBuildingCorners}=await import('./DoubleTileCurves.js');
 const s=new VoxelStore(16,16,12);s.datum=1;
 const b={rounded:true,x0:3,y0:3,w:8,d:8,baseZ:1,storeys:2};
 s.fill(0,0,0,15,15,1,'paving');
 for(const [z,mat]of [[1,'carpet'],[4,'oak_floor'],[7,'concrete']])s.fill(3,3,z,10,10,z,mat);
 s.set(4,4,1,MAT.ceramic); // A wet room meeting the same corner retains its authored finish.
 const before=new Map();for(const z of [1,4,7])for(let y=3;y<=10;y++)for(let x=3;x<=10;x++)before.set(`${x},${y},${z}`,s.get(x,y,z));
 curveBuildingCorners(s,b,{floor:'concrete',roof:'ceramic'});
 for(const [key,spec]of s.curveCells)if(spec.kind==='floor'){
  const p=key.split(',').map(Number);assert.equal(s.get(...p),before.get(key));assert.equal(spec.material,before.get(key));
 }
 // Reapplying glazing/corner styling must not recolour the floor either.
 curveBuildingCorners(s,b,{wall:'glass',floor:'paving'});
 assert.equal(s.get(4,4,1),MAT.ceramic);assert.equal(s.get(3,3,4),MAT.oak_floor);
});
