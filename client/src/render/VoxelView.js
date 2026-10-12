// Chunked voxel rendering with PBR materials. Destruction only rebuilds the chunks the store marked dirty.
import * as THREE from 'three';
import { meshChunk } from './ChunkMesher.js';
import { KitView, kitHandler } from './kit/KitView.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';
import { MATERIALS } from '../../../shared/voxel/Materials.js';
import { renderFor } from './RenderTable.js';

const APRON = 22;          // cells the ground continues past the map edge (visual only), fading into the background

export class VoxelView {
    constructor(scene, store, library, kit = null) {
        this.scene = scene; this.store = store; this.library = library;
        this.kitView = kit ? new KitView(kit, scene.clipping) : null;
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
        if (old) { for (const m of old) { this.group.remove(m); if (m.userData.kit) m.dispose?.(); if (!m.isInstancedMesh) m.geometry.dispose(); } }
        const hidden = (x,y,z) => this.buildingView?.hiddenAt(x,y,z)||false;
        const parts = meshChunk(this.store, cx, cy, cz, { hidden, tint: this.tint, cutZ: this.cutZ, kit: this.kitView ? kitHandler : null, apron: true });
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
    /**
     * The ground continues past the map edge as an apron (no gameplay, no grid), so the battlefield reads as part of a
     * neighbourhood rather than a floating block. Each edge cell's ground is stretched outward and fades out.
     */
    buildApron() {
        const s = this.store, W = s.width, D = s.depth;
        const ground = (x, y) => {
            let z = 0;
            while (z + 1 < s.height) {
                const m = MATERIALS[s.get(x, y, z + 1)];
                if (!m.solid || m.liquid || (this.kitView && kitHandler(s, x, y, z + 1))) break;
                z++;
            }
            const above = MATERIALS[s.get(x, y, z + 1)];
            if (above.liquid) return { key: above.key, h: z + 1.9 };
            const key = MATERIALS[s.get(x, y, z)].key;
            return { key, h: z + 1 - (renderFor(key).drop || 0) };
        };
        const bufs = new Map();
        const buf = key => { if (!bufs.has(key)) bufs.set(key, { p: [], n: [], uv: [], c: [], i: [] }); return bufs.get(key); };
        const rect = (key, h, ax, ay, bx, by, fadeAt) => {
            const b = buf(key), r = renderFor(key), sc = r.scale || 1, st = b.p.length / 3;
            const pts = [[ax, ay], [bx, ay], [bx, by], [ax, by]];
            for (const [x, y] of pts) {
                b.p.push(x, h, y); b.n.push(0, 1, 0); b.uv.push(x / sc, y / sc);
                const k = fadeAt(x, y); b.c.push(k, k, k);
            }
            b.i.push(st, st + 2, st + 1, st, st + 3, st + 2);
        };
        const fade = (x, y) => {
            const dx = Math.max(0, -x, x - W), dy = Math.max(0, -y, y - D);
            const d = Math.hypot(dx, dy) / APRON;
            return Math.max(0.12, 0.92 - d * 0.85);
        };
        for (let x = 0; x < W; x++) { const n = ground(x, 0), so = ground(x, D - 1); rect(n.key, n.h, x, -APRON, x + 1, 0, fade); rect(so.key, so.h, x, D, x + 1, D + APRON, fade); }
        for (let y = 0; y < D; y++) { const w = ground(0, y), e = ground(W - 1, y); rect(w.key, w.h, -APRON, y, 0, y + 1, fade); rect(e.key, e.h, W, y, W + APRON, y + 1, fade); }
        for (const [cx, cy, ax, ay] of [[0, 0, -APRON, -APRON], [W - 1, 0, W, -APRON], [0, D - 1, -APRON, D], [W - 1, D - 1, W, D]]) {
            const g = ground(cx, cy); rect(g.key, g.h, ax, ay, ax + APRON, ay + APRON, fade);
        }
        this.apron = new THREE.Group();
        for (const [key, b] of bufs) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
            g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
            g.setAttribute('aRim', new THREE.Float32BufferAttribute(new Float32Array(b.p.length / 3 * 4), 4));
            g.setAttribute('aGrid', new THREE.Float32BufferAttribute(new Float32Array(b.p.length / 3), 1));
            g.setIndex(b.i);
            const mesh = new THREE.Mesh(g, this.library.get(key));
            mesh.receiveShadow = true;
            this.apron.add(mesh);
        }
        this.scene.scene.add(this.apron);
    }
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
        if (this.apron) { for (const m of this.apron.children) m.geometry.dispose(); this.scene.scene.remove(this.apron); }
    }
}
