// A playable architecture/traversal lab: no random dressing obscures the test lanes.
import { createMap } from './modern/MapKit.js';
import { SUBURB_PROPS } from './PropCatalog.js';
import { curveBuildingCorners } from '../voxel/DoubleTileCurves.js';
import { MAT } from '../voxel/Materials.js';
export const ARCHITECTURE_YARD_ID='architecture-yard';
export function buildArchitectureYard({seed=1}={}) {
    const m=createMap({id:ARCHITECTURE_YARD_ID,width:48,depth:44,height:13,seed,ground:'concrete'});
    m.roadX(20,22);
    m.roadY(20,22,17,23); // Reference junction: paired curved curbs with continuous asphalt.
    m.building({id:'residence',name:'Sash window residence',program:'house',wall:'stucco',x0:5,y0:5,w:12,d:12,storeys:2,front:'s',furnish:false});
    m.building({id:'factory',name:'Steel window workshop',program:'warehouse',wall:'siding',x0:27,y0:5,w:14,d:12,storeys:2,front:'s',furnish:false});
    const pavilion=m.building({id:'pavilion',name:'Curved glass pavilion',rounded:true,program:'office',wall:'concrete_wall',x0:29,y0:26,w:12,d:12,storeys:2,front:'s',furnish:false});
    // Rounded curtain-glass corners and uninterrupted bands wrap both lower floors.
    for(let floor=0;floor<2;floor++)for(let y=pavilion.y0;y<pavilion.y0+pavilion.d;y++)for(let x=pavilion.x0;x<pavilion.x0+pavilion.w;x++) {
        if(x!==pavilion.x0&&y!==pavilion.y0&&x!==pavilion.x0+pavilion.w-1&&y!==pavilion.y0+pavilion.d-1)continue;
        if(pavilion.doors.some(d=>d.x===x&&d.y===y&&d.storey===floor))continue;
        for(const h of [1,2]){const z=1+floor*3+h;m.store.set(x,y,z,MAT.glass);m.hints[`${x},${y},${z}`]={windowStyle:'curtain'};}
    }
    curveBuildingCorners(m.store,pavilion,{wall:'glass',floor:'concrete',hints:m.hints});
    // Paired diagonal curve modules: low cover with a continuous rounded paving edge.
    m.curve({x:20,y:6,height:1,wall:'concrete_wall',floor:'paving'});
    m.line(22,6,3,'x','concrete_wall',1);m.line(20,8,3,'y','concrete_wall',1);
    m.reserve(19,5,25,11);
    // Adjacent traversal lanes: clear full-height glass versus a solid, vaultable half-height sill.
    for(let x=5;x<=11;x++)for(const z of [2,3]){m.store.set(x,33,z,MAT.glass);m.hints[`${x},33,${z}`]={windowStyle:'curtain'};}
    for(let x=17;x<=23;x++) {
        m.store.set(x,33,2,MAT.concrete_wall);m.store.set(x,33,3,MAT.glass);
        m.hints[`${x},33,3`]={windowStyle:'ribbon'};
    }
    // Residential and factory reference panels on the same test apron.
    for(let x=5;x<=11;x++){m.store.set(x,26,2,MAT.brick);m.store.set(x,26,3,MAT.glass);m.hints[`${x},26,3`]={windowStyle:'sash'};}
    for(let x=17;x<=23;x++){m.store.set(x,26,2,MAT.siding);m.store.set(x,26,3,MAT.glass);m.hints[`${x},26,3`]={windowStyle:'factory'};}
    // Keep the architecture samples clear while furnishing the surrounding combat approaches.
    m.reserve(4,25,12,35);m.reserve(16,25,24,35);m.reserve(10,34,21,41);
    for(let x=2;x<=46;x+=4)m.decorAt('streetlight',x,20,{yaw:0});
    for(const b of m.buildings){m.decorAt('rooftop_vent',b.x0+2,b.y0+2,{z:b.top+1});m.decorAt('wall_vent',b.x0-.45,b.y0+3,{z:b.baseZ+2,yaw:-Math.PI/2,free:true});m.decorAt('wall_sign',b.x0-.45,b.y0+6,{z:b.baseZ+2,yaw:-Math.PI/2,free:true});}
    m.line(13,37,3,'x','sandbag');
    m.scatter(SUBURB_PROPS,{maxGap:4,targetShare:.3});
    return m.finish({name:'Architecture Yard',
        spawns:{player:[{x:12,y:35,z:1},{x:19,y:35,z:1},{x:12,y:39,z:1},{x:24,y:39,z:1},{x:5,y:40,z:1},{x:17,y:40,z:1}],enemy:[{type:'warden_foe',group:0,at:{x:44,y:3}}]},
        objective:{kind:'eliminate',text:'Test glass passages, vaultable window sills and rounded facades.'},
        meta:{kind:'architecture-yard',lighting:'overcast',theme:'Training',defaultCut:Infinity}
    });
}
