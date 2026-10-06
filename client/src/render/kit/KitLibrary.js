// Loads the baked tile set (assets/kit/tileset.glb, optionally overridden by tileset-art.glb) and resolves the
// pieces' material slots to lit, textured materials. Falls back to building the pieces in the browser.
//
// Slots on wall-like pieces use WORLD-SPACE UVs (computed in the vertex shader from the instance's world position
// and normal), so a wall made of a dozen instanced pieces reads as one continuous surface of stone or plaster.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildAllPieces } from './KitPieces.js';
import { RENDER, FALLBACK } from '../RenderTable.js';

/** slot → { tex (or 'self' = the voxel's own), uv: 'world' | 'mesh', scale, color, rough, metal, emissive, … } */
export const SLOTS = {
    self: { tex: 'self', uv: 'world' },
    trim: { tex: 'timber', uv: 'world', scale: 1.5, color: 0xa08468, rough: 0.8 },
    quoin: { tex: 'stone_floor', uv: 'world', scale: 1.5, color: 0xe8e0d0, rough: 0.85 },
    wood: { tex: 'plank', uv: 'world', scale: 1.5, rough: 0.8 },
    door: { tex: 'door', uv: 'world', scale: 1.2, rough: 0.75 },
    glass: { tex: 'glass', uv: 'mesh', rough: 0.05, metal: 0.1, opacity: 0.45, color: 0xcfe8f2 },
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
        const key = `${slot}|${texName}`;
        let m = this.cache.get(key);
        if (m) return m;
        const r = def.tex === 'self' ? (RENDER[selfKey] || FALLBACK) : {};
        const map = texName ? this.mats.tex(texName, false) : null, normalMap = texName ? this.mats.tex(texName, true) : null;
        const opacity = def.opacity ?? 1;
        m = new THREE.MeshStandardMaterial({
            map, normalMap, color: def.color ?? 0xffffff,
            roughness: def.rough ?? r.rough ?? 0.9, metalness: def.metal ?? r.metal ?? 0,
            emissive: def.emissive ?? 0x000000, emissiveIntensity: def.emissiveIntensity ?? 0,
            transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
            side: def.side === 'double' || opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
            clippingPlanes: clipping
        });
        if (r.brightness) m.color.multiplyScalar(r.brightness);
        if (def.uv === 'world') worldUv(m, def.scale ?? r.scale ?? 2);
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
