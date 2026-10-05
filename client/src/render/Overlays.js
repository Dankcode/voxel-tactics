// Tactical overlays: AP-coloured move range (Phoenix Point rings), hovered tile, path line, cover
// shields, aim cone, blast radius, throw arc, overwatch cones, room / element debug tints.
import * as THREE from 'three';
import { coverAt } from '../../../shared/voxel/Cover.js';

const AP_COLORS = [0x3fd0ff, 0x3fd0ff, 0x4f8dff, 0xf2c94c, 0xf2994a, 0xeb5757];

export class Overlays {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group(); scene.scene.add(this.group);
        this.rangeGroup = new THREE.Group(); this.group.add(this.rangeGroup);
        this.tileGeo = new THREE.PlaneGeometry(0.9, 0.9); this.tileGeo.rotateX(-Math.PI / 2);
        this.tileMats = AP_COLORS.map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthWrite: false, clippingPlanes: scene.clipping }));
        this.hover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
        this.hover.visible = false; this.group.add(this.hover);
        this.pathLine = null; this.shields = new THREE.Group(); this.group.add(this.shields);
        this.aim = new THREE.Group(); this.group.add(this.aim);
        this.debug = new THREE.Group(); this.group.add(this.debug);
        this.shieldGeo = new THREE.BoxGeometry(0.5, 0.42, 0.06);
        this.shieldMats = [null, new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.85 }), new THREE.MeshBasicMaterial({ color: 0x2f80ed, transparent: true, opacity: 0.9 })];
    }
    clearRange() { for (const c of [...this.rangeGroup.children]) this.rangeGroup.remove(c); }
    /** costs: Map nodeKey → path cost; apOf(cost) → AP needed. */
    showRange(nodes, costs, apOf, maxAp) {
        this.clearRange();
        const byAp = new Map();
        for (const [k, n] of nodes) {
            const ap = apOf(costs.get(k));
            if (ap < 1 || ap > maxAp) continue;
            (byAp.get(ap) || byAp.set(ap, []).get(ap)).push(n);
        }
        for (const [ap, list] of byAp) {
            const mesh = new THREE.InstancedMesh(this.tileGeo, this.tileMats[Math.min(ap, 5)], list.length);
            const m = new THREE.Matrix4();
            list.forEach((n, i) => { m.makeTranslation(n.x + 0.5, n.z + 1.03, n.y + 0.5); mesh.setMatrixAt(i, m); });
            this.rangeGroup.add(mesh);
        }
    }
    setHover(cell) {
        if (!cell) { this.hover.visible = false; return; }
        this.hover.visible = true; this.hover.position.set(cell.x + 0.5, cell.z + 1.04, cell.y + 0.5);
    }
    showPath(path) {
        if (this.pathLine) { this.group.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine = null; }
        if (!path || path.length < 2) return;
        const pts = path.map(p => new THREE.Vector3(p.x + 0.5, p.z + 1.15, p.y + 0.5));
        this.pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff }));
        this.group.add(this.pathLine);
    }
    /** XCOM shield icons on the four faces of a standing position. */
    showCover(store, cell) {
        for (const c of [...this.shields.children]) this.shields.remove(c);
        if (!cell) return;
        const cov = coverAt(store, cell.x, cell.y, cell.z);
        for (const [dir, dx, dy] of [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]]) {
            if (!cov[dir]) continue;
            const m = new THREE.Mesh(this.shieldGeo, this.shieldMats[cov[dir]]);
            m.position.set(cell.x + 0.5 + dx * 0.42, cell.z + 1.4, cell.y + 0.5 + dy * 0.42);
            m.rotation.y = dx ? Math.PI / 2 : 0;
            this.shields.add(m);
        }
    }
    clearAim() { for (const c of [...this.aim.children]) { this.aim.remove(c); c.geometry?.dispose?.(); } }
    /** Accuracy cone: lines from the muzzle to a ring of radius r at the aim point. */
    showCone(muzzle, aimPoint, spreadDeg) {
        this.clearAim();
        const a = new THREE.Vector3(muzzle.x, muzzle.h, muzzle.y), b = new THREE.Vector3(aimPoint.x, aimPoint.h, aimPoint.y);
        const d = a.distanceTo(b), r = d * Math.tan(spreadDeg * Math.PI / 180);
        const dir = b.clone().sub(a).normalize();
        const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(dir, u).normalize();
        const ring = [];
        for (let i = 0; i <= 32; i++) { const t = i / 32 * Math.PI * 2; ring.push(b.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r)); }
        const mat = new THREE.LineBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.9, depthTest: false });
        const ringLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat); ringLine.renderOrder = 20;
        const inner = ring.map(p => b.clone().lerp(p, 0.5));
        const innerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(inner), mat); innerLine.renderOrder = 20;
        const spokes = [0, 8, 16, 24].map(i => new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, ring[i]]), new THREE.LineBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.35, depthTest: false })));
        this.aim.add(ringLine, innerLine, ...spokes);
    }
    showArc(points, radius, land) {
        this.clearAim();
        if (points?.length) this.aim.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p.x, p.h, p.y))), new THREE.LineBasicMaterial({ color: 0xffb347, depthTest: false })));
        if (land) {
            const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.08, radius, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }));
            ring.position.set(land.x, land.h + 0.05, land.y); this.aim.add(ring);
        }
    }
    /** Overwatch cones of units (thin wedges on the ground). */
    showOverwatch(units) {
        for (const c of [...this.debug.children].filter(c => c.userData.ow)) this.debug.remove(c);
        for (const u of units) {
            if (!u.overwatch) continue;
            const ow = u.overwatch, a0 = Math.atan2(ow.dy, ow.dx) - ow.halfAngle, a1 = Math.atan2(ow.dy, ow.dx) + ow.halfAngle;
            const pts = [new THREE.Vector3(u.x + 0.5, u.z + 1.08, u.y + 0.5)];
            for (let i = 0; i <= 16; i++) { const a = a0 + (a1 - a0) * i / 16; pts.push(new THREE.Vector3(u.x + 0.5 + Math.cos(a) * ow.range, u.z + 1.08, u.y + 0.5 + Math.sin(a) * ow.range)); }
            pts.push(pts[0]);
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: u.side === 'player' ? 0x56ccf2 : 0xff7070, transparent: true, opacity: 0.7 }));
            line.userData.ow = true; this.debug.add(line);
        }
    }
}
