// Chunked voxel rendering with PBR materials. Destruction only rebuilds the chunks the store marked dirty.
import * as THREE from 'three';
import { meshChunk } from './ChunkMesher.js';
import { KitView, kitHandler } from './kit/KitView.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';
import { MATERIALS } from '../../../shared/voxel/Materials.js';
import { renderFor } from './RenderTable.js';
import { DamageDecals } from './DamageDecals.js';

const APRON = 0;          // cells the ground continues past the map edge (visual only), fading into the background

export class VoxelView {
    constructor(scene, store, library, kit = null) {
        this.scene = scene; this.store = store; this.library = library;
        this.kitView = kit ? new KitView(kit, scene.clipping) : null;
        this.decals = new DamageDecals({ clipping: scene.clipping });
        this.group = new THREE.Group();
        scene.scene.add(this.group);
        this.chunks = new Map();
        this.tint = null; this.interiorVisibility = null;
        this.cutZ = Infinity;
        this.stats = { lastRebuildMs: 0, chunks: 0, meshes: 0 };
        this.deps = new Map();
    }
    /** Mission render hints + decor (mission.visual): furniture orientation, whole cars / trees, visual dressing. */
    setVisual(visual) {
        this.kitView?.setVisual(visual);
        this.deps = this.kitView?.dependencies() || new Map();
    }
    rebuildAll() {
        const s = this.store;
        if (!this.apron) this.buildApron();
        for (let cz = 0; cz < Math.ceil(s.height / CHUNK); cz++)
            for (let cy = 0; cy < Math.ceil(s.depth / CHUNK); cy++)
                for (let cx = 0; cx < Math.ceil(s.width / CHUNK); cx++) this.rebuild(`${cx},${cy},${cz}`);
        s.dirtyChunks.clear(); this.refreshConcealment();
    }
    /** Rebuild every chunk the store has marked dirty since the last call. */
    flush() {
        const keys = this.store.takeDirtyChunks();
        // A damaged car / container / tree is redrawn by the chunk that holds its anchor too.
        for (const k of [...keys]) for (const a of this.deps.get(k) || []) if (!keys.includes(a)) keys.push(a);
        const t = performance.now();
        for (const k of keys) this.rebuild(k);
        if (keys.length) this.stats.lastRebuildMs = performance.now() - t;
        this.refreshConcealment();
        return keys.length;
    }
    rebuild(key) {
        const [cx, cy, cz] = key.split(',').map(Number);
        if (cx < 0 || cy < 0 || cz < 0 || cx * CHUNK >= this.store.width || cy * CHUNK >= this.store.depth || cz * CHUNK >= this.store.height) return;
        const old = this.chunks.get(key);
        if (old) { for (const m of old) { this.group.remove(m); if (m.userData.kit) m.dispose?.(); if (!m.isInstancedMesh) m.geometry.dispose(); else if (m.userData.decals) m.dispose(); } }
        const hidden = (x,y,z) => this.buildingView?.hiddenAt(x,y,z)||false;
        const parts = meshChunk(this.store, cx, cy, cz, { hidden, tint: this.tint, cutZ: this.cutZ, kit: this.kitView ? kitHandler : null, apron: false });
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
        for (const m of this.decals.buildChunk(this.store, cx, cy, cz, { hidden, cutZ: this.cutZ })) { this.group.add(m); meshes.push(m); }
        if (this.kitView) for (const m of this.kitView.buildChunk(this.store, cx, cy, cz, { hidden, cutZ: this.cutZ, tint: this.tint ? (x, y, z) => this.tint(x, y, z) : null })) { this.group.add(m); meshes.push(m); }
        this.chunks.set(key, meshes);
        this.stats.chunks = this.chunks.size;
        this.stats.meshes = this.group.children.length;
    }
    refreshConcealment() {
        const rooms=this.interiorVisibility?.concealedRooms()||[];
        const key=rooms.map(r=>r.id).join(',')+':'+this.cutZ+':'+[...(this.buildingView?.active||[])].map(([b,z])=>`${b.id}:${z}`).join(',')+':'+[...(this.interiorVisibility?.seen||[])].sort().join(';');
        if(key===this.concealmentKey)return;
        this.concealmentKey=key;
        if(this.concealment){this.group.remove(this.concealment);this.concealment.geometry.dispose();this.concealment.material.dispose();}
        const cells=rooms.flatMap(r=>r.cells.map(([x,y])=>({x,y,z:r.floorZ+1.02,floor:r.floorZ}))).filter(c=>c.z<this.cutZ&&!this.buildingView?.hiddenAt(c.x,c.y,c.floor)&&this.interiorVisibility.hiddenAt(c.x,c.y,c.floor));
        if(!cells.length){this.concealment=null;return;}
        const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x091118,transparent:true,opacity:.65,depthWrite:false,clippingPlanes:this.scene.clipping}),cells.length);
        const matrix=new THREE.Matrix4();
        cells.forEach((c,i)=>{matrix.identity();matrix.setPosition(c.x+.5,c.z,c.y+.5);mesh.setMatrixAt(i,matrix);});
        mesh.instanceMatrix.needsUpdate=true;mesh.userData.noAO=true;this.concealment=mesh;this.group.add(mesh);
    }
    /** Hard tactical boundary: off-map scenery is a screen-space image. */
    buildApron() { /* The tactical map ends at its bounds; a 2D background replaces off-map geometry. */ }
    /** Storey cutaway: hide voxels at z >= top and cap what is cut. Rebuilds every chunk when it changes. */
    setCut(top) {
        const z = Number.isFinite(top) ? top : Infinity;
        if (z === this.cutZ) return;
        this.cutZ = z; this.rebuildAll();
    }
    dispose() {
        if(this.concealment){this.concealment.geometry.dispose();this.concealment.material.dispose();}
        for (const ms of this.chunks.values()) for (const m of ms) { if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); }
        this.scene.scene.remove(this.group);
        this.decals.dispose();
        if (this.apron) { for (const m of this.apron.children) m.geometry.dispose(); this.scene.scene.remove(this.apron); }
    }
}
