// Plays battle events in order as animation. The battle state is already final when events arrive;
// this only decides what the player sees and when (cut-in → tracer → impact → destruction).
import * as THREE from 'three';
import { EVENT_TO_CLIP, CLIP_HOLD } from './AnimationClips.js';
import { WEAPONS, THROWABLES } from '../../../shared/content/weapons.js';
import { ELEMENT_COLORS } from '../../../shared/elements/Elements.js';
import { ABILITIES } from '../../../shared/content/units.js';
import { FORMATIONS } from '../../../shared/content/formations.js';
import { materialById } from '../../../shared/voxel/Materials.js';
import { TRACER_SPEED, BURST_GAP } from '../render/Fx.js';
import { explosionSound, weaponHandlingSound } from '../audio/SoundPlayer.js';

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
        if (this.game.cameraDirector.phase === 'action') this.game.cameraDirector.end();
        this.game.discoveryVisible.clear();
        this.game.settleViews();
        const w = this.idleWaiters; this.idleWaiters = [];
        w.forEach(r => r());
    }
    d(s) { return wait(s / this.speed); }
    /** Slide a unit view between two cells (step-out and back), keeping its facing. */
    async slide(v, a, b, seconds) {
        const n = 6;
        for (let i = 1; i <= n; i++) { const k = i / n, e = k * k * (3 - 2 * k); v.setCell(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e); await this.d(seconds / n); }
    }
    view(id) { return this.game.views.get(id); }
    async play(e) {
        const g = this.game, fx = g.fx;
        const clip = EVENT_TO_CLIP[e.t];
        switch (e.t) {
            case 'intel': g.hud.log(`${e.source}: ${e.contacts.length} shared contact(s)`); break;
            case 'drone': g.hud.log(e.detected?'Scout drone detected and lost':`Drone scouting ${e.x}, ${e.y}`); break;
            case 'cutin': {
                const u = g.battle.unit(e.unitId);
                const group = (e.group || [e.unitId]).map(id => g.battle.unit(id)).filter(Boolean);
                const target = e.targetIds?.[0] ? g.battle.unit(e.targetIds[0]) : null;
                // PLAN-10: a squad member being targeted pulls the camera (and the storey cut) to them.
                if (u && u.side !== 'player' && target?.side === 'player' && g.options.followCamera) { g.focusUnit(target); g.focusFloor(target, g.isVisible(u) ? u : null); }
                if (!group.length || (u.side === 'enemy' && !g.isVisible(u))) break;
                const title = e.kind === 'breach' ? 'BREACH' : (WEAPONS[e.weaponId]?.name || THROWABLES[e.itemId]?.name || ABILITIES[e.abilityId]?.name || e.kind).toUpperCase();
                // PLAN-09: NPC shots roll an XCOM-style chance to hit; show it like XCOM does.
                const sub = e.chance != null ? `${e.chance}% to hit${target ? ` → ${target.name}` : ''}`
                    : !g.battle.intelMode && g.lastPreview?.unitId === e.unitId && g.lastPreview.hit != null ? `${Math.round(g.lastPreview.hit * 100)}% on target` : (target ? `→ ${target.name}` : '');
                const sv = this.view(e.unitId), tv = target ? this.view(target.id) : null;
                // A shot from a blocked angle is framed from the side tile the soldier steps out to.
                const step = e.muzzle?.step, shooterPos = step && sv ? new THREE.Vector3(step.x + 0.5, sv.worldPosition().y, step.y + 0.5) : sv?.worldPosition();
                await g.cutins.play({ units: group, weaponId: e.weaponId, kind: e.kind, title, subtitle: sub, side: u.side, shoulder: e.muzzle?.side,
                    shooterPos, targetPos: e.aimPoint?new THREE.Vector3(e.aimPoint.x,e.aimPoint.h-1.1,e.aimPoint.y):tv ? tv.worldPosition() : sv?.worldPosition().clone().add(new THREE.Vector3(...faceVec(u)).multiplyScalar(4)) });
                break;
            }
            case 'move': case 'knockback': {
                const v = this.view(e.unitId); if (!v) break;
                const path = e.path || [];
                v.animator.play(e.t === 'move' ? 'run' : 'hit');
                const speed = (e.t === 'move' ? 7 : 12) * this.speed;
                let stopFootsteps = null;
                try {
                    for (let i = 1; i < path.length; i++) {
                        const a = path[i - 1], b = path[i];
                        v.face(b.x - a.x, b.y - a.y);
                        const kind = e.kinds?.[i - 1] || (Math.hypot(b.x - a.x, b.y - a.y) > 1.5 ? 'vault' : 'walk');
                        const windowVault=!!e.windowVaults?.[i-1];
                        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * (kind === 'climb' ? 1.6 : 1);
                        if(e.t === 'move') v.animator.play(kind === 'vault' ? 'vault' : kind === 'climb' ? 'climb' : 'run');
                        const steps = Math.max(1, Math.round(len * 6));
                        const walking = e.t === 'move' && kind === 'walk' && (v.unit.side === 'player' || g.isVisible(v.unit)) && !['wall_strider', 'siege_weaver'].includes(v.unit.type) && !v.unit.drone;
                        if (walking && !stopFootsteps) stopFootsteps = g.audio.play('footsteps', { loop: true, volume: 0.22, rate: this.speed * 1.25 });
                        else if (!walking && stopFootsteps) { stopFootsteps(); stopFootsteps = null; }
                        for (let s = 1; s <= steps; s++) {
                            const k = s / steps;
                            let px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k, pz = a.z + (b.z - a.z) * k;
                            if (kind === 'vault') {pz += Math.sin(k * Math.PI) * (windowVault?1:1.1);if(windowVault)v.group.scale.y=1-.5*Math.sin(k*Math.PI);}                // hop over low cover
                            else if (kind === 'jump') {
                                // Step off the edge, then drop under gravity.
                                const h = Math.min(1, k / 0.35);
                                px = a.x + (b.x - a.x) * h; py = a.y + (b.y - a.y) * h;
                                pz = k < 0.35 ? a.z + Math.sin(h * Math.PI / 2) * 0.25 : a.z + 0.25 - (a.z + 0.25 - b.z) * ((k - 0.35) / 0.65) ** 2;
                            } else if (kind === 'climb') {
                                // Up: climb the ladder column, then step onto the ledge. Down: step onto the ladder, then descend.
                                const up = b.z > a.z, split = 0.8;
                                const vk = up ? Math.min(1, k / split) : Math.max(0, (k - (1 - split)) / split);
                                const hk = up ? Math.max(0, (k - split) / (1 - split)) : Math.min(1, k / (1 - split));
                                px = a.x + (b.x - a.x) * hk; py = a.y + (b.y - a.y) * hk; pz = a.z + (b.z - a.z) * vk;
                            }
                            v.setCell(px, py, pz);
                            g.updateEnemyVisibility();
                            await wait(len / speed / steps);
                        }
                    }
                } finally { stopFootsteps?.(); v.group.scale.y=1; }
                v.animator.play('idle');
                if (e.unitId && g.selected === e.unitId) g.focusUnit(g.battle.unit(e.unitId));
                break;
            }
            case 'shot': {
                const v = this.view(e.unitId);
                // Step out to the side tile, fire, step back (the soldier's tile never changes).
                const step = e.muzzle?.step && v ? e.muzzle.step : null;
                if (step) await this.slide(v, v.unit, step, 0.14);
                v?.animator.play('fire', { weaponId: e.weaponId, restart: true });
                if (e.aim) v?.face(e.aim.x - (v.unit.x + 0.5), e.aim.y - (v.unit.y + 0.5));
                const w = WEAPONS[e.weaponId];
                fx.flash(e.muzzle, 0xffe08a, 0.25);
                // PLAN-07 tracers: squad warm white, enemies red-orange, overwatch amber, elemental shots in colour.
                // Burst/auto rounds leave BURST_GAP apart; pellets of one shell fly together.
                const shooter = this.view(e.unitId)?.unit;
                const color = w?.element ? new THREE.Color(ELEMENT_COLORS[w.element]).getHex() : e.reaction ? 0xffb347 : shooter?.side === 'enemy' ? 0xff6a4a : 0xfff0c8;
                const perRound = Math.max(1, Math.round(e.projectiles.length / Math.max(1, e.rounds || 1)));
                let last = 0;
                e.projectiles.forEach((p, i) => {
                    const delay = Math.floor(i / perRound) * BURST_GAP / this.speed;
                    const d = Math.hypot(p.to.x - e.muzzle.x, p.to.y - e.muzzle.y, p.to.h - e.muzzle.h);
                    last = Math.max(last, delay + d / (TRACER_SPEED * this.speed));
                    fx.tracer(e.muzzle, p.to, color, { delay, speed: TRACER_SPEED * this.speed, onArrive: () => {
                        if (p.kind === 'voxel') fx.impact(p.to, materialById(g.battle?.store.get(p.voxel?.x, p.voxel?.y, p.voxel?.z) ?? 0).family || 'stone');
                        else if (p.kind === 'unit') { fx.impact(p.to, 'unit'); if (p.crit) fx.float(new THREE.Vector3(p.to.x, p.to.h - 1.6, p.to.y), 'CRITICAL', '#ffd34d', 20); }
                        for (const q of p.pierced || []) { const k = q.t / Math.max(d, 1e-6); fx.impact({ x: e.muzzle.x + (p.to.x - e.muzzle.x) * k, y: e.muzzle.y + (p.to.y - e.muzzle.y) * k, h: e.muzzle.h + (p.to.h - e.muzzle.h) * k }, 'stone', { exit: true }); }
                    } });
                });
                await this.d(Math.max(CLIP_HOLD.fire, last * this.speed));
                if (e.weaponId === 'blunderbuss' && v && (v.unit.side === 'player' || g.isVisible(v.unit))) g.audio.play('shotgunPump', { volume: 0.6 });
                g.voxelView?.flush();
                if (step) { await this.slide(v, step, v.unit, 0.18); v.snap(); }
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
            case 'strike': {
                // PLAN-12: the salvo drops out of the sky onto the strike area, all bombs together; the blasts follow.
                const cx = e.bombs.reduce((s, b) => s + b.x, 0) / e.bombs.length, cy = e.bombs.reduce((s, b) => s + b.y, 0) / e.bombs.length;
                const h = e.bombs.reduce((s, b) => s + b.h, 0) / e.bombs.length;
                if (g.options.followCamera) g.scene.glideTo(new THREE.Vector3(cx, h, cy), 5);
                g.overlays?.clearAim?.();
                await Promise.all(e.bombs.map((b, i) => fx.bomb(b, { fall: 0.65 / this.speed, delay: i * 0.08 / this.speed })));
                break;
            }
            case 'explosion': g.audio?.play(explosionSound(e, g.scene.target), { volume: e.of > 1 ? 0.7 / Math.sqrt(e.of) : 0.7 }); fx.explosion(e, e.radius, e.element); g.voxelView?.flush(); if (!(e.of > 1) || e.salvo === e.of - 1) await this.d(0.15); break;   // an airstrike salvo goes off at once
            case 'smoke': fx.syncField(g.battle.field); break;
            case 'voxels': g.voxelView.flush(); if (g.roadMarks && g.battle && (g.battle.mission?.visual?.roadPaint || e.changes?.some(c => (c[2] ?? c.z) <= (g.battle.mission?.meta?.streetDatum ?? 1) + 1))) g.roadMarks.build(g.battle.store, g.battle.mission?.visual?.roadPaint); break;
            case 'collapse': g.voxelView.flush(); fx.float(new THREE.Vector3(e.fallen?.[0]?.x ?? 0, e.fallen?.[0]?.to ?? 1, e.fallen?.[0]?.y ?? 0), 'COLLAPSE', '#ffcc66', 22); g.scene.shake = 0.6; await this.d(0.25); break;
            case 'elements': g.voxelView.flush(); fx.syncField(g.battle.field); break;
            case 'door': { const v=this.view(e.unitId); if(e.kicked){v?.animator.play('vault',{restart:true});fx.float(v?.worldPosition()||new THREE.Vector3(),'KICK!','#ffd54f',22);g.scene.shake=.18;await this.d(.3);} g.voxelView.flush(); break; }
            case 'damage': {
                const v = this.view(e.unitId); if (!v) break;
                if (!g.isVisible(v.unit) && v.unit.side === 'enemy') break;
                fx.float(v.worldPosition(), e.amount ? `-${e.amount} ${PART_LABEL[e.part] || ''}` : 'ARMOR', e.element ? ELEMENT_COLORS[e.element] : (e.amount ? '#ff8a8a' : '#cfd8dc'), e.amount ? 20 : 15);
                v.drawBar();
                if (e.amount) v.animator.play('hit', { restart: true });
                break;
            }
            case 'disabled': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.4, 0)), `${PART_LABEL[e.part]} disabled`.toUpperCase(), '#ffb74d', 15); break; }
            case 'heal': { const v=this.view(e.unitId); if(v) {v.drawBar(); fx.float(v.worldPosition(),`+${e.amount} HP`,'#5ff2d6',22);} await this.d(0.3); break; }
            case 'death': { const v = this.view(e.unitId); if (v) { v.animator.play('down'); v.drawBar(); fx.float(v.worldPosition(), v.unit.side === 'player' ? 'KIA' : v.unit.drone ? 'DRONE DOWN' : 'KILLED', '#ff5252', 22); } await this.d(CLIP_HOLD.down); break; }
            case 'extract': { const v = this.view(e.unitId); if (v) { fx.float(v.worldPosition(), e.item ? 'EXTRACTED WITH THE PACKAGE' : 'EXTRACTED', '#5ff2d6', 20); await this.d(0.35); v.setVisible(false); } g.overlays.showObjective(g.battle); break; }
            case 'recover': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition(), `${(e.label || 'item').toUpperCase()} RECOVERED`, '#5ff2d6', 20); g.overlays.showObjective(g.battle); await this.d(0.3); break; }
            case 'drop': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition(), `${(e.label || 'item').toUpperCase()} DROPPED`, '#ffc845', 18); if (e.collapse) g.hud.log(`${e.label || 'The package'} fell with the floor.`); g.overlays.showObjective(g.battle); break; }
            case 'zone': g.overlays.showObjective(g.battle); g.hud.log('The objective zone collapsed to the floor below.'); break;
            case 'objective': if (e.kind === 'hold') g.hud.log(e.contested ? `Zone contested — held ${e.held}/${e.rounds}` : `Zone held ${e.held}/${e.rounds}`); break;
            case 'status': { const v = this.view(e.unitId); if (v && (v.unit.side === 'player' || g.isVisible(v.unit))) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.3, 0)), e.statusId, '#ffe08a', 14); break; }
            case 'stress': { const v = this.view(e.unitId); if (v) { v.drawBar(); if (e.breakdown) { fx.float(v.worldPosition(), 'BREAKDOWN', '#c38bff', 22); await this.d(0.4); } } break; }
            case 'reaction': { const v = this.view(e.watcherId); if (v) fx.float(v.worldPosition(), e.chance != null ? `OVERWATCH ${e.chance}%` : 'OVERWATCH!', '#ff9f6b', 18); await this.d(0.2); break; }
            case 'discovery': { e.unitIds.forEach(id=>g.discoveryVisible.add(id));g.updateEnemyVisibility();g.hud.banner('ENEMY CONTACT','SCATTERING TO COVER','enemy');g.hud.log('Enemy group spotted — scattering to cover.');await this.d(.5);break; }
            case 'wait': this.view(e.unitId)?.animator.play('idle');break;
            case 'alert': for (const id of e.unitIds) { const v = this.view(id); if (v && g.isVisible(v.unit)) fx.float(v.worldPosition(), '!', '#ff5252', 30); } break;
            // PLAN-14: enemies that heard a loud sound and go to search it (only the ones you can see show it).
            case 'heard': { let shown = 0; for (const id of e.unitIds) { const v = this.view(id); if (v && g.isVisible(v.unit) && !v.unit.alerted) { fx.float(v.worldPosition(), '?', '#ffd54f', 28); shown++; } } if (shown) g.hud.log(`${shown} hostile${shown > 1 ? 's' : ''} heard that and ${shown > 1 ? 'are' : 'is'} coming to look.`); break; }
            case 'scan': { g.sightings.showScan(e); g.hud.log(e.contacts.length ? `Recon Scan: ${e.contacts.length} contact${e.contacts.length > 1 ? 's' : ''} within ${e.range} tiles (approximate positions).` : `Recon Scan: no contacts within ${e.range} tiles.`); await this.d(0.3); break; }
            case 'vision': g.onVision(e.cells);break;
            case 'reveal': g.onReveal(e.roomId); break;
            case 'fall': { const v = this.view(e.unitId); if (v) { v.animator.play('hit', { restart: true }); if (e.to >= 0) v.setCell(v.unit.x, v.unit.y, e.to); } await this.d(0.2); break; }
            case 'breach': fx.float(this.view(e.unitIds[0])?.worldPosition() || new THREE.Vector3(), 'BREACH!', '#ffd54f', 24); break;
            case 'overwatch': this.view(e.unitId)?.animator.play('hunker'); break;
            case 'overwatchCancel': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.3, 0)), 'OVERWATCH CANCELLED', '#9fd8ff', 14); break; }
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
            case 'reload': { const v = this.view(e.unitId); if (v) { fx.float(v.worldPosition(), 'RELOAD', '#b0bec5', 14); if (v.unit.side === 'player' || g.isVisible(v.unit)) g.audio.play(weaponHandlingSound(e.weaponId), { volume: 0.6 }); } break; }
        }
        if (clip && e.t !== 'move' && e.t !== 'shot' && e.t !== 'damage' && e.t !== 'death') void clip;
        g.hud.refresh();
    }
}

function faceVec(u) { const m = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] }[u.facing] || [0, 1]; return [m[0], 0, m[1]]; }
