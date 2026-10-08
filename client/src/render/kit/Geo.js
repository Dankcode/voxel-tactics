// Geometry helpers shared by the tile-set piece modules (KitPieces.js, ModernPieces.js). Pure three.js, no DOM.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const WALL_T = 0.4;            // wall thickness (a voxel is ~0.9 m; XCOM-like thin walls)
export const ARM = 0.5 - WALL_T / 2;

// ------------------------------------------------------------------------------------------- helpers
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
export function clean(g) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }
export function merge(list) {
    const parts = list.filter(Boolean).map(g => { const n = g.index ? g.toNonIndexed() : g; if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; });
    const m = mergeGeometries(parts.map(p => { for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k); return p; }), false);
    m.computeBoundingBox(); m.computeBoundingSphere();
    return m;
}
/** Rounded box: a box whose corners are pulled in (cheap bevel) — used for bags, bales, crates. */
export function softBox(w, h, d, r, seg = 2) {
    const g = new THREE.BoxGeometry(w, h, d, seg + 2, seg + 2, seg + 2);
    const p = g.attributes.position, v = new THREE.Vector3();
    const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const c = new THREE.Vector3(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
        const dir = v.clone().sub(c);
        if (dir.lengthSq() > 1e-9) v.copy(c.add(dir.normalize().multiplyScalar(r)));
        p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
}
/** Lumpy rock / foliage blob: an icosphere with deterministic radial noise. */
export function blob(radius, detail, seed, squash = [1, 1, 1], amp = 0.18) {
    const g = new THREE.IcosahedronGeometry(radius, detail);
    const p = g.attributes.position, v = new THREE.Vector3(), r = rng(seed);
    const bumps = Array.from({ length: 7 }, () => [new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), (r() - 0.3) * amp]);
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = v.clone().normalize();
        let k = 1;
        for (const [d, a] of bumps) k += a * Math.max(0, n.dot(d)) ** 3;
        v.copy(n.multiplyScalar(radius * k)).multiply(new THREE.Vector3(...squash));
        p.setXYZ(i, v.x, v.y, v.z);
    }
    const flat = g.index ? g.toNonIndexed() : g; flat.computeVertexNormals();
    return flat;
}

/** Cylinder along Y (base at y = 0). */
export const cyl = (rTop, rBot, h, seg = 12, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(x, y + h / 2, z);
/** Wheel / disc along Z. */
export const disc = (r, w, seg = 16, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(r, r, w, seg).rotateX(Math.PI / 2).translate(x, y, z);
/** A side profile (points [x, y] in the XY plane) extruded along Z by `depth`, centred on z = 0. */
export function profileX(points, depth, bevel = 0) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    return g.translate(0, 0, -depth / 2);
}
/** A cross-section (points [z, y]) extruded along X by `length`, centred on x = 0 — barriers, kerbs. */
export function profileZ(points, length) {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    return new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(length / 2, 0, 0);
}
