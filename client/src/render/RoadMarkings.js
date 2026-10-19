// PLAN-12 road paint. Presentation only: thin, centred markings drawn over the asphalt instead of whole painted voxel
// cells (a 1 m cell cannot centre a line on a 4-cell carriageway, and cell-sized zebras read as a checkerboard).
//
//  - A carriageway is a straight run of 3–6 asphalt cells across, bounded by non-road on both sides (kerbs).
//  - Each carriageway gets a dashed centre line (2 m dash, 2 m gap) exactly on its centre.
//  - Where a carriageway opens into a junction (the next cell is road but no longer a carriageway), a zebra crossing
//    is painted across it: bars along the traffic direction, spaced across the road.
// Junction boxes, car parks and plazas (wider asphalt) get no paint. Rebuilt after destruction (craters lose paint).
import * as THREE from 'three';
import { MAT } from '../../../shared/voxel/Materials.js';
import { renderFor } from './RenderTable.js';

const LINE = 0.12, DASH = 2, BAR = 0.36, BAR_GAP = 0.34;

/** Pure planner (testable): road cells → { dashes: [{x0,y0,x1,y1,z}], bars: [...] } rectangles in world x/y. */
export function planRoadPaint(store, isRoad = id => id === MAT.asphalt || id === MAT.road_mark) {
    const W = store.width, D = store.depth, top = new Int16Array(W * D).fill(-1);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) { const z = store.topSolid(x, y); if (z >= 0 && isRoad(store.get(x, y, z))) top[x + y * W] = z; }
    const road = (x, y) => x >= 0 && y >= 0 && x < W && y < D ? top[x + y * W] : -1;
    const dashes = [], bars = [];
    // band[axis][x+y*W] = { lo, len } when the cell belongs to a carriageway running along that axis.
    const bands = { x: new Map(), y: new Map() };
    for (const axis of ['x', 'y']) {
        const outer = axis === 'x' ? W : D, inner = axis === 'x' ? D : W;
        for (let a = 0; a < outer; a++) {
            let b = 0;
            while (b < inner) {
                const at = i => axis === 'x' ? road(a, i) : road(i, a), z = at(b);
                if (z < 0) { b++; continue; }
                let e = b; while (e + 1 < inner && at(e + 1) === z) e++;
                const len = e - b + 1;
                if (len >= 3 && len <= 6 && at(b - 1) !== z && at(e + 1) !== z) for (let i = b; i <= e; i++) bands[axis].set(axis === 'x' ? a + i * W : i + a * W, { lo: b, len, z });
                b = e + 1;
            }
        }
    }
    for (const [axis, band] of Object.entries(bands)) for (const [key, s] of band) {
        const x = key % W, y = Math.floor(key / W), along = axis === 'x' ? x : y;
        if (s.lo !== (axis === 'x' ? y : x)) continue;                 // one entry per carriageway slice
        const c = s.lo + s.len / 2;
        if (Math.floor(along / DASH) % 2 === 0) dashes.push(axis === 'x' ? { x0: x, x1: x + 1, y0: c - LINE / 2, y1: c + LINE / 2, z: s.z } : { x0: c - LINE / 2, x1: c + LINE / 2, y0: y, y1: y + 1, z: s.z });
        // Zebra where the carriageway meets a junction (or a wider paved area) on either end.
        for (const dir of [-1, 1]) {
            const nx = axis === 'x' ? x + dir : x, ny = axis === 'x' ? y : y + dir;
            if (road(nx, ny) !== s.z || band.has(nx + ny * W)) continue;
            for (let o = s.lo + 0.25; o + BAR <= s.lo + s.len - 0.2; o += BAR + BAR_GAP)
                bars.push(axis === 'x' ? { x0: x + 0.1, x1: x + 0.9, y0: o, y1: o + BAR, z: s.z } : { x0: o, x1: o + BAR, y0: y + 0.1, y1: y + 0.9, z: s.z });
        }
    }
    return { dashes, bars };
}

export class RoadMarkings {
    constructor(scene) {
        this.scene = scene; this.group = new THREE.Group(); this.group.name = 'road-paint'; scene.scene.add(this.group);
        this.material = new THREE.MeshStandardMaterial({ color: 0xe9e4d4, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        this.cut = Infinity; this.z = 0;
    }
    build(store) {
        this.clear();
        const { dashes, bars } = planRoadPaint(store), drop = renderFor('asphalt').drop || 0;
        const pos = [], idx = [];
        for (const r of [...dashes, ...bars]) {
            const h = r.z + 1 - drop + 0.012, b = pos.length / 3;
            pos.push(r.x0, h, r.y0, r.x1, h, r.y0, r.x1, h, r.y1, r.x0, h, r.y1);
            idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
            this.z = Math.max(this.z, r.z);
        }
        if (!idx.length) return;
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, this.material); mesh.receiveShadow = true; mesh.renderOrder = 2;
        this.group.add(mesh); this.setCut(this.cut);
    }
    setCut(top) { this.cut = top; this.group.visible = !(top <= this.z); }
    clear() { for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); } }
}
