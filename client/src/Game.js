// Client controller: owns the scene, the battle (through a session), input modes, overlays, the event
// player and the HUD. Local sessions apply intents directly; online sessions apply the server-ordered
// intent stream (lockstep) — the Game code is the same.
import * as THREE from 'three';
import { Scene } from './render/Scene.js';
import { VoxelView } from './render/VoxelView.js';
import { Overlays } from './render/Overlays.js';
import { Fx } from './render/Fx.js';
import { UnitView, loadCharacterArt } from './units/UnitView.js';
import { EventPlayer } from './anim/EventPlayer.js';
import { CutInDirector, CUTIN_MODES } from './anim/CutInDirector.js';
import { CameraDirector } from './anim/CameraDirector.js';
import { Hud } from './ui/Hud.js';
import { castRay } from '../../shared/voxel/Raycast.js';
import { MAT, AIR, materialById } from '../../shared/voxel/Materials.js';
import { nodeKey, pathTo } from '../../shared/world/PathSearch.js';
import { estimateShot, partCentre } from '../../shared/battle/Ballistics.js';
import { coverAgainst, COVER } from '../../shared/voxel/Cover.js';
import { decide } from '../../shared/battle/Ai.js';
import { alive } from '../../shared/battle/Units.js';
import { WEAPONS, THROWABLES } from '../../shared/content/weapons.js';
import { ABILITIES } from '../../shared/content/units.js';

const PART_KEYS = { z: 'head', x: 'torso', c: 'armL', v: 'armR', g: 'legs' };

export class Game {
    constructor({ canvas, hudRoot, cutinRoot, floatRoot, onExit }) {
        this.scene = new Scene(canvas);
        this.overlays = new Overlays(this.scene);
        this.fx = new Fx(this.scene, floatRoot);
        this.cameraDirector = new CameraDirector(this.scene);
        this.cutins = new CutInDirector(cutinRoot, this.cameraDirector);
        this.player = new EventPlayer(this);
        this.hud = new Hud(hudRoot, this);
        this.onExit = onExit;
        this.views = new Map();
        this.mode = { kind: 'move' };
        this.fog = true; this.autoPlayer = false; this.cutLevel = Infinity; this.levelLocked = false;
        this.keys = new Set();
        this.bindInput(canvas);
        this.last = performance.now();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    // ------------------------------------------------------------------ lifecycle
    async start(session) {
        this.session = session;
        this.battle = session.battle;
        this.voxelView?.dispose();
        for (const v of this.views.values()) v.dispose();
        this.views.clear();
        const store = this.battle.store;
        this.voxelView = new VoxelView(this.scene, store);
        this.voxelView.tint = (x, y, z) => {
            const r = store.roomAt(x, y, z) >= 0 ? store.roomAt(x, y, z) : store.roomAt(x, y, z + 1);
            return r >= 0 && this.fog && !this.battle.revealedRooms.has(r) ? [0.5, 0.5, 0.62] : null;
        };
        this.voxelView.rebuildAll();
        this.cameraDirector.store = store;
        await Promise.all(this.battle.units.map(async u => this.views.set(u.id, new UnitView(this.scene, u, await loadCharacterArt(u.art)))));
        const first = this.battle.unitsOf('player')[0];
        this.scene.focus(store.width / 2, 2, store.depth / 2);
        if (first) { this.select(first.id); }
        this.fx.syncField(this.battle.field);
        this.updateEnemyVisibility();
        session.onEvents = events => this.player.enqueue(events);
        session.onRemoteTurn = () => this.maybeRunAi();
        this.hud.refresh();
        this.hud.log(`${this.battle.mission.name}: ${this.battle.mission.objective?.text || ''}`);
        this.hud.banner('YOUR TURN', 'player');
    }
    restart() { this.session.restart?.().then(s => this.start(s)); }
    exitToMenu() { this.onExit?.(); }

    loop(now) {
        const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
        this.handleKeysHeld(dt);
        const yaw = this.scene.yaw;
        const cine = this.cameraDirector.active;
        for (const v of this.views.values()) {
            v.update(dt, cine ? Math.atan2(this.cameraDirector.cam.position.x - v.pos.x, this.cameraDirector.cam.position.z - v.pos.z) : yaw);
            v.bar.visible = !cine && !v.unit.dead;
            v.sprite.visible = !(cine && this.cameraDirector.hidden?.has(v.id));
        }
        this.fx.update(dt);
        if (this.cameraDirector.active) {
            this.scene.updateCamera(dt);
            this.scene.renderer.render(this.scene.scene, this.cameraDirector.cam);
        } else this.scene.render(dt);
        requestAnimationFrame(this.loop);
    }

    // ------------------------------------------------------------------ queries
    selectedUnit() { const u = this.battle?.unit(this.selected); return u && alive(u) ? u : null; }
    isVisible(u) { return u.side === 'player' || !this.fog || this.battle.visible?.has(u.id); }
    updateEnemyVisibility() {
        for (const [id, v] of this.views) {
            const u = v.unit;
            v.setVisible(u.side === 'player' || this.isVisible(u) || (u.dead && !this.fog));
        }
    }
    settleViews() {
        for (const v of this.views.values()) { v.snap(); v.drawBar(); if (v.unit.dead) v.animator.play('down'); }
        this.voxelView.flush();
        this.fx.syncField(this.battle.field);
        this.updateEnemyVisibility();
        this.overlays.showOverwatch(this.battle.units.filter(u => alive(u) && (u.side === 'player' || this.isVisible(u))));
        this.refreshRange();
        this.hud.refresh();
        this.hud.renderDebug();
    }

    // ------------------------------------------------------------------ selection & modes
    select(id) {
        const u = this.battle.unit(id);
        if (!u || u.side !== 'player' || !alive(u)) return;
        for (const v of this.views.values()) v.setSelected(false);
        this.selected = id;
        this.views.get(id)?.setSelected(true);
        this.setMode({ kind: 'move' });
        this.focusUnit(u);
        if (!this.levelLocked) this.setLevel(this.battle.store.roomAt(u.x, u.y, u.z + 1) >= 0 ? u.z + 3 : Infinity);
    }
    focusUnit(u, soft = false) {
        if (!u) return;
        const t = new THREE.Vector3(u.x + 0.5, u.z + 1, u.y + 0.5);
        if (soft) this.scene.target.lerp(t, 0.35); else this.scene.target.copy(t);
    }
    setMode(m) {
        this.mode = m; this.targetInfo = null;
        this.overlays.clearAim();
        this.refreshRange();
        this.hud.refresh();
    }
    refreshRange() {
        const u = this.selectedUnit();
        if (!u || this.mode.kind !== 'move' || this.battle.activeSide !== 'player' || !this.player.idle()) { this.overlays.clearRange(); this.search = null; return; }
        this.search = this.battle.reach(u);
        this.overlays.showRange(this.search.nodes, this.search.costs, c => this.battle.apForCost(u, c), u.ap + u.moveOnlyAp);
    }
    setLevel(top) { this.cutLevel = top; this.scene.setCut(Number.isFinite(top) ? top : Infinity); this.hud.refresh(); }
    changeLevel(d) {
        this.levelLocked = true;
        const levels = [4, 7, 10, 13, Infinity];
        let i = levels.indexOf(this.cutLevel); if (i < 0) i = levels.findIndex(l => l > this.cutLevel);
        i = Math.max(0, Math.min(levels.length - 1, i + d));
        this.setLevel(levels[i]);
    }
    cycleCutins() { const i = CUTIN_MODES.indexOf(this.cutins.mode); this.cutins.mode = CUTIN_MODES[(i + 1) % CUTIN_MODES.length]; this.hud.refresh(); }

    // ------------------------------------------------------------------ intents
    canAct() { return this.battle && this.battle.activeSide === 'player' && !this.battle.outcome && this.player.idle() && this.session.canAct?.() !== false; }
    async intent(partial) {
        const u = this.selectedUnit();
        if (!this.canAct()) return { ok: false };
        const intent = { unitId: u?.id, by: this.session.playerId || 'player', ...partial };
        const r = await this.session.submit(intent);
        if (!r.ok) { this.hud.log(`Can't: ${r.reason}`, 'warn'); return r; }
        this.player.enqueue(r.events || []);
        await this.player.whenIdle();
        if (this.mode.kind !== 'move' && !['shoot'].includes(this.mode.kind)) this.setMode({ kind: 'move' });
        else this.setMode(this.mode);
        if (u && !alive(u)) { const next = this.battle.unitsOf('player')[0]; if (next) this.select(next.id); }
        return r;
    }
    useAbility(id) {
        const a = ABILITIES[id];
        if (id === 'suppress') { this.setMode({ kind: 'shoot', weaponId: 'repeater', suppress: true }); return; }
        this.intent({ type: 'ability', abilityId: id }).then(r => r.ok && this.hud.log(`${a.name}: ${a.text}`));
    }
    declareFormation(template) {
        const u = this.selectedUnit(); if (!u) return;
        const others = this.battle.unitsOf('player').filter(o => o.id !== u.id && !o.formationId).sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
        const n = template === 'crossfire' ? 1 : Math.min(3, others.length);
        const facing = this.hoverFacing(u);
        this.intent({ type: 'formation', template, leaderId: u.id, memberIds: [u.id, ...others.slice(0, n).map(o => o.id)], facing });
    }
    hoverFacing(u) {
        const h = this.hoverCell;
        let dx, dy;
        if (h && (h.x !== u.x || h.y !== u.y)) { dx = h.x - u.x; dy = h.y - u.y; }
        else { dx = -Math.sin(this.scene.yaw); dy = -Math.cos(this.scene.yaw); }
        return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
    }
    breachStack(u, pt) {
        if (!pt) return [u.id];
        return [u.id, ...this.battle.unitsOf('player').filter(o => o.id !== u.id && o.ap >= 1 && Math.max(Math.abs(o.x - pt.x), Math.abs(o.y - pt.y)) <= 2 && Math.abs(o.z - pt.z) <= 1).map(o => o.id)];
    }
    doBreach(i, entry) {
        const u = this.selectedUnit(); if (!u) return;
        const pt = this.battle.breachPoints(u)[i]; if (!pt) return;
        this.intent({ type: 'breach', door: pt, unitIds: this.breachStack(u, pt), entry });
    }
    nearestDoor(u) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const id = this.battle.store.get(u.x + dx, u.y + dy, u.z + 1);
            if (id === MAT.door || id === MAT.door_open) return { x: u.x + dx, y: u.y + dy, z: u.z };
        }
        return null;
    }
    toggleNearestDoor() { const u = this.selectedUnit(); const d = u && this.nearestDoor(u); if (d) this.intent({ type: 'door', door: d }); }
    fireAtPart(part) {
        if (this.mode.kind !== 'shoot' || !this.targetInfo) return;
        this.targetInfo.part = part;
        this.fire(this.targetInfo.target, part);
    }
    fire(target, part = 'torso') {
        const u = this.selectedUnit(); if (!u) return;
        this.lastPreview = { unitId: u.id, hit: this.targetInfo?.byPart?.[part] };
        this.intent({ type: 'shoot', weaponId: this.mode.weaponId, aim: { unitId: target.id, part }, suppress: this.mode.suppress });
    }
    async endTurn() {
        if (!this.canAct()) return;
        this.overlays.clearRange(); this.overlays.clearAim();
        const r = await this.session.submit({ type: 'endTurn', side: 'player', by: this.session.playerId || 'player' });
        if (!r.ok) { this.hud.log(`Can't end turn: ${r.reason}`, 'warn'); return; }
        this.player.enqueue(r.events || []);
        await this.player.whenIdle();
        await this.maybeRunAi();
    }
    /** Local AI turns (enemy side, or the squad when autoplay is on), played unit by unit. */
    async maybeRunAi() {
        if (this.aiRunning || !this.session.local) return;
        this.aiRunning = true;
        try {
            for (let guard = 0; guard < 400 && this.battle && !this.battle.outcome; guard++) {
                const side = this.battle.activeSide;
                const aiSide = side === 'enemy' || (side === 'player' && this.autoPlayer);
                if (!aiSide) break;
                let acted = false;
                for (const u of this.battle.unitsOf(side)) {
                    for (let k = 0; k < 6 && alive(u) && !this.battle.outcome; k++) {
                        const intent = decide(this.battle, u, { formations: side === 'player' });
                        if (!intent) break;
                        const r = await this.session.submit(intent);
                        if (!r.ok) break;
                        acted = true;
                        this.player.enqueue(r.events);
                        await this.player.whenIdle();
                    }
                }
                if (this.battle.outcome) break;
                const r = await this.session.submit({ type: 'endTurn', side });
                this.player.enqueue(r.events || []);
                await this.player.whenIdle();
                void acted;
            }
        } finally { this.aiRunning = false; }
        const u = this.selectedUnit() || this.battle.unitsOf('player')[0];
        if (u) this.select(u.id);
    }

    // ------------------------------------------------------------------ battle event hooks (from EventPlayer)
    onReveal(roomId) {
        const room = this.battle.mission.rooms[roomId]; if (!room) return;
        for (const [x, y] of room.cells) for (let h = 0; h <= 3; h++) this.battle.store.markDirty(x, y, room.floorZ + h);
        this.voxelView.flush();
    }
    onTurn(e) {
        this.cutins.newTurn();
        this.hud.banner(e.side === 'player' ? `ROUND ${e.round} — YOUR TURN` : 'ENEMY ACTIVITY', e.side);
        this.hud.log(e.side === 'player' ? `Round ${e.round}` : 'Enemy activity…');
    }
    onOutcome(e) { this.hud.showOutcome(e); this.hud.log(e.winner === 'player' ? 'Mission complete.' : 'Squad lost.'); }
    log(t) { this.hud.log(t); }
    debugAction(a) {
        const b = this.battle;
        if (a === 'fog') { this.fog = !this.fog; this.voxelView.rebuildAll(); this.updateEnemyVisibility(); }
        if (a === 'auto') { this.autoPlayer = !this.autoPlayer; if (this.autoPlayer && b.activeSide === 'player') this.maybeRunAi(); }
        if (a === 'speed') this.player.speed = this.player.speed >= 4 ? 1 : this.player.speed * 2;
        if (a === 'rooms') { for (const r of b.mission.rooms) b.revealedRooms.add(r.id); this.voxelView.rebuildAll(); }
        if (a === 'ap') { const u = this.selectedUnit(); if (u) { u.ap += 4; this.refreshRange(); } }
        if (a === 'kill') { for (const id of b.visible || []) { const e = b.unit(id); if (e && alive(e)) b.kill(e, 'debug'); } this.settleViews(); }
    }

    // ------------------------------------------------------------------ input
    bindInput(canvas) {
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('mousemove', e => this.onHover(e));
        canvas.addEventListener('mousedown', e => { if (e.button === 2) { this.dragging = { x: e.clientX, y: e.clientY, moved: false }; } });
        window.addEventListener('mouseup', e => {
            if (e.button === 2) { if (this.dragging && !this.dragging.moved) this.setMode({ kind: 'move' }); this.dragging = null; }
        });
        canvas.addEventListener('click', e => this.onClick(e));
        canvas.addEventListener('wheel', e => { e.preventDefault(); this.scene.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
        window.addEventListener('keydown', e => this.onKey(e));
        window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    }
    handleKeysHeld(dt) {
        const k = this.keys, s = dt * 60;
        if (k.has('w') || k.has('arrowup')) this.scene.pan(0, s);
        if (k.has('s') || k.has('arrowdown')) this.scene.pan(0, -s);
        if (k.has('a') || k.has('arrowleft')) this.scene.pan(-s, 0);
        if (k.has('d') || k.has('arrowright')) this.scene.pan(s, 0);
    }
    onKey(e) {
        if (!this.battle || e.target.tagName === 'INPUT') return;
        const key = e.key.toLowerCase();
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { this.keys.add(key); return; }
        const u = this.selectedUnit();
        if (this.mode.kind === 'shoot' && PART_KEYS[key] && this.targetInfo) { this.fireAtPart(PART_KEYS[key]); return; }
        switch (key) {
            case 'q': this.scene.rotate(-1); break;
            case 'e': this.scene.rotate(1); break;
            case 'pageup': this.changeLevel(1); break;
            case 'pagedown': this.changeLevel(-1); break;
            case 'tab': { e.preventDefault(); const list = this.battle.unitsOf('player'); const i = list.findIndex(x => x.id === this.selected); if (list.length) this.select(list[(i + 1) % list.length].id); break; }
            case 'enter': this.endTurn(); break;
            case 'escape': this.setMode({ kind: 'move' }); this.hud.hidePanel(); break;
            case 'o': this.setMode({ kind: 'overwatch' }); break;
            case 'r': this.intent({ type: 'reload' }); break;
            case 't': if (u) { const id = Object.keys(u.items).find(k => u.items[k] > 0); if (id) this.setMode({ kind: 'throw', itemId: id }); } break;
            case 'f': this.hud.showFormationPanel(); break;
            case 'b': if (u && this.battle.breachPoints(u).length) this.hud.showBreachPanel(); break;
            case '`': this.hud.toggle('.debug'); this.hud.renderDebug(); break;
            default:
                if (/^[1-9]$/.test(key) && u) {
                    const w = WEAPONS[u.weapons[+key - 1]];
                    if (w) this.setMode({ kind: w.kind === 'melee' ? 'melee' : 'shoot', weaponId: w.id });
                }
        }
        this.hud.refresh();
    }
    /** Voxel picking through the cutaway: returns { cell, voxel, point, normal }. */
    pick(px, py) {
        const ray = this.scene.rayAt(px, py);
        const o = ray.ray.origin, d = ray.ray.direction;
        const from = { x: o.x, y: o.z, h: o.y }, to = { x: o.x + d.x * 500, y: o.z + d.z * 500, h: o.y + d.y * 500 };
        const store = this.battle.store, top = this.cutLevel;
        const r = castRay(store, from, to, { skipStart: false, blocks: (s, x, y, z) => z < top && x >= 0 && y >= 0 && x < s.width && y < s.depth && s.get(x, y, z) !== AIR && materialById(s.get(x, y, z)).render !== 'none' });
        if (!r.hit) return null;
        const v = r.hit;
        let cx = v.x, cy = v.y;
        if (r.normal && (r.normal[0] || r.normal[1])) { cx += r.normal[0]; cy += r.normal[1]; }
        const surf = store.surfaces(cx, cy).filter(s => s.z <= v.z && s.z < top).at(-1) || store.surfaces(v.x, v.y).filter(s => s.z <= v.z).at(-1);
        const cell = surf ? { x: surf.x, y: surf.y, z: surf.z } : null;
        return { cell, voxel: v, point: r.point, normal: r.normal };
    }
    unitAt(px, py) {
        const ray = this.scene.rayAt(px, py);
        const meshes = [...this.views.values()].filter(v => v.group.visible && alive(v.unit)).map(v => v.sprite);
        const hit = ray.intersectObjects(meshes, false)[0];
        return hit ? this.battle.unit(hit.object.userData.unitId) : null;
    }
    onHover(e) {
        if (this.dragging) {
            const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) { this.dragging.moved = true; this.scene.pan(-dx * 0.05, dy * 0.05); this.dragging.x = e.clientX; this.dragging.y = e.clientY; }
            return;
        }
        if (!this.battle) return;
        const unit = this.unitAt(e.clientX, e.clientY);
        const p = this.pick(e.clientX, e.clientY);
        this.hoverCell = p?.cell || (unit ? { x: unit.x, y: unit.y, z: unit.z } : null);
        this.hoverPick = p;
        this.overlays.setHover(this.hoverCell);
        const u = this.selectedUnit();
        if (!u || !this.canAct()) { this.overlays.showPath(null); return; }
        switch (this.mode.kind) {
            case 'move': {
                const c = this.hoverCell;
                if (c && this.search?.costs.has(nodeKey(c))) {
                    this.overlays.showPath(pathTo(this.search, nodeKey(c)));
                    this.overlays.showCover(this.battle.store, c);
                } else { this.overlays.showPath(null); this.overlays.showCover(this.battle.store, c); }
                break;
            }
            case 'shoot': {
                if (unit && unit.side !== 'player' && this.isVisible(unit)) this.aimAt(u, unit, this.targetInfo?.target === unit ? this.targetInfo.part : 'torso');
                else if (e.altKey && p) {
                    const w = WEAPONS[this.mode.weaponId];
                    const { spread } = this.battle.spreadFor(u, w, p.point);
                    const est = estimateShot(this.battle, u, { point: p.point }, { weapon: w, spread, samples: 32 });
                    this.overlays.showCone(est.muzzle, p.point, spread);
                    this.targetInfo = null; this.hud.renderTarget();
                } else { this.overlays.clearAim(); if (this.targetInfo) { this.targetInfo = null; this.hud.renderTarget(); } }
                break;
            }
            case 'throw': {
                const c = this.hoverCell; if (!c) break;
                const t = THROWABLES[this.mode.itemId];
                const arc = this.battle.throwArc(u, c);
                const inRange = Math.hypot(c.x - u.x, c.y - u.y) <= t.range;
                this.overlays.showArc(inRange ? arc.points : [], t.radius, arc.land);
                break;
            }
            default: this.overlays.showPath(null);
        }
    }
    aimAt(u, target, part) {
        const w = WEAPONS[this.mode.weaponId];
        const key = `${u.id}:${u.x},${u.y},${u.z}:${target.id}:${target.x},${target.y},${target.z}:${w.id}:${this.battle.seq}`;
        if (!this.targetInfo || this.targetInfo.key !== key) {
            const { spread, mods } = this.battle.spreadFor(u, w, partCentre(target, 'torso'), { target });
            const byPart = {};
            let any = 0, blocked = 0, friendly = 0, muzzle = null, lean = null, distance = 0;
            for (const p of ['head', 'torso', 'armL', 'armR', 'legs']) {
                const est = estimateShot(this.battle, u, { unitId: target.id, part: p }, { weapon: w, spread, samples: 64 });
                byPart[p] = est.parts[p];
                if (p === 'torso') { any = est.hit; blocked = est.cover; friendly = est.friendly; muzzle = est.muzzle; lean = est.lean; distance = est.distance; }
            }
            const cover = coverAgainst(this.battle.store, target.x, target.y, target.z, u.x, u.y);
            this.targetInfo = { key, target, part, byPart, anyHit: any, blocked, friendly, spread, mods, muzzle, lean, distance, cover, flanked: cover === COVER.NONE, ap: this.battle.shotAp(u, w) };
        }
        this.targetInfo.part = part;
        this.overlays.showCone(this.targetInfo.muzzle, partCentre(target, part), this.targetInfo.spread);
        this.hud.renderTarget();
    }
    onClick(e) {
        if (!this.battle || this.dragging?.moved) return;
        const unit = this.unitAt(e.clientX, e.clientY);
        const u = this.selectedUnit();
        if (unit && unit.side === 'player' && alive(unit) && (this.mode.kind === 'move' || !u)) { this.select(unit.id); return; }
        if (!u || !this.canAct()) return;
        const p = this.hoverPick || this.pick(e.clientX, e.clientY);
        switch (this.mode.kind) {
            case 'move': {
                const c = p?.cell;
                if (c && this.search?.costs.has(nodeKey(c))) this.intent({ type: 'move', to: c, group: !!this.battle.formations.of(u) && e.shiftKey });
                break;
            }
            case 'shoot':
                if (unit && unit.side !== 'player') this.fire(unit, this.targetInfo?.target === unit ? this.targetInfo.part : 'torso');
                else if (e.altKey && p) { this.lastPreview = null; this.intent({ type: 'shoot', weaponId: this.mode.weaponId, aim: { point: p.point } }); }
                break;
            case 'melee': if (unit && unit.side !== 'player') this.intent({ type: 'melee', weaponId: this.mode.weaponId, targetId: unit.id, part: 'torso' }); break;
            case 'throw': if (p?.cell) this.intent({ type: 'throw', itemId: this.mode.itemId, to: p.cell }); break;
            case 'overwatch': if (p?.cell) this.intent({ type: 'overwatch', weaponId: u.weapons.find(id => WEAPONS[id].kind === 'ballistic'), toward: { x: p.cell.x, y: p.cell.y } }); break;
        }
    }
}
