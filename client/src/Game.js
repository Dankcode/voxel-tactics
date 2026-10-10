// Client controller: owns the scene, the battle (through a session), input modes, overlays, the event
// player and the HUD. Local sessions apply intents directly; online sessions apply the server-ordered
// intent stream (lockstep) — the Game code is the same.
//
// Turn flow (XCOM 2 idiom, Phoenix Point AP underneath):
//   select soldier → blue zone (move and still act) / yellow zone (dash) → hover shows path, cost and cover →
//   click moves → action bar (fire / throw / overwatch / abilities) → targeting: target strip, Tab cycles,
//   body-part aim, confirm fires → when a soldier is out of AP the next ready soldier is selected → when the
//   whole squad is spent the turn ends (auto-end setting) → enemy phase with the camera following each actor.
import * as THREE from 'three';
import { Scene } from './render/Scene.js';
import { VoxelView } from './render/VoxelView.js';
import { setGroundStore } from './render/Ground.js';
import { MaterialLibrary } from './render/MaterialLibrary.js';
import { KitLibrary } from './render/kit/KitLibrary.js';
import { Overlays } from './render/Overlays.js';
import { LanternLights } from './render/LanternLights.js';
import { Fx } from './render/Fx.js';
import { UnitView, loadCharacterArt } from './units/UnitView.js';
import { EventPlayer } from './anim/EventPlayer.js';
import { CutInDirector, CUTIN_MODES } from './anim/CutInDirector.js';
import { CameraDirector } from './anim/CameraDirector.js';
import { Hud } from './ui/Hud.js';
import { DebugTools } from './debug/DebugTools.js';
import { reasonText } from './ui/Reasons.js';
import { castRay } from '../../shared/voxel/Raycast.js';
import { MAT, AIR, materialById } from '../../shared/voxel/Materials.js';
import { nodeKey, pathTo } from '../../shared/world/PathSearch.js';
import { estimateShot, partCentre } from '../../shared/battle/Ballistics.js';
import { coverAgainst, COVER } from '../../shared/voxel/Cover.js';
import { decide, formationIntents } from '../../shared/battle/Ai.js';
import { alive } from '../../shared/battle/Units.js';
import { WEAPONS, THROWABLES } from '../../shared/content/weapons.js';
import { ABILITIES } from '../../shared/content/units.js';

const PART_KEYS = { z: 'head', x: 'torso', c: 'armL', v: 'armR', g: 'legs' };
const wait = ms => new Promise(r => setTimeout(r, ms));

export class Game {
    constructor({ canvas, hudRoot, cutinRoot, floatRoot, onExit, options = {} }) {
        this.options = { autoEndTurn: true, autoNext: true, followCamera: true, edgeScroll: true, ...options };
        this.scene = new Scene(canvas);
        this.library = new MaterialLibrary(this.scene.renderer, this.scene.clipping);
        this.kit = new KitLibrary(this.library);
        this.libraryReady = this.library.load().then(() => this.kit.load());
        this.overlays = new Overlays(this.scene);
        this.lanterns = new LanternLights(this.scene);
        this.fx = new Fx(this.scene, floatRoot);
        this.cameraDirector = new CameraDirector(this.scene);
        this.cutins = new CutInDirector(cutinRoot, this.cameraDirector);
        this.player = new EventPlayer(this);
        this.hud = new Hud(hudRoot, this);
        this.debug = new DebugTools(this, hudRoot);
        this.onExit = onExit;
        this.views = new Map();
        this.mode = { kind: 'move' };
        this.fog = true; this.autoPlayer = false; this.cutLevel = Infinity; this.levelLocked = false;
        this.keys = new Set();
        this.bindInput(canvas);
        this.last = performance.now();
        this.time = 0;
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    // ------------------------------------------------------------------ lifecycle
    async start(session) {
        this.cameraDirector.end();
        this.session = session;
        this.battle = session.battle;
        this.voxelView?.dispose();
        for (const v of this.views.values()) v.dispose();
        this.views.clear();
        this.overlays.clearRange(); this.overlays.clearPath(); this.overlays.clearAim(); this.overlays.clearDebugLayer();
        const store = this.battle.store;
        await this.libraryReady;
        this.scene.setBounds(store.width, store.depth, store.height);
        this.scene.setMission(this.battle.mission);
        this.voxelView = new VoxelView(this.scene, store, this.library, this.options.kit === false ? null : this.kit);
        this.voxelView.tint = (x, y, z) => {
            const r = store.roomAt(x, y, z) >= 0 ? store.roomAt(x, y, z) : store.roomAt(x, y, z + 1);
            const light=this.battle.light.tint(x,y,z);
            return r >= 0 && this.fog && !this.battle.revealedRooms.has(r) ? light.map((c,i)=>c*[0.42,0.44,0.55][i]) : light;
        };
        setGroundStore(store);
        this.voxelView.setVisual(this.battle.mission?.visual);
        this.voxelView.rebuildAll();
        this.lanterns.scan(store, this.battle.mission?.visual?.decor);
        this.cameraDirector.store = store;
        await Promise.all(this.battle.units.map(u => this.addView(u)));
        this.selected = null; this.mode = { kind: 'move' };
        const first = this.battle.unitsOf('player')[0];
        this.scene.focus(store.width / 2, 2, store.depth / 2);
        if (first) this.select(first.id, { snap: true });
        this.fx.syncField(this.battle.field);
        this.updateEnemyVisibility();
        this.overlays.showObjective(this.battle);
        session.onEvents = events => this.player.enqueue(events);
        session.onRemoteTurn = () => this.maybeRunAi();
        this.hud.reset();
        this.hud.refresh();
        this.hud.log(`${this.battle.mission.name}: ${this.battle.mission.objective?.text || ''}`);
        this.hud.banner(`ROUND ${this.battle.round}`, 'SQUAD PHASE', 'player');
        this.debug.onStart();
        this.levelLocked = false;
        // Each map has a time of day (Main Street at dusk, the docks at night) unless the player picked one.
        if (!this.options.lighting) this.scene.setLighting(this.battle.mission.meta?.timeOfDay || this.battle.mission.meta?.lighting || 'day');
        this.setLevel(this.battle.mission.meta?.defaultCut ?? Infinity);
        if (this.battle.mission.meta?.theme === 'modern') {
            this.scene.viewHeight = 34;
            this.scene.focus(store.width / 2, 2, 23);
            this.scene.glide = null;
            this.scene.updateCamera();
        }
    }
    async addView(u) {
        if (this.views.has(u.id)) return this.views.get(u.id);
        const v = new UnitView(this.scene, u, await loadCharacterArt(u.art));
        this.views.set(u.id, v);
        return v;
    }
    restart() { this.session.restart?.().then(s => this.start(s)); }
    exitToMenu() { this.onExit?.(); }

    loop(now) {
        // rAF timestamps can predate the constructor (negative first dt), which used to fling the camera shake.
        const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = now;
        this.time += dt;
        this.handleKeysHeld(dt);
        const yaw = this.scene.yaw;
        this.cameraDirector.update(dt);
        const cine = this.cameraDirector.active;
        for (const v of this.views.values()) {
            v.update(dt, cine ? Math.atan2(this.cameraDirector.cam.position.x - v.pos.x, this.cameraDirector.cam.position.z - v.pos.z) : yaw);
            v.bar.visible = !cine && !v.unit.dead && v.group.visible;
            v.sprite.visible = !(cine && this.cameraDirector.hidden?.has(v.id));
            const ground = this.battle?.store.surfaces(Math.floor(v.pos.x), Math.floor(v.pos.z))[0];
            v.updateDrop(cine ? Infinity : ground ? ground.z + 1 : 0);
        }
        // Pulse the destination marker.
        const mk = this.overlays.marker;
        if (mk.visible) { const s = 1 + Math.sin(this.time * 5) * 0.08; mk.userData.ring.scale.set(s, 1, s); }
        this.fx.update(dt);
        this.library.update(dt);
        this.lanterns.update(dt, this.scene.target, this.cutLevel);
        if (this.cameraDirector.active) {
            this.scene.updateCamera(dt);
            this.scene.renderer.render(this.scene.scene, this.cameraDirector.cam);
        } else this.scene.render(dt);
        this.hud.tick?.(dt);
        requestAnimationFrame(this.loop);
    }

    // ------------------------------------------------------------------ queries
    selectedUnit() { const u = this.battle?.unit(this.selected); return u && alive(u) ? u : null; }
    /** Units the local player may command right now (debug can hand over the enemy side). */
    controllable(u) {
        if (!u || !alive(u) || u.side !== this.battle.activeSide) return false;
        if (u.side === 'player') return true;
        return this.debug.manualEnemy;
    }
    isVisible(u) { return u.side === 'player' || !this.fog || this.battle.visible?.has(u.id); }
    updateEnemyVisibility() {
        for (const v of this.views.values()) {
            const u = v.unit;
            v.setVisible(!u.extracted && (u.side === 'player' || this.isVisible(u) || (u.dead && !this.fog)));
        }
    }
    settleViews() {
        for (const v of this.views.values()) { v.snap(); v.drawBar(); if (v.unit.dead) v.animator.play('down'); }
        this.battle.light.flush();
        if (this.voxelView.flush()) this.lanterns.scan(this.battle.store);
        this.fx.syncField(this.battle.field);
        this.updateEnemyVisibility();
        this.overlays.showOverwatch(this.battle.units.filter(u => alive(u) && (u.side === 'player' || this.isVisible(u))));
        this.overlays.showObjective(this.battle);
        this.refreshRange();
        this.hud.refresh();
        this.debug.refresh();
    }
    /** Cheapest thing this unit could still do after moving (decides blue vs yellow). */
    minActionAp(u) {
        let best = Infinity;
        for (const id of u.weapons) {
            const w = WEAPONS[id];
            if (w.kind === 'melee') best = Math.min(best, w.ap);
            else if ((u.ammo[id] ?? 0) >= (w.perShot || 1)) best = Math.min(best, this.battle.shotAp(u, w));
        }
        for (const [id, n] of Object.entries(u.items)) if (n > 0) best = Math.min(best, THROWABLES[id].ap);
        return Number.isFinite(best) ? best : 1;
    }
    canStillAct(u) { return alive(u) && (u.ap + u.moveOnlyAp) > 0; }
    readyUnits() { return this.battle.unitsOf(this.battle.activeSide).filter(u => this.controllable(u) && this.canStillAct(u) && !u.overwatch); }
    targetsFor(u, weaponId) {
        const w = WEAPONS[weaponId];
        return this.battle.enemiesOf(u)
            .filter(t => (u.side !== 'player' || this.isVisible(t)) && Math.hypot(t.x - u.x, t.y - u.y) <= (w?.maxRange ?? 30) && (u.side !== 'player' || this.battle.visible?.has(t.id) || !this.fog))
            .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
    }

    // ------------------------------------------------------------------ selection & modes
    select(id, { snap = false } = {}) {
        const u = this.battle.unit(id);
        if (!u || !alive(u) || !(u.side === 'player' || this.controllable(u))) return;
        for (const v of this.views.values()) v.setSelected(false);
        this.selected = id;
        this.views.get(id)?.setSelected(true);
        this.setMode({ kind: 'move' });
        this.focusUnit(u, !snap);
        if (!this.levelLocked) this.setLevel(this.battle.store.roomAt(u.x, u.y, u.z + 1) >= 0 ? u.z + 3 : Infinity);
    }
    cycleUnit(d = 1) {
        const list = this.battle.unitsOf(this.battle.activeSide === 'player' ? 'player' : this.battle.activeSide).filter(u => this.controllable(u) || u.side === 'player');
        if (!list.length) return;
        const ready = list.filter(u => this.canStillAct(u));
        const pool = ready.length ? ready : list;
        const i = pool.findIndex(x => x.id === this.selected);
        this.select(pool[(i + d + pool.length) % pool.length].id);
    }
    focusUnit(u, glide = true) {
        if (!u) return;
        const t = new THREE.Vector3(u.x + 0.5, u.z + 1, u.y + 0.5);
        if (glide && this.options.followCamera) this.scene.glideTo(t, 5); else { this.scene.glide = null; this.scene.target.copy(t); }
    }
    setMode(m) {
        if (this.cameraDirector.phase === 'prepare') this.cameraDirector.end();
        this.mode = m; this.targetInfo = null;
        this.overlays.clearAim();
        this.overlays.clearPath();
        this.overlays.showCover(this.battle?.store, null);
        if (m.kind === 'shoot') this.enterTargeting();
        this.refreshRange();
        this.hud.refresh();
    }
    refreshRange() {
        const u = this.selectedUnit();
        if (!u || this.mode.kind !== 'move' || !this.controllable(u) || !this.player.idle() || this.battle.outcome) { this.overlays.clearRange(); this.search = null; this.zones = null; return; }
        this.search = this.battle.reach(u);
        const minAct = this.minActionAp(u), zones = new Map();
        for (const [k, cost] of this.search.costs) {
            const ap = this.battle.apForCost(u, cost);
            if (ap < 1 || ap > u.ap + u.moveOnlyAp) continue;
            const spentAp = Math.max(0, ap - u.moveOnlyAp);
            zones.set(k, u.ap - spentAp >= minAct ? 'blue' : 'yellow');
        }
        this.zones = zones;
        this.overlays.showZones(this.search.nodes, zones);
    }
    setLevel(top) { this.cutLevel = top; this.scene.setCut(Number.isFinite(top) ? top : Infinity); this.voxelView?.setCut(top); this.scene.rig.minLayerHeight=top===this.battle.mission.meta.streetDatum?2:(this.battle.mission.meta.streetDatum||1)+1;if(top===this.battle.mission.meta.streetDatum){const u=this.selectedUnit(),route=this.battle.mission.meta.underground?.route,p=u&&u.z<top?u:route?.[Math.floor(route.length/2)];this.scene.glide=null;if(p)this.scene.rig.target.set(p.x+.5,2,p.y+.5);else this.scene.rig.target.y=2;} this.hud.refresh(); }
    changeLevel(d) {
        this.levelLocked = true;
        const levels = this.battle.mission.meta.cutLevels || [4, 7, 10, 13, Infinity];
        let i = levels.indexOf(this.cutLevel); if (i < 0) i = levels.findIndex(l => l > this.cutLevel);
        i = Math.max(0, Math.min(levels.length - 1, i + d));
        this.setLevel(levels[i]);
    }
    cycleCutins() { const i = CUTIN_MODES.indexOf(this.cutins.mode); this.cutins.mode = CUTIN_MODES[(i + 1) % CUTIN_MODES.length]; this.hud.refresh(); }

    // ------------------------------------------------------------------ targeting
    enterTargeting() {
        const u = this.selectedUnit(); if (!u) return;
        this.targets = this.targetsFor(u, this.mode.weaponId);
        const keep = this.targets.find(t => t.id === this.lastTargetId) || this.targets[0];
        if (keep) this.aimAt(u, keep, 'torso', { frame: true });
    }
    cycleTarget(d = 1) {
        const u = this.selectedUnit(); if (!u || !this.targets?.length) return;
        const i = this.targets.findIndex(t => t.id === this.targetInfo?.target.id);
        this.aimAt(u, this.targets[(i + d + this.targets.length) % this.targets.length], this.targetInfo?.part || 'torso', { frame: true });
    }
    targetById(id) {
        const u = this.selectedUnit(), t = this.battle.unit(id);
        if (!u || !t) return;
        if (this.mode.kind !== 'shoot') { const w = u.weapons.find(x => WEAPONS[x].kind === 'ballistic'); if (!w) return; this.mode = { kind: 'shoot', weaponId: w }; this.targets = this.targetsFor(u, w); }
        this.aimAt(u, t, this.targetInfo?.part || 'torso', { frame: true });
        this.hud.refresh();
    }
    confirmFire() { if (this.mode.kind === 'shoot' && this.targetInfo) this.fire(this.targetInfo.target, this.targetInfo.part); }

    // ------------------------------------------------------------------ intents
    canAct() { return this.battle && !this.battle.outcome && this.player.idle() && this.session.canAct?.() !== false && (this.battle.activeSide === 'player' || this.debug.manualEnemy) && !this.aiRunning; }
    async intent(partial) {
        const u = this.selectedUnit();
        if (!this.canAct()) return { ok: false };
        const intent = { unitId: u?.id, by: this.session.playerId || 'player', ...partial };
        this.overlays.clearRange(); this.overlays.clearPath(); this.overlays.showCover(this.battle.store, null); this.hud.cursorTip(null);
        const r = await this.session.submit(intent);
        if (!r.ok) { this.hud.toast(`Can't: ${reasonText(r.reason)}`, 'warn'); this.refreshRange(); return r; }
        this.player.enqueue(r.events || []);
        await this.player.whenIdle();
        if (this.battle.outcome) return r;
        if (u && alive(u) && this.mode.kind === 'shoot' && partial.type === 'shoot' && u.ap >= this.battle.shotAp(u, WEAPONS[this.mode.weaponId])) this.setMode({ kind: 'shoot', weaponId: this.mode.weaponId });
        else this.setMode({ kind: 'move' });
        await this.afterUnitAction(u);
        return r;
    }
    /** XCOM flow: a spent soldier hands over to the next ready one; a spent squad ends the turn. */
    async afterUnitAction(u) {
        if (this.battle.outcome || !this.options.autoNext) return;
        const side = this.battle.activeSide;
        if (u && alive(u) && this.canStillAct(u) && !u.overwatch && u.side === side) return;
        const ready = this.readyUnits();
        if (ready.length) {
            await wait(350);
            const next = ready.sort((a, b) => Math.hypot(a.x - (u?.x ?? 0), a.y - (u?.y ?? 0)) - Math.hypot(b.x - (u?.x ?? 0), b.y - (u?.y ?? 0)))[0];
            this.select(next.id);
            return;
        }
        if (side === 'player') {
            this.hud.squadSpent(true);
            if (this.options.autoEndTurn && this.session.local) { await wait(700); if (!this.readyUnits().length && this.battle.activeSide === 'player' && !this.battle.outcome) this.endTurn(); }
        }
    }
    useAbility(id) {
        const a = ABILITIES[id];
        if (id === 'suppress') { this.setMode({ kind: 'shoot', weaponId: this.selectedUnit()?.weapons.find(w => WEAPONS[w].kind === 'ballistic'), suppress: true }); return; }
        this.intent({ type: 'ability', abilityId: id }).then(r => r.ok && this.hud.log(`${a.name}: ${a.text}`));
    }
    declareFormation(template) {
        const u = this.selectedUnit(); if (!u) return;
        const others = this.battle.unitsOf(u.side).filter(o => o.id !== u.id && !o.formationId && this.controllable(o)).sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
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
        return [u.id, ...this.battle.unitsOf(u.side).filter(o => o.id !== u.id && this.controllable(o) && o.ap >= 1 && Math.max(Math.abs(o.x - pt.x), Math.abs(o.y - pt.y)) <= 2 && Math.abs(o.z - pt.z) <= 1).map(o => o.id)];
    }
    doBreach(i, entry) {
        const u = this.selectedUnit(); if (!u) return;
        const pt = this.battle.breachPoints(u)[i]; if (!pt) return;
        this.intent({ type: 'breach', door: pt, unitIds: pt.entry==='floor'?[u.id]:this.breachStack(u, pt), entry });
    }
    nearestDoor(u) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const id = this.battle.store.get(u.x + dx, u.y + dy, u.z + 1);
            if (id === MAT.door || id === MAT.door_open) return { x: u.x + dx, y: u.y + dy, z: u.z };
        }
        return null;
    }
    toggleNearestDoor() { const u = this.selectedUnit(); const d = u && this.nearestDoor(u); if (d) this.intent({ type: 'door', door: d }); }
    setAimPart(part) {
        if (this.mode.kind !== 'shoot' || !this.targetInfo || this.mode.suppress) return;
        const u = this.selectedUnit(); if (!u) return;
        this.aimAt(u, this.targetInfo.target, part);
    }
    fire(target, part = 'torso') {
        const u = this.selectedUnit(); if (!u) return;
        this.lastTargetId = target.id;
        this.lastPreview = { unitId: u.id, hit: this.targetInfo?.byPart?.[part] };
        this.intent(this.mode.suppress
            ? { type: 'ability', abilityId: 'suppress', targetId: target.id }
            : { type: 'shoot', weaponId: this.mode.weaponId, aim: { unitId: target.id, part } });
    }
    async endTurn() {
        if (!this.canAct()) return;
        const side = this.battle.activeSide;
        this.overlays.clearRange(); this.overlays.clearAim(); this.overlays.clearPath();
        this.hud.squadSpent(false);
        const r = await this.session.submit({ type: 'endTurn', side, by: this.session.playerId || 'player' });
        if (!r.ok) { this.hud.toast(`Can't end turn: ${reasonText(r.reason)}`, 'warn'); return; }
        this.player.enqueue(r.events || []);
        await this.player.whenIdle();
        await this.maybeRunAi();
    }
    /** Local AI turns (enemy side, or the squad when autoplay is on), played unit by unit with the camera following. */
    async maybeRunAi() {
        if (this.aiRunning || !this.session.local) return;
        this.aiRunning = true;
        this.hud.refresh();
        try {
            for (let guard = 0; guard < 400 && this.battle && !this.battle.outcome; guard++) {
                const side = this.battle.activeSide;
                const aiSide = (side === 'enemy' && !this.debug.manualEnemy) || (side === 'player' && this.autoPlayer);
                if (!aiSide) break;
                if (side === 'player') for (const intent of formationIntents(this.battle, side)) {
                    const r = await this.session.submit(intent);
                    if (r.ok) { this.player.enqueue(r.events); await this.player.whenIdle(); }
                }
                for (const u of this.battle.unitsOf(side)) {
                    let looked = false;
                    for (let k = 0; k < 6 && alive(u) && !this.battle.outcome; k++) {
                        if (this.debug.paused) await this.debug.waitStep();
                        const intent = decide(this.battle, u, { formations: side === 'player' });
                        if (!intent) break;
                        if (!looked && this.options.followCamera && (u.side === 'player' || this.isVisible(u))) { this.focusUnit(u); looked = true; await wait(220 / this.player.speed); }
                        const r = await this.session.submit(intent);
                        if (!r.ok) break;
                        this.player.enqueue(r.events);
                        await this.player.whenIdle();
                    }
                }
                if (this.battle.outcome) break;
                const r = await this.session.submit({ type: 'endTurn', side });
                this.player.enqueue(r.events || []);
                await this.player.whenIdle();
            }
        } finally { this.aiRunning = false; }
        const u = this.readyUnits()[0] || this.battle.unitsOf('player')[0];
        if (u) this.select(u.id);
        this.hud.refresh();
    }

    // ------------------------------------------------------------------ battle event hooks (from EventPlayer)
    onReveal(roomId) {
        const room = this.battle.mission.rooms[roomId]; if (!room) return;
        for (const [x, y] of room.cells) for (let h = 0; h <= 3; h++) this.battle.store.markDirty(x, y, room.floorZ + h);
        this.battle.light.flush();this.voxelView.flush();
    }
    onTurn(e) {
        this.cutins.newTurn();
        this.hud.squadSpent(false);
        if (e.side === 'player') this.hud.banner(`ROUND ${e.round}`, 'SQUAD PHASE', 'player');
        else this.hud.banner('ENEMY ACTIVITY', 'HOSTILE PHASE', 'enemy');
        this.hud.log(e.side === 'player' ? `Round ${e.round}` : 'Enemy activity…');
    }
    onOutcome(e) { this.hud.showOutcome(e); this.hud.log(e.winner === 'player' ? 'Mission complete.' : 'Squad lost.'); }
    async onSpawn(e) { const u = this.battle.unit(e.unitId); if (u) { await this.addView(u); this.updateEnemyVisibility(); } }
    log(t) { this.hud.log(t); }

    // ------------------------------------------------------------------ input
    bindInput(canvas) {
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('mousemove', e => this.onHover(e));
        // Camera: right-drag grabs the ground and pans, middle-drag orbits (yaw + clamped tilt), wheel zooms (eased).
        canvas.addEventListener('mousedown', e => {
            if (e.button !== 2 && e.button !== 1) return;
            if (e.button === 1) e.preventDefault();                                  // no browser autoscroll
            const grab = e.button === 2 ? this.scene.rig.groundPoint(this.scene.rayAt(e.clientX, e.clientY)) : null;
            this.dragging = { button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, grab };
        });
        window.addEventListener('mouseup', e => {
            if (e.button === 2) { if (this.dragging && !this.dragging.moved) this.cancel(); this.dragging = null; }
            if (e.button === 1) this.dragging = null;
        });
        canvas.addEventListener('click', e => this.onClick(e));
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
            this.scene.zoom(Math.exp(Math.max(-1, Math.min(1, px * 0.0015))));
        }, { passive: false });
        window.addEventListener('keydown', e => this.onKey(e));
        window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
        // Screen-edge scrolling: remember where the pointer is (not over HUD controls) and whether it left the window.
        window.addEventListener('mousemove', e => { this.edgePtr = { x: e.clientX, y: e.clientY, ui: !!e.target?.closest?.('button, input, select, textarea, .options, .panel, .target') }; });
        document.addEventListener('mouseleave', () => { this.edgePtr = null; });
        window.addEventListener('blur', () => { this.edgePtr = null; this.keys.clear(); });
    }
    cancel() {
        if (this.debug.tool) { this.debug.setTool(null); return; }
        if (this.mode.kind !== 'move') this.setMode({ kind: 'move' });
        this.hud.hidePanel();
    }
    /** WASD / arrows and screen edges feed the rig's smooth pan (relative to the camera yaw). */
    handleKeysHeld(dt) {
        const k = this.keys;
        let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
        let y = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
        const p = this.edgePtr, M = 12;
        if (p && !p.ui && this.options.edgeScroll && !this.dragging && !this.cameraDirector.active && document.hasFocus()) {
            const W = window.innerWidth, H = window.innerHeight;
            if (p.x <= M) x -= 1; else if (p.x >= W - 1 - M) x += 1;
            if (p.y <= M) y += 1; else if (p.y >= H - 1 - M) y -= 1;
        }
        this.scene.rig.setPanIntent(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
    }
    onKey(e) {
        if (!this.battle || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const key = e.key.toLowerCase();
        if (this.debug.onKey(e, key)) return;
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { this.keys.add(key); return; }
        const u = this.selectedUnit();
        if (this.mode.kind === 'shoot' && PART_KEYS[key] && this.targetInfo) { this.setAimPart(PART_KEYS[key]); return; }
        switch (key) {
            case 'q': this.scene.rotate(-1); break;
            case 'e': this.scene.rotate(1); break;
            case 'pageup': this.changeLevel(1); break;
            case 'pagedown': this.changeLevel(-1); break;
            case 'tab': e.preventDefault(); if (this.mode.kind === 'shoot') this.cycleTarget(e.shiftKey ? -1 : 1); else this.cycleUnit(e.shiftKey ? -1 : 1); break;
            case 'enter': case ' ': e.preventDefault(); if (this.mode.kind === 'shoot') this.confirmFire(); else if (key === 'enter') this.endTurn(); break;
            case 'backspace': case 'escape': this.cancel(); break;
            case 'h': case 'home': e.preventDefault(); this.focusUnit(u); break;
            case 'v': this.scene.toggleProjection(); this.hud.toast(this.scene.projection === 'ortho' ? 'Camera: isometric' : 'Camera: perspective'); break;
            case 'o': this.setMode({ kind: 'overwatch' }); break;
            case 'r': this.intent({ type: 'reload' }); break;
            case 't': if (u) { const id = Object.keys(u.items).find(k => u.items[k] > 0); if (id) this.setMode({ kind: 'throw', itemId: id }); } break;
            case 'f': this.hud.showFormationPanel(); break;
            case 'b': if (u && this.battle.breachPoints(u).length) this.hud.showBreachPanel(); break;
            default:
                if (/^[1-9]$/.test(key)) this.hud.triggerSlot(+key);
        }
        this.hud.refresh();
    }
    /** Voxel picking through the cutaway: returns { cell, voxel, point, normal }. */
    pick(px, py) {
        const ray = this.scene.rayAt(px, py);
        const store = this.battle.store, top = this.cutLevel;
        // The camera usually sits outside the map (always in ortho) and castRay stops as soon as it leaves the grid,
        // so clip the ray to the map's box first and start the voxel walk just inside it (or at the lens if inside).
        const seg = clipToBox(ray.ray.origin, ray.ray.direction, store);
        if (!seg) return null;
        const { from, to } = seg;
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
            const d = this.dragging, dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) <= 3) return;
            d.moved = true; d.x = e.clientX; d.y = e.clientY;
            const rig = this.scene.rig;
            if (d.button === 1) rig.orbit(dx, dy);
            else {
                rig.glide = null;
                const p = d.grab && rig.groundPoint(this.scene.rayAt(e.clientX, e.clientY), d.grab.y);
                if (p) { rig.target.x += d.grab.x - p.x; rig.target.z += d.grab.z - p.z; rig.clamp(); rig.apply(); }
                else rig.pan(-dx * 0.05, dy * 0.05);
            }
            return;
        }
        if (!this.battle) return;
        this.mouse = { x: e.clientX, y: e.clientY };
        const unit = this.unitAt(e.clientX, e.clientY);
        const p = this.pick(e.clientX, e.clientY);
        this.hoverCell = p?.cell || (unit ? { x: unit.x, y: unit.y, z: unit.z } : null);
        this.hoverPick = p;
        this.hoverUnit = unit;
        this.overlays.setHover(this.hoverCell);
        this.debug.onHover(p, unit);
        if (this.debug.tool) { this.hud.cursorTip(null); return; }
        const u = this.selectedUnit();
        if (!u || !this.canAct() || !this.controllable(u)) { this.overlays.clearPath(); this.hud.cursorTip(null); return; }
        switch (this.mode.kind) {
            case 'move': {
                const c = this.hoverCell;
                const k = c && nodeKey(c);
                if (c && this.zones?.has(k) && !(unit && unit.id !== u.id)) {
                    const zone = this.zones.get(k);
                    const pv = this.battle.preview({ type: 'move', unitId: u.id, to: c, by: '*' });
                    this.overlays.showPath(pathTo(this.search, k), zone === 'yellow');
                    const flanked = pv.ok && pv.cover === COVER.NONE && this.battle.enemiesOf(u).some(t => this.battle.visible?.has(t.id));
                    this.overlays.showCover(this.battle.store, c, { flanked, dark:this.battle.mission.meta.imageGenerated&&this.battle.light.dark(c.x,c.y,c.z) });
                    const coverText = pv.ok ? ['No cover', 'Half cover', 'Full cover'][Math.max(0, Math.min(2, pv.cover))] : '';
                    const dz = c.z - u.z;
                    const height = dz > 0 ? ` · <b class="up">▲ ${dz} up</b>` : dz < 0 ? ` · <b class="down">▼ ${-dz} down</b>` : '';
                    this.hud.cursorTip(e.clientX, e.clientY, `<b class="${zone}">${pv.ap ?? '?'} AP</b>${zone === 'yellow' ? ' · DASH' : ''}${height}${this.battle.mission.meta.imageGenerated&&this.battle.light.dark(c.x,c.y,c.z)?' · ☾ DARK':''}<br><span>${flanked ? '<i class="flank">FLANKED</i>' : coverText}</span>`);
                } else {
                    this.overlays.clearPath(); this.overlays.showCover(this.battle.store, c);
                    this.hud.cursorTip(unit && unit.side !== u.side && this.isVisible(unit) ? e.clientX : null, e.clientY, unit ? `${unit.name} · ${unit.hp}/${unit.maxHp}<br><span>click a weapon to target</span>` : '');
                }
                break;
            }
            case 'shoot': {
                if (unit && unit.side !== u.side && this.isVisible(unit)) { if (this.targetInfo?.target !== unit) this.aimAt(u, unit, this.targetInfo?.part || 'torso'); this.hud.cursorTip(e.clientX, e.clientY, `click to fire · <b>${Math.round((this.targetInfo?.byPart?.[this.targetInfo.part] ?? 0) * 100)}%</b>`); }
                else if (e.altKey && p) {
                    const w = WEAPONS[this.mode.weaponId];
                    const { spread } = this.battle.spreadFor(u, w, p.point);
                    const est = estimateShot(this.battle, u, { point: p.point }, { weapon: w, spread, samples: 32 });
                    this.overlays.showCone(est.muzzle, p.point, spread);
                    this.hud.cursorTip(e.clientX, e.clientY, 'Alt+click: free-aim at this voxel');
                } else this.hud.cursorTip(null);
                break;
            }
            case 'throw': {
                const c = this.hoverCell; if (!c) break;
                const t = THROWABLES[this.mode.itemId];
                const arc = this.battle.throwArc(u, c);
                const inRange = Math.hypot(c.x - u.x, c.y - u.y) <= t.range;
                this.overlays.showArc(inRange ? arc.points : [], t.radius, arc.land);
                this.hud.cursorTip(e.clientX, e.clientY, inRange ? `${t.name} · ${t.ap} AP` : '<i class="flank">Out of range</i>');
                break;
            }
            case 'overwatch': this.hud.cursorTip(e.clientX, e.clientY, 'Click the direction to watch'); break;
            default: this.overlays.clearPath(); this.hud.cursorTip(null);
        }
    }
    aimAt(u, target, part, { frame = false } = {}) {
        if (this.mode.suppress) part = 'torso';
        const w = WEAPONS[this.mode.weaponId];
        if (!w) return;
        const key = `${u.id}:${u.x},${u.y},${u.z}:${target.id}:${target.x},${target.y},${target.z}:${w.id}:${!!this.mode.suppress}:${this.battle.seq}`;
        if (!this.targetInfo || this.targetInfo.key !== key) {
            const { spread, mods } = this.battle.spreadFor(u, w, partCentre(target, 'torso'), { target });
            const byPart = {};
            let any = 0, blocked = 0, friendly = 0, muzzle = null, lean = null, distance = 0;
            for (const p of ['head', 'torso', 'armL', 'armR', 'legs']) {
                const est = estimateShot(this.battle, u, { unitId: target.id, part: p }, { weapon: w, spread, samples: 64 });
                byPart[p] = est.parts[p];
                if (p === 'torso') { any = est.hit; blocked = est.cover; friendly = est.friendly; muzzle = est.muzzle; lean = est.lean; distance = est.distance; }
            }
            const cover = coverAgainst(this.battle.store, target.x, target.y, target.z, u.x, u.y, u.z);
            this.targetInfo = { key, target, part, byPart, anyHit: any, blocked, friendly, spread, mods, muzzle, lean, distance, cover, flanked: cover === COVER.NONE, ap: this.mode.suppress ? ABILITIES.suppress.ap : this.battle.shotAp(u, w), inRange: distance <= w.maxRange };
        }
        this.cameraDirector.prepare(new THREE.Vector3(u.x+0.5,u.z+1,u.y+0.5), new THREE.Vector3(target.x+0.5,target.z+1,target.y+0.5));
        this.targetInfo.part = part;
        this.overlays.showCone(this.targetInfo.muzzle, partCentre(target, part), this.targetInfo.spread);
        if (frame && this.options.followCamera) this.scene.glideTo(new THREE.Vector3((u.x + target.x) / 2 + 0.5, (u.z + target.z) / 2 + 1, (u.y + target.y) / 2 + 0.5), 4);
        this.hud.renderTarget();
    }
    onClick(e) {
        if (!this.battle || this.dragging?.moved) return;
        const unit = this.unitAt(e.clientX, e.clientY);
        const p = this.hoverPick || this.pick(e.clientX, e.clientY);
        if (this.debug.tool) { this.debug.click(p, unit, e); return; }
        const u = this.selectedUnit();
        if (unit && (unit.side === 'player' || this.controllable(unit)) && alive(unit) && unit.side === (u?.side ?? unit.side) && (this.mode.kind === 'move' || !u)) { this.select(unit.id); return; }
        if (!u || !this.canAct() || !this.controllable(u)) return;
        switch (this.mode.kind) {
            case 'move': {
                const c = p?.cell;
                if (unit && unit.side !== u.side && this.isVisible(unit)) { this.targetById(unit.id); break; }
                if (c && this.zones?.has(nodeKey(c))) this.intent({ type: 'move', to: c, group: !!this.battle.formations.of(u) && e.shiftKey });
                break;
            }
            case 'shoot':
                if (unit && unit.side !== u.side) {
                    if (this.targetInfo?.target === unit) this.fire(unit, this.targetInfo.part);
                    else this.aimAt(u, unit, this.targetInfo?.part || 'torso', { frame: true });
                } else if (e.altKey && p) { this.lastPreview = null; this.intent({ type: 'shoot', weaponId: this.mode.weaponId, aim: { point: p.point } }); }
                break;
            case 'melee': if (unit && unit.side !== u.side) this.intent({ type: 'melee', weaponId: this.mode.weaponId, targetId: unit.id, part: 'torso' }); break;
            case 'throw': if (p?.cell) this.intent({ type: 'throw', itemId: this.mode.itemId, to: p.cell }); break;
            case 'overwatch': if (p?.cell) this.intent({ type: 'overwatch', weaponId: u.weapons.find(id => WEAPONS[id].kind === 'ballistic'), toward: { x: p.cell.x, y: p.cell.y } }); break;
        }
    }
}

/** Clip a three-space ray to the voxel grid's box; returns voxel-space { from, to } or null when it misses. */
export function clipToBox(o, d, store) {
    const O = [o.x, o.z, o.y], Dv = [d.x, d.z, d.y], hi = [store.width, store.depth, store.height + 2];
    let t0 = 0, t1 = 2000;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(Dv[i]) < 1e-9) { if (O[i] < 0 || O[i] > hi[i]) return null; continue; }
        let a = (0 - O[i]) / Dv[i], b = (hi[i] - O[i]) / Dv[i];
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) return null;
    }
    const at = t => ({ x: O[0] + Dv[0] * t, y: O[1] + Dv[1] * t, h: O[2] + Dv[2] * t });
    return { from: at(Math.max(0, t0 - 0.01)), to: at(t1 + 0.01) };
}
