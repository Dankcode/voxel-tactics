// Loads the baked tile set (assets/kit/tileset.glb, optionally overridden by tileset-art.glb) and resolves the
// pieces' material slots to lit, textured materials. Falls back to building the pieces in the browser.
//
// Slots on wall-like pieces use WORLD-SPACE UVs (computed in the vertex shader from the instance's world position
// and normal), so a wall made of a dozen instanced pieces reads as one continuous surface of stone or plaster.
import * as THREE from 'three';
import { materialByKey } from '../../../../shared/voxel/Materials.js';
import { CONTINUOUS_SURFACES, surfaceFinish } from '../SurfaceFinish.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildAllPieces } from './KitPieces.js';
import { RENDER, FALLBACK } from '../RenderTable.js';

/** slot → { tex (or 'self' = the voxel's own), uv: 'world' | 'mesh', scale, color, rough, metal, emissive, … } */
export const SLOTS = {
    self: { tex: 'self', uv: 'world' },
    // Present-day set.
    frame: { tex: null, color: 0x2c3134, rough: 0.45, metal: 0.35 },                 // window / door frames, caps, legs
    plinth: { tex: 'concrete', uv: 'world', scale: 1.5, color: 0x6c7174, rough: 0.9 },
    leaf: { tex: 'oak_floor', uv: 'mesh', color: 0x8a6a4c, rough: 0.6 },                // door leaves
    chrome: { tex: null, color: 0xc9cdd1, rough: 0.22, metal: 0.9 },
    lacquer: { tex: null, color: 0xeeeee9, rough: 0.38 },                                // kitchen fronts, wardrobes
    worktop: { tex: 'worktop', uv: 'world', scale: 1, rough: 0.28 },
    porcelain: { tex: null, color: 0xf3f2ec, rough: 0.25 },
    upholstery: { tex: 'upholstery', uv: 'world', scale: 1, rough: 0.95 },
    linen: { tex: 'linen', uv: 'world', scale: 1, rough: 0.95 },
    accent: { tex: null, color: 0xc49a4a, rough: 0.9 },
    self_dark: { tex: null, color: 0x2f3438, rough: 0.7 },
    screen: { tex: null, color: 0x0e1215, rough: 0.12, metal: 0.4, emissive: 0x0a1620, emissiveIntensity: 0.4 },
    carpaint: { tex: null, color: 0xffffff, rough: 0.22, metal: 0.55 },
    glass_dark: { tex: null, color: 0x1d2327, rough: 0.05, metal: 0.5, opacity: 0.9 },
    tyre: { tex: null, color: 0x1b1c1e, rough: 0.92 },
    tail: { tex: null, color: 0x9a1c16, rough: 0.3, emissive: 0x5a0a06, emissiveIntensity: 0.6 },
    lamp: { tex: null, color: 0xfff6e2, rough: 0.3, emissive: 0xfff1d0, emissiveIntensity: 1.4 },
    shade: { tex: null, color: 0xf2e6cc, rough: 0.8, emissive: 0xffd9a0, emissiveIntensity: 0.6 },
    soil: { tex: 'soil', uv: 'world', scale: 1, color: 0x8a7a6a, rough: 1 },
    flowers: { tex: null, color: 0xd96f86, rough: 0.8 },
    goods_a: { tex: null, color: 0xc2553f, rough: 0.7 },
    goods_b: { tex: null, color: 0x3f78a8, rough: 0.7 },
    goods_c: { tex: null, color: 0xe1b94c, rough: 0.7 },
    cardboard: { tex: null, color: 0xb88f5e, rough: 0.92 },
    mesh: { tex: null, color: 0x9aa3a8, rough: 0.5, metal: 0.6, opacity: 0.32 },
    post: { tex: 'deck', uv: 'world', scale: 1, color: 0x6e5440, rough: 0.85 },
    lid: { tex: null, color: 0x22282a, rough: 0.7 },
    red: { tex: null, color: 0xb3261e, rough: 0.45, metal: 0.2 },
    steel_yellow: { tex: null, color: 0xd9a21b, rough: 0.5, metal: 0.3 },
    canvas: { tex: null, color: 0xc77a52, rough: 0.9 },
    canvas_white: { tex: null, color: 0xe9e5dc, rough: 0.9, side: 'double' },
    rug: { tex: 'carpet', uv: 'world', scale: 1.2, color: 0xd8d2c6, rough: 1 },
    pot: { tex: null, color: 0xd9d4ca, rough: 0.7 },
    needles: { tex: 'leaves', uv: 'world', scale: 1.2, color: 0x7f9f78, rough: 0.9 },
    shutter: { tex: 'siding', uv: 'world', scale: 1, color: 0xc9cdd0, rough: 0.5, metal: 0.5 },
    wreck: { tex: 'metal', uv: 'world', scale: 1, color: 0x3a3330, rough: 0.9, metal: 0.4 },
    books: { tex: null, color: 0x8a5a44, rough: 0.8 },
    // Legacy set (still used by the older pieces).
    trim: { tex: 'timber', uv: 'world', scale: 1.5, color: 0xa08468, rough: 0.8 },
    quoin: { tex: 'stone_floor', uv: 'world', scale: 1.5, color: 0xe8e0d0, rough: 0.85 },
    wood: { tex: 'oak_floor', uv: 'world', scale: 1.5, rough: 0.6 },
    door: { tex: 'door', uv: 'world', scale: 1.2, rough: 0.75 },
    glass: { tex: null, uv: 'mesh', rough: 0.03, metal: 0.25, opacity: 0.3, color: 0xc4dce4 },
    iron: { tex: 'metal', uv: 'world', scale: 1, rough: 0.45, metal: 0.7, color: 0x8a8f96 },
    glow: { tex: null, uv: 'mesh', color: 0xffd28a, emissive: 0xffb347, emissiveIntensity: 2.4 },
    cloth: { tex: 'cloth', uv: 'mesh', rough: 0.95, side: 'double' },
    crate: { tex: 'crate', uv: 'mesh', rough: 0.85 },
    barrel: { tex: 'self', uv: 'mesh', rough: 0.7 },
    hay: { tex: 'hay', uv: 'mesh', rough: 1 },
    sandbag: { tex: 'sandbag', uv: 'world', scale: 0.8, rough: 1 },
    drystone: { tex: 'stone', uv: 'world', scale: 1.2, color: 0xb8b0a0, rough: 0.95 },
    rock: { tex: 'stone_floor', uv: 'world', scale: 1.2, color: 0xa8a294, rough: 0.95 },
    leaves: { tex: 'leaves', uv: 'world', scale: 1.2, rough: 0.9, color: 0xd8ecc0 },
    hedge: { tex: 'hedge', uv: 'world', scale: 1, rough: 0.9, color: 0xe0f0c8 },
    bark: { tex: 'trunk', uv: 'mesh', rough: 0.95 },
    cap: { tex: null, uv: 'mesh', color: 0x1e2226, rough: 1 },
    crystal: { tex: 'crystal', uv: 'world', scale: 1, rough: 0.1, emissive: 0x58b8ff, emissiveIntensity: 0.6, opacity: 0.9 },
    roof: { tex: 'roof', uv: 'mesh', rough: 0.8, side: 'double' }
};

export class KitLibrary {
    constructor(materials) {
        this.mats = materials;               // MaterialLibrary (textures)
        this.pieces = new Map();             // id → [{ slot, geometry }]
        this.cache = new Map();
        this.source = 'none';
    }
    async load() {
        const loader = new GLTFLoader();
        const read = async url => {
            const gltf = await loader.loadAsync(url);
            const out = new Map();
            gltf.scene.updateMatrixWorld(true);
            for (const node of gltf.scene.children) {
                const parts = [];
                node.traverse(o => { if (o.isMesh) parts.push({ slot: o.material?.name || 'self', geometry: o.geometry.clone().applyMatrix4(o.matrixWorld) }); });
                if (parts.length) out.set(node.name, parts);
            }
            return out;
        };
        try { this.pieces = await read('/assets/kit/tileset.glb'); this.source = 'tileset.glb'; }
        catch (err) { console.warn('[kit] baked tile set missing, building pieces in the browser:', err.message); this.pieces = buildAllPieces(); this.source = 'procedural'; }
        try { const art = await read('/assets/kit/tileset-art.glb'); for (const [k, v] of art) this.pieces.set(k, v); this.source += ' + tileset-art.glb'; } catch { /* optional */ }
        for (const parts of this.pieces.values()) for (const p of parts) { p.geometry.computeBoundingSphere(); }
        return this;
    }
    piece(id) { return this.pieces.get(id) || this.pieces.get(`${id}#0`) || null; }
    /** Material for a slot; `selfKey` is the voxel material that 'self' (and barrels) resolve to. */
    material(slot, selfKey, clipping) {
        const def = SLOTS[slot] || SLOTS.self;
        const texName = def.tex === 'self' ? (RENDER[selfKey] || FALLBACK).tex : def.tex;
        const key = `${slot}|${texName}|${def.tex === 'self' ? selfKey : ''}|${clipping ? 'clip' : 'free'}`;
        let m = this.cache.get(key);
        if (m) return m;
        const r = def.tex === 'self' ? (RENDER[selfKey] || FALLBACK) : {};
        const continuous = def.tex === 'self' && CONTINUOUS_SURFACES.has(selfKey);
        const map = !continuous && texName ? this.mats.tex(texName, false) : null, normalMap = !continuous && texName ? this.mats.tex(texName, true) : null;
        const opacity = def.opacity ?? 1;
        m = new THREE.MeshStandardMaterial({
            map, normalMap, color: continuous ? materialByKey(selfKey).color : def.color ?? r.tint ?? 0xffffff,
            roughness: def.rough ?? r.rough ?? 0.9, metalness: def.metal ?? r.metal ?? 0,
            emissive: def.emissive ?? 0x000000, emissiveIntensity: def.emissiveIntensity ?? 0,
            transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
            side: def.side === 'double' || opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
            clippingPlanes: clipping
        });
        if (r.brightness) m.color.multiplyScalar(r.brightness);
        if (def.uv === 'world') worldUv(m, def.scale ?? r.scale ?? 2);
        if (continuous) surfaceFinish(m);
        this.cache.set(key, m);
        return m;
    }
}

/** Box-projected UVs from world position and normal (instancing-aware), for both the colour and normal maps. */
function worldUv(material, scale) {
    material.onBeforeCompile = shader => {
        shader.uniforms.kitUvScale = { value: 1 / scale };
        shader.vertexShader = 'uniform float kitUvScale;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            {
                mat4 kitM = modelMatrix;
                #ifdef USE_INSTANCING
                    kitM = modelMatrix * instanceMatrix;
                #endif
                vec3 kitP = (kitM * vec4(position, 1.0)).xyz;
                vec3 kitN = normalize(mat3(kitM) * normal);
                vec3 an = abs(kitN);
                vec2 kitUv = an.y > 0.6 ? kitP.xz : (an.x > an.z ? vec2(kitP.z * sign(kitN.x), kitP.y) : vec2(-kitP.x * sign(kitN.z), kitP.y));
                kitUv *= kitUvScale;
                #ifdef USE_MAP
                    vMapUv = kitUv;
                #endif
                #ifdef USE_NORMALMAP
                    vNormalMapUv = kitUv;
                #endif
            }`);
    };
    material.customProgramCacheKey = () => `kit-world-uv-${scale}`;
}
