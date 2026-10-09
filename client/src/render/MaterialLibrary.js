// Loads the PBR voxel textures (albedo + normal) and builds one MeshStandardMaterial per render key.
// Textures: client/public/assets/textures/pbr/ (tools/art/make_textures.py). Tuning lives in RenderTable.js.
import * as THREE from 'three';
import { materialByKey } from '../../../shared/voxel/Materials.js';
import { RENDER, FALLBACK } from './RenderTable.js';

import { CONTINUOUS_SURFACES, surfaceFinish } from './SurfaceFinish.js';
import { QUALITY } from './Quality.js';

const BASE = QUALITY.textures;
const loader = new THREE.TextureLoader();

export class MaterialLibrary {
    constructor(renderer, clipping) {
        this.renderer = renderer; this.clipping = clipping;
        this.textures = new Map();
        this.materials = new Map();
        this.aniso = Math.min(QUALITY.anisotropy, renderer.capabilities.getMaxAnisotropy());
        this.water = [];
    }
    /** Preload every texture the table references (resolves even if some fail: those fall back to flat colour). */
    async load() {
        const names = new Set(Object.values(RENDER).map(r => r.tex).filter(Boolean));
        await Promise.all([...names].map(n => Promise.all([this.texture(n, false), this.texture(n, true)])));
    }
    texture(name, normal) {
        const key = `${name}${normal ? '_n' : ''}`;
        if (this.textures.has(key)) return this.textures.get(key).promise;
        const entry = { tex: null };
        entry.promise = new Promise(resolve => loader.load(`${BASE}${key}.jpg`, t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = this.aniso;
            t.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
            t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
            entry.tex = t; resolve(t);
        }, undefined, () => resolve(null)));
        this.textures.set(key, entry);
        return entry.promise;
    }
    tex(name, normal) { return this.textures.get(`${name}${normal ? '_n' : ''}`)?.tex || null; }
    /** Material for a render key (cached). */
    get(key) {
        let m = this.materials.get(key);
        if (m) return m;
        const r = RENDER[key] || FALLBACK;
        const kind = r.kind || 'opaque';
        const continuous = CONTINUOUS_SURFACES.has(key);
        const map = continuous ? null : this.tex(r.tex, false), normalMap = continuous ? null : this.tex(r.tex, true);
        m = new THREE.MeshStandardMaterial({
            map, normalMap, vertexColors: true,
            color: continuous ? materialByKey(key).color : r.tint ?? 0xffffff, roughness: r.rough ?? 0.9, metalness: r.metal ?? 0,
            normalScale: new THREE.Vector2((r.normal ?? 1) * QUALITY.normalScale, (r.normal ?? 1) * QUALITY.normalScale),
            emissive: r.emissive ?? 0x000000, emissiveIntensity: r.emissiveIntensity ?? 0,
            clippingPlanes: this.clipping, clipShadows: true,
            side: kind === 'opaque' ? THREE.FrontSide : THREE.DoubleSide,
            transparent: kind !== 'opaque' && (r.opacity ?? 1) < 1, opacity: r.opacity ?? 1,
            depthWrite: kind === 'opaque' || (r.opacity ?? 1) >= 1
        });
        if (r.brightness) m.color.multiplyScalar(r.brightness);
        if (kind === 'opaque') { heightCues(m); if (continuous) surfaceFinish(m); }
        if (r.emissive && map) m.emissiveMap = map;
        if (kind === 'water') {
            // Water scrolls its normal map; keep its own clone so other keys sharing the texture don't scroll.
            if (normalMap) { m.normalMap = normalMap.clone(); m.normalMap.needsUpdate = true; this.water.push(m); }
        }
        this.materials.set(key, m);
        return m;
    }
    update(dt) {
        for (const m of this.water) { m.normalMap.offset.x += dt * 0.03; m.normalMap.offset.y += dt * 0.017; }
    }
}

/** Shared switches for the terrain height cues (Options / debug). */
export const TERRAIN_CUES = { uGrid: { value: 0 }, uRim: { value: 0 } };

/**
 * Tile grid on walkable tops and bright rims on ledge edges, drawn in the fragment shader from world position, so
 * they cost no geometry and stay ~1.5 px wide at any zoom. Driven by the mesher's aGrid / aRim attributes.
 */
function heightCues(material) {
    material.onBeforeCompile = shader => {
        shader.uniforms.uGrid = TERRAIN_CUES.uGrid; shader.uniforms.uRim = TERRAIN_CUES.uRim;
        shader.vertexShader = 'attribute vec4 aRim;\nattribute float aGrid;\nvarying vec4 vRim;\nvarying float vGrid;\nvarying vec3 vCueWorld;\n' +
            shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
                vRim = aRim; vGrid = aGrid; vCueWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        shader.fragmentShader = 'uniform float uGrid;\nuniform float uRim;\nvarying vec4 vRim;\nvarying float vGrid;\nvarying vec3 vCueWorld;\n' +
            shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
                if (vGrid > 0.5) {
                    vec2 c = fract(vCueWorld.xz);
                    float fw = max(fwidth(vCueWorld.x), fwidth(vCueWorld.z));
                    float edge = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
                    float grid = 1.0 - smoothstep(0.0, fw * 1.4, edge);
                    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), grid * 0.13 * uGrid);
                    // edges: N = -z (c.y), E = +x (1 - c.x), S = +z (1 - c.y), W = -x (c.x)
                    vec4 d = vec4(c.y, 1.0 - c.x, 1.0 - c.y, c.x);
                    vec4 w = vec4(0.05) + fw * 1.5;
                    vec4 on = step(vec4(0.5), vRim);
                    vec4 r = on * (1.0 - smoothstep(vec4(0.0), w, d));
                    float rim = max(max(r.x, r.y), max(r.z, r.w));
                    float big = max(max(on.x * step(1.5, vRim.x), on.y * step(1.5, vRim.y)), max(on.z * step(1.5, vRim.z), on.w * step(1.5, vRim.w)));
                    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(1.0, 0.92, 0.72), vec3(1.0, 0.78, 0.45), big), rim * 0.75 * uRim);
                }`);
    };
    material.customProgramCacheKey = () => 'terrain-height-cues-v1';
}
