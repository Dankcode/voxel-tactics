// Plays battle events in order as animation. The battle state is already final when events arrive;
// this only decides what the player sees and when (cut-in → tracer → impact → destruction).
import * as THREE from 'three';
import { EVENT_TO_CLIP, CLIP_HOLD } from './AnimationClips.js';
import { WEAPONS, THROWABLES } from '../../../shared/content/weapons.js';
import { ELEMENT_COLORS } from '../../../shared/elements/Elements.js';
import { ABILITIES } from '../../../shared/content/units.js';
import { FORMATIONS } from '../../../shared/content/formations.js';
import { materialById, MAT } from '../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';
import { aimedUnit } from '../../../shared/battle/Ballistics.js';
import { TRACER_SPEED, BURST_GAP } from '../render/Fx.js';
import { explosionSound, impactSound, weaponHandlingSound, weaponSound } from '../audio/SoundPlayer.js';

const wait = s => new Promise(r => setTimeout(r, s * 1000));
const animateFrame = () => typeof requestAnimationFrame === 'function' ? new Promise(r => requestAnimationFrame(r)) : new Promise(r => setTimeout(r, 8));
const PART_LABEL = { head: 'head', torso: 'torso', armL: 'L arm', armR: 'R arm', legs: 'legs' };

export class EventPlayer {
    constructor(game) { this.game = game; this.queue = []; this.busy = false; this.speed = 1; this.deferSettle = false; this.idleWaiters = []; this.activeEnemyId = null; }
    enqueue(events) { this.queue.push(...events); if (!this.busy) this.pump(); }
    idle() { return !this.busy && !this.queue.length; }
    whenIdle() { return this.idle() ? Promise.resolve() : new Promise(r => this.idleWaiters.push(r)); }
    async pump() {
        this.busy = true;
        try {
            while (this.queue.length) {
                const e = this.queue.shift();
                try { await this.play(e); } catch (err) { console.error('event playback', e, err); }
            }
            const camera=this.game.cameraDirector;
            if (camera.phase === 'action') {
                const resume=this.game.mode.kind==='shoot'&&this.game.selected===camera.aimUnitId;
                if(!resume||!camera.resumeAim())camera.end();
            }
            this.game.discoveryVisible.clear();
            if (!this.deferSettle) this.game.settleViews();
        } finally {
            this.setActiveEnemy(null);
            this.busy = false;
            const w = this.idleWaiters; this.idleWaiters = [];
            w.forEach(r => r());
        }
    }
    d(s) { return wait(s / this.speed); }
    /** Drive a smooth animation callback across frames (`step(1)` immediately when duration is tiny). */
    async animate(durationSec, step) {
        if (durationSec <= 0.004) { step(1); return; }
        const start = performance.now(), ms = durationSec * 1000;
        while (true) {
            const k = Math.min(1, Math.max(0, (performance.now() - start) / ms));
            step(k);
            if (k >= 1) break;
            await animateFrame();
        }
    }
    /** Glide the tactical overview camera toward `pos` without changing camera angle or zoom. */
    focusOverview(pos, speed = 6.5) {
        const g = this.game;
        if (!pos || !g?.options?.followCamera) return;
        if (g.scene?.glideTo) g.scene.glideTo(pos, speed);
        else g.focusUnit?.({ x: pos.x - 0.5, y: pos.z - 0.5, z: pos.y - 1 }, true);
    }
    /** Highlight the active visible enemy on the overview and update HUD activity caption. */
    setActiveEnemy(unitId, label = null, kind = null) {
        const g = this.game;
        if (this.activeEnemyId && this.activeEnemyId !== unitId) {
            this.view(this.activeEnemyId)?.setActiveActor?.(null);
            this.activeEnemyId = null;
        }
        if (unitId) {
            const v = this.view(unitId);
            if (v?.unit?.side === 'enemy' && !v.unit.dead && (g.isVisible?.(v.unit) ?? true)) {
                v.setActiveActor?.(kind || 'move', label);
                this.activeEnemyId = unitId;
            }
        }
        g.activeEnemyLabel = label || null;
        g.hud?.setEnemyActivity?.(label || null);
    }
    /** Slide a unit view between two cells (step-out and back), keeping its facing. */
    async slide(v, a, b, seconds) {
        await this.animate(seconds / this.speed, k => {
            const e = k * k * (3 - 2 * k);
            v.setCell(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e);
        });
    }
    view(id) { return this.game.views.get(id); }
    async play(e) {
        const g = this.game, fx = g.fx;
        const clip = EVENT_TO_CLIP[e.t];
        const hiddenEnemy = v => !!(g.fog && v?.unit?.side === 'enemy' && g.isVisible && !g.isVisible(v.unit));
        const anyVisible = ids => (ids || []).some(id => { const un = g.battle?.unit?.(id); return un && (un.side === 'player' || g.isVisible?.(un)); });
        switch (e.t) {
            case 'intel': g.hud.log(`${e.source}: ${e.contacts.length} shared contact(s)`); break;
            case 'drone': g.hud.log(e.detected?'Scout drone detected and lost':`Drone scouting ${e.x}, ${e.y}`); break;
            case 'cutin': {
                const u = g.battle.unit(e.unitId);
                const group = (e.group || [e.unitId]).map(id => g.battle.unit(id)).filter(Boolean);
                const target = e.targetIds?.[0] ? g.battle.unit(e.targetIds[0]) : null;
                if (u?.side === 'enemy') {
                    // XCOM 2 overview style: never switch camera angle or play 2D cut-ins during enemy actions.
                    if (g.cameraDirector?.active) g.cameraDirector.end();
                    if (!g.isVisible?.(u)) {
                        if (target?.side === 'player' && g.options?.followCamera) { g.focusUnit?.(target); g.focusFloor?.(target); }
                        break;
                    }
                    const sv = this.view(e.unitId), tv = target ? this.view(target.id) : null;
                    const actName = e.kind === 'breach' ? 'BREACH' : (WEAPONS[e.weaponId]?.name || THROWABLES[e.itemId]?.name || ABILITIES[e.abilityId]?.name || e.kind || 'ACTION');
                    const kind = ['shot', 'burst', 'heavy'].includes(e.kind) ? 'shoot' : 'attack';
                    this.setActiveEnemy(u.id, `${u.name || 'HOSTILE'} · ${actName}`.toUpperCase(), kind);
                    const aimPt = e.aim || e.aimPoint;
                    if (aimPt) sv?.face?.(aimPt.x - (u.x + 0.5), aimPt.y - (u.y + 0.5));
                    else if (target) sv?.face?.(target.x - u.x, target.y - u.y);
                    if (kind === 'shoot') sv?.animator?.play('aim');
                    const sp = sv?.worldPosition?.() || new THREE.Vector3(u.x + 0.5, u.z + 1, u.y + 0.5);
                    let focusPos = sp;
                    if (target) {
                        const tp = tv?.worldPosition?.() || new THREE.Vector3(target.x + 0.5, target.z + 1, target.y + 0.5);
                        if (Math.hypot(target.x - u.x, target.y - u.y) <= 15) focusPos = sp.clone().lerp(tp, 0.35);
                    }
                    const panDist = g.options?.followCamera && g.scene?.target ? g.scene.target.distanceTo(focusPos) : 0;
                    this.focusOverview(focusPos, 7);
                    if (g.options?.followCamera) g.focusFloor?.(target?.side === 'player' ? target : u);
                    if (panDist > 2.5 && this.speed < 50) await this.d(Math.min(0.24, 0.06 + panDist * 0.012));
                    break;
                }
                if (!group.length) break;
                // Ballistic shots execute immediately over the live battlefield camera without blocking 2D cut-in cards.
                if (['shot', 'burst', 'heavy'].includes(e.kind)) {
                    if (u.side === 'player' && g.cameraDirector?.phase === 'prepare') g.cameraDirector.commitAim(u.id);
                    break;
                }
                const sv = this.view(e.unitId), tv = target ? this.view(target.id) : null;
                if (e.aimPoint && sv) sv.face?.(e.aimPoint.x - (u.x + 0.5), e.aimPoint.y - (u.y + 0.5));
                else if (target && sv) sv.face?.(target.x - u.x, target.y - u.y);
                const actionClip = e.kind === 'melee' ? 'fire' : e.kind === 'breach' ? 'stacked' : 'throw';
                sv?.animator?.play?.(actionClip, { restart: true });
                const focusPos = tv?.worldPosition?.() && sv?.worldPosition?.()
                    ? sv.worldPosition().clone().lerp(tv.worldPosition(), 0.35)
                    : sv?.worldPosition?.();
                if (focusPos && g.options?.followCamera && !g.cameraDirector?.active) this.focusOverview(focusPos, 6.5);
                break;
            }
            case 'peek': case 'peekBack': {
                const v = this.view(e.unitId);
                if (v && e.from && e.to) {
                    v.animator?.play?.('run');
                    await this.slide(v, e.from, e.to, e.t === 'peek' ? 0.14 : 0.15);
                    v.animator?.play?.(e.t === 'peek' ? 'aim' : (v.unit?.overwatch ? 'hunker' : 'idle'));
                }
                break;
            }
            case 'move': case 'knockback': {
                const v = this.view(e.unitId); if (!v) break;
                const path = e.path || [];
                if (e.t === 'move' && v.unit.side === 'enemy' && g.fog && path.length >= 2) {
                    const anyVisible = g.discoveryVisible?.has(v.id) || path.some(cell =>
                        g.battle?.unitsOf('player').some(u => g.battle.sees(u, { ...v.unit, ...cell }))
                        && !g.voxelView?.interiorVisibility?.hiddenAt(cell.x, cell.y, cell.z + 1));
                    if (!anyVisible) {
                        const last = path[path.length - 1];
                        v.setCell(last.x, last.y, last.z);
                        v.setVisible(false);
                        break;
                    }
                }
                if (path.length < 2) break;
                const segs = [];
                let totalLen = 0;
                for (let i = 1; i < path.length; i++) {
                    const a = path[i - 1], b = path[i];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const kind = e.kinds?.[i - 1] || (Math.hypot(dx, dy) > 1.5 ? 'vault' : 'walk');
                    const windowVault = !!e.windowVaults?.[i - 1];
                    const len = Math.max(0.05, Math.hypot(dx, dy, b.z - a.z) * (kind === 'climb' ? 1.55 : 1));
                    segs.push({ a, b, dx, dy, kind, windowVault, start: totalLen, end: totalLen + len, len });
                    totalLen += len;
                }
                v.animator?.play(e.t === 'move' ? 'run' : 'hit');
                const baseSpeed = e.t === 'move' ? (v.unit.side === 'enemy' ? 9.8 : 9.5) : 14;
                const totalDur = totalLen / (baseSpeed * this.speed);
                let stopFootsteps = null, segIdx = -1, lastFloorZ = null;
                const blend = totalLen > 2.5 ? 0.16 : 0.35;
                const smoothU = u => {
                    if (u <= 0) return 0;
                    if (u >= 1) return 1;
                    if (u < blend) return 0.5 * u * u / (blend * (1 - blend));
                    if (u > 1 - blend) { const r = 1 - u; return 1 - 0.5 * r * r / (blend * (1 - blend)); }
                    return (u - 0.5 * blend) / (1 - blend);
                };
                try {
                    await this.animate(totalDur, rawU => {
                        const dist = smoothU(rawU) * totalLen;
                        let curIdx = segs.length - 1;
                        for (let i = 0; i < segs.length; i++) if (dist <= segs[i].end + 1e-6) { curIdx = i; break; }
                        for (let idx = segIdx + 1; idx <= curIdx; idx++) {
                            const enter = segs[idx];
                            v.face(enter.dx, enter.dy);
                            if (e.t === 'move') v.animator?.play(enter.kind === 'vault' ? 'vault' : enter.kind === 'climb' ? 'climb' : 'run');
                            const walking = e.t === 'move' && enter.kind === 'walk' && (v.unit.side === 'player' || g.isVisible(v.unit)) && !['wall_strider', 'siege_weaver'].includes(v.unit.type) && !v.unit.drone;
                            if (walking && !stopFootsteps) stopFootsteps = g.audio.play('footsteps', { loop: true, volume: 0.22, rate: this.speed * 1.25 });
                            else if (!walking && stopFootsteps) { stopFootsteps(); stopFootsteps = null; }
                            if (v.unit.side === 'enemy' && g.fog && idx < curIdx) {
                                const visible = (g.discoveryVisible?.has(v.id) ?? false) || (g.battle?.unitsOf?.('player')?.some(u => g.battle.sees?.(u, { ...v.unit, ...enter.b })) ?? false);
                                v.setVisible?.(visible && !(g.voxelView?.interiorVisibility?.hiddenAt?.(enter.b.x, enter.b.y, enter.b.z + 1) ?? false));
                            }
                            if (v.unit.side === 'enemy' && enter.b.z !== lastFloorZ && g.options?.followCamera && (g.isVisible ? g.isVisible(v.unit) : !hiddenEnemy(v))) {
                                lastFloorZ = enter.b.z;
                                g.focusFloor?.({ ...v.unit, x: enter.b.x, y: enter.b.y, z: enter.b.z });
                            }
                        }
                        segIdx = curIdx;
                        const seg = segs[curIdx];
                        const k = Math.max(0, Math.min(1, (dist - seg.start) / seg.len));
                        let px = seg.a.x + (seg.b.x - seg.a.x) * k, py = seg.a.y + (seg.b.y - seg.a.y) * k, pz = seg.a.z + (seg.b.z - seg.a.z) * k;
                        if (seg.kind === 'vault') {
                            pz += Math.sin(k * Math.PI) * (seg.windowVault ? 1 : 1.1);
                            if (seg.windowVault) v.group.scale.y = 1 - 0.5 * Math.sin(k * Math.PI);
                        } else if (seg.kind === 'jump') {
                            const h = Math.min(1, k / 0.35);
                            px = seg.a.x + (seg.b.x - seg.a.x) * h; py = seg.a.y + (seg.b.y - seg.a.y) * h;
                            pz = k < 0.35 ? seg.a.z + Math.sin(h * Math.PI / 2) * 0.25 : seg.a.z + 0.25 - (seg.a.z + 0.25 - seg.b.z) * ((k - 0.35) / 0.65) ** 2;
                        } else if (seg.kind === 'climb') {
                            const up = seg.b.z > seg.a.z, split = 0.8;
                            const vk = up ? Math.min(1, k / split) : Math.max(0, (k - (1 - split)) / split);
                            const hk = up ? Math.max(0, (k - split) / (1 - split)) : Math.min(1, k / (1 - split));
                            px = seg.a.x + (seg.b.x - seg.a.x) * hk; py = seg.a.y + (seg.b.y - seg.a.y) * hk; pz = seg.a.z + (seg.b.z - seg.a.z) * vk;
                        }
                        if (k > 0.72 && curIdx + 1 < segs.length) {
                            const nxt = segs[curIdx + 1], t = (k - 0.72) / 0.28;
                            v.face(seg.dx * (1 - t) + nxt.dx * t, seg.dy * (1 - t) + nxt.dy * t);
                        }
                        v.setCell(px, py, pz);
                        let curVisible = v.unit.side === 'enemy' ? (g.isVisible ? g.isVisible(v.unit) : !hiddenEnemy(v)) : true;
                        if (v.unit.side === 'enemy' && g.fog) {
                            const cell = k < 0.5 ? seg.a : seg.b;
                            curVisible = ((g.discoveryVisible?.has(v.id) ?? false) || (g.battle?.unitsOf?.('player')?.some(u => g.battle.sees?.(u, { ...v.unit, ...cell })) ?? false)) && !(g.voxelView?.interiorVisibility?.hiddenAt?.(cell.x, cell.y, cell.z + 1) ?? false);
                            v.setVisible?.(curVisible);
                        }
                        if (e.t === 'move' && v.unit.side === 'enemy' && curVisible) {
                            if (this.activeEnemyId !== v.id) this.setActiveEnemy(v.id, `${v.unit.name || 'HOSTILE'} · MOVING`.toUpperCase(), 'move');
                            this.focusOverview(new THREE.Vector3(px + 0.5, pz + 1, py + 0.5), 7.5);
                        }
                    });
                } finally { stopFootsteps?.(); v.group.scale.y = 1; }
                v.animator?.play('idle');
                if (e.unitId && g.selected === e.unitId) g.focusUnit(g.battle.unit(e.unitId));
                break;
            }
            case 'shot': {
                const v = this.view(e.unitId);
                const w = WEAPONS[e.weaponId], audible = v && (v.unit.side === 'player' || g.isVisible?.(v.unit));
                if (hiddenEnemy(v) && !e.projectiles?.some(p => p.unitId && anyVisible([p.unitId]))) { g.voxelView?.flush(); break; }
                const shooter = v?.unit;
                const isEnemyShooter = shooter?.side === 'enemy';
                const enemyVisible = isEnemyShooter && !hiddenEnemy(v) && (g.isVisible ? g.isVisible(shooter) : true);
                if (enemyVisible) {
                    const label = `${shooter.name || 'HOSTILE'} · ${w?.name || 'FIRING'}`.toUpperCase();
                    this.setActiveEnemy(e.unitId, label, 'shoot');
                    if (e.aim) v?.face(e.aim.x - (shooter.x + 0.5), e.aim.y - (shooter.y + 0.5));
                    v?.animator?.play('aim');
                    const ringPos = v.worldPosition?.() || new THREE.Vector3(shooter.x + 0.5, shooter.z + 1, shooter.y + 0.5);
                    fx.calloutRing?.(ringPos, e.reaction ? 0xffb347 : 0xff5a4a);
                    if (this.speed < 50) await this.d(0.13);
                } else if (isEnemyShooter && hiddenEnemy(v)) {
                    const hitId = e.projectiles?.find(p => p.unitId && anyVisible([p.unitId]))?.unitId;
                    const tv = hitId && this.view(hitId);
                    if (tv?.worldPosition) this.focusOverview(tv.worldPosition(), 7);
                }
                // Step out to the side tile, fire, step back (the soldier's tile never changes).
                const step = e.muzzle?.step && v ? e.muzzle.step : null;
                if (step && Math.hypot(v.pos.x - (step.x + 0.5), v.pos.z - (step.y + 0.5)) > 0.15) {
                    if (step.via) {
                        await this.slide(v, v.unit, step.via, 0.06);
                        await this.slide(v, step.via, step, 0.06);
                    } else {
                        await this.slide(v, v.unit, step, 0.09);
                    }
                }
                v?.animator?.play('fire', { weaponId: e.weaponId, restart: true });
                if (isEnemyShooter) v?.pulseAction?.('fire');
                if (e.aim && v) v.face(e.aim.x - (v.unit.x + 0.5), e.aim.y - (v.unit.y + 0.5));
                if (audible) g.audio.play(weaponSound(e.weaponId), { volume: e.weaponId === 'longrifle' ? 0.72 : 0.58 });
                const tracerFrom = g.cutins?.tracerOrigin?.(e.muzzle, e.aim) || e.muzzle;

                // PLAN-07 tracers: squad warm white, enemies red-orange, overwatch amber, elemental shots in colour.
                // Burst/auto rounds leave BURST_GAP apart; pellets of one shell fly together.
                const color = w?.element ? new THREE.Color(ELEMENT_COLORS[w.element]).getHex() : e.reaction ? 0xffb347 : isEnemyShooter ? 0xff6a4a : 0xfff0c8;
                fx.flash(tracerFrom, color, isEnemyShooter ? 0.44 : 0.25, isEnemyShooter ? 0.18 : 0.12);
                const tracerSpeed = (isEnemyShooter ? TRACER_SPEED * 0.65 : TRACER_SPEED) * this.speed;
                if (enemyVisible && e.projectiles?.length) {
                    fx.shotLine?.(tracerFrom, e.projectiles[0].to, color, 0.28 / this.speed);
                    if (e.aim && Math.hypot(e.aim.x - (shooter.x + 0.5), e.aim.y - (shooter.y + 0.5)) > 15) {
                        this.focusOverview(new THREE.Vector3(e.aim.x, e.aim.h, e.aim.y), 5.5);
                    }
                }
                const perRound = Math.max(1, Math.round(e.projectiles.length / Math.max(1, e.rounds || 1)));
                let last = 0, flankFloatShown = false;
                e.projectiles.forEach((p, i) => {
                    const delay = Math.floor(i / perRound) * BURST_GAP / this.speed;
                    const d = Math.hypot(p.to.x - e.muzzle.x, p.to.y - e.muzzle.y, p.to.h - e.muzzle.h);
                    const travel = Math.hypot(p.to.x - tracerFrom.x, p.to.y - tracerFrom.y, p.to.h - tracerFrom.h);
                    last = Math.max(last, delay + travel / tracerSpeed);
                    fx.tracer(tracerFrom, p.to, color, { delay, speed: tracerSpeed, light: i === 0, arc: p.arc || null, onArrive: () => {
                        const family=p.kind==='voxel'?materialById(p.material ?? g.battle?.store.get(p.voxel?.x, p.voxel?.y, p.voxel?.z) ?? 0).family||'stone':p.kind==='unit'?'unit':null;
                        if(family){fx.impact(p.to,family);if(audible&&i%perRound===0)g.audio.play(impactSound(family),{volume:.28});}
                        if (p.kind === 'unit') {
                            if (p.headshot) fx.float(new THREE.Vector3(p.to.x, p.to.h - 1.6, p.to.y), 'HEADSHOT', '#ffd34d', 20);
                            else if (p.flanked && !flankFloatShown) { flankFloatShown = true; fx.float(new THREE.Vector3(p.to.x, p.to.h - 1.6, p.to.y), 'FLANK!', '#ff9f6b', 18); }
                            if (g.scene && typeof g.scene.shake === 'number') g.scene.shake = Math.max(g.scene.shake, p.headshot ? 0.14 : (w?.pellets > 1 || e.weaponId === 'longrifle') ? 0.11 : 0.05);
                        }
                        for (const q of p.pierced || []) { const k = q.t / Math.max(d, 1e-6); fx.impact({ x: e.muzzle.x + (p.to.x - e.muzzle.x) * k, y: e.muzzle.y + (p.to.y - e.muzzle.y) * k, h: e.muzzle.h + (p.to.h - e.muzzle.h) * k }, 'stone', { exit: true }); }
                    } });
                });
                await this.d(Math.max(CLIP_HOLD.fire, last * this.speed));
                if (e.weaponId === 'blunderbuss' && v && (v.unit.side === 'player' || g.isVisible(v.unit))) g.audio.play('shotgunPump', { volume: 0.6 });
                g.voxelView?.flush();
                if (step) {
                    if (step.via) {
                        await this.slide(v, step, step.via, 0.07);
                        await this.slide(v, step.via, v.unit, 0.07);
                    } else {
                        await this.slide(v, step, v.unit, 0.11);
                    }
                    v.snap();
                }
                break;
            }
            case 'melee': {
                const v = this.view(e.unitId), t = this.view(e.targetId);
                if (hiddenEnemy(v) && (!t || hiddenEnemy(t))) break;
                if (v?.unit?.side === 'enemy' && !hiddenEnemy(v) && (g.isVisible ? g.isVisible(v.unit) : true)) {
                    this.setActiveEnemy(e.unitId, `${v.unit.name || 'HOSTILE'} · MELEE`.toUpperCase(), 'attack');
                    const pos = v.worldPosition?.() || new THREE.Vector3(v.unit.x + 0.5, v.unit.z + 1, v.unit.y + 0.5);
                    this.focusOverview(pos, 7);
                    fx.calloutRing?.(pos, 0xff5a4a, 0.36);
                    v.pulseAction?.('fire');
                }
                let start, contact;
                if (v && t) {
                    const dx = t.pos.x - v.pos.x, dy = t.pos.z - v.pos.z, distance = Math.hypot(dx,dy) || 1;
                    v.face(dx, dy);
                    v.animator?.play('fire', { restart:true });
                    start = {x:v.pos.x-.5, y:v.pos.z-.5, z:v.visualZ};
                    contact = {...start, x:start.x+.32*dx/distance, y:start.y+.32*dy/distance};
                    await this.slide(v, start, contact, .12);
                }
                if(v&&(v.unit.side==='player'||g.isVisible(v.unit)))g.audio.play('meleeHit',{volume:.5});
                if (t && (t.unit.side === 'player' || g.isVisible(t.unit))) {
                    const p = t.worldPosition();
                    fx.impact({x:p.x, y:p.z, h:p.y+1}, 'unit');
                }
                if (contact) await this.slide(v, contact, start, .18);
                break;
            }
            case 'throw': {
                const v = this.view(e.unitId);
                const pts = e.points || [];
                if (hiddenEnemy(v) && !(pts.length && g.battle?.unitsOf?.('player')?.some?.(p => Math.hypot(p.x - pts.at(-1).x, p.y - pts.at(-1).y) <= 8))) break;
                if (v?.unit?.side === 'enemy' && !hiddenEnemy(v) && (g.isVisible ? g.isVisible(v.unit) : true)) {
                    const name = THROWABLES[e.itemId]?.name || 'THROWING';
                    this.setActiveEnemy(e.unitId, `${v.unit.name || 'HOSTILE'} · ${name}`.toUpperCase(), 'attack');
                    if (pts.length) v.face?.(pts.at(-1).x - (v.unit.x + 0.5), pts.at(-1).y - (v.unit.y + 0.5));
                    fx.calloutRing?.(v.worldPosition?.() || new THREE.Vector3(v.unit.x + 0.5, v.unit.z + 1, v.unit.y + 0.5), 0xffb347, 0.36);
                    v.pulseAction?.('throw');
                }
                v?.animator?.play('throw', { restart: true });
                if (v && (v.unit.side === 'player' || g.isVisible(v.unit))) g.audio.play('throwWhoosh', { volume: 0.4 });
                if (pts.length) {
                    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
                    g.scene.scene.add(ball);
                    try {
                        await this.animate(0.34 / this.speed, k => {
                            const f = k * (pts.length - 1);
                            const i0 = Math.min(pts.length - 1, Math.floor(f));
                            const i1 = Math.min(pts.length - 1, i0 + 1);
                            const frac = f - i0;
                            const p0 = pts[i0], p1 = pts[i1];
                            ball.position.set(p0.x + (p1.x - p0.x) * frac, p0.h + (p1.h - p0.h) * frac, p0.y + (p1.y - p0.y) * frac);
                            if (v?.unit?.side === 'enemy' && k > 0.35) this.focusOverview(ball.position.clone(), 5.5);
                        });
                    } finally {
                        g.scene.scene.remove(ball); ball.geometry.dispose(); ball.material.dispose();
                    }
                }
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
            case 'explosion': {
                g.audio?.play(explosionSound(e, g.scene.target), { volume: e.of > 1 ? 0.7 / Math.sqrt(e.of) : 0.7 });
                fx.explosion(e, e.radius, e.element);
                const nextT = this.queue[0]?.t;
                const deferFlush = (e.of > 1 && e.salvo < e.of - 1) || nextT === 'explosion' || nextT === 'voxels' || nextT === 'collapse';
                if (!deferFlush) g.voxelView?.flush?.({ maxMs: 16 });
                if (!(e.of > 1) || e.salvo === e.of - 1) await this.d(0.15);
                break;
            }
            case 'smoke': fx.syncField(g.battle.field); break;
            case 'voxels': {
                const destroyed = [], priority = new Set();
                let roadTouched = false;
                const roadZMax = (g.battle?.mission?.meta?.streetDatum ?? 1) + 1;
                for (const raw of e.changes || []) {
                    const x = raw[0] ?? raw.x, y = raw[1] ?? raw.y, z = raw[2] ?? raw.z;
                    const before = raw[3] ?? raw.before, after = raw[4] ?? raw.after;
                    priority.add(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`);
                    if (before !== 0 && after === 0 && materialById(before).render !== 'none') destroyed.push({ x, y, z, before });
                    if (z <= roadZMax && (before === MAT.asphalt || before === MAT.road_mark || after === MAT.asphalt || after === MAT.road_mark)) roadTouched = true;
                }
                const stride = Math.max(1, Math.ceil(destroyed.length / 12));
                for (let i = 0; i < destroyed.length; i += stride) {
                    const c = destroyed[i];
                    fx.debris({ x: c.x + 0.5, y: c.y + 0.5, h: c.z + 0.5 }, materialById(c.before));
                }
                g.voxelView?.flush?.({ maxMs: 16, priority });
                if (roadTouched && g.roadMarks && g.battle) g.roadMarks.build(g.battle.store, g.battle.mission?.visual?.roadPaint);
                break;
            }
            case 'collapse': g.audio.play('collapse',{volume:.65}); if (this.queue[0]?.t !== 'voxels') g.voxelView?.flush?.({ maxMs: 16 }); fx.float(new THREE.Vector3(e.fallen?.[0]?.x ?? 0, e.fallen?.[0]?.to ?? 1, e.fallen?.[0]?.y ?? 0), 'COLLAPSE', '#ffcc66', 22); g.scene.shake = 0.6; await this.d(0.25); break;
            case 'elements': g.voxelView.flush(); fx.syncField(g.battle.field); if(e.element)g.audio.play(explosionSound({...e,x:e.changes?.[0]?.x||0,y:e.changes?.[0]?.y||0},g.scene.target),{volume:.35}); break;
            case 'door': { const v=this.view(e.unitId);if(v&&(v.unit.side==='player'||g.isVisible(v.unit)))g.audio.play(e.kicked?'doorKick':'doorOpen',{volume:.5}); if(e.kicked){v?.animator?.play('vault',{restart:true});fx.float(v?.worldPosition()||new THREE.Vector3(),'KICK!','#ffd54f',22);g.scene.shake=.18;await this.d(.3);} g.voxelView.flush(); break; }
            case 'damage': {
                const v = this.view(e.unitId); if (!v) break;
                if (!g.isVisible(v.unit) && v.unit.side === 'enemy') break;
                fx.float(v.worldPosition(), e.amount ? `-${e.amount} ${PART_LABEL[e.part] || ''}` : 'ARMOR', e.element ? ELEMENT_COLORS[e.element] : (e.amount ? '#ff8a8a' : '#cfd8dc'), e.amount ? 20 : 15);
                v.drawBar();
                if (e.amount) { v.animator?.play('hit', { restart: true }); v.pulseAction?.('hit'); }
                break;
            }
            case 'disabled': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.4, 0)), `${PART_LABEL[e.part]} disabled`.toUpperCase(), '#ffb74d', 15); break; }
            case 'heal': { const v=this.view(e.unitId); if(hiddenEnemy(v)){v.drawBar();break;} if(v) {v.drawBar(); fx.float(v.worldPosition(),`+${e.amount} HP`,'#5ff2d6',22);if(v.unit.side==='player'||g.isVisible?.(v.unit))g.audio.play('heal',{volume:.4});} await this.d(0.2); break; }
            case 'death': { const v = this.view(e.unitId); if(hiddenEnemy(v)){v.animator?.play('down');v.drawBar();break;} if (v) { const p=v.worldPosition();v.animator?.play('down'); v.drawBar(); fx.defeat(p,v.unit.drone);fx.float(p, v.unit.side === 'player' ? 'KIA' : v.unit.drone ? 'DRONE DOWN' : 'KILLED', '#ff5252', 22); } await this.d(CLIP_HOLD.down); break; }
            case 'extract': { const v = this.view(e.unitId); if (v) { fx.float(v.worldPosition(), e.item ? 'EXTRACTED WITH THE PACKAGE' : 'EXTRACTED', '#5ff2d6', 20);g.audio.play('extract',{volume:.45}); await this.d(0.35); v.setVisible(false); } g.overlays.showObjective(g.battle); break; }
            case 'recover': { const v = this.view(e.unitId); if (v) {fx.float(v.worldPosition(), `${(e.label || 'item').toUpperCase()} RECOVERED`, '#5ff2d6', 20);g.audio.play('recover',{volume:.45});} g.overlays.showObjective(g.battle); await this.d(0.3); break; }
            case 'drop': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition(), `${(e.label || 'item').toUpperCase()} DROPPED`, '#ffc845', 18); if (e.collapse) g.hud.log(`${e.label || 'The package'} fell with the floor.`); g.overlays.showObjective(g.battle); break; }
            case 'zone': g.overlays.showObjective(g.battle); g.hud.log('The objective zone collapsed to the floor below.'); break;
            case 'objective': if (e.kind === 'hold') g.hud.log(e.contested ? `Zone contested — held ${e.held}/${e.rounds}` : `Zone held ${e.held}/${e.rounds}`); break;
            case 'status': { const v = this.view(e.unitId); if (v && (v.unit.side === 'player' || g.isVisible(v.unit))) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.3, 0)), e.statusId, '#ffe08a', 14); break; }
            case 'stress': { const v = this.view(e.unitId); if (v) { v.drawBar(); if (e.breakdown) { fx.float(v.worldPosition(), 'BREAKDOWN', '#c38bff', 22); await this.d(0.4); } } break; }
            case 'reaction': {
                const v = this.view(e.watcherId); if (hiddenEnemy(v)) break;
                if (v) {
                    if (v.unit.side === 'enemy' && (g.isVisible ? g.isVisible(v.unit) : true)) {
                        this.setActiveEnemy(e.watcherId, `${v.unit.name || 'HOSTILE'} · OVERWATCH!`.toUpperCase(), 'shoot');
                        const pos = v.worldPosition?.() || new THREE.Vector3(v.unit.x + 0.5, v.unit.z + 1, v.unit.y + 0.5);
                        this.focusOverview(pos, 7.5);
                        fx.calloutRing?.(pos, 0xffb347, 0.38);
                    }
                    fx.float(v.worldPosition(), 'OVERWATCH!', '#ff9f6b', 18);
                    if (v.unit.side === 'player' || g.isVisible?.(v.unit)) g.audio.play('overwatch', { volume: 0.35 });
                }
                g.refreshOverwatch?.();
                await this.d(0.12);
                break;
            }
            case 'discovery': { e.unitIds.forEach(id=>g.discoveryVisible.add(id));g.updateEnemyVisibility();g.hud.banner('ENEMY CONTACT','SCATTERING TO COVER','enemy');g.hud.log('Enemy group spotted — scattering to cover.');g.audio.play('contactAlert',{volume:.4});await this.d(.32);break; }
            case 'wait': this.view(e.unitId)?.animator?.play('idle');break;
            case 'alert': for (const id of e.unitIds) { const v = this.view(id); if (v && g.isVisible(v.unit)) fx.float(v.worldPosition(), '!', '#ff5252', 30); } break;
            // PLAN-14: enemies that heard a loud sound and go to search it (only the ones you can see show it).
            case 'heard': { let shown = 0; for (const id of e.unitIds) { const v = this.view(id); if (v && g.isVisible(v.unit) && !v.unit.alerted) { fx.float(v.worldPosition(), '?', '#ffd54f', 28); shown++; } } if (shown) g.hud.log(`${shown} hostile${shown > 1 ? 's' : ''} heard that and ${shown > 1 ? 'are' : 'is'} coming to look.`); break; }
            case 'scan': { g.sightings.showScan(e); g.hud.log(e.contacts.length ? `Recon Scan: ${e.contacts.length} contact${e.contacts.length > 1 ? 's' : ''} within ${e.range} tiles (approximate positions).` : `Recon Scan: no contacts within ${e.range} tiles.`); await this.d(0.3); break; }
            case 'vision': g.onVision(e.cells);break;
            case 'reveal': g.onReveal(e.roomId); break;
            case 'fall': { const v = this.view(e.unitId); if (hiddenEnemy(v)) { if (e.to >= 0) v.setCell(v.unit.x, v.unit.y, e.to); break; } if (v) { v.animator?.play('hit', { restart: true }); if (e.to >= 0) v.setCell(v.unit.x, v.unit.y, e.to); } await this.d(0.2); break; }
            case 'breach': fx.float(this.view(e.unitIds[0])?.worldPosition() || new THREE.Vector3(), 'BREACH!', '#ffd54f', 24); break;
            case 'overwatch': {
                const v = this.view(e.unitId);
                if (v?.unit?.side === 'enemy' && !hiddenEnemy(v) && (g.isVisible ? g.isVisible(v.unit) : true)) {
                    this.setActiveEnemy(e.unitId, `${v.unit.name || 'HOSTILE'} · OVERWATCH`.toUpperCase(), 'move');
                    this.focusOverview(v.worldPosition?.() || new THREE.Vector3(v.unit.x + 0.5, v.unit.z + 1, v.unit.y + 0.5), 6.5);
                }
                v?.animator?.play('hunker');
                if (v && (v.unit.side === 'player' || g.isVisible(v.unit))) g.audio.play('overwatch', { volume: 0.35 });
                g.refreshOverwatch?.();
                break;
            }
            case 'overwatchCancel': { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition().add(new THREE.Vector3(0, 0.3, 0)), 'OVERWATCH CANCELLED', '#9fd8ff', 14); g.refreshOverwatch?.(); break; }
            case 'ability': {
                const v = this.view(e.unitId);
                if (v) {
                    if (v.unit.side === 'enemy' && !hiddenEnemy(v) && (g.isVisible ? g.isVisible(v.unit) : true)) {
                        this.setActiveEnemy(e.unitId, `${v.unit.name || 'HOSTILE'} · ${(ABILITIES[e.abilityId]?.name || e.abilityId || 'ABILITY')}`.toUpperCase(), 'attack');
                        this.focusOverview(v.worldPosition?.() || new THREE.Vector3(v.unit.x + 0.5, v.unit.z + 1, v.unit.y + 0.5), 6.5);
                        v.pulseAction?.('throw');
                    }
                    fx.float(v.worldPosition(), ABILITIES[e.abilityId]?.name || e.abilityId, '#7fdbff', 16);
                }
                break;
            }
            case 'formation': {
                const f = e.formation; const tpl = FORMATIONS[f?.template || e.template];
                if (e.action === 'declare' && f) for (const id of f.members) { const v = this.view(id); if (v) fx.float(v.worldPosition(), tpl.name.toUpperCase(), '#80cbc4', 14); }
                if (e.action === 'dissolve') g.log(`${tpl?.name || 'Formation'} dissolved (${e.why})`);
                if (e.action === 'broken') g.log('Formation cohesion broken');
                break;
            }
            case 'turn': this.setActiveEnemy(null); g.onTurn(e); await this.d(0.18); break;
            case 'aiAdapt': {
                const top = e.shifts?.[0] ? `${e.shifts[0].key.replace(/([A-Z])/g, ' $1').trim()} ×${e.shifts[0].to}` : '';
                const tags = e.detected?.length ? e.detected.slice(0, 2).join(', ') : '';
                const msg = `Hostile AI adapted${tags ? ` (${tags})` : ''}${top ? ` → ${top}` : ''}`;
                g.hud?.log?.(msg);
                g.hud?.toast?.(msg);
                break;
            }
            case 'outcome': g.onOutcome(e); break;
            case 'spawn': await g.onSpawn(e); { const v = this.view(e.unitId); if (v) fx.float(v.worldPosition(), 'SPAWNED', '#b388ff', 16); } break;
            case 'debug': { const v = this.view(e.unitId); if (v) { v.snap(); v.drawBar(); if (e.op === 'heal' && !v.unit.dead) v.animator?.play('idle'); } break; }
            case 'reload': {
                const v = this.view(e.unitId);
                if (v) {
                    if (v.unit.side === 'enemy' && !hiddenEnemy(v) && (g.isVisible ? g.isVisible(v.unit) : true)) {
                        this.setActiveEnemy(e.unitId, `${v.unit.name || 'HOSTILE'} · RELOADING`.toUpperCase(), 'move');
                        this.focusOverview(v.worldPosition?.() || new THREE.Vector3(v.unit.x + 0.5, v.unit.z + 1, v.unit.y + 0.5), 6.5);
                    }
                    fx.float(v.worldPosition(), 'RELOAD', '#b0bec5', 14);
                    if (v.unit.side === 'player' || g.isVisible(v.unit)) g.audio.play(weaponHandlingSound(e.weaponId), { volume: 0.6 });
                }
                break;
            }
        }
        if (clip && e.t !== 'move' && e.t !== 'shot' && e.t !== 'damage' && e.t !== 'death') void clip;
        if (!this.deferSettle || ['turn', 'outcome', 'damage', 'aiAdapt'].includes(e.t)) g.hud.refresh();
    }
}

function faceVec(u) { const m = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] }[u.facing] || [0, 1]; return [m[0], 0, m[1]]; }
