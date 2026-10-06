// Plays battle events in order as animation. The battle state is already final when events arrive;
// this only decides what the player sees and when (cut-in → tracer → impact → destruction).
import * as THREE from 'three';
import { EVENT_TO_CLIP, CLIP_HOLD } from './AnimationClips.js';
import { WEAPONS, THROWABLES } from '../../../shared/content/weapons.js';
import { ELEMENT_COLORS } from '../../../shared/elements/Elements.js';
import { ABILITIES } from '../../../shared/content/units.js';
import { FORMATIONS } from '../../../shared/content/formations.js';

const wait = s => new Promise(r => setTimeout(r, s * 1000));
const PART_LABEL = { head: 'head', torso: 'torso', armL: 'L arm', armR: 'R arm', legs: 'legs' };

export class EventPlayer {
    constructor(game) { this.game = game; this.queue = []; this.busy = false; this.speed = 1; this.idleWaiters = []; }
    enqueue(events) { this.queue.push(...events); if (!this.busy) this.pump(); }
    idle() { return !this.busy && !this.queue.length; }
    whenIdle() { return this.idle() ? Promise.resolve() : new Promise(r => this.idleWaiters.push(r)); }
    async pump() {
        this.busy = true;
        while (this.queue.length) {
            const e = this.queue.shift();
            try { await this.play(e); } catch (err) { console.error('event playback', e, err); }
        }
        this.busy = false;
        this.game.settleViews();
        const w = this.idleWaiters; this.idleWaiters = [];
        w.forEach(r => r());
    }
    d(s) { return wait(s / this.speed); }
    view(id) { return this.game.views.get(id); }
    async play(e) {
        const g = this.game, fx = g.fx;
        const clip = EVENT_TO_CLIP[e.t];
        switch (e.t) {
            case 'cutin': {
                const u = g.battle.unit(e.unitId);
                const group = (e.group || [e.unitId]).map(id => g.battle.unit(id)).filter(Boolean);
                if (!group.length || (u.side === 'enemy' && !g.isVisible(u))) break;
                const target = e.targetIds?.[0] ? g.battle.unit(e.targetIds[0]) : null;
                const title = e.kind === 'breach' ? 'BREACH' : (WEAPONS[e.weaponId]?.name || THROWABLES[e.itemId]?.name || e.kind).toUpperCase();
                const sub = g.lastPreview?.unitId === e.unitId && g.lastPreview.hit != null ? `${Math.round(g.lastPreview.hit * 100)}% on target` : (target ? `→ ${target.name}` : '');
                const sv = this.view(e.unitId), tv = target ? this.view(target.id) : null;
                await g.cutins.play({ units: group, kind: e.kind, title, subtitle: sub, side: u.side,
                    shooterPos: sv?.worldPosition(), targetPos: tv ? tv.worldPosition() : sv?.worldPosition().clone().add(new THREE.Vector3(...faceVec(u), 0).multiplyScalar(4)) });
                break;
            }
            case 'move': case 'knockback': {
                const v = this.view(e.unitId); if (!v) break;
                const path = e.path || [];
                v.animator.play(e.t === 'move' ? 'walk' : 'hit');
                const speed = (e.t === 'move' ? 7 : 12) * this.speed;
                for (let i = 1; i < path.length; i++) {
                    const a = path[i - 1], b = path[i];
                    v.face(b.x - a.x, b.y - a.y);
                    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
                    const steps = Math.max(1, Math.round(len * 6));
                    for (let s = 1; s <= steps; s++) {
                        const k = s / steps;
                        v.setCell(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
                        g.updateEnemyVisibility();
                        await wait(len / speed / steps);
                    }
                }
                v.animator.play('idle');
                if (e.unitId && g.selected === e.unitId) g.focusUnit(g.battle.unit(e.unitId));
                break;
            }
            case 'shot': {
                const v = this.view(e.unitId);
                v?.animator.play('fire', { weaponId: e.weaponId, restart: true });
                if (e.aim) v?.face(e.aim.x - (v.unit.x + 0.5), e.aim.y - (v.unit.y + 0.5));
                const w = WEAPONS[e.weaponId];
                fx.flash(e.muzzle, 0xffe08a, 0.25);
                for (const p of e.projectiles) {
                    fx.tracer(e.muzzle, p.to, w?.element ? new THREE.Color(ELEMENT_COLORS[w.element]).getHex() : (e.reaction ? 0xff9f6b : 0xfff0b0));
                    if (p.kind === 'voxel') fx.flash(p.to, 0xd8c8a8, 0.12, 0.2);
                    if (w?.projectiles > 1) await this.d(0.04);
                }
                await this.d(CLIP_HOLD.fire);
                break;
            }
            case 'melee': {
                const v = this.view(e.unitId), t = this.view(e.targetId);
                if (v && t) { v.face(t.unit.x - v.unit.x, t.unit.y - v.unit.y); v.animator.play('fire', { restart: true }); }
                await this.d(0.3);
                break;
            }
            case 'throw': {
                const v = this.view(e.unitId);
                v?.animator.play('throw', { restart: true });
                const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
                g.scene.scene.add(ball);
                const pts = e.points || [];
                for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 24))) { ball.position.set(pts[i].x, pts[i].h, pts[i].y); await wait(0.5 / this.speed / 24); }
                g.scene.scene.remove(ball); ball.geometry.dispose(); ball.material.dispose();
                break;
            }
            case 'explosion': fx.explosion(e, e.radius, e.element); await this.d(0.15); break;
            case 'smoke': fx.syncField(g.battle.field); break;
            case 'voxels': g.voxelView.flush(); fx.debris(e.changes || []); break;
            case 'collapse': g.voxelView.flush(); fx.float(new THREE.Vector3(e.fallen?.[0]?.x ?? 0, e.fallen?.[0]?.to ?? 1, e.fallen?.[0]?.y ?? 0), 'COLLAPSE', '#ffcc66', 22); g.scene.shake = 0.6; await this.d(0.25); break;
            case 'elements': g.voxelView.flush(); fx.syncField(g.battle.field); break;
            case 'door': g.voxelView.flush(); break;
            case 'damage': {
                const v = this.view(e.unitId); if (!v) break;
                if (!g.isVisible(v.unit) && v.unit.side === 'enemy') break;
                fx.float(v.worldPosition(), e.amount ? `-${e.amount} ${PART_LABEL[e.part] || ''}` : 'ARMOR', e.element ? ELEMENT_COLORS[e.element] : (e.amount ? '#ff8a8a' : '#cfd8dc'), e.amount ? 20 : 15);
                v.drawBar();
                if (e.amount) v.animator.play('hit', { restart: true });
                break;
            }
            case 'disabled': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.4, 0)), `${PART_LABEL[e.part]} disabled`.toUpperCase(), '#ffb74d', 15); break; }
            case 'death': { const v = this.view(e.unitId); if (v) { v.animator.play('down'); v.drawBar(); fx.float(v.worldPosition(), v.unit.side === 'player' ? 'KIA' : 'KILLED', '#ff5252', 22); } await this.d(0.3); break; }
            case 'status': { const v = this.view(e.unitId); if (v && (v.unit.side === 'player' || g.isVisible(v.unit))) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.3, 0)), e.statusId, '#ffe08a', 14); break; }
            case 'stress': { const v = this.view(e.unitId); if (v) { v.drawBar(); if (e.breakdown) { fx.float(v.worldPosition(), 'BREAKDOWN', '#c38bff', 22); await this.d(0.4); } } break; }
            case 'reaction': { const v = this.view(e.watcherId); if (v) fx.float(v.worldPosition(), 'OVERWATCH!', '#ff9f6b', 18); await this.d(0.2); break; }
            case 'alert': for (const id of e.unitIds) { const v = this.view(id); if (v && g.isVisible(v.unit)) fx.float(v.worldPosition(), '!', '#ff5252', 30); } break;
            case 'reveal': g.onReveal(e.roomId); break;
            case 'fall': { const v = this.view(e.unitId); if (v) { v.animator.play('hit', { restart: true }); if (e.to >= 0) v.setCell(v.unit.x, v.unit.y, e.to); } await this.d(0.2); break; }
            case 'breach': fx.float(this.view(e.unitIds[0])?.worldPosition() || new THREE.Vector3(), 'BREACH!', '#ffd54f', 24); break;
            case 'overwatch': this.view(e.unitId)?.animator.play('hunker'); break;
            case 'ability': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition(), ABILITIES[e.abilityId]?.name || e.abilityId, '#7fdbff', 16); break; }
            case 'formation': {
                const f = e.formation; const tpl = FORMATIONS[f?.template || e.template];
                if (e.action === 'declare' && f) for (const id of f.members) { const v = this.view(id); if (v) fx.float(v.worldPosition(), tpl.name.toUpperCase(), '#80cbc4', 14); }
                if (e.action === 'dissolve') g.log(`${tpl?.name || 'Formation'} dissolved (${e.why})`);
                if (e.action === 'broken') g.log('Formation cohesion broken');
                break;
            }
            case 'turn': g.onTurn(e); await this.d(0.35); break;
            case 'outcome': g.onOutcome(e); break;
            case 'spawn': await g.onSpawn(e); { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition(), 'SPAWNED', '#b388ff', 16); } break;
            case 'debug': { const v = this.view(e.unitId); if (v) { v.snap(); v.drawBar(); if (e.op === 'heal' && !v.unit.dead) v.animator.play('idle'); } break; }
            case 'reload': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition(), 'RELOAD', '#b0bec5', 14); break; }
        }
        if (clip && e.t !== 'move' && e.t !== 'shot' && e.t !== 'damage' && e.t !== 'death') void clip;
        g.hud.refresh();
    }
}

function faceVec(u) { const m = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] }[u.facing] || [0, 1]; return [m[0], 0, m[1]]; }
