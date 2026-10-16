// PLAN-07 visible damage. Presentation only: reads the voxel store and never changes it.
//
//   cracks   voxels at ≤ 66 % HP get a cracked overlay on their exposed faces, ≤ 33 % a heavy one
//   scars    a surviving voxel next to a shot-out / blown-out cell (store.scars) shows broken material on the face
//            toward the hole, and a frayed, chipped band along the edge of its faces nearest the hole
//   scorch   cells in store.scorch get soot: a burn mark on an exposed top, a soot gradient on exposed sides, and
//            (PLAN-09) chipped, broken edges on those side faces like XCOM's blast-worn walls
//
// Decals are quads laid on the voxel's real collision footprint (thin walls and bands included), batched as one
// InstancedMesh per decal kind per render chunk, so a chunk rebuild replaces its decals with its geometry.
// Textures are generated procedurally (DataTexture), so they need no assets and work headless.
import * as THREE from 'three';
import { materialById } from '../../../shared/voxel/Materials.js';
import { collisionFootprint } from '../../../shared/voxel/ConnectedShapes.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';

/** Whole-object pieces (vehicles, containers) are drawn from hints, not voxel faces: no decals on their cells. */
const OBJECT_KEYS = new Set(['car_body', 'car_cabin', 'container', 'dumpster', 'pump', 'trunk', 'leaves', 'hedge']);   // trees are species pieces too
const FAMILY_TINT = { stone: 0x8d857a, metal: 0x55595f, wood: 0xa07e55, earth: 0x6e5c47, glass: 0x9aa5ad, ice: 0xbcd6e4, plant: 0x5d6b3c };
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const EPS = 0.012;

/** 0 = intact, 1 = cracked (≤ 66 % HP), 2 = heavily damaged (≤ 33 % HP). */
export function damageLevel(store, x, y, z) {
    const m = materialById(store.get(x, y, z));
    if (!m.solid || m.liquid || !Number.isFinite(m.hp) || m.hp <= 1 || OBJECT_KEYS.has(m.key)) return 0;
    const r = store.hpAt(x, y, z) / m.hp;
    return r <= 0.33 ? 2 : r <= 0.66 ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------- textures
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 4294967296); }
function canvas(n = 128) { return { n, d: new Uint8Array(n * n * 4) }; }
function plot(c, x, y, rgb, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= c.n || y >= c.n) return;
    const i = (y * c.n + x) * 4;
    if (a <= c.d[i + 3]) return;
    c.d[i] = rgb[0]; c.d[i + 1] = rgb[1]; c.d[i + 2] = rgb[2]; c.d[i + 3] = a;
}
function crackLine(c, r, x, y, len, ang, w, rgb, a) {
    for (let k = 0; k < len; k++) {
        ang += (r() - 0.5) * 0.7;
        x += Math.cos(ang) * 1.2; y += Math.sin(ang) * 1.2;
        for (let dx = -w; dx <= w; dx++) for (let dy = -w; dy <= w; dy++) plot(c, x + dx, y + dy, rgb, a);
        if (r() < 0.04 && len > 12) crackLine(c, r, x, y, len * 0.4, ang + (r() < 0.5 ? 0.9 : -0.9), 0, rgb, a * 0.8);
    }
}
function texture(c) {
    const t = new THREE.DataTexture(c.d, c.n, c.n, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
}
/** Cracks radiating from impact points; heavy adds more, wider cracks and chipped spots. */
export function crackTexture(heavy = false) {
    const c = canvas(), r = rng(heavy ? 77 : 41), dark = [26, 23, 20];
    const hits = heavy ? 4 : 2;
    for (let h = 0; h < hits; h++) {
        const cx = 24 + r() * 80, cy = 24 + r() * 80;
        for (let k = 0; k < (heavy ? 7 : 4); k++) crackLine(c, r, cx, cy, 18 + r() * (heavy ? 50 : 32), r() * Math.PI * 2, heavy && k < 3 ? 1 : 0, dark, heavy ? 235 : 200);
        if (heavy) for (let k = 0; k < 40; k++) { const a = r() * Math.PI * 2, d = r() * 7; plot(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, [40, 36, 32], 210); }
    }
    return texture(c);
}
/** Broken material seen end-on: speckled rubble, aggregate and dark voids (tinted per material family). */
export function rubbleTexture() {
    const c = canvas(), r = rng(9);
    for (let y = 0; y < c.n; y++) for (let x = 0; x < c.n; x++) {
        const v = 150 + (r() - 0.5) * 90, i = (y * c.n + x) * 4;
        c.d[i] = v; c.d[i + 1] = v; c.d[i + 2] = v; c.d[i + 3] = 235;
    }
    for (let k = 0; k < 260; k++) { const x = r() * c.n, y = r() * c.n, s = 1 + r() * 3, v = r() < 0.5 ? 60 : 220; for (let a = -s; a <= s; a++) for (let b = -s; b <= s; b++) if (a * a + b * b <= s * s) { const i = ((Math.round(y + b) & 127) * c.n + (Math.round(x + a) & 127)) * 4; c.d[i] = v; c.d[i + 1] = v; c.d[i + 2] = v; } }
    // A few rebar-like dark strokes.
    for (let k = 0; k < 3; k++) crackLine(c, r, r() * 128, 0, 110, Math.PI / 2 + (r() - 0.5) * 0.3, 1, [35, 30, 28], 255);
    return texture(c);
}
/** A jagged, chipped band along the right edge (u → 1): the face near a hole. Transparent elsewhere. */
export function frayTexture() {
    const c = canvas(), r = rng(23);
    let j = 0.78;
    for (let y = 0; y < c.n; y++) {
        j = Math.min(0.92, Math.max(0.62, j + (r() - 0.5) * 0.08));
        for (let x = 0; x < c.n; x++) {
            const u = x / c.n;
            if (u < j - 0.08) continue;
            const edge = u > j ? 1 : (u - (j - 0.08)) / 0.08, v = u > j ? 70 + r() * 60 : 40;
            plot(c, x, y, [v, v * 0.95, v * 0.9], Math.round(edge * 230));
        }
    }
    for (let k = 0; k < 6; k++) crackLine(c, r, 128 * 0.75, r() * 128, 30 + r() * 30, Math.PI + (r() - 0.5), 0, [30, 27, 24], 200);
    return texture(c);
}
/** Burn mark seen from above: a ragged dark blot, blackest in the middle. */
export function scorchTexture() {
    const c = canvas(), r = rng(5), n = c.n;
    const lobes = Array.from({ length: 9 }, () => [r() * Math.PI * 2, 0.25 + r() * 0.2]);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = x / n - 0.5, dy = y / n - 0.5, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        let edge = 0.36; for (const [la, lr] of lobes) edge = Math.max(edge, lr * Math.max(0, Math.cos(a - la)) ** 6 + 0.3);
        if (d > edge) continue;
        const k = 1 - d / edge, noise = 0.75 + r() * 0.25;
        plot(c, x, y, [14, 12, 11], Math.round(Math.min(1, k * 1.6) * 230 * noise));
    }
    return texture(c);
}
/** Soot on a side face: dark at the bottom, fading upward, streaky. */
export function sootTexture() {
    const c = canvas(), r = rng(13), n = c.n;
    const streak = Array.from({ length: n }, () => 0.7 + r() * 0.3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const up = y / n;                                  // texture v 0 = bottom of the quad (flipY off below)
        const k = Math.max(0, 1 - up * 1.15) * streak[x];
        if (k <= 0.02) continue;
        plot(c, x, y, [16, 14, 12], Math.round(k * 210 * (0.85 + r() * 0.15)));
    }
    return texture(c);
}

/**
 * XCOM-style blast wear on a side face: a jagged, chipped border on all four edges (broken material showing through,
 * deeper chips at the corners, hairline cracks running in). Transparent in the middle so the brick/plaster shows.
 */
export function edgeTexture() {
    const c = canvas(), r = rng(31), n = c.n;
    // A random-walk depth (px) per edge position, per side: bottom, top, left, right.
    const walk = () => { const a = []; let d = 5; for (let i = 0; i < n; i++) { d = Math.max(2, Math.min(13, d + (r() - 0.5) * 3.2 + (r() < 0.03 ? 6 : 0) - (d > 9 ? 0.8 : 0))); a.push(d); } return a; };
    const sides = [walk(), walk(), walk(), walk()];
    const corner = (x, y) => Math.max(0, 16 - Math.min(Math.hypot(x, y), Math.hypot(n - x, y), Math.hypot(x, n - y), Math.hypot(n - x, n - y))) * 0.9;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const depths = [[y, sides[0][x]], [n - 1 - y, sides[1][x]], [x, sides[2][y]], [n - 1 - x, sides[3][y]]];
        let k = -Infinity;
        for (const [dist, depth] of depths) k = Math.max(k, (depth + corner(x, y)) - dist);
        if (k <= -1.5) continue;
        if (k < 0) { plot(c, x, y, [22, 19, 17], Math.round(150 * (1 + k / 1.5))); continue; }   // dark lip of the break
        const v = 118 + r() * 70 - Math.min(40, k * 3);
        plot(c, x, y, [v, v * 0.96, v * 0.9], 225);
    }
    for (let k = 0; k < 10; k++) {
        const side = Math.floor(r() * 4), t = 8 + r() * (n - 16);
        const [x, y, a] = side === 0 ? [t, 4, Math.PI / 2] : side === 1 ? [t, n - 5, -Math.PI / 2] : side === 2 ? [4, t, 0] : [n - 5, t, Math.PI];
        crackLine(c, r, x, y, 10 + r() * 22, a + (r() - 0.5) * 0.8, 0, [28, 25, 22], 190);
    }
    return texture(c);
}

// ---------------------------------------------------------------------------------------------- decals
function footBox(store, x, y, z) {
    const poly = collisionFootprint(store, x, y, z);
    if (!poly || !poly.length) return { x0: x, x1: x + 1, y0: y, y1: y + 1 };
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [px, py] of poly) { a = Math.min(a, px); b = Math.max(b, px); c = Math.min(c, py); d = Math.max(d, py); }
    return { x0: x + a, x1: x + b, y0: y + c, y1: y + d };
}
const open = (store, x, y, z) => { const m = materialById(store.get(x, y, z)); return !m.solid || m.shatters; };

export class DamageDecals {
    constructor({ clipping = [] } = {}) {
        this.clipping = clipping;
        this.tex = { crack: crackTexture(false), heavy: crackTexture(true), rubble: rubbleTexture(), fray: frayTexture(), scorch: scorchTexture(), soot: sootTexture(), edge: edgeTexture() };
        this.materials = new Map();
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.stats = { decals: 0 };
    }
    material(kind, tint = 0xffffff, opacity = 1) {
        const k = `${kind}:${tint}:${opacity}`;
        let m = this.materials.get(k);
        if (!m) {
            m = new THREE.MeshStandardMaterial({ map: this.tex[kind], color: tint, transparent: true, opacity, depthWrite: false, roughness: 1, metalness: 0,
                polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, clippingPlanes: this.clipping, side: THREE.FrontSide });
            this.materials.set(k, m);
        }
        return m;
    }
    /**
     * Decal instances for one render chunk: [{ kind, tint, opacity, matrix }]. Pure (testable without a renderer).
     */
    collect(store, cx, cy, cz, { cutZ = Infinity, hidden = () => false } = {}) {
        const out = [];
        const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
        const x1 = Math.min(store.width, x0 + CHUNK), y1 = Math.min(store.depth, y0 + CHUNK), z1 = Math.min(store.height, z0 + CHUNK, cutZ);
        const scars = store.scars || new Set(), scorch = store.scorch || new Map();
        for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const m = materialById(store.get(x, y, z));
            if (!m.solid || m.liquid || m.shatters || OBJECT_KEYS.has(m.key) || hidden(x, y, z)) continue;
            const lvl = damageLevel(store, x, y, z), soot = scorch.get(`${x},${y},${z}`) || 0;
            let nearScar = false;
            if (scars.size) for (const [dx, dy, dz] of DIRS) if (scars.has(`${x + dx},${y + dy},${z + dz}`) && !store.isSolid(x + dx, y + dy, z + dz)) { nearScar = true; break; }
            if (!lvl && !soot && !nearScar) continue;
            const box = footBox(store, x, y, z), tint = FAMILY_TINT[m.family] ?? 0x8d857a;
            for (const d of DIRS) {
                const [dx, dy, dz] = d;
                if (dz === 0 ? !open(store, x + dx, y + dy, z) : !open(store, x, y, z + dz)) continue;
                if (dz < 0) continue;                                   // nobody sees the underside
                if (lvl) out.push({ kind: lvl === 2 ? 'heavy' : 'crack', tint: 0xffffff, opacity: 1, matrix: faceMatrix(box, z, d) });
                if (soot) out.push(dz > 0 ? { kind: 'scorch', tint: 0xffffff, opacity: [0, 0.55, 0.8, 1][soot], matrix: faceMatrix(box, z, d, { scale: 1.08, spin: hashSpin(x, y, z) }) }
                    : { kind: 'soot', tint: 0xffffff, opacity: [0, 0.45, 0.7, 0.9][soot], matrix: faceMatrix(box, z, d) });
                // The blast-facing side of a burned voxel is chipped along its edges (XCOM-style wear), heavier with more soot.
                if (soot && dz === 0) out.push({ kind: 'edge', tint, opacity: [0, 0.55, 0.8, 1][soot], matrix: faceMatrix(box, z, d, { inset: -0.002 }) });
                if (nearScar) {
                    const toward = DIRS.find(([ax, ay, az]) => scars.has(`${x + ax},${y + ay},${z + az}`) && !store.isSolid(x + ax, y + ay, z + az) && (ax !== dx || ay !== dy || az !== dz) && (ax !== -dx || ay !== -dy || az !== -dz));
                    // The face that looks into the hole shows broken material end-on.
                    if (scars.has(`${x + dx},${y + dy},${z + dz}`)) out.push({ kind: 'rubble', tint, opacity: 1, matrix: faceMatrix(box, z, d, { inset: 0.04 }) });
                    // Faces at right angles get a frayed band along their edge nearest the hole.
                    else if (toward) out.push({ kind: 'fray', tint, opacity: 1, matrix: faceMatrix(box, z, d, { toward }) });
                }
            }
        }
        return out;
    }
    /** InstancedMeshes for one render chunk. */
    buildChunk(store, cx, cy, cz, opts = {}) {
        const decals = this.collect(store, cx, cy, cz, opts);
        if (!decals.length) return [];
        const groups = new Map();
        for (const d of decals) { const k = `${d.kind}:${d.tint}:${d.opacity}`; (groups.get(k) || groups.set(k, { d, list: [] }).get(k)).list.push(d.matrix); }
        const meshes = [];
        for (const { d, list } of groups.values()) {
            const mesh = new THREE.InstancedMesh(this.geometry, this.material(d.kind, d.tint, d.opacity), list.length);
            list.forEach((mx, i) => mesh.setMatrixAt(i, mx));
            mesh.instanceMatrix.needsUpdate = true;
            mesh.renderOrder = 3; mesh.userData.decals = true; mesh.userData.noAO = true; mesh.castShadow = false; mesh.receiveShadow = true;
            mesh.dispose = () => {};                                  // shared geometry and materials outlive chunks
            meshes.push(mesh);
        }
        this.stats.decals = decals.length;
        return meshes;
    }
    dispose() { this.geometry.dispose(); for (const m of this.materials.values()) m.dispose(); for (const t of Object.values(this.tex)) t.dispose(); }
}

const hashSpin = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 628 / 100;
const Q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
/**
 * Matrix for a quad on face d of a voxel whose footprint is `box` (voxel coords; three.js is x, z→up, y→z).
 * toward: for frayed bands, the direction of the hole; the quad covers the half of the face nearest it.
 */
export function faceMatrix(box, z, [dx, dy, dz], { scale = 1, spin = 0, inset = 0, toward = null } = {}) {
    const n = new THREE.Vector3(dx, dz, dy);
    const cxw = (box.x0 + box.x1) / 2, cyw = (box.y0 + box.y1) / 2;
    const hx = (box.x1 - box.x0) / 2, hy = (box.y1 - box.y0) / 2;
    let pos, w, h;
    if (dz > 0) { pos = new THREE.Vector3(cxw, z + 1 + EPS, cyw); w = box.x1 - box.x0; h = box.y1 - box.y0; }
    else if (dx) { pos = new THREE.Vector3(cxw + dx * (hx + EPS), z + 0.5, cyw); w = box.y1 - box.y0; h = 1; }
    else { pos = new THREE.Vector3(cxw, z + 0.5, cyw + dy * (hy + EPS)); w = box.x1 - box.x0; h = 1; }
    Q.setFromUnitVectors(Z, n);
    if (spin && dz > 0) Q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, spin));
    let sx = w * scale - inset * 2, sy = h * scale - inset * 2;
    if (toward) {
        // Shift to the half nearest the hole and flip so the texture's jagged edge (u = 1) faces it.
        const t = new THREE.Vector3(toward[0], toward[2], toward[1]);
        const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(Q), uy = new THREE.Vector3(0, 1, 0).applyQuaternion(Q);
        if (Math.abs(ux.dot(t)) > 0.5) { pos.addScaledVector(ux, Math.sign(ux.dot(t)) * Math.abs(sx) / 4); sx = Math.abs(sx) / 2 * Math.sign(ux.dot(t)); }
        else if (Math.abs(uy.dot(t)) > 0.5) {
            // Hole above or below: rotate the band a quarter turn so u runs vertically toward it.
            Q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.sign(uy.dot(t)) * Math.PI / 2));
            pos.addScaledVector(uy, Math.sign(uy.dot(t)) * Math.abs(sy) / 4);
            [sx, sy] = [Math.abs(sy) / 2, Math.abs(sx)];
        }
    }
    return new THREE.Matrix4().compose(pos, Q.clone(), new THREE.Vector3(sx, sy, 1));
}
