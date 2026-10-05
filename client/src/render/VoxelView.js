// Chunked voxel rendering. Destruction only rebuilds the chunks the store marked dirty.
import * as THREE from 'three';
import { meshChunk } from './ChunkMesher.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';

export class VoxelView {
    constructor(scene, store) {
        this.scene = scene; this.store = store;
        this.group = new THREE.Group();
        scene.scene.add(this.group);
        const clip = scene.clipping;
        this.materials = [
            new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: clip }),
            new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthWrite: false, clippingPlanes: clip }),
            new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.72, depthWrite: false, clippingPlanes: clip })
        ];
        this.chunks = new Map();
        this.tint = null;
        this.stats = { lastRebuildMs: 0, chunks: 0 };
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
        if (old) { for (const m of old) { this.group.remove(m); m.geometry.dispose(); } }
        const parts = meshChunk(this.store, cx, cy, cz, { tint: this.tint });
        const meshes = [];
        for (const p of parts) {
            if (!p.indices.length) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(p.positions, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(p.normals, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(p.colors, 3));
            g.setIndex(p.indices);
            const mesh = new THREE.Mesh(g, this.materials[p.group]);
            mesh.renderOrder = p.group;
            this.group.add(mesh);
            meshes.push(mesh);
        }
        this.chunks.set(key, meshes);
        this.stats.chunks = this.chunks.size;
    }
    dispose() { for (const ms of this.chunks.values()) for (const m of ms) m.geometry.dispose(); this.scene.scene.remove(this.group); }
}
