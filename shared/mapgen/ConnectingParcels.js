import reference from './reference/more-maps-pack.json' with {type:'json'};
import {MAT} from '../voxel/Materials.js';
/** Original connecting modules: rotated footprints and matching surface/lower-level sockets.
 * The imported PCP declaration supplies a selection contract, never Unreal geometry. */
export const CONNECTOR_PARCELS=Object.freeze({
    street_portal:{id:'street-underpass-portal',width:5,length:4,type:'Straight',surface:4,lower:1},
    service_headhouse:{id:'service-headhouse',width:5,length:5,type:'Terminal',surface:4,lower:1},
    freight_ramp:{id:'freight-loading-ramp',width:5,length:4,type:'Straight',surface:4,lower:1}
});
export function connectionContract(entrance,index=0) {
    const template=entrance.kind==='manhole'?CONNECTOR_PARCELS.service_headhouse:CONNECTOR_PARCELS.street_portal;
    return {id:`connector-${index}`,template:template.id,sourceProfile:reference.coverPieces[0]?.id||null,
        x:entrance.x,y:entrance.y,dir:entrance.dir||null,sockets:[{level:'street',x:entrance.x+(entrance.kind==='manhole'?1:(entrance.dir?.[0]||0)*3),y:entrance.y+(entrance.kind==='manhole'?0:(entrance.dir?.[1]||0)*3),z:4},{level:'lower',x:entrance.x,y:entrance.y,z:1}],width:template.width,length:template.length};
}
/** Wrap access in a retained frontage/roof, so shafts are enclosed architectural parcels. */
export function finishConnectionParcel(m,entrance,dir,index) {
    m.connectorFootprint ||= new Set();
    const s=m.store,contract=connectionContract({...entrance,dir},index),cells=[];
    const put=(x,y,z,mat)=>{if(!s.inBounds(x,y,z)||(z>=5&&z<=6&&m.connectorPaths?.has(`${x},${y}`)))return;const building=m.buildings.find(b=>x>=b.x0-1&&x<=b.x0+b.w&&y>=b.y0-1&&y<=b.y0+b.d);if(building)return;s.set(x,y,z,mat);cells.push([x,y,z]);};
    if(entrance.kind==='manhole') {
        // A service headhouse encloses the shaft and backing wall, with an open street doorway at the front.
        for(let dx=-1;dx<=2;dx++)for(let dy=-2;dy<=2;dy++) {
            if(dx===-1&&(dy===-2||dy===2))for(let z=5;z<=6;z++)put(entrance.x+dx,entrance.y+dy,z,MAT.concrete_wall);
            put(entrance.x+dx,entrance.y+dy,7,MAT.roof);
        }
    } else {
        const [dx,dy]=dir;
        for(let i=0;i<4;i++) {
            const x=entrance.x+dx*i,y=entrance.y+dy*i;
            for(const side of [-2,2])for(let z=5;z<=6;z++)put(x-dy*side,y+dx*side,z,MAT.concrete_wall);
            for(let side=-2;side<=2;side++)put(x-dy*side,y+dx*side,7,MAT.roof);
        }
    }
    // Every canopy component needs an anchor on intact street ground; clipped/unsupported roofs are omitted.
    const roof=new Set(cells.filter(([, ,z])=>z===7).map(([x,y])=>`${x},${y}`));
    while(roof.size){
        const root=roof.values().next().value,component=[root];roof.delete(root);
        for(let i=0;i<component.length;i++){const [x,y]=component[i].split(',').map(Number);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const key=`${x+dx},${y+dy}`;if(roof.delete(key))component.push(key);}}
        const anchor=component.find(key=>{const [x,y]=key.split(',').map(Number);return s.isSolid(x,y,4)&&!m.connectorPaths?.has(key);});
        if(anchor){const [x,y]=anchor.split(',').map(Number);put(x,y,5,MAT.concrete_wall);put(x,y,6,MAT.concrete_wall);}
        else for(const key of component){const [x,y]=key.split(',').map(Number);s.set(x,y,7,0);}
    }
    const protectedCells=cells.filter(([, ,z])=>z===5||z===6).map(([x,y])=>[x,y]);
    for(const [x,y] of protectedCells){m.connectorFootprint.add(`${x},${y}`);m.reserve(x,y,x,y);}
    return {...contract,cells};
}
