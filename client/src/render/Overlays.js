import { buildWatchPreview, WATCH_COLORS } from '../../../shared/battle/WatchPreview.js';
// Tactical overlays in the XCOM idiom: blue (move and still act) and yellow (dash) zones drawn as glowing
// outlines with a faint fill, a path ribbon to the hovered tile with a destination marker, cover shields on the
// destination's faces, aim cone, blast radius, throw arc, overwatch cones, plus debug layers.
import * as THREE from 'three';
import { overlayDropAt as dropAt } from './Ground.js';
import { coverAt } from '../../../shared/voxel/Cover.js';

export const ZONE = { blue: 0x46c8ff, yellow: 0xffc845, red: 0xff5a4a, white: 0xffffff, teal: 0x5ff2d6 };
const DIRS = [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']];

function glowMaterial(color, opacity = 0.95, clipping = null) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    if (clipping) m.clippingPlanes = clipping;
    return m;
}

/** Canvas-drawn XCOM-style shield icon: full (solid) or half (lower half filled). */
function shieldTexture(kind) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 72;
    const g = c.getContext('2d');
    if(kind==='dark'){g.fillStyle='#b9ceff';g.font='56px sans-serif';g.fillText('☾',5,57);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
    const path = () => { g.beginPath(); g.moveTo(32, 4); g.lineTo(58, 14); g.lineTo(56, 40); g.quadraticCurveTo(50, 60, 32, 68); g.quadraticCurveTo(14, 60, 8, 40); g.lineTo(6, 14); g.closePath(); };
    const col = kind === 'flank' ? '#ff5a4a' : '#46c8ff';
    g.lineWidth = 5; g.strokeStyle = '#0b1622'; path(); g.stroke();
    g.lineWidth = 3; g.strokeStyle = col; path(); g.stroke();
    g.save(); path(); g.clip();
    g.fillStyle = col;
    if (kind === 'full' || kind === 'flank') g.fillRect(0, 0, 64, 72);
    else g.fillRect(0, 38, 64, 40);
    g.restore();
    if (kind === 'flank') { g.fillStyle = '#0b1622'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.fillText('!', 32, 52); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export class Overlays {
    constructor(scene) {
        this.scene = scene;
        const clip = scene.clipping;
        this.group = new THREE.Group(); this.group.userData.noAO = true; scene.scene.add(this.group);
        this.rangeGroup = new THREE.Group(); this.group.add(this.rangeGroup);
        this.pathGroup = new THREE.Group(); this.group.add(this.pathGroup);
        this.shields = new THREE.Group(); this.group.add(this.shields);
        this.aim = new THREE.Group(); this.group.add(this.aim);
        this.debug = new THREE.Group(); this.group.add(this.debug);
        this.debugLayer = new THREE.Group(); this.group.add(this.debugLayer);
        this.objectiveGroup = new THREE.Group(); this.group.add(this.objectiveGroup);
        this.mats = {
            blueLine: glowMaterial(ZONE.blue, 0.95, clip), yellowLine: glowMaterial(ZONE.yellow, 0.95, clip),
            blueFill: new THREE.MeshBasicMaterial({ color: ZONE.blue, transparent: true, opacity: 0.1, depthWrite: false, clippingPlanes: clip, toneMapped: false }),
            yellowFill: new THREE.MeshBasicMaterial({ color: ZONE.yellow, transparent: true, opacity: 0.08, depthWrite: false, clippingPlanes: clip, toneMapped: false }),
            path: glowMaterial(ZONE.blue, 0.9, clip), pathDash: glowMaterial(ZONE.yellow, 0.9, clip),
            hover: glowMaterial(0xffffff, 0.55, clip),
            objLine: glowMaterial(ZONE.teal, 0.85, clip),
            objFill: new THREE.MeshBasicMaterial({ color: ZONE.teal, transparent: true, opacity: 0.12, depthWrite: false, clippingPlanes: clip, toneMapped: false }),
            objBeam: glowMaterial(ZONE.teal, 0.5, clip),
            objCase: new THREE.MeshStandardMaterial({ color: 0xd08a2c, roughness: 0.5, metalness: 0.2 })
        };
        this.hover = new THREE.Mesh(frameGeometry(0.06), this.mats.hover);
        this.hover.visible = false; this.group.add(this.hover);
        this.shieldTex = { half: shieldTexture('half'), full: shieldTexture('full'), flank: shieldTexture('flank'),dark:shieldTexture('dark') };
        this.marker = this.makeMarker(); this.marker.visible = false; this.group.add(this.marker);
    }
    makeMarker() {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.4, 32).rotateX(-Math.PI / 2), glowMaterial(ZONE.blue, 0.95, this.scene.clipping));
        const inner = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ZONE.blue, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 6).translate(0, 0.9, 0), glowMaterial(ZONE.blue, 0.45, this.scene.clipping));
        g.add(ring, inner, beam);
        g.userData = { ring, inner, beam };
        return g;
    }
    clearRange() { for (const c of [...this.rangeGroup.children]) { this.rangeGroup.remove(c); c.geometry.dispose(); c.material.dispose(); } }
    /** Mark every overlay mesh so the AO pass skips it (they are added and removed all the time). */
    static flag(o) { o.traverse?.(c => { c.userData.noAO = true; }); return o; }
    /**
     * zones: Map nodeKey → 'blue' | 'yellow'; nodes: Map nodeKey → {x,y,z}.
     * Outlines are drawn where a zone meets a cell outside it (different zone, unreachable or a level change).
     */
    showZones(nodes, zones) {
        this.clearRange();
        const lines = { blue: [], yellow: [] }, fills = { blue: [], yellow: [] };
        const key = (x, y, z) => `${x},${y},${z}`;
        const zoneAt = (x, y, z) => zones.get(key(x, y, z));
        for (const [k, zone] of zones) {
            const n = nodes.get(k); if (!n) continue;
            fills[zone].push(n);
            for (const [dx, dy] of DIRS) {
                // Same-height neighbour in the same zone (or a stair step within one level) → interior edge.
                const nb = [0, 1, -1].map(dz => zoneAt(n.x + dx, n.y + dy, n.z + dz)).find(Boolean);
                if (nb === zone || (zone === 'yellow' && nb === 'blue')) continue;
                lines[zone].push([n, dx, dy]);
            }
        }
        for (const zone of ['blue', 'yellow']) {
            if (fills[zone].length) this.rangeGroup.add(tileMesh(fills[zone], zone === 'blue' ? this.mats.blueFill : this.mats.yellowFill));
            if (lines[zone].length) this.rangeGroup.add(edgeMesh(lines[zone], zone === 'blue' ? this.mats.blueLine : this.mats.yellowLine));
        }
    }
    clearPath() { for (const c of [...this.pathGroup.children]) { this.pathGroup.remove(c); c.geometry?.dispose(); } this.marker.visible = false; }
    /** Path ribbon + destination marker; dash = destination is in the yellow zone. */
    showPath(path, dash = false) {
        this.clearPath();
        if (!path || path.length < 2) return;
        const pts = path.map(p => new THREE.Vector3(p.x + 0.5, p.z + 1.06 - dropAt(p.x, p.y, p.z), p.y + 0.5));
        this.pathGroup.add(new THREE.Mesh(ribbonGeometry(pts, 0.09), dash ? this.mats.pathDash : this.mats.path));
        const end = path[path.length - 1];
        this.marker.visible = true;
        this.marker.position.set(end.x + 0.5, end.z + 1.03 - dropAt(end.x, end.y, end.z), end.y + 0.5);
        const col = dash ? ZONE.yellow : ZONE.blue;
        for (const m of Object.values(this.marker.userData)) m.material.color.setHex(col);
    }
    setHover(cell) {
        if (!cell) { this.hover.visible = false; return; }
        this.hover.visible = true; this.hover.position.set(cell.x + 0.5, cell.z + 1.03 - dropAt(cell.x, cell.y, cell.z), cell.y + 0.5);
    }
    /** XCOM shield icons on the four faces of a standing position; flankedBy: list of {dx, dy} threats. */
    showCover(store, cell, { flanked = false, dark=false } = {}) {
        for (const c of [...this.shields.children]) { this.shields.remove(c); c.material.dispose(); }
        if (!cell) return;
        const cov = coverAt(store, cell.x, cell.y, cell.z);
        for (const [dx, dy, dir] of DIRS) {
            if (!cov[dir]) continue;
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cov[dir] === 2 ? this.shieldTex.full : this.shieldTex.half, depthTest: false, transparent: true, toneMapped: false }));
            s.scale.set(0.42, 0.47, 1);
            s.position.set(cell.x + 0.5 + dx * 0.5, cell.z + 1.55, cell.y + 0.5 + dy * 0.5);
            s.renderOrder = 30;
            this.shields.add(s);
        }
        if(dark){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:this.shieldTex.dark,depthTest:false,transparent:true,toneMapped:false}));s.scale.set(.55,.6,1);s.position.set(cell.x+.5,cell.z+2.2,cell.y+.5);s.renderOrder=31;this.shields.add(s);}
        if (flanked) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.shieldTex.flank, depthTest: false, transparent: true, toneMapped: false }));
            s.scale.set(0.5, 0.56, 1); s.position.set(cell.x + 0.5, cell.z + 2.75, cell.y + 0.5); s.renderOrder = 31;
            this.shields.add(s);
        }
    }
    clearAim() { const owned=new Set();for (const c of [...this.aim.children]) { this.aim.remove(c); c.geometry?.dispose?.();if(c.userData.watch)owned.add(c.material); }for(const m of owned)m.dispose();this.watchPreview=null; }
    /** Accuracy cone: lines from the muzzle to a ring of radius r at the aim point. */
    showCone(muzzle, aimPoint, spreadDeg) {
        this.clearAim();
        const a = new THREE.Vector3(muzzle.x, muzzle.h, muzzle.y), b = new THREE.Vector3(aimPoint.x, aimPoint.h, aimPoint.y);
        const d = a.distanceTo(b), r = d * Math.tan(spreadDeg * Math.PI / 180);
        const dir = b.clone().sub(a).normalize();
        const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(dir, u).normalize();
        const ring = [];
        for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; ring.push(b.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r)); }
        const mat = new THREE.LineBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false });
        const ringLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat); ringLine.renderOrder = 20;
        const inner = ring.map(p => b.clone().lerp(p, 0.5));
        const innerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), mat); innerLine.renderOrder = 20;
        const spokes = [0, 12, 24, 36].map(i => new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, ring[i]]), new THREE.LineBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.35, depthTest: false, toneMapped: false })));
        const shot = new THREE.Mesh(ribbonGeometry([a, b], 0.03, true), glowMaterial(0xff6b5a, 0.6));
        shot.material.depthTest = false; shot.renderOrder = 19;
        this.aim.add(ringLine, innerLine, shot, ...spokes);
    }
    showArc(points, radius, land) {
        this.clearAim();
        if (points?.length) {
            const pts = points.map(p => new THREE.Vector3(p.x, p.h, p.y));
            const m = new THREE.Mesh(ribbonGeometry(pts, 0.05, true), glowMaterial(0xffb347, 0.9));
            m.material.depthTest = false; m.renderOrder = 20; this.aim.add(m);
        }
        if (land) {
            const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.1, radius, 48).rotateX(-Math.PI / 2), glowMaterial(0xff8a3d, 0.9));
            ring.material.depthTest = false; ring.renderOrder = 20;
            ring.position.set(land.x, land.h + 0.05, land.y);
            const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false }));
            disc.position.copy(ring.position);
            this.aim.add(ring, disc);
        }
    }
    showAbilityTile(cell, valid) {
        this.clearAim();
        if (!cell) return;
        const m = tileMesh([cell], glowMaterial(valid ? ZONE.teal : ZONE.red, 0.3));
        this.aim.add(m);
    }
    showWatchPreview(battle, unit, sector, {hidden,cutZ=Infinity} = {}) {
        this.clearAim();
        if(!sector)return;
        const key=`${battle.seq}:${JSON.stringify(unit)}:${sector.weaponId}`;
        if(this.watchBattle!==battle || this.watchCacheKey!==key) {
            this.watchBattle=battle;this.watchCacheKey=key;this.watchCache=new Map();
        }
        const data=buildWatchPreview(battle,unit,sector,{hidden,cutZ,cache:this.watchCache});
        this.watchPreview=data;
        for(const mesh of this.watchMeshes(data))this.aim.add(mesh);
        Overlays.flag(this.aim);
        return data;
    }
    watchMeshes(data,opacity=.38) {
        const meshes=[];
        for(const band of ['high','low']) {
            const material=new THREE.MeshBasicMaterial({color:WATCH_COLORS[band],transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,clippingPlanes:this.scene.clipping,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
            const cells=data.tiles.filter(c=>c.band===band),faces=data.faces.filter(f=>f.band===band);
            if(cells.length)meshes.push(tileMesh(cells,material));
            if(faces.length)meshes.push(watchFaceMesh(faces,material));
            if(!cells.length&&!faces.length)material.dispose();
        }
        for(const mesh of meshes)mesh.userData.watch=true;
        return meshes;
    }
    /** Committed watches keep the same filled accuracy field as selection. */
    showOverwatch(battle,units,options={}) {
        const materials=new Set();
        for(const c of [...this.debug.children].filter(c=>c.userData.ow)) {
            this.debug.remove(c);c.geometry.dispose();materials.add(c.material);
        }
        for(const material of materials)material.dispose();
        for(const u of units) {
            if(!u.overwatch)continue;
            const data=buildWatchPreview(battle,u,u.overwatch,options);
            for(const mesh of this.watchMeshes(data,.24)) {mesh.userData.ow=true;this.debug.add(mesh);}
        }
        Overlays.flag(this.debug);
    }
    // ------------------------------------------------------------------ debug layers
    /** The mission objective: its zone (teal tiles, outlined) and the item to recover (a case with a beacon). */
    showObjective(battle) {
        for (const c of [...this.objectiveGroup.children]) { this.objectiveGroup.remove(c); c.geometry?.dispose(); }
        const o = battle?.objective; if (!o) return;
        if (o.zone) {
            const cells = [], inside = new Set();
            for (let y = o.zone.y0; y <= o.zone.y1; y++) for (let x = o.zone.x0; x <= o.zone.x1; x++) {
                const s = battle.store.surfaceNear(x, y, o.zone.z ?? Infinity);
                if (s && (!this.visibleCell || this.visibleCell(s)) && (o.zone.z == null || Math.abs(s.z - o.zone.z) <= (o.zone.dz ?? 1))) { cells.push(s); inside.add(`${x},${y}`); }
            }
            const edges = [];
            for (const n of cells) for (const [dx, dy] of DIRS) if (!inside.has(`${n.x + dx},${n.y + dy}`)) edges.push([n, dx, dy]);
            if (cells.length) this.objectiveGroup.add(tileMesh(cells, this.mats.objFill), edgeMesh(edges, this.mats.objLine));
        }
        const it = o.item;
        if (it && !it.carrier && !it.secured && (!this.visibleCell || this.visibleCell(it))) {
            const y = it.z + 1 - dropAt(it.x, it.y, it.z);
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.16), this.mats.objCase);
            box.position.set(it.x + 0.5, y + 0.15, it.y + 0.5); box.castShadow = true;
            const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6).translate(0, 1.2, 0), this.mats.objBeam);
            beam.position.set(it.x + 0.5, y, it.y + 0.5);
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 32).rotateX(-Math.PI / 2), this.mats.objLine);
            ring.position.set(it.x + 0.5, y + 0.03, it.y + 0.5);
            this.objectiveGroup.add(box, beam, ring);
        }
        Overlays.flag(this.objectiveGroup);
    }
    clearDebugLayer() { for (const c of [...this.debugLayer.children]) { this.debugLayer.remove(c); c.geometry?.dispose(); c.material?.dispose?.(); } }
    /** Coloured tiles: cells = [{x, y, z, color}]. */
    showDebugTiles(cells, opacity = 0.35) {
        const byColor = new Map();
        for (const c of cells) (byColor.get(c.color) || byColor.set(c.color, []).get(c.color)).push(c);
        for (const [color, list] of byColor) this.debugLayer.add(tileMesh(list, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, clippingPlanes: this.scene.clipping })));
    }
    showDebugLines(segments, color = 0xff00ff) {
        const pts = [];
        for (const [a, b] of segments) pts.push(new THREE.Vector3(a.x, a.h, a.y), new THREE.Vector3(b.x, b.h, b.y));
        const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }));
        line.renderOrder = 25; this.debugLayer.add(line);
    }
}

function frameGeometry(w) {
    // Square outline on a tile top (four thin quads).
    const pos = [], idx = [];
    const quad = (x0, z0, x1, z1) => { const b = pos.length / 3; pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1); idx.push(b, b + 2, b + 1, b, b + 3, b + 2); };
    const h = 0.48;
    quad(-h, -h, h, -h + w); quad(-h, h - w, h, h); quad(-h, -h, -h + w, h); quad(h - w, -h, h, h);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
}

function tileMesh(cells, material) {
    const pos = [], idx = [];
    for (const n of cells) {
        const b = pos.length / 3, y = n.z + 1.02 - dropAt(n.x, n.y, n.z);
        pos.push(n.x, y, n.y, n.x + 1, y, n.y, n.x + 1, y, n.y + 1, n.x, y, n.y + 1);
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, material); m.renderOrder = 5;
    return m;
}

/** Edge strips just inside a cell's border, on the tile top. edges: [node, dx, dy]. */
function edgeMesh(edges, material) {
    const pos = [], idx = [], w = 0.09, y0 = 0.035;
    for (const [n, dx, dy] of edges) {
        const y = n.z + 1 + y0 - dropAt(n.x, n.y, n.z), x0 = n.x, z0 = n.y;
        let a, b, c, d;
        if (dy === -1) { a = [x0, z0]; b = [x0 + 1, z0]; c = [x0 + 1, z0 + w]; d = [x0, z0 + w]; }
        else if (dy === 1) { a = [x0, z0 + 1 - w]; b = [x0 + 1, z0 + 1 - w]; c = [x0 + 1, z0 + 1]; d = [x0, z0 + 1]; }
        else if (dx === -1) { a = [x0, z0]; b = [x0 + w, z0]; c = [x0 + w, z0 + 1]; d = [x0, z0 + 1]; }
        else { a = [x0 + 1 - w, z0]; b = [x0 + 1, z0]; c = [x0 + 1, z0 + 1]; d = [x0 + 1 - w, z0 + 1]; }
        const base = pos.length / 3;
        for (const p of [a, b, c, d]) pos.push(p[0], y, p[1]);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, material); m.renderOrder = 6;
    return m;
}

/** Flat ribbon along points (horizontal unless `vertical` — then it is billboarded around the travel axis). */
function ribbonGeometry(pts, width, vertical = false) {
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
        const dir = next.clone().sub(prev); if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
        dir.normalize();
        const side = vertical ? new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize().add(new THREE.Vector3(0, 0.6, 0)).normalize() : new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        if (side.lengthSq() < 1e-9) side.set(1, 0, 0);
        pos.push(p.x + side.x * width, p.y + side.y * width, p.z + side.z * width, p.x - side.x * width, p.y - side.y * width, p.z - side.z * width);
        if (i > 0) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
}

function watchFaceMesh(faces,material) {
    const positions=[],indices=[];
    for(const face of faces) {
        const base=positions.length/3;
        for(const [x,y,z] of face.points)positions.push(x,z,y);
        if(face.points.every(p=>Math.abs(p[2]-face.points[0][2])<.0001)) {
            const triangles=THREE.ShapeUtils.triangulateShape(face.points.map(p=>new THREE.Vector2(p[0],p[1])),[]);
            for(const triangle of triangles)indices.push(...triangle.map(i=>base+i));
        } else for(let i=1;i<face.points.length-1;i++)indices.push(base,base+i,base+i+1);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
    const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=6;return mesh;
}
