const URBAN_STREET_PROPS={jersey:DOWNTOWN_PROPS.jersey,bins:DOWNTOWN_PROPS.bins,newsstand:DOWNTOWN_PROPS.newsstand,pallets:DOCKS_PROPS.pallets};
import {createMap} from './modern/MapKit.js';
import {DOCKS_PROPS,DOWNTOWN_PROPS} from './PropCatalog.js';
import {MAT} from '../voxel/Materials.js';
/** A rotated street connector: three adjacent lanes, not a freestanding stair shaft. */
function roadRamp(m,{x,y,dx=1,dy=0,width=3,up=false}) {
    const cells=[];
    for(let i=0;i<4;i++)for(let lane=0;lane<width;lane++) {
        const px=x+dx*i-dy*lane,py=y+dy*i+dx*lane,z=up?1+i:4-i;
        for(let h=z+1;h<=6;h++)m.store.set(px,py,h,0);
        m.store.set(px,py,z,MAT.paving);m.reserve(px-1,py-1,px+1,py+1);cells.push({x:px,y:py,z});
    }
    return {id:`road-ramp-${x}-${y}`,template:'lower-street-ramp',cells,sockets:[cells[0],cells[cells.length-width]]};
}
function dressBuildings(m) {
    for(const b of m.buildings) {
        for(const dx of [2,5]) {m.decorAt('rooftop_vent',b.x0+dx,b.y0+2,{z:b.top+1});m.decorAt('cable_spool',b.x0+dx,b.y0+5,{z:b.top+1});}
        for(const dy of [2,5])m.decorAt('wall_sign',b.x0-.5,b.y0+dy,{z:b.baseZ+2,yaw:-Math.PI/2,free:true});
    }
}
export function buildSunkenBoulevard({seed=1}={}) {
    const m=createMap({id:'sunken-boulevard',width:56,depth:40,height:16,seed,datum:4,ground:'paving'}),s=m.store;
    m.roadY(25,31,0,39,{curb:null});
    const parcels=[];
    // Two lower street parcels meet a roofed crossing beneath the upper boulevard.
    for(let x=7;x<=48;x++)for(let y=18;y<=24;y++) {
        s.set(x,y,1,MAT.asphalt);for(let z=2;z<=4;z++)s.set(x,y,z,0);
        if(x>=25&&x<=31)s.set(x,y,4,MAT.asphalt);
        m.reserve(x,y,x,y);
    }
    parcels.push(roadRamp(m,{x:4,y:18,width:7}),roadRamp(m,{x:48,y:18,width:7,up:true}));
    for(let x=7;x<=48;x++)for(const y of [17,25])for(let z=2;z<=4;z++)s.set(x,y,z,z===4&&x>=25&&x<=31?MAT.asphalt:MAT.concrete_wall);
    for(const x of [25,31])m.line(x,17,9,'y','railing',1,4);
    for(let x=10;x<=45;x+=5)for(const y of [18,24])m.line(x,y,1,'x','crate',1,1);
    for(const x of [20,35])m.line(x,20,2,'y','crate',2,1);
    m.building({id:'corner-shop',program:'shop',x0:7,y0:4,w:12,d:10,baseZ:4,storeys:1,front:'s'});
    m.building({id:'transit-office',program:'office',x0:35,y0:28,w:12,d:10,baseZ:4,storeys:1,front:'n',rounded:false});
    m.reserve(1,16,6,27);m.reserve(46,16,53,27);
    m.scatter(URBAN_STREET_PROPS,{maxGap:3,targetShare:.3,blocked:(x,y)=>y>=17&&y<=25});
    const lowerCells=[];for(let x=8;x<=47;x++)lowerCells.push({x,y:21,z:1});
    dressBuildings(m);
    return m.finish({name:'Sunken Boulevard',spawns:{player:[{x:2,y:18,z:4},{x:2,y:20,z:4},{x:3,y:22,z:4},{x:2,y:24,z:4},{x:4,y:26,z:4},{x:4,y:16,z:4}],enemy:[{type:'warden_foe',group:0,pos:{x:38,y:21,z:1}},{type:'cultist',group:1,pos:{x:42,y:32,z:4}}]},objective:{kind:'eliminate',text:'Clear the checkpoint across the sunken boulevard and its upper crossing.'},meta:{theme:'Split-level districts',lighting:'overcast',streetDatum:4,cutLevels:[4,7,Infinity],floorNames:{4:'Lower street',7:'Upper street'},connectionParcels:[...parcels,{id:'covered-crossing',template:'boulevard-underpass',sockets:[{x:24,y:21,z:1},{x:32,y:21,z:1}],cells:lowerCells.filter(p=>p.x>=25&&p.x<=31)}],lowerStreet:lowerCells,defaultCut:7}});
}
export function buildFreightTerraces({seed=1}={}) {
    const m=createMap({id:'freight-terraces',width:56,depth:40,height:16,seed,ground:'concrete'}),s=m.store;
    m.roadX(30,33);m.roadY(3,6,0,39);
    // Raised loading deck, connected by a broad vehicle ramp. The deck is ground for a low warehouse.
    for(let x=25;x<=49;x++)for(let y=6;y<=25;y++)for(let z=2;z<=4;z++)s.set(x,y,z,MAT.concrete);
    const ramp=roadRamp(m,{x:21,y:18,width:5,up:true});
    m.building({id:'freight-office',program:'office',rounded:false,x0:9,y0:6,w:10,d:10,storeys:1,front:'s'});
    m.building({id:'raised-depot',program:'warehouse',rounded:false,x0:32,y0:8,w:14,d:12,baseZ:4,storeys:1,front:'s'});
    for(const y of [20,26]){m.container(10,y);m.container(15,y);}
    // Service catwalk above the cargo lane, reached from supported steps at both ends.
    for(let x=19;x<=28;x++){const z=x<22?4+(x-19):x>25?7-(x-25):7;s.set(x,5,z,MAT.grate);for(let h=2;h<z;h++)s.set(x,5,h,MAT.steel_post);for(const y of [4,6]){for(let h=2;h<=z;h++)s.set(x,y,h,MAT.steel_post);s.set(x,y,z+1,MAT.railing);}m.reserve(x-1,4,x+1,6);}
    m.line(26,7,3,'y','crate',1,4);
    for(let x=26;x<=49;x+=4)m.line(x,24,2,'x','sandbag',1,4);
    m.line(7,24,3,'x','sandbag');m.line(7,29,3,'x','sandbag');
    m.reserve(1,24,7,29);m.reserve(20,16,26,25);
    m.scatter(DOCKS_PROPS,{maxGap:2,targetShare:.3,blocked:(x,y)=>x>=20&&x<=26&&y>=16&&y<=25});
    dressBuildings(m);
    return m.finish({name:'Freight Terraces',spawns:{player:[{x:2,y:25,z:1},{x:2,y:27,z:1},{x:3,y:26,z:1},{x:4,y:25,z:1},{x:4,y:27,z:1},{x:5,y:26,z:1}],enemy:[{type:'warden_foe',group:0,pos:{x:43,y:23,z:4}},{type:'cultist',group:1,pos:{x:44,y:12,z:4}}]},objective:{kind:'eliminate',text:'Secure the freight terminal using its loading ramp, warehouse and service catwalk.'},meta:{theme:'Split-level districts',lighting:'dusk',streetDatum:1,cutLevels:[4,7,10,Infinity],floorNames:{4:'Freight yard',7:'Loading deck',10:'Catwalk'},connectionParcels:[ramp,{id:'freight-catwalk',template:'service-catwalk',sockets:[{x:19,y:5,z:4},{x:28,y:5,z:4}]}],defaultCut:7}});
}

/** Matching lower-street sockets compose straight, covered crossing and T-junction parcels. */
export function buildSunkenJunction({seed=1}={}) {
 const m=createMap({id:'sunken-junction',width:64,depth:56,height:16,seed,datum:4,ground:'paving'}),s=m.store;
 m.roadY(28,34,0,55,{curb:null});
 const streets=[{id:'north-boulevard',x0:7,x1:56,y0:18,y1:24},{id:'south-boulevard',x0:7,x1:56,y0:40,y1:46}];
 for(const street of streets) {
  for(let x=street.x0;x<=street.x1;x++)for(let y=street.y0;y<=street.y1;y++){s.set(x,y,1,MAT.asphalt);for(let z=2;z<=4;z++)s.set(x,y,z,0);if(x>=28&&x<=34)s.set(x,y,4,MAT.asphalt);m.reserve(x,y,x,y);}
  for(let x=7;x<=56;x++)for(const y of [street.y0-1,street.y1+1])for(let z=2;z<=4;z++)s.set(x,y,z,z===4&&x>=28&&x<=34?MAT.asphalt:MAT.concrete_wall);
  for(let x=11;x<=54;x+=6)for(const y of [street.y0,street.y1])m.line(x,y,1,'x','crate',1,1);
 }
 for(const street of streets)for(const x of [28,34])m.line(x,street.y0-1,9,'y','railing',1,4);
 for(const y of [2,10,15,28,35,50,54])for(const x of [28,34])m.line(x,y,1,'x','jersey',1,4);
 for(let x=48;x<=54;x++)for(let y=24;y<=40;y++){s.set(x,y,1,MAT.asphalt);for(let z=2;z<=4;z++)s.set(x,y,z,0);m.reserve(x,y,x,y);}
 for(const x of [47,55])for(let y=25;y<40;y++)for(let z=2;z<=4;z++)s.set(x,y,z,MAT.concrete_wall);
 const ramps=[];for(const y of [18,40])ramps.push(roadRamp(m,{x:4,y,width:7}),roadRamp(m,{x:56,y,width:7,up:true}));
 m.building({id:'corner-retail',program:'shop',x0:7,y0:4,w:12,d:10,baseZ:4,storeys:1,front:'s',rounded:true});
 m.building({id:'transit-diner',program:'diner',x0:40,y0:4,w:12,d:10,baseZ:4,storeys:1,front:'s',rounded:true});
 m.building({id:'freight-depot',program:'warehouse',x0:7,y0:27,w:14,d:10,baseZ:4,storeys:1,front:'n',rounded:false});
 m.building({id:'repair-bay',program:'garage',x0:36,y0:27,w:10,d:10,baseZ:4,storeys:1,front:'n',rounded:false});
 m.car(23,5,'y');m.car(58,7,'y');m.car(23,50,'x');
 m.reserve(29,0,33,55);
 m.reserve(1,14,6,27);m.reserve(2,37,6,49);
 m.scatter(URBAN_STREET_PROPS,{maxGap:3,targetShare:.3,blocked:(x,y)=>streets.some(p=>y>=p.y0-1&&y<=p.y1+1)||x>=47&&x<=55&&y>=24&&y<=40});
 dressBuildings(m);
 const connectors=[...ramps,{id:'north-boulevard',template:'sunken-straight',sockets:[{x:7,y:21,z:1},{x:51,y:21,z:1}]},{id:'east-link',template:'sunken-T-junction',sockets:[{x:51,y:21,z:1},{x:51,y:43,z:1}]},{id:'south-boulevard',template:'sunken-straight',sockets:[{x:51,y:43,z:1},{x:7,y:43,z:1}]}];
 return m.finish({name:'Sunken Junction',spawns:{player:[{x:2,y:18,z:4},{x:2,y:20,z:4},{x:3,y:22,z:4},{x:2,y:24,z:4},{x:4,y:26,z:4},{x:4,y:16,z:4}],enemy:[{type:'warden_foe',group:0,pos:{x:12,y:32,z:4}},{type:'cultist',group:1,pos:{x:38,y:43,z:1}}]},objective:{kind:'eliminate',text:'Secure the linked boulevards, freight depot and repair district.'},meta:{theme:'Split-level districts',lighting:'overcast',streetDatum:4,cutLevels:[4,7,Infinity],floorNames:{4:'Lower streets',7:'Upper district'},connectionParcels:connectors,parcelGraph:[['north-boulevard','east-link'],['east-link','south-boulevard']],designDecisions:['Two sunken streets share same-height sockets through an east T-junction.','Upper boulevard crosses both streets on covered parcels.','Retail/diner use rounded corners; depot/garage use square corners.','Street dressing uses barriers, vending, bins and freight pallets, without park benches or bushes.'],defaultCut:7}});
}
