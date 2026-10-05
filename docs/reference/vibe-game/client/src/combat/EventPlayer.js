// PLAN 15A §9.6 — plays EncounterEvents as timed animations. Events are presentation; schema is truth.
import * as THREE from 'three';
import { eventSeconds } from '../../../shared/combat/Presentation.js';

// Durations come from shared/combat/Presentation.js so the server's pacing matches what is drawn here.
const ELEMENT_COLORS = { pyro: '#ff7a3d', hydro: '#4fc3f7', cryo: '#bfefff', anemo: '#b7f5c9', geo: '#e0c28a' };

export class EventPlayer {
    constructor({ threeManager, viewFor, topOffset = () => 1, onEvent = () => {} }) {
        Object.assign(this, { threeManager, viewFor, topOffset, onEvent });
        this.queue = [];
        this.current = null;
        this.lastSeq = 0;
        this.speed = 1;
        this.projectile = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c4 }));
        this.projectile.visible = false; this.projectile.renderOrder = 14;
        threeManager.scene.add(this.projectile);
        this.layer = document.createElement('div');
        this.layer.className = 'combat-float-layer';
        document.body.appendChild(this.layer);
        this.floats = [];
    }
    /** Appends events, ignoring seq ≤ lastPlayedSeq. Returns false on a gap (caller re-syncs). */
    enqueue(events, { fromSeq, resync = false } = {}) {
        if (resync) { this.queue = []; this.current = null; this.lastSeq = (events[0]?.seq ?? 1) - 1; }
        else if (fromSeq != null && fromSeq > this.lastSeq + 1 && this.lastSeq > 0) return false;
        for (const e of events) if (e.seq > this.lastSeq) { this.queue.push(e); this.lastSeq = e.seq; }
        return true;
    }
    /** Nothing playing and nothing queued: the screen has caught up with the server. */
    idle() { return !this.current && !this.queue.length; }
    reset(seq = 0) { this.queue = []; this.current = null; this.lastSeq = seq; this.projectile.visible = false; }
    fastForward(multiplier) { this.speed = multiplier; }
    update(dt) {
        const step = dt * this.speed;
        for (let guard = 0; guard < 32; guard++) {
            if (!this.current) {
                const e = this.queue.shift(); if (!e) break;
                this.current = { e, t: 0, duration: this.start(e) };
                this.onEvent(e);
            }
            const c = this.current;
            c.t += guard === 0 ? step : 0;
            this.animate(c);
            if (c.t < c.duration) break;
            this.finish(c.e);
            this.current = null;
        }
        this.updateFloats(dt);
    }
    start(e) {
        switch (e.t) {
            case 'played': if ((e.trajectory?.points?.length || 0) >= 2) this.projectile.visible = true; break;
            case 'damaged': this.float(e.actorId, e.amount ? `-${e.amount}` : 'blocked', ELEMENT_COLORS[e.element] || '#ffffff'); break;
            case 'healed': this.float(e.actorId, `+${e.amount}`, '#8dff9f'); break;
            case 'status': if (e.stacks) this.float(e.actorId, e.statusId, '#ffe08a', 0.4); break;
            case 'down': this.float(e.actorId, 'Down!', '#ff8a8a'); break;
            case 'died': this.float(e.actorId, 'Defeated', '#ffb0b0'); this.viewFor(e.actorId)?.playDeath?.(); break;
            case 'revived': this.float(e.actorId, 'Back up!', '#8dff9f'); break;
        }
        return eventSeconds(e);
    }
    animate(c) {
        const { e } = c;
        const k = c.duration ? Math.min(1, c.t / c.duration) : 1;
        if (e.t === 'moved' || e.t === 'pushed') {
            const view = this.viewFor(e.actorId), p = pointAlong(e.path || [], k);
            if (view && p) placeView(view, p);
        } else if (e.t === 'played' && this.projectile.visible) {
            const pts = e.trajectory.points, p = pointAlong3(pts, k);
            if (p) this.projectile.position.set(p.x, p.h - 1 + this.topOffset(), p.y);
        }
    }
    finish(e) {
        if (e.t === 'played') this.projectile.visible = false;
        if ((e.t === 'moved' || e.t === 'pushed') && e.path?.length) { const view = this.viewFor(e.actorId); if (view) placeView(view, e.path[e.path.length - 1]); }
    }
    float(actorId, text, color, scale = 1) {
        const view = this.viewFor(actorId);
        const pos = view?.worldPosition?.() || null;
        if (!pos) return;
        const el = document.createElement('div');
        el.className = 'combat-float'; el.textContent = text; el.style.color = color; el.style.fontSize = `${Math.round(18 * scale + 6)}px`;
        this.layer.appendChild(el);
        this.floats.push({ el, pos: pos.clone().add(new THREE.Vector3(0, 1.9, 0)), t: 0 });
    }
    updateFloats(dt) {
        const cam = this.threeManager.camera, rect = this.threeManager.renderer?.domElement?.getBoundingClientRect?.() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
        const v = new THREE.Vector3();
        this.floats = this.floats.filter(f => {
            f.t += dt;
            if (f.t > 1.1) { f.el.remove(); return false; }
            v.copy(f.pos); v.y += f.t * 0.8; v.project(cam);
            f.el.style.transform = `translate(${rect.left + (v.x + 1) / 2 * rect.width}px, ${rect.top + (1 - v.y) / 2 * rect.height}px) translate(-50%, -50%)`;
            f.el.style.opacity = String(Math.min(1, 2.2 - f.t * 2));
            return true;
        });
    }
    dispose() { this.threeManager.scene.remove(this.projectile); this.projectile.geometry.dispose(); this.projectile.material.dispose(); this.layer.remove(); }
}
export function placeView(view, p) {
    if (view.applyAuthoritativeCenter) view.applyAuthoritativeCenter(p.x, p.y, p.z, Math.round(p.x), Math.round(p.y), Math.round(p.z));
    else if (view.setRemoteTarget) view.setRemoteTarget(p.x, p.y, p.z);
    else if (view.setCell) view.setCell(p.x, p.y, p.z);
}
function pathLength(path) { let d = 0; for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z); return d; }
function pathLength3(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].h - pts[i - 1].h); return d; }
function pointAlong(path, k) {
    if (!path.length) return null;
    if (path.length === 1) return path[0];
    const total = pathLength(path) * k;
    let d = 0;
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (d + len >= total) { const t = len ? (total - d) / len : 1; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
        d += len;
    }
    return path[path.length - 1];
}
function pointAlong3(pts, k) {
    const total = pathLength3(pts) * k;
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y, b.h - a.h);
        if (d + len >= total) { const t = len ? (total - d) / len : 1; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: a.h + (b.h - a.h) * t }; }
        d += len;
    }
    return pts[pts.length - 1];
}
