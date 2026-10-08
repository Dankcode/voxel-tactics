// Baked silhouettes use the same polygons as cover and ballistics; never bevel a shared cell join.
import * as THREE from 'three';
import { wallFootprint, bandFootprint, BANDS } from '../../../../shared/voxel/ConnectedShapes.js';
import { blob, merge } from './Geo.js';

export function prismGeometry(poly, bottom = 0, top = 1, sides = true) {
    const positions=[], normals=[], uvs=[], indices=[];
    const vertex=(p,h,n)=>{positions.push(p[0]-.5,h,p[1]-.5);normals.push(...n);uvs.push(p[0],p[1]);};
    const triangles=THREE.ShapeUtils.triangulateShape(poly.map(p=>new THREE.Vector2(...p)),[]);
    poly.forEach(p=>vertex(p,top,[0,1,0]));
    for (const [a,b,c] of triangles) indices.push(c,b,a);
    if (sides) {
        const count=positions.length/3;
        poly.forEach(p=>vertex(p,bottom,[0,-1,0]));
        for (const [a,b,c] of triangles) indices.push(count+a,count+b,count+c);
        poly.forEach((p,i)=>{
            const q=poly[(i+1)%poly.length];
            // These flat edges are internal seams against the next module; omit their hidden faces.
            if ((p[0]===0&&q[0]===0)||(p[0]===1&&q[0]===1)||(p[1]===0&&q[1]===0)||(p[1]===1&&q[1]===1)) return;
            const dx=q[0]-p[0],dy=q[1]-p[1],l=Math.hypot(dx,dy),n=[dy/l,0,-dx/l];
            const start=positions.length/3;
            vertex(p,bottom,n);vertex(q,bottom,n);vertex(q,top,n);vertex(p,top,n);
            indices.push(start,start+2,start+1,start,start+3,start+2);
        });
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);
    return g;
}
export const CONNECTED_PIECES={};
for(let mask=0;mask<16;mask++) {
    CONNECTED_PIECES[`joined_wall_${mask}`]={meta:{group:'connected-wall',text:'Rounded connected wall; shared collision silhouette'},build:()=>[{slot:'self',geometry:prismGeometry(wallFootprint(mask))}]};
    CONNECTED_PIECES[`joined_cap_${mask}`]={meta:{group:'connected-wall'},build:()=>[{slot:'cap',geometry:prismGeometry(wallFootprint(mask),1,1.008,false)}]};
}

// Grouped cover: the same post-and-arm silhouette as its collision footprint (ConnectedShapes BANDS). A lone piece is a
// rounded post; touching pieces of the same family merge into one run with rounded outside corners. Each mask has a
// "top" module (the visible height of the cover) and a "full" one used under another piece of the same family.
export const GROUPED = {
    hedge: { slot: 'hedge', top: 0.86 },
    planter: { slot: 'self', top: 0.6, soil: true },
    sandbag: { slot: 'sandbag', top: 0.9 },
    drystone: { slot: 'drystone', top: 0.92 }
};
for (const [family, def] of Object.entries(GROUPED)) {
    const band = BANDS[family];
    for (let mask = 0; mask < 16; mask++) {
        const poly = bandFootprint(mask, band.thickness, band.radius);
        CONNECTED_PIECES[`joined_${family}_${mask}_top`] = { meta: { group: 'connected-cover', text: `Connected ${family} run, top module` }, build: () => {
            const parts = [{ slot: def.slot, geometry: prismGeometry(poly, 0, def.top) }];
            if (def.soil) parts.push({ slot: 'soil', geometry: prismGeometry(bandFootprint(mask, band.thickness - 0.14, band.radius * 0.6), def.top - 0.04, def.top + 0.005, false) });
            return parts;
        } };
        CONNECTED_PIECES[`joined_${family}_${mask}_full`] = { meta: { group: 'connected-cover' }, build: () => [{ slot: def.slot, geometry: prismGeometry(poly, 0, 1) }] };
    }
}
// Planting in a planter cell (drawn per cell on top of the connected trough).
CONNECTED_PIECES.planter_plants = { meta: { group: 'connected-cover', text: 'Shrubs and flowers in a planter cell', overhang: true }, build: () => [
    { slot: 'leaves', geometry: merge([blob(0.24, 1, 3, [1.2, 0.8, 1], 0.3).translate(-0.18, 0.72, 0), blob(0.22, 1, 8, [1, 1.1, 1], 0.3).translate(0.2, 0.74, 0.05)]) },
    { slot: 'flowers', geometry: merge([blob(0.07, 0, 2).translate(-0.05, 0.86, 0.18), blob(0.07, 0, 4).translate(0.3, 0.84, -0.16)]) }
] };
