import test from 'node:test';
import assert from 'node:assert/strict';
import reference from './reference/more-maps-pack.json' with {type:'json'};
import {parseXcomMapDefinitions,selectParcel,solveReferenceParcels} from './ParcelFormula.js';
import {BURGER_DISTRICT_SITE} from '../mission/generated/BurgerDistrict.js';
import {solveSite} from './SiteSolver.js';
import {rasterRoadNetwork} from './RoadGeometry.js';
test('the supplied pack contains eight active parcels, three plots and one cover piece',()=>{
    assert.equal(reference.parcels.length,8);assert.equal(reference.plots.length,3);assert.equal(reference.coverPieces.length,1);
    assert.equal(reference.coverPieces[0].width,16);assert.equal(reference.coverPieces[0].length,16);
    assert.ok(reference.parcels.some(p=>p.entrances.some(e=>e.socket===2)));
    assert.ok(!reference.coverPieces.some(p=>p.id.includes('AdventWall')),'commented cancelled entries stay excluded');
});
test('INI continuation and comments cannot create active definitions or change indexed entrance sockets',()=>{
    const parsed=parseXcomMapDefinitions({'test.ini':';+arrAllParcelDefinitions=(MapName="bad")\n+arrAllParcelDefinitions=(MapName="ok",eSize=eParcelSizeType_Medium,\\\narrPlotTypes[0]=(strPlotType="SmallTown"),arrZoneTypes[0]="Retail",bHasEntranceN2=true,eFacing=EParcelFacingType_S)'});
    assert.equal(parsed.parcels.length,1);assert.equal(parsed.parcels[0].id,'ok');assert.deepEqual(parsed.parcels[0].entrances,[{side:'n',socket:2}]);
});
test('parcel filtering enforces size, zone, mission tags and entrance contracts before seeded selection',()=>{
    const slot={id:'objective',size:'medium',plotType:'SmallTown',zone:'Retail',program:'diner',objectiveTag:'Recover',entrances:['street','service'],front:'w'};
    const result=selectParcel(slot);assert.equal(result.sourceProfile,'md_AdventSecurity_daz_01');assert.equal(result.front,'w');
    assert.throws(()=>selectParcel({...slot,objectiveTag:'Incompatible'}),/parcel.compatibility/);
    assert.throws(()=>selectParcel({...slot,size:'large'}),/parcel.compatibility/);
    assert.deepEqual(result,selectParcel(slot));
});
test('reference parcels preserve every footprint, one uniform transform, and building ownership over roads',()=>{
    const s=solveSite(BURGER_DISTRICT_SITE),p=solveReferenceParcels(BURGER_DISTRICT_SITE,s.buildings);
    assert.equal(p.length,BURGER_DISTRICT_SITE.buildings.length);assert.equal(p.filter(p=>p.objectiveTag).length,1);
    assert.ok(s.congruence.every(c=>c.iou>=.85));assert.ok(s.width>64&&s.width<=192);
    const owned=(x,y)=>s.buildings.some(b=>x>=b.x0&&y>=b.y0&&x<b.x0+b.w&&y<b.y0+b.d);
    assert.ok(rasterRoadNetwork(s.roads,s.width,s.depth,{blocked:owned}).every(c=>!owned(c.x,c.y)));
});

test('the selected region excludes right-side lots and preserves source scale rather than stretching the crop',async()=>{
    const {FULL_BURGER_DISTRICT_SITE}=await import('../mission/generated/BurgerDistrict.js');
    const {pointInRegion}=await import('./RoadGeometry.js');
    const {cropReferenceRegion}=await import('./ReferenceRegion.js');
    const selected=cropReferenceRegion(FULL_BURGER_DISTRICT_SITE,[0,0,.775,.92],{buildingIds:['west-retail','north-diner','central-diner']});
    assert.deepEqual(selected.buildings.map(b=>b.id),['west-retail','north-diner','central-diner']);
    for(const b of selected.buildings){const old=FULL_BURGER_DISTRICT_SITE.buildings.find(c=>c.id===b.id);assert.ok(Math.abs((b.bounds[2]-b.bounds[0])*selected.frame.width-(old.bounds[2]-old.bounds[0])*FULL_BURGER_DISTRICT_SITE.frame.width)<1e-8);}
    assert.equal(pointInRegion(selected.playableBoundary,.95,.12),false);
    assert.ok(selected.roads.every(r=>r.points.every(p=>p.every(n=>n>=0&&n<=1))));
});
