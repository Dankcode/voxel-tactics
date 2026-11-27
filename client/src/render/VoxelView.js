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
        this.onBeforeFlush = null;
        this.pendingChunks = new Set();
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
    /** Rebuild every chunk the store has marked dirty since the last call, optionally time-sliced. */
    flush({ maxMs = Infinity, priority = null } = {}) {
        this.onBeforeFlush?.();
        const fresh = this.store.takeDirtyChunks();
        // A damaged car / container / tree is redrawn by the chunk that holds its anchor too.
        for (const k of fresh) {
            this.pendingChunks.add(k);
            for (const a of this.deps.get(k) || []) this.pendingChunks.add(a);
        }
        if (!this.pendingChunks.size) { this.refreshConcealment(); return 0; }
        const prioSet = priority ? new Set(priority) : null;
        const ordered = prioSet
            ? [...this.pendingChunks].sort((a, b) => (prioSet.has(b) ? 1 : 0) - (prioSet.has(a) ? 1 : 0))
            : [...this.pendingChunks];
        const t = performance.now();
        let rebuilt = 0;
        for (const k of ordered) {
            this.pendingChunks.delete(k);
            this.rebuild(k);
            rebuilt++;
            if (Number.isFinite(maxMs) && performance.now() - t >= maxMs) break;
        }
        this.stats.lastRebuildMs = performance.now() - t;
        this.refreshConcealment();
        return rebuilt;
    }
    /** Drain any remaining deferred lighting/neighbor chunks across frames. */
    tick(maxMs = 6) {
        if (this.pendingChunks.size) this.flush({ maxMs });
    }
    /** Rebuild only chunks overlapping the given boxes ({ x0, y0, w, d }), leaving unrelated map chunks intact. */
    rebuildBoxes(boxes = []) {
        if (!boxes?.length) { this.rebuildAll(); return; }
        const s = this.store;
        const maxCx = Math.ceil(s.width / CHUNK) - 1;
        const maxCy = Math.ceil(s.depth / CHUNK) - 1;
        const maxCz = Math.ceil(s.height / CHUNK) - 1;
        const keys = new Set();
        for (const b of boxes) {
            const cx0 = Math.max(0, Math.floor((b.x0 - 1) / CHUNK));
            const cy0 = Math.max(0, Math.floor((b.y0 - 1) / CHUNK));
            const cx1 = Math.min(maxCx, Math.floor((b.x0 + b.w) / CHUNK));
            const cy1 = Math.min(maxCy, Math.floor((b.y0 + b.d) / CHUNK));
            for (let cz = 0; cz <= maxCz; cz++)
                for (let cy = cy0; cy <= cy1; cy++)
                    for (let cx = cx0; cx <= cx1; cx++) keys.add(`${cx},${cy},${cz}`);
        }
        for (const k of [...keys]) for (const a of this.deps.get(k) || []) keys.add(a);
        for (const k of keys) this.rebuild(k);
        this.refreshConcealment();
    }
    rebuild(key) {
        const [cx, cy, cz] = key.split(',').map(Number);
        if (cx < 0 || cy < 0 || cz < 0 || cx * CHUNK >= this.store.width || cy * CHUNK >= this.store.depth || cz * CHUNK >= this.store.height) return;
        const old = this.chunks.get(key);
        if (old) { for (const m of old) { this.group.remove(m); if (m.userData.kit) m.dispose?.(); if (!m.isInstancedMesh) m.geometry.dispose(); else if (m.userData.decals) m.dispose(); } }
        const hidden = (x,y,z) => this.buildingView?.hiddenAt(x,y,z)||(this.xray?.has(`${x},${y},${z}`)??false);
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
    disposeConcealment() {
        if (!this.concealment) return;
        this.group.remove(this.concealment);
        this.concealment.traverse(o => {
            o.geometry?.dispose?.();
            o.material?.map?.dispose?.();
            o.material?.dispose?.();
        });
        this.concealment = null;
    }
    refreshConcealment() {
        const rooms = this.interiorVisibility?.concealedRooms() || [];
        const key = rooms.map(r => r.id).join(',') + ':' + this.cutZ + ':' + [...(this.buildingView?.active || [])].map(([b, z]) => `${b.id}:${z}`).join(',') + ':' + [...(this.interiorVisibility?.seen || [])].sort().join(';');
        if (key === this.concealmentKey) return;
        this.concealmentKey = key;
        this.disposeConcealment();
        const byFloor = new Map();
        for (const r of rooms) {
            for (const [x, y] of r.cells) {
                if (r.floorZ >= this.cutZ || this.buildingView?.hiddenAt(x, y, r.floorZ) || !this.interiorVisibility.hiddenAt(x, y, r.floorZ)) continue;
                let list = byFloor.get(r.floorZ);
                if (!list) byFloor.set(r.floorZ, list = []);
                list.push({ x, y });
            }
        }
        if (!byFloor.size) return;
        const group = new THREE.Group();
        group.userData.noAO = true;
        for (const [floorZ, cells] of byFloor) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const c of cells) {
                if (c.x < minX) minX = c.x;
                if (c.x > maxX) maxX = c.x;
                if (c.y < minY) minY = c.y;
                if (c.y > maxY) maxY = c.y;
            }
            minX -= 1; maxX += 2; minY -= 1; maxY += 2;
            const bw = maxX - minX, bd = maxY - minY;
            let tex;
            if (typeof document !== 'undefined') {
                const SCALE = 8, cw = Math.max(8, bw * SCALE), ch = Math.max(8, bd * SCALE);
                const mask = document.createElement('canvas'); mask.width = cw; mask.height = ch;
                const mctx = mask.getContext('2d');
                mctx.fillStyle = '#ffffff';
                for (const c of cells) mctx.fillRect((c.x - minX) * SCALE, (c.y - minY) * SCALE, SCALE, SCALE);
                const out = document.createElement('canvas'); out.width = cw; out.height = ch;
                const ctx = out.getContext('2d');
                ctx.save();
                ctx.filter = 'blur(4px)';
                ctx.drawImage(mask, 0, 0);
                ctx.restore();
                ctx.globalCompositeOperation = 'source-in';
                ctx.fillStyle = 'rgba(14, 20, 32, 0.58)';
                ctx.fillRect(0, 0, cw, ch);
                ctx.globalCompositeOperation = 'source-atop';
                ctx.strokeStyle = 'rgba(26, 36, 56, 0.22)';
                ctx.lineWidth = 2;
                for (let d = -ch; d < cw + ch; d += 12) {
                    ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d - ch, ch); ctx.stroke();
                }
                tex = new THREE.CanvasTexture(out);
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
            } else {
                tex = new THREE.DataTexture(new Uint8Array([14, 20, 32, 148]), 1, 1, THREE.RGBAFormat);
                tex.needsUpdate = true;
            }
            const geo = new THREE.PlaneGeometry(bw, bd).rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({
                map: tex, transparent: true, depthWrite: false, depthTest: true,
                clippingPlanes: this.scene.clipping, side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(minX + bw / 2, Math.min(floorZ + 2.92, this.cutZ - 0.06), minY + bd / 2);
            mesh.renderOrder = 8;
            mesh.userData.noAO = true;
            group.add(mesh);
        }
        this.concealment = group;
        this.group.add(group);
    }
    /** Hard tactical boundary: off-map scenery is a screen-space image. */
    buildApron() { /* The tactical map ends at its bounds; a 2D background replaces off-map geometry. */ }
    /**
     * PLAN-10 aim x-ray: hide these voxels ("x,y,z" keys) while the interior shoulder camera looks through them.
     * Presentation only; rebuilds just the chunks (and their neighbours) whose hidden set changed.
     */
    setXray(cells) {
        const next = cells && cells.size ? new Set(cells) : null, old = this.xray || null;
        if (!old && !next) return;
        this.xray = next;
        const dirty = new Set();
        for (const k of new Set([...(old || []), ...(next || [])])) {
            if (old?.has(k) && next?.has(k)) continue;
            const [x, y, z] = k.split(',').map(Number);
            for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
                dirty.add(`${Math.floor((x + dx) / CHUNK)},${Math.floor((y + dy) / CHUNK)},${Math.floor((z + dz) / CHUNK)}`);
        }
        for (const c of dirty) this.rebuild(c);
    }
    /** Storey cutaway: hide voxels at z >= top and cap what is cut. Rebuilds every chunk when it changes. */
    setCut(top) {
        const z = Number.isFinite(top) ? top : Infinity;
        if (z === this.cutZ) return;
        this.cutZ = z; this.rebuildAll();
    }
    dispose() {
        this.disposeConcealment();
        for (const ms of this.chunks.values()) for (const m of ms) { if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); }
        this.scene.scene.remove(this.group);
        this.decals.dispose();
        if (this.apron) { for (const m of this.apron.children) m.geometry.dispose(); this.scene.scene.remove(this.apron); }
    }
}
