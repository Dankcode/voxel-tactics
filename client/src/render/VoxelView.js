// Chunked voxel rendering with PBR materials. Destruction only rebuilds the chunks the store marked dirty.
import * as THREE from 'three';
import { meshChunk } from './ChunkMesher.js';
import { KitView, kitHandler } from './kit/KitView.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';

export class VoxelView {
    constructor(scene, store, library, kit = null) {
        this.scene = scene; this.store = store; this.library = library;
        this.kitView = kit ? new KitView(kit, scene.clipping) : null;
        this.group = new THREE.Group();
        scene.scene.add(this.group);
        this.chunks = new Map();
        this.tint = null;
        this.cutZ = Infinity;
        this.stats = { lastRebuildMs: 0, chunks: 0, meshes: 0 };
    }
    rebuildAll() {
        const s = this.store;
        for (let cz = 0; cz < Math.ceil(s.height / CHUNK); cz++)
            for (let cy = 0; cy < Math.ceil(s.depth / CHUNK); cy++)
                for (let cx = 0; cx < Math.ceil(s.width / CHUNK); cx++) this.rebuild(`${cx},${cy},${cz}`);
        s.dirtyChunks.clear();
    }
    /** Rebuild every chunk the store has marked dirty since the last call. */
    flush() {
        const keys = this.store.takeDirtyChunks();
        const t = performance.now();
        for (const k of keys) this.rebuild(k);
        if (keys.length) this.stats.lastRebuildMs = performance.now() - t;
        return keys.length;
    }
    rebuild(key) {
        const [cx, cy, cz] = key.split(',').map(Number);
        if (cx < 0 || cy < 0 || cz < 0 || cx * CHUNK >= this.store.width || cy * CHUNK >= this.store.depth || cz * CHUNK >= this.store.height) return;
        const old = this.chunks.get(key);
        if (old) { for (const m of old) { this.group.remove(m); if (m.userData.kit) m.dispose?.(); if (!m.isInstancedMesh) m.geometry.dispose(); } }
        const parts = meshChunk(this.store, cx, cy, cz, { tint: this.tint, cutZ: this.cutZ, kit: this.kitView ? kitHandler : null });
        const meshes = [];
        for (const p of parts) {
            if (!p.indices.length) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(p.positions, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(p.normals, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uvs, 2));
            g.setAttribute('color', new THREE.Float32BufferAttribute(p.colors, 3));
            g.setAttribute('aRim', new THREE.Float32BufferAttribute(p.rims, 4));
            g.setAttribute('aGrid', new THREE.Float32BufferAttribute(p.grids, 1));
            g.setIndex(p.indices);
            g.computeBoundingSphere();
            const mesh = new THREE.Mesh(g, this.library.get(p.key));
            mesh.renderOrder = p.group;
            mesh.castShadow = p.group !== 2;
            mesh.receiveShadow = true;
            mesh.userData.renderKey = p.key;
            this.group.add(mesh);
            meshes.push(mesh);
        }
        if (this.kitView) for (const m of this.kitView.buildChunk(this.store, cx, cy, cz, { cutZ: this.cutZ, tint: this.tint ? (x, y, z) => this.tint(x, y, z) : null })) { this.group.add(m); meshes.push(m); }
        this.chunks.set(key, meshes);
        this.stats.chunks = this.chunks.size;
        this.stats.meshes = this.group.children.length;
    }
    /** Storey cutaway: hide voxels at z >= top and cap what is cut. Rebuilds every chunk when it changes. */
    setCut(top) {
        const z = Number.isFinite(top) ? top : Infinity;
        if (z === this.cutZ) return;
        this.cutZ = z; this.rebuildAll();
    }
    dispose() { for (const ms of this.chunks.values()) for (const m of ms) { if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); } this.scene.scene.remove(this.group); }
}
