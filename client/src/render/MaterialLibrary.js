// Loads the PBR voxel textures (albedo + normal) and builds one MeshStandardMaterial per render key.
// Textures: client/public/assets/textures/pbr/ (tools/art/make_textures.py). Tuning lives in RenderTable.js.
import * as THREE from 'three';
import { RENDER, FALLBACK } from './RenderTable.js';

const BASE = '/assets/textures/pbr/';
const loader = new THREE.TextureLoader();

export class MaterialLibrary {
    constructor(renderer, clipping) {
        this.renderer = renderer; this.clipping = clipping;
        this.textures = new Map();
        this.materials = new Map();
        this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        this.water = [];
    }
    /** Preload every texture the table references (resolves even if some fail: those fall back to flat colour). */
    async load() {
        const names = new Set(Object.values(RENDER).map(r => r.tex));
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
        const map = this.tex(r.tex, false), normalMap = this.tex(r.tex, true);
        m = new THREE.MeshStandardMaterial({
            map, normalMap, vertexColors: true,
            color: r.tint ?? 0xffffff, roughness: r.rough ?? 0.9, metalness: r.metal ?? 0,
            normalScale: new THREE.Vector2(r.normal ?? 1, r.normal ?? 1),
            emissive: r.emissive ?? 0x000000, emissiveIntensity: r.emissiveIntensity ?? 0,
            clippingPlanes: this.clipping, clipShadows: true,
            side: kind === 'opaque' ? THREE.FrontSide : THREE.DoubleSide,
            transparent: kind !== 'opaque' && (r.opacity ?? 1) < 1, opacity: r.opacity ?? 1,
            depthWrite: kind === 'opaque' || (r.opacity ?? 1) >= 1
        });
        if (r.brightness) m.color.multiplyScalar(r.brightness);
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
