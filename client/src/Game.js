import { FORMATIONS } from '../../shared/content/formations.js';
import { TacticalMarks } from './render/TacticalMarks.js';
import { SightingMarks } from './render/SightingMarks.js';
import { RoadMarkings } from './render/RoadMarkings.js';
import { updateReticle } from './ui/AimReticle.js';
import { AimController, aimTau, swayDegrees, aimDelta } from './ui/AimController.js';
import { AimPointer } from './ui/AimPointer.js';
import { floorCutLevels, zoomCutLevel, unitCutLevel } from './render/FloorCutaway.js';
import { BuildingView, BUILDING_VIEWS } from './render/BuildingView.js';
import { pickVisibleTile, pickReachableAlongRay } from './render/TilePicking.js';
import { footprint } from '../../shared/battle/IntelOps.js';
import { InteriorVisibility } from './render/InteriorVisibility.js';
import { battleReport } from '../../shared/session/BattleReport.js';
import { saveReport } from './ui/TestGroundStore.js';
import { recordLocalMatch } from './net/AiCache.js';
import { watchWeapon, watchSector } from '../../shared/battle/WatchSector.js';
import { weaponBuild } from '../../shared/battle/FireControl.js';
import { peekCells, peekExposure, atCell } from '../../shared/battle/Peek.js';
import { toolTeardown, autoEndReady, peekStep, migrateSettings } from './ui/ToolState.js';
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
import { SoundPlayer } from './audio/SoundPlayer.js';
import { EventPlayer } from './anim/EventPlayer.js';
import { CutInDirector, CUTIN_MODES } from './anim/CutInDirector.js';
import { CameraDirector } from './anim/CameraDirector.js';
import { Hud } from './ui/Hud.js';
import { DebugTools } from './debug/DebugTools.js';
import { reasonText } from './ui/Reasons.js';
import { castRay } from '../../shared/voxel/Raycast.js';
import { MAT, AIR, materialById } from '../../shared/voxel/Materials.js';
import { nodeKey, pathTo } from '../../shared/world/PathSearch.js';
import { estimateShot, partCentre, chooseMuzzle, occupiedBy, resolveAimPoint, aimedUnit, stickyAim, partUnderRay, aimFriction } from '../../shared/battle/Ballistics.js';
import { coverAgainst, COVER } from '../../shared/voxel/Cover.js';
import { decide, formationIntents, aiOrder } from '../../shared/battle/Ai.js';
import { podRole } from '../../shared/battle/EnemyAi.js';
import { alive } from '../../shared/battle/Units.js';
import { WEAPONS, THROWABLES } from '../../shared/content/weapons.js';
import { reserveAmmo } from '../../shared/inventory/Equipment.js';
import { ABILITIES } from '../../shared/content/units.js';
import { B } from '../../shared/content/balance.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * Texture variants by noise (PLAN-04 P8): generated maps carry per-building and per-lot wear tints, so whole streets
 * age together (clean / worn / dirty) instead of flickering per tile. Visual only. Returns null for other maps.
 */
export function wearTint(mission) {
    const wear = mission?.visual?.wear; if (!wear) return null;
    const { width: W, depth: D } = mission.store, G = mission.meta?.streetDatum ?? 1;
    const ground = new Float32Array(W * D * 3).fill(1), walls = new Float32Array(W * D * 3).fill(1), built = new Uint8Array(W * D);
    for (const l of wear.lots) for (let y = l.y0; y <= Math.min(D - 1, l.y1); y++) for (let x = l.x0; x <= Math.min(W - 1, l.x1); x++) ground.set(l.tint, (x + y * W) * 3);
    for (const b of wear.buildings) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) { walls.set(b.tint, (x + y * W) * 3); built[x + y * W] = 1; }
    return (x, y, z) => {
        if (x < 0 || y < 0 || x >= W || y >= D) return null;
        const i = x + y * W, src = built[i] && z > G ? walls : z <= G ? ground : null;
        return src ? [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]] : null;
    };
}

export class Game {
    constructor({ canvas, hudRoot, cutinRoot, floatRoot, onExit, options = {} }) {
        let savedOptions={};try{savedOptions=JSON.parse(localStorage.getItem('tactics-settings')||'{}');}catch{}
        savedOptions=migrateSettings(savedOptions);
        this.options = { soundVolume:0.65,turnSpeed:1,rotateSpeed:1,aimSensitivity:0.5,aimSway:true,aimAssist:'light',unitTags:'selected',showEnemyBars:true,confirmMoves:false,autoEndTurn: true, autoNext: true, followCamera: true, edgeScroll: true, buildingView:'auto', ...savedOptions, ...options };
        this.audio = new SoundPlayer({ volume: this.options.soundVolume });
        this.scene = new Scene(canvas);
        this.library = new MaterialLibrary(this.scene.renderer, this.scene.clipping);
        this.kit = new KitLibrary(this.library);
        this.libraryReady = this.library.load().then(() => this.kit.load());
        this.overlays = new Overlays(this.scene);
        this.tacticalMarks=new TacticalMarks(this.scene);
        this.sightings=new SightingMarks(this.scene);   // PLAN-11: spotted flashes and last-seen markers
        this.roadMarks=new RoadMarkings(this.scene);    // PLAN-12: thin centred road paint
        this.lanterns = new LanternLights(this.scene);
        this.fx = new Fx(this.scene, floatRoot);
        this.cameraDirector = new CameraDirector(this.scene);
        this.aim = new AimController();
        this.cutins = new CutInDirector(cutinRoot, this.cameraDirector);
        this.cutins.unitView = id => this.views.get(id);
        // Leaving aim mode restores the ordinary field sprite.
        this.cameraDirector.onEnd = () => this.cutins.endAim();
        this.cameraDirector.xray = cells => this.voxelView?.setXray(cells);   // PLAN-10 interior aim cutaway
        this.player = new EventPlayer(this);this.player.speed=this.options.turnSpeed;
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
    async start(session, { progress = null } = {}) {
        this.audio.stopAll();
        this.audio.active = true;
        this.cameraDirector.end();
        this.session = session;
        this.startedAt = performance.now();
        this.battle = session.battle;
        this.voxelView?.dispose();this.tacticalMarks.clear();this.sightings.clear();this.roadMarks.clear();
        for (const v of this.views.values()) v.dispose();
        this.views.clear();
        this.overlays.clearRange(); this.overlays.clearPath(); this.overlays.clearAim(); this.overlays.clearDebugLayer();
        const store = this.battle.store;
        await progress?.('art');
        await this.libraryReady;
        await progress?.('world');
        this.scene.setBounds(store.width, store.depth, store.height);
        this.scene.rig.resetTactical();this.scene.syncPassCamera();
        this.scene.setMission(this.battle.mission);
        this.voxelView = new VoxelView(this.scene, store, this.library, this.options.kit === false ? null : this.kit);
        this.visualRevealedRooms = new Set(this.battle.revealedRooms);
        this.discoveryVisible = new Set();
        this.visualInterior=new Set(this.battle.visibleInterior);
        this.buildingView=new BuildingView(this.battle.mission);this.buildingViewKey=null;this.voxelView.buildingView=this.buildingView;
        this.voxelView.interiorVisibility = new InteriorVisibility(this.battle.mission,this.visualRevealedRooms,()=>this.fog,this.visualInterior);
        this.overlays.visibleCell = c => !this.voxelView.interiorVisibility.hiddenAt(c.x,c.y,c.z+1)&&!this.buildingView.hiddenAt(c.x,c.y,c.z);
        const wear = wearTint(this.battle.mission);
        this.voxelView.tint = (x, y, z) => {
            let light=this.battle.light.tint(x,y,z);
            const w = wear?.(x, y, z); if (w) light = light.map((c, i) => c * w[i]);
            return this.voxelView.interiorVisibility.hiddenAt(x,y,z) ? light.map((c,i)=>c*[0.18,0.22,0.3][i]) : light;
        };
        setGroundStore(store);
        this.voxelView.setVisual(this.battle.mission?.visual);
        this.cutLevel=this.options.buildingView==='exterior'?Infinity:zoomCutLevel(this.battle.mission,this.scene.rig.distanceTarget);
        this.voxelView.cutZ=this.cutLevel;this.scene.setCut(this.cutLevel);
        this.refreshBuildingView({rebuild:false});
        this.voxelView.rebuildAll();
        this.lanterns.scan(store, this.battle.mission?.visual?.decor);
        this.roadMarks.setCut(this.cutLevel);this.roadMarks.build(store,this.battle.mission?.visual?.roadPaint);
        this.cameraDirector.store = store;
        await progress?.('squad');
        await Promise.all(this.battle.units.map(u => this.addView(u)));
        this.selected = null; this.mode = { kind: 'move' };
        this.intelOverlaySeq=null;this.overlays.showIntel(this.battle);
        const first = this.battle.unitsOf('player').find(u=>this.controllable(u));
        this.scene.focus(store.width / 2, 2, store.depth / 2);
        if (first) this.select(first.id, { snap: true });
        this.fx.syncField(this.battle.field);
        this.updateEnemyVisibility();
        this.overlays.showObjective(this.battle);
        session.onEvents = events => this.player.enqueue(events);
        session.onRemoteTurn = () => this.maybeRunAi();
        session.onState = state => {
            this.hud.log(`Co-op: ${state === 'recovering' ? 'restoring authoritative battle' : state}`);
            this.hud.refresh();
        };
        session.onError = message => this.hud.log(`Co-op recovery failed: ${message}`);
        session.onRecovered = async () => { await this.player.whenIdle(); await this.start(session); };
        this.hud.reset();
        this.hud.refresh();
        this.hud.log(`${this.battle.mission.name}: ${this.battle.mission.objective?.text || ''}`);
        this.hud.banner(`ROUND ${this.battle.round}`, 'SQUAD PHASE', 'player');
        this.debug.onStart();
        this.levelLocked = false;
        // Each map has a time of day (Main Street at dusk, the docks at night) unless the player picked one.
        if (!this.options.lighting) this.scene.setLighting(this.battle.mission.meta?.timeOfDay || this.battle.mission.meta?.lighting || 'day');
        this.applyZoomCut();

    }
    async addView(u) {
        if (this.views.has(u.id)) return this.views.get(u.id);
        const v = new UnitView(this.scene, u, await loadCharacterArt(u.art),this.battle.store);
        v.statusLines = x => this.statusLines(x);
        this.views.set(u.id, v);
        return v;
    }
    restart() { this.session.restart?.().then(s => this.start(s)).then(() => { if (this.autoPlayer) this.maybeRunAi(); }); }
    exitToMenu(opts) { this.aimPointer.setEnabled(false);this.audio.active = false; this.audio.stopAll(); this.onExit?.(opts); }

    loop(now) {
        // PLAN-15: one bad frame (e.g. a battle half set up during start) must never stop the render loop.
        try { this.frame(now); } catch (err) { if (!this.frameErrorAt || now - this.frameErrorAt > 2000) { this.frameErrorAt = now; console.warn('frame:', err); } }
        requestAnimationFrame(this.loop);
    }
    frame(now) {
        // rAF timestamps can predate the constructor (negative first dt), which used to fling the camera shake.
        const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = now;
        this.time += dt;
        this.handleKeysHeld(dt);
        if(this.peekGlide){const g=this.peekGlide;g.t=Math.min(1,g.t+dt/g.dur);const p=g.from.clone().lerp(g.to,g.t*g.t*(3-2*g.t));g.view.setWorld(p.x,p.z,p.y);if(g.t>=1)this.peekGlide=null;}
        this.refreshBuildingView();
        const yaw = this.scene.yaw;
        this.stepAim(dt);
        this.cameraDirector.update(dt);
        this.scene.rig.rotationSpeed=this.options.rotateSpeed;
        this.tacticalMarks.update(this.battle,this.cutLevel,this.time,this.selected);
        this.sightings.update(this,this.time,dt);
        if(this.battle)updateReticle(this);
        const cine = this.cameraDirector.active;
        for (const v of this.views.values()) {
            v.swayEnabled=this.options.aimSway;
            if(v.tagMode!==this.options.unitTags){v.tagMode=this.options.unitTags;v.drawBar();}
            v.update(dt, cine ? Math.atan2(this.cameraDirector.cam.position.x - v.pos.x, this.cameraDirector.cam.position.z - v.pos.z) : yaw, this.scene.camera);
            v.bar.visible = !cine && !v.unit.dead && v.group.visible && (v.unit.side==='player'||this.options.showEnemyBars);
            v.sprite.visible = !(cine && this.cameraDirector.hidden?.has(v.id));
            const ground = this.battle?.store.surfaces(Math.floor(v.pos.x), Math.floor(v.pos.z))[0];
            v.updateDrop(cine ? Infinity : ground ? ground.z + 1 : 0);
        }
        // Pulse the destination marker.
        const mk = this.overlays.marker;
        if (mk.visible) { const s = 1 + Math.sin(this.time * 5) * 0.08; mk.userData.ring.scale.set(s, 1, s); }
        this.overlays.pulse?.(this.time);
        this.fx.update(dt);
        this.library.update(dt);
        this.lanterns.update(dt, this.scene.target, this.cutLevel);
        if (this.cameraDirector.active) {
            this.scene.updateCamera(dt);
            this.scene.renderer.render(this.scene.scene, this.cameraDirector.cam);
        } else this.scene.render(dt);
        if(this.battle?.intelMode && this.intelOverlaySeq!==this.battle.seq){this.intelOverlaySeq=this.battle.seq;this.overlays.showIntel(this.battle);}
        this.hud.tick?.(dt);
    }

    // ------------------------------------------------------------------ queries
    selectedUnit() { const u = this.battle?.unit(this.selected); return u && alive(u) ? u : null; }
    /** Units the local player may command right now (debug can hand over the enemy side). */
    controllable(u) {
        if (!u || !alive(u) || u.side !== this.battle.activeSide) return false;
        if (u.side === 'player') return this.session.local || u.owner===this.session.playerId;
        return this.debug.manualEnemy;
    }
    isVisible(u) { return u.side==='player' || !this.fog || (this.battle.visible?.has(u.id) && !this.voxelView?.interiorVisibility?.hiddenAt(u.x,u.y,u.z+1)); }
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
        this.overlays.showOverwatch(this.battle,this.battle.units.filter(u => alive(u) && (u.side === 'player' || this.isVisible(u))),{hidden:(x,y,z)=>this.voxelView.interiorVisibility.hiddenAt(x,y,z),cutZ:this.cutLevel});
        this.overlays.showObjective(this.battle);
        this.refreshRange();
        this.hud.refresh();
        this.debug.refresh();
    }
    /** AP a blue tile must leave: a shot or overwatch with the equipped gun (Battle.blueAp). */
    minActionAp(u) { return this.battle.blueAp(u); }
    canStillAct(u) { return alive(u) && (u.ap + u.moveOnlyAp) > 0; }
    readyUnits() { return this.battle.unitsOf(this.battle.activeSide).filter(u => this.controllable(u) && this.canStillAct(u) && !u.overwatch); }
    targetsFor(u, weaponId) {
        const w = WEAPONS[weaponId]&&weaponBuild(u,WEAPONS[weaponId]);
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
        this.focusFloor(u);
        this.views.get(id)?.flashStatus?.();   // PLAN-11: HP / ammo / gadgets for a moment
        // PLAN-15: always say who is in control now.
        if (u.side === 'player' && this.lastAnnounced !== id) { this.lastAnnounced = id; this.hud.announceUnit?.(u); }
    }
    /** PLAN-11: the two short lines of the selected soldier's status card (weapon rounds, spare mags, gadgets). */
    statusLines(u) {
        const w = WEAPONS[u.weapon], lines = [];
        if (w?.kind === 'ballistic') lines.push(`${w.name}  ${u.ammo[w.id] ?? 0}/${w.ammo}${(() => { try { const r = reserveAmmo(u, w); return r ? `  +${r}` : ''; } catch { return ''; } })()}`);
        else if (w) lines.push(w.name);
        const items = Object.entries(u.items || {}).filter(([id, n]) => n > 0 && THROWABLES[id]).map(([id, n]) => `${THROWABLES[id].short || THROWABLES[id].name.split(' ')[0]} ${n}`);
        if (items.length) lines.push(items.join(' · '));
        return lines;
    }
    /**
     * PLAN-10: show the storey a unit stands on (Tab, selection, targeting, enemy activity). Indoors and on upper
     * levels the cut follows the unit; outdoors at street level the zoom keeps deciding. Exterior view is respected.
     */
    focusFloor(...units) {
        if (!this.battle?.mission) return;
        if (this.options.buildingView === 'exterior') { if (!this.levelLocked) this.applyZoomCut(); return; }
        const u = units.filter(Boolean).sort((a, b) => b.z - a.z)[0];
        const cut = u ? unitCutLevel(this.battle.mission, u) : null;
        if (cut === null) { if (this.levelSource === 'unit' || !this.levelLocked) { this.levelSource = null; this.applyZoomCut(); } return; }
        this.levelLocked = true; this.levelSource = 'unit';
        if (cut !== this.cutLevel) this.setLevel(cut);
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
        if (m.kind === 'shoot' && m.weaponId === 'handcannon' && (this.mode.kind !== 'shoot' || this.mode.weaponId !== m.weaponId)) this.audio.play('handgunClick', { volume: 0.5 });
        // PLAN-15: one tool on screen at a time — entering a tool tears every other one down (panels, aim, overlays).
        const td = toolTeardown(this.mode, m, { panelOpen: !this.hud.el('.panel').classList.contains('hidden'), locked: !!this.aimPointer?.locked });
        if (td.closePanel) this.hud.hidePanel();
        if (td.releaseLock) this.aimPointer.release();
        if (td.resetPeek) this.setPeek(null, { reframe: false });
        this.cancelAutoEnd();
        if (this.cameraDirector.phase === 'prepare') this.cameraDirector.end();
        this.mode = m;this.aimDrag=null;this.rawAim=null;this.aimPick=null;
        if (['throw','gadget','breach'].includes(m.kind)) this.views.get(this.selected)?.flashStatus?.(); this.targetInfo = null;this.freeAim=null;this.freeAimManual=false;this.moveConfirmation=null;this.aim.clear();this.aimStance=null;
        this.aimPointer.setEnabled(m.kind==='shoot');
        if(m.kind!=='shoot')this.hud.el('.aim-reticle')?.classList.add('hidden');   // PLAN-15: never a reticle beside another tool
        this.overlays.clearAim();
        this.overlays.clearPath();
        this.overlays.showCover(this.battle?.store, null);
        if (m.kind === 'shoot') this.enterTargeting();
        this.refreshRange();
        this.hud.refresh();
    }
    refreshRange() {
        const u = this.selectedUnit();
        if (!u || this.mode.kind !== 'move' || !this.controllable(u) || (this.session.local && !this.player.idle()) || this.battle.outcome) { this.overlays.clearRange(); this.search = null; this.zones = null; return; }
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
    setLevel(top) {
        const changed=top!==this.voxelView?.cutZ;
        this.cutLevel=top;this.scene.setCut(top);this.cameraDirector.cutZ=top;this.roadMarks?.setCut(top);
        this.scene.rig.minLayerHeight=top===this.battle.mission.meta.streetDatum?2:(this.battle.mission.meta.streetDatum||1)+1;
        if(top===this.battle.mission.meta.streetDatum){
            const u=this.selectedUnit(),route=this.battle.mission.meta.underground?.route,p=u&&u.z<top?u:route?.[Math.floor(route.length/2)];
            this.scene.glide=null;if(p)this.scene.rig.target.set(p.x+.5,2,p.y+.5);else this.scene.rig.target.y=2;
        }
        // Update the per-building mask before rebuilding cut chunks: one rebuild per floor change.
        this.refreshBuildingView({rebuild:!changed});
        this.voxelView?.setCut(top);
        if(changed)this.refreshRange();
        this.hud.refresh();
    }
    setBuildingView(mode) {
        if(!BUILDING_VIEWS.includes(mode))return;
        this.options.buildingView=mode;this.buildingViewKey=null;
        if(mode==='exterior')this.setLevel(Infinity);else this.applyZoomCut();
        this.refreshBuildingView();
        this.hud.refresh();this.hud.renderOptions();
    }
    cycleBuildingView(){this.setBuildingView(this.options.buildingView==='exterior'?'auto':'exterior');}
    applyZoomCut() {
        if(!this.battle)return;
        this.levelLocked=false;
        this.setLevel(this.options.buildingView==='exterior'?Infinity:zoomCutLevel(this.battle.mission,this.scene.rig.distanceTarget));
    }
    refreshBuildingView({rebuild=true}={}) {
        if(!this.battle||!this.buildingView)return;
        const u=this.selectedUnit(),units=this.battle.unitsOf('player'),key=`${u?.id}:${units.map(p=>`${p.id}:${p.x},${p.y},${p.z}`).join(';')}:${u?.x},${u?.y},${u?.z}:${this.cutLevel}:${this.options.buildingView}`;
        if(key===this.buildingViewKey)return;this.buildingViewKey=key;
        if(this.buildingView.update({unit:u,units,cutZ:this.cutLevel,mode:this.options.buildingView,zoomFloor:Number.isFinite(this.cutLevel)?Math.max(1,Math.round((this.cutLevel-(this.battle.mission.meta.streetDatum??1))/3)):0})){if(rebuild)this.voxelView.rebuildAll();this.refreshRange();}
    }
    changeLevel(d) {
        this.levelLocked = true;
        if(this.options.buildingView==='exterior')this.options.buildingView='auto';
        const levels = floorCutLevels(this.battle.mission);
        let i = levels.indexOf(this.cutLevel); if (i < 0) i = levels.findIndex(l => l > this.cutLevel);
        i = Math.max(0, Math.min(levels.length - 1, i + d));
        this.chooseFloor(levels[i]);
    }
    chooseFloor(top) {
        this.levelLocked=true;this.levelSource='manual';
        if(this.options.buildingView==='exterior')this.options.buildingView='auto';
        if(Number.isFinite(top)){this.scene.rig.glide=null;this.scene.rig.target.y=top-2;}
        this.setLevel(top);this.hoverPick=null;this.hoverCell=null;
    }

    // ------------------------------------------------------------------ targeting
    enterTargeting() {
        const u = this.selectedUnit(); if (!u) return;
        this.targets = this.targetsFor(u, this.mode.weaponId);
        const keep = this.targets.find(t => t.id === this.lastTargetId) || this.targets[0];
        if (keep) this.aimAt(u, keep, 'torso', { frame: true });
        else {this.freeAim={x:u.x+.5,y:u.y-8,h:u.z+2.1};this.aim.snap(this.freeAim);this.freeAimManual=true;this.frameAim(u,this.freeAim);this.focusFloor(u);}
        if(navigator.userActivation?.isActive&&!this.aimPointer.unavailable)this.aimPointer.request();
    }
    cycleTarget(d = 1) {
        const u = this.selectedUnit(); if (!u) return;
        this.targets=this.targetsFor(u,this.mode.weaponId);if(!this.targets.length)return;
        const i = this.targets.findIndex(t => t.id === this.targetInfo?.target.id);
        this.aimAt(u, this.targets[(i + d + this.targets.length) % this.targets.length], this.targetInfo?.part || 'torso', { frame: true });
    }
    targetById(id) {
        const u = this.selectedUnit(), t = this.battle.unit(id);
        if (!u || !t || !this.targetsFor(u,this.mode.weaponId||watchWeapon(u)).some(target=>target.id===id)) return;
        if (this.mode.kind !== 'shoot') { const w = watchWeapon(u); if (!w) return; this.mode = { kind: 'shoot', weaponId: w }; this.targets = this.targetsFor(u, w); }
        this.aimAt(u, t, this.targetInfo?.part || 'torso', { frame: true });
        this.aimPointer.setEnabled(true);
        if(navigator.userActivation?.isActive&&!this.aimPointer.unavailable)this.aimPointer.request();
        this.hud.refresh();
    }
    confirmFire() {if(this.mode.kind!=='shoot')return;if(this.mode.suppress&&this.targetInfo)return this.fire(this.targetInfo.target,'torso');if(this.freeAim)this.intent({type:'shoot',weaponId:this.mode.weaponId,aim:{point:{...this.freeAim}},...(this.peek?{from:{...this.peek}}:{})});}

    // ------------------------------------------------------------------ intents
    canAct() { return this.battle && !this.battle.outcome && (!this.session.local || this.player.idle()) && this.session.canAct?.() !== false && (this.battle.activeSide === 'player' || this.debug.manualEnemy) && !this.aiRunning; }
    async intent(partial) {
        const u = this.selectedUnit();
        if (!this.canAct()) return { ok: false };
        const intent = { unitId: u?.id, by: this.session.playerId || 'player', ...partial };
        this.overlays.clearRange(); this.overlays.clearPath(); this.overlays.showCover(this.battle.store, null); this.hud.cursorTip(null);
        const r = await this.session.submit(intent);
        if (!r.ok) { this.hud.toast(`Can't: ${reasonText(r.reason)}`, 'warn'); this.refreshRange(); return r; }
        this.player.enqueue(r.events || []);
        await this.player.whenIdle();
        if (partial.type === 'reload' && u) this.views.get(u.id)?.flashStatus?.();
        if(['inventoryMove','equipCargo','setFireMode','mark','formation_plan'].includes(partial.type)){this.refreshRange();this.hud.refresh();return r;}
        if (this.battle.outcome) return r;
        if (u && alive(u) && this.mode.kind === 'shoot' && partial.type === 'shoot' && u.ap >= this.battle.shotAp(u, WEAPONS[this.mode.weaponId])) this.setMode({ kind: 'shoot', weaponId: this.mode.weaponId });
        else this.setMode({ kind: 'move' });
        await this.afterUnitAction(u);
        return r;
    }
    /** XCOM flow: a spent soldier hands over to the next ready one; a spent squad prompts the player to end the phase. */
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
            // PLAN-15: when the squad's AP is spent the turn ends by itself after a short, cancellable countdown.
            if (this.options.autoEndTurn && autoEndReady(this.battle, u => this.controllable(u))) this.startAutoEnd();
        }
    }
    useAbility(id) {
        const a = ABILITIES[id];
        if (a.targeting) { this.setMode({ kind: 'ability', abilityId: id }); return; }
        if (id === 'suppress') { this.setMode({ kind: 'shoot', weaponId: this.selectedUnit()?.weapons.find(w => WEAPONS[w].kind === 'ballistic'), suppress: true }); return; }
        this.intent({ type: 'ability', abilityId: id }).then(r => r.ok && this.hud.log(`${a.name}: ${a.text}`));
    }
    declareFormation(template) {const u=this.selectedUnit();if(!u)return;const f=this.battle.formations.of(u);
        if(f){this.intent({type:'formation_switch',template,facing:this.hoverFacing(u)});return;}   // reshape an existing formation, free
        this.intent({type:'formation_plan',template,facing:this.hoverFacing(u)});}
    /** Formation spot under the cursor for the selected member: its slot index, or -1. Clicking it trades places (free). */
    formationSlotAt(u, c) {
        const f = c && this.battle.formations.of(u);
        if (!f || !FORMATIONS[f.template]?.slots) return -1;
        const asg = this.battle.formations.assignmentsOf(f);
        const i = this.battle.formations.slotTiles(f).findIndex(p => p.x === c.x && p.y === c.y && Math.abs(p.z - c.z) <= 1);
        if (i < 0) return -1;
        const holder = Object.keys(asg).find(id => asg[id] === i), hu = holder && this.battle.unit(holder);
        return i === asg[u.id] ? -1 : i >= Math.min(FORMATIONS[f.template].slots.length, FORMATIONS[f.template].max) ? -1 : (hu || !this.battle.occupant(c.x, c.y, c.z)) ? i : -1;
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
            : { type: 'shoot', weaponId: this.mode.weaponId, aim: { unitId: target.id, part }, ...(this.peek ? { from: { ...this.peek } } : {}) });
    }
    /** PLAN-15 auto end turn: 1.2 s countdown on the HUD; Esc, a click on it or any new order cancels. */
    startAutoEnd(ms = 1200) {
        this.cancelAutoEnd();
        const token = this.autoEnd = { until: performance.now() + ms };
        this.hud.autoEndCountdown?.(ms);
        setTimeout(() => {
            if (this.autoEnd !== token) return;
            this.autoEnd = null; this.hud.autoEndCountdown?.(0);
            if (this.battle && !this.battle.outcome && this.battle.activeSide === 'player' && autoEndReady(this.battle, u => this.controllable(u))) this.endTurn();
        }, ms);
    }
    cancelAutoEnd() { if (!this.autoEnd) return false; this.autoEnd = null; this.hud?.autoEndCountdown?.(0); return true; }
    async endTurn() {
        this.cancelAutoEnd();
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
                for (const intent of formationIntents(this.battle, side)) {     // squad autopilot and enemy pods (PLAN-09)
                    const r = await this.session.submit(intent);
                    if (r.ok) { this.player.enqueue(r.events); await this.player.whenIdle(); }
                }
                for (const u of aiOrder(this.battle, side)) {
                    let looked = false;
                    for (let k = 0; k < 6 && alive(u) && !this.battle.outcome; k++) {
                        if (this.debug.paused) await this.debug.waitStep();
                        const intent = decide(this.battle, u, { formations: side === 'player' });
                        if (!intent) break;
                        if (!looked && this.options.followCamera && (u.side === 'player' || this.isVisible(u))) { this.focusUnit(u); this.focusFloor(u); looked = true; await wait(220 / this.player.speed); }
                        this.debug.aiLog?.(u, intent, u.side === 'enemy' ? podRole(this.battle, u) : null);   // PLAN-15 why log
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
    onVision(cells) {
        const next=new Set(cells),changed=[...this.visualInterior].filter(k=>!next.has(k)).concat(cells.filter(k=>!this.visualInterior.has(k)));
        this.visualInterior.clear();for(const k of cells)this.visualInterior.add(k);
        for(const k of changed){const [x,y,z]=k.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let h=0;h<4;h++)this.battle.store.markDirty(x+dx,y+dy,z+h);}
        this.voxelView.flush();this.updateEnemyVisibility();
    }
    onReveal(roomId) {
        const room = this.battle.mission.rooms.find(r=>r.id===roomId); if (!room) return;
        this.visualRevealedRooms.add(roomId);
        for (const [x, y] of room.cells) for (let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for (let h = 0; h <= 3; h++) this.battle.store.markDirty(x+dx, y+dy, room.floorZ + h);
        this.battle.light.flush();this.voxelView.flush();
        if(!this.levelLocked)this.applyZoomCut();
        this.updateEnemyVisibility();this.overlays.showObjective(this.battle);
    }
    onTurn(e) {
        this.cutins.newTurn();
        this.hud.squadSpent(false);
        this.overlays.clearAim(); this.overlays.clearPath();
        if (e.side === 'player') this.hud.banner(this.battle.asyncCoop?`ENEMY BEAT ${e.round}`:`ROUND ${e.round}`, this.battle.asyncCoop?'INDEPENDENT TURNS':'SQUAD PHASE', 'player');
        else this.hud.banner('ENEMY ACTIVITY', 'HOSTILE PHASE', 'enemy');
        this.hud.log(e.side === 'player' ? `Round ${e.round}` : 'Enemy activity…');
    }
    onOutcome(e) {
        this.aimPointer.setEnabled(false);
        this.hud.log(e.winner === 'player' ? 'Mission complete.' : 'Squad lost.');
        // After-action report for every battle; kept in this browser's recent reports (Test ground).
        const report = battleReport(this.battle, this.session?.desc || {}, {
            at: new Date().toISOString(), durationMs: Math.round(performance.now() - (this.startedAt || performance.now())),
            mode: this.session?.local ? 'local' : 'online', autopilot: !!this.autoPlayer
        });
        this.lastReport = report;
        this.hud.showReport(report, { saved: saveReport(report), canEdit: !!this.session?.local });
        // PLAN-09: cache what this match says about the squad's playstyle (online rooms record it on the server).
        if (this.session?.local && !this.autoPlayer && report.playstyle && !this.session.desc?.debugMap)
            recordLocalMatch(report.playstyle, { outcome: report.outcome.winner, scenario: report.scenario.id }).catch(err => console.warn('AI cache:', err.message));
    }
    async onSpawn(e) { const u = this.battle.unit(e.unitId); if (u) { await this.addView(u); this.updateEnemyVisibility(); } }
    log(t) { this.hud.log(t); }

    // ------------------------------------------------------------------ input
    bindInput(canvas) {
        this.aimPointer=new AimPointer(canvas,{
            changed:()=>this.hud.renderTarget(),
            failed:()=>{this.hud.renderTarget();this.hud.toast('Browser refused mouse capture. Drag or use arrow keys to aim; Space fires.','warn');}
        });
        canvas.addEventListener('pointerdown',e=>{
            if(e.button===0&&this.mode.kind==='shoot'&&this.aimPointer.unavailable&&!this.aimPointer.locked){
                this.aimDrag={x:e.clientX,y:e.clientY,id:e.pointerId};canvas.setPointerCapture(e.pointerId);
            }
        });
        const endAimDrag=()=>{this.aimDrag=null;};
        canvas.addEventListener('pointerup',endAimDrag);canvas.addEventListener('pointercancel',endAimDrag);
        canvas.addEventListener('lostpointercapture',endAimDrag);
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('mousemove', e => this.onHover(e));
        // Camera: right-drag grabs the ground and pans, middle-drag orbits (yaw + clamped tilt), wheel zooms (eased).
        canvas.addEventListener('mousedown', e => {
            if(this.mode.kind==='shoot')return;
            if (e.button !== 2 && e.button !== 1) return;
            if (e.button === 1) e.preventDefault();                                  // no browser autoscroll
            const grab = e.button === 2 ? this.scene.rig.groundPoint(this.scene.rayAt(e.clientX, e.clientY)) : null;
            this.dragging = { button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, grab };
        });
        window.addEventListener('mouseup', e => {
            if (e.button === 2) { if(this.mode.kind==='shoot')this.cancel();else if (this.dragging && !this.dragging.moved) this.cancel(); this.dragging = null; }
            if (e.button === 1) this.dragging = null;
        });
        canvas.addEventListener('click', e => this.onClick(e));
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
            if(this.mode.kind==='shoot'&&this.cameraDirector.phase==='prepare'){this.cameraDirector.zoomAim(Math.exp(Math.max(-1,Math.min(1,px*.0015))));return;}
            this.scene.zoom(Math.exp(Math.max(-1, Math.min(1, px * 0.0015))));
            // A unit-driven floor holds while zooming in; pulling out to the roof view hands the cut back to the zoom.
            if(this.levelSource==='unit'&&this.scene.rig.distanceTarget>=36){this.levelSource=null;this.levelLocked=false;}
            if(!this.levelLocked)this.applyZoomCut();
        }, { passive: false });
        window.addEventListener('keydown', e => this.onKey(e));
        window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
        // Screen-edge scrolling: remember where the pointer is (not over HUD controls) and whether it left the window.
        window.addEventListener('mousemove', e => { this.edgePtr = { x: e.clientX, y: e.clientY, ui: !!e.target?.closest?.('button, input, select, textarea, .options, .panel, .target') }; });
        document.addEventListener('mouseleave', () => { this.edgePtr = null; });
        window.addEventListener('blur', () => { this.edgePtr = null;this.aimDrag=null;this.keys.clear();this.aimPointer.release(); });
    }
    cancel() {
        this.aimDrag=null;
        if(this.cancelAutoEnd())return;
        if(this.mode.kind==='shoot'&&this.peek){this.setPeek(null);return;}   // PLAN-15: first Esc steps back from a peek
        if(this.aimPointer.locked){this.aimPointer.release();return;}
        if(this.hud.equipment.open){this.hud.equipment.toggle();return;}
        if (this.debug.tool) { this.debug.setTool(null); return; }
        if (this.mode.kind !== 'move') this.setMode({ kind: 'move' });
        this.hud.hidePanel();
    }
    /** WASD / arrows and screen edges feed the rig's smooth pan (relative to the camera yaw). */
    handleKeysHeld(dt) {
        const k = this.keys;
        // PLAN-15: W/S change floors (onKey); A/D and the arrows pan. While aiming WASD peeks (onKey), arrows nudge the aim.
        let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
        let y = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
        if(this.mode.kind==='shoot'){
            this.scene.rig.setPanIntent(0,0);
            const ax=(k.has('arrowright')?1:0)-(k.has('arrowleft')?1:0),ay=(k.has('arrowup')?1:0)-(k.has('arrowdown')?1:0);
            if(this.canAct()&&!this.hud.equipment.open)this.moveAim(ax*400*dt,-ay*400*dt);
            return;
        }
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
        if(this.hud.equipment.open){
            if(['i','escape','tab','r'].includes(key))e.preventDefault();
            if(key==='i'||key==='escape')this.hud.equipment.toggle();
            else if(key==='tab')this.cycleUnit(e.shiftKey?-1:1);
            else if(key==='r'&&this.hud.equipment.selected){this.hud.equipment.rotate();}
            return;
        }
        if (this.debug.onKey(e, key)) return;
        if (['w', 'a', 's', 'd'].includes(key) && this.mode.kind === 'shoot') {
            // PLAN-15: WASD leans the soldier out of cover (one tile per press, camera-relative) while aiming.
            e.preventDefault();
            const now = performance.now(); if (e.repeat && now - (this.lastPeekKey || 0) < 180) return; this.lastPeekKey = now;
            if (this.canAct()) this.stepPeek(key);
            return;
        }
        if ((key === 'w' || key === 's') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (!e.repeat) this.changeLevel(key === 'w' ? 1 : -1); return; }
        if (['a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { e.preventDefault(); this.keys.add(key); return; }
        const u = this.selectedUnit();
        switch (key) {
            case 'q': this.scene.rotate(-1); break;
            case 'e': this.scene.rotate(1); break;
            case 'pageup': this.changeLevel(1); break;
            case 'pagedown': this.changeLevel(-1); break;
            // PLAN-14: targets are chosen with the reticle only; Tab always moves on to the next soldier.
            case 'tab': e.preventDefault(); if (this.mode.kind === 'shoot') this.cancel(); this.cycleUnit(e.shiftKey ? -1 : 1); break;
            case 'enter': case ' ': e.preventDefault(); if (this.mode.kind === 'shoot') this.confirmFire(); else if (key === 'enter') this.endTurn(); break;
            case 'backspace': case 'escape': this.cancel(); break;
            case 'h': case 'home': e.preventDefault(); this.focusUnit(u); this.focusFloor(u); break;
            case 'i': this.aimPointer.release();this.hud.equipment.toggle(); break;
            case 'v': this.scene.toggleProjection(); this.hud.toast(this.scene.projection === 'ortho' ? 'Camera: isometric' : 'Camera: perspective'); break;
            case 'o': this.setMode({ kind: 'overwatch' }); break;
            case 'r': if(this.hud.equipment.open&&this.hud.equipment.selected){this.hud.equipment.rotate();}else this.intent({ type: 'reload' }); break;
            case 't': if (u) { const id = Object.keys(u.items).find(k => u.items[k] > 0); if (id&& !THROWABLES[id].placed) this.setMode({ kind: THROWABLES[id].kind==='gadget'?'gadget':'throw', itemId: id }); } break;
            case 'f': this.hud.showFormationPanel(); break;
            case 'b': if (u && this.battle.breachPoints(u).length) this.hud.showBreachPanel(); break;
            default:
                if (/^[1-9]$/.test(key)) { if (!this.hud.pickPanelItem?.(+key)) this.hud.triggerSlot(+key); }
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
        const freePick=['mark','shoot'].includes(this.mode.kind);
        const hit=pickVisibleTile(store,from,to,{cutZ:top,buildingView:this.buildingView,preferredFloor:!freePick&&Number.isFinite(top)?top-3:null,reachable:freePick?null:this.search?.costs,origin:this.selectedUnit()});
        // Moving never needs the elevation cut: when the visible pick is not a destination (a roof, a wall face, an
        // upper floor), take the highest reachable floor along the same ray instead.
        if(this.mode.kind==='move'&&this.zones?.size&&!(hit?.cell&&this.zones.has(nodeKey(hit.cell)))){
            const through=pickReachableAlongRay(store,from,to,this.zones,{cutZ:top});
            if(through)return through;
        }
        return hit;
    }
    /** PLAN-12: the strike plane is the level in view: the visible floor under a storey cut, else the street. */
    strikePlaneY() { const G = this.battle.mission.meta?.streetDatum ?? 1; return Number.isFinite(this.cutLevel) ? this.cutLevel - 2 : G + 1; }
    /**
     * PLAN-12 strike targeting: where the cursor ray meets the flat plane of the level in view (not a walkable-floor
     * pick, which found nothing over roofs and walls). The tile's z is the highest surface in that column below the cut.
     */
    strikeCell(px, py) {
        const ray = this.scene.rayAt(px, py).ray, y = this.strikePlaneY(), s = this.battle.store;
        if (Math.abs(ray.direction.y) < 1e-4) return null;
        const t = (y - ray.origin.y) / ray.direction.y; if (t <= 0) return null;
        const x = Math.floor(ray.origin.x + ray.direction.x * t), cy = Math.floor(ray.origin.z + ray.direction.z * t);
        if (!s.inBounds(x, cy, 0)) return null;
        const cut = this.cutLevel, top = s.surfaces(x, cy).filter(q => q.z < cut - 1).at(-1)?.z ?? Math.max(0, s.topSolid(x, cy));
        return { x, y: cy, z: top };
    }
    unitAt(px, py) {
        const ray = this.scene.rayAt(px, py);
        const meshes = [...this.views.values()].filter(v => v.group.visible && alive(v.unit) && v.unit.z<this.cutLevel && (!this.levelLocked||!Number.isFinite(this.cutLevel)||v.unit.z>=this.cutLevel-3)).map(v => v.sprite);
        const hit = ray.intersectObjects(meshes, true)[0];
        return hit ? this.battle.unit(hit.object.userData.unitId) : null;
    }
    onHover(e) {
        if(this.mode.kind==='shoot'){
            if(this.canAct()&&!this.hud.equipment.open){
                if(this.aimPointer.locked)this.moveAim(e.movementX,e.movementY);
                else if(this.aimDrag){const p=this.aimDrag;this.moveAim(e.clientX-p.x,e.clientY-p.y);p.x=e.clientX;p.y=e.clientY;}
            }
            this.hud.cursorTip(null);return;
        }
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
        const ab = this.mode.kind === 'ability' ? ABILITIES[this.mode.abilityId] : null;
        if (ab && (ab.support || ab.commander)) this.hoverCell = this.strikeCell(e.clientX, e.clientY) || this.hoverCell;
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
                    const path = pathTo(this.search, k);
                    this.overlays.showPath(path, zone === 'yellow');
                    // PLAN-07: red "!" on the steps a known enemy overwatch covers.
                    const threats = this.battle.overwatchThreats(u, path);
                    this.overlays.showAlerts(threats);
                    const flanked = pv.ok && pv.cover === COVER.NONE && this.battle.enemiesOf(u).some(t => this.battle.visible?.has(t.id));
                    this.overlays.showCover(this.battle.store, c, { flanked, dark:this.battle.mission.meta.imageGenerated&&this.battle.light.dark(c.x,c.y,c.z) });
                    const coverText = pv.ok ? ['No cover', 'Half cover', 'Full cover'][Math.max(0, Math.min(2, pv.cover))] : '';
                    const dz = c.z - u.z;
                    const height = dz > 0 ? ` · <b class="up">▲ ${dz} up</b>` : dz < 0 ? ` · <b class="down">▼ ${-dz} down</b>` : '';
                    this.hud.cursorTip(e.clientX, e.clientY, `<b class="${zone}">${pv.ap ?? '?'} AP</b>${zone === 'yellow' ? ' · DASH' : ''}${threats.length ? ' · <b class="flank">! OVERWATCH</b>' : ''}${height}${this.battle.mission.meta.imageGenerated&&this.battle.light.dark(c.x,c.y,c.z)?' · ☾ DARK':''}<br><span>${flanked ? '<i class="flank">FLANKED</i>' : coverText}</span>`);
                } else {
                    this.overlays.clearPath(); this.overlays.showCover(this.battle.store, c);
                    this.hud.cursorTip(unit && unit.side !== u.side && this.isVisible(unit) ? e.clientX : null, e.clientY, unit ? `${unit.name} · ${unit.hp}/${unit.maxHp}<br><span>click a weapon to target</span>` : '');
                }
                break;
            }
            case 'mark':this.hud.cursorTip(e.clientX,e.clientY,`Click a block to mark ${this.mode.color} · click the same marker to clear`);break;
            case 'throw': {
                const c = this.hoverCell; if (!c) break;
                const t = THROWABLES[this.mode.itemId];
                const inRange = Math.hypot(c.x - u.x, c.y - u.y) <= t.range;
                // PLAN-15: the preview shows where it really goes off, the tiles and units in the blast, and the scatter.
                const key = `${u.id}:${t.id}:${c.x},${c.y},${c.z}:${this.battle.seq}`;
                if (this.throwPv?.key !== key) this.throwPv = { key, pv: this.battle.throwPreview(u, t.id, c) };
                const pv = this.throwPv.pv;
                this.overlays.showThrowPreview(pv, { inRange, unitPos: id => { const v = this.views.get(id); return v && (v.unit.side === 'player' || this.isVisible(v.unit)) ? v.pos.clone() : null; } });
                const seen = (pv?.units || []).filter(h => h.side === 'player' || this.isVisible(this.battle.unit(h.id)));
                const foes = seen.filter(h => h.side !== u.side).length, friends = seen.filter(h => h.side === u.side).length;
                this.hud.cursorTip(e.clientX, e.clientY, !inRange ? '<i class="flank">Out of range</i>'
                    : `${t.name} · ${t.ap} AP${pv?.smoke ? '' : ` · ${foes} enem${foes === 1 ? 'y' : 'ies'}`}${friends ? ` · <b class="flank">${friends} ALL${friends === 1 ? 'Y' : 'IES'} IN BLAST</b>` : ''}${pv?.scatter > 0.2 ? ` · scatter ±${pv.scatter.toFixed(1)}` : ''}${pv?.blocked ? '<br><b class="flank">HITS COVER — DETONATES AT THE ✕</b>' : ''}`);
                break;
            }
            case 'gadget': {const reason=this.battle.validate({type:'gadget',unitId:u.id,itemId:this.mode.itemId,cargo:this.mode.cargo,targetId:unit?.id,by:'*'});this.overlays.showAbilityTile(unit,!reason);this.hud.cursorTip(e.clientX,e.clientY,reason?`Medical kit · ${reasonText(reason)}`:'Click ally · heal 8 HP · 1 AP');break;}
            case 'ability': {
                const a = ABILITIES[this.mode.abilityId];
                const intent = {type:'ability', unitId:u.id, abilityId:a.id, to:this.hoverCell, targetId:unit?.id, by:'*'};
                const reason = this.battle.validate(intent);
                if((a.support||a.commander) && this.hoverCell)this.overlays.showStrikeArea(footprint(this.battle,a.id,this.hoverCell,u),!reason,this.strikePlaneY());   // PLAN-12: one flat rectangle at the viewed level
                else this.overlays.showAbilityTile(a.targeting === 'ally' ? unit : this.hoverCell, !reason);
                this.hud.cursorTip(e.clientX,e.clientY, reason ? `${a.name} · ${reasonText(reason)}` : `${a.name} · click to cast · ${a.ap} AP / ${a.wp} WP`);
                break;
            }
            case 'overwatch': {
                const sector = watchSector(u, this.hoverCell || p?.voxel, watchWeapon(u));
                this.overlays.setHover(null);
                this.overlays.showWatchPreview(this.battle,u,sector,{hidden:(x,y,z)=>this.voxelView.interiorVisibility.hiddenAt(x,y,z),cutZ:this.cutLevel});
                this.hud.cursorTip(e.clientX, e.clientY, sector ? `Click to watch · ${Math.round(sector.halfAngle*360/Math.PI)}° wedge · ${sector.range} tiles<br><span style="color:#5ff2d6">Teal ≥65%</span> · <span style="color:#ffb347">Amber &lt;65%</span> · estimated standing-target hit<br>Filled surfaces show aim quality; cover still blocks shots` : 'Choose a direction away from this soldier');
                break;
            }
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
            this.targetInfo = { key, target, part, byPart, anyHit: any, blocked, friendly, spread, mods, muzzle, lean, distance, cover, flanked: cover === COVER.NONE, ap: this.mode.suppress ? ABILITIES.suppress.ap : this.battle.shotAp(u, w), inRange: distance <= weaponBuild(u,w).maxRange };
        }
        // Target selection re-frames and zooms; body-part changes and free aim keep the current framing.
        const anchor=partCentre(target,part);this.freeAimManual=false;this.rawAim=null;this.lastTargetId=target.id;this.aimPick={unitId:target.id,part};
        if(frame||!this.aim.current||this.cameraDirector.phase!=='prepare'){this.aim.snap(anchor);this.freeAim={...anchor};this.frameAim(u,anchor);}
        else this.aim.setTarget(anchor);
        if(frame)this.cameraDirector.focusTarget(new THREE.Vector3(anchor.x,anchor.h,anchor.y));
        this.targetInfo.part = part;
        this.overlays.showCone(this.targetInfo.muzzle, partCentre(target, part), this.targetInfo.spread);
        if (frame && this.options.followCamera) this.scene.glideTo(new THREE.Vector3((u.x + target.x) / 2 + 0.5, (u.z + target.z) / 2 + 1, (u.y + target.y) / 2 + 0.5), 4);
        if (frame) this.focusFloor(u, target);
        this.hud.renderTarget();
    }
    /**
     * Update the direct aim point and shoulder camera. The character stays on its world cell.
     */
    stepAim(dt){
        const u=this.selectedUnit();
        if(!u||this.mode.kind!=='shoot'||!this.aim.current)return;
        const w=WEAPONS[this.mode.weaponId],origin=this.aimOrigin(u);
        const p=this.aim.step(dt,{tau:aimTau(u,w),sway:this.options.aimSway?swayDegrees(u):0,origin,inertia:false});
        if(!p)return;
        this.freeAim=p;
        // Blocked angles: the shot steps out to a side tile (shared chooseMuzzle); the shoulder camera and the reticle
        // follow it, so the view is from where the soldier will actually fire and not into the wall.
        const st=this.aimStance;
        if(!st||st.unitId!==u.id||Math.hypot(p.x-st.at.x,p.y-st.at.y,p.h-st.at.h)>0.25){
            const m=this.aimMuzzle(u,p);
            if(!st||st.unitId!==u.id||aimStanceKey(m)!==st.key)this.frameAim(u,p,m);
            else {Object.assign(st,{at:{...p},muzzle:m,side:m.side||'right',blocked:shotBlocked(this.battle.store,m,p)});this.cutins.beginAim(u,{shoulder:st.side,weaponId:this.mode.weaponId});}
        }
        this.views.get(u.id)?.face(p.x-origin.x,p.y-origin.y);
        if(this.cameraDirector.phase==='prepare')this.cameraDirector.track(new THREE.Vector3(p.x,p.h,p.y),dt);
        // PLAN-10: the aim line and cone follow the live aim from the muzzle the shot will actually leave from.
        this.coneT=(this.coneT||0)+dt;
        const m=this.aimStance?.muzzle,key=m&&`${aimStanceKey(m)}:${p.x.toFixed(1)},${p.y.toFixed(1)},${p.h.toFixed(1)}`;
        if(m&&key!==this.coneKey&&this.coneT>=0.06){
            this.coneKey=key;this.coneT=0;
            const t=this.aimTargetNear(p),spread=this.battle.spreadFor(this.shooterOf(u),w,p,{target:t}).spread;
            this.overlays.showCone(m,p,spread);
            if(this.targetInfo)this.targetInfo.spread=spread;
        }
    }
    /** PLAN-14: hit chance for the body part under the reticle (cached per stance, target position and battle step). */
    partChance(t,part){
        const u=this.selectedUnit(),w=WEAPONS[this.mode.weaponId];if(!u||!t||!w)return null;
        const key=`${u.id}:${this.peek?`${this.peek.x},${this.peek.y}`:'home'}:${aimStanceKey(this.aimStance?.muzzle||{})}:${t.id}:${t.x},${t.y},${t.z}:${part}:${w.id}:${this.battle.seq}`;
        if(this.partChanceCache?.key===key)return this.partChanceCache.value;
        const s=this.shooterOf(u),{spread}=this.battle.spreadFor(s,w,partCentre(t,part),{target:t});
        const est=estimateShot(this.battle,s,{unitId:t.id,part},{weapon:w,spread,samples:48});
        const value={part:Math.round((est.partHit??0)*100),any:Math.round((est.hit??0)*100)};
        this.partChanceCache={key,value};return value;
    }
    /** The shot's origin for aiming: the current stance muzzle (lean or step-out), else the shoulder on the unit's tile. */
    aimOrigin(u){const m=this.aimStance?.unitId===u.id?this.aimStance.muzzle:null,s=this.shooterOf(u);return m?{x:m.x,y:m.y,h:m.h}:{x:s.x+.5,y:s.y+.5,h:s.z+2.35};}
    /** PLAN-15: the shooter as it stands for this shot — on its peek tile while peeking. */
    shooterOf(u){return this.peek&&this.mode.kind==='shoot'?atCell(u,this.peek):u;}
    /** The visible hostile whose body the aim point sits on (for target-dependent spread: smoke, darkness, height). */
    aimTargetNear(p){const u=this.selectedUnit();return u&&p?aimedUnit(this.battle,u,p,t=>this.isVisible(t)):null;}
    /** Where a shot at `p` would leave from (lean or step-out), as the battle will resolve it. */
    aimMuzzle(u,p){const s=this.shooterOf(u);return chooseMuzzle(this.battle.store,s,p,{occupied:occupiedBy(this.battle,u)});}
    /**
     * Frame the aiming shoulder camera for a shot at `p`: from the step-out tile when the angle is blocked, so the view
     * (and the reticle) look past the wall at the target, as in XCOM 2. The camera keeps the same shoulder and the
     * character stays on its occupied cell. Its world sprite flips toward the reticle.
     */
    frameAim(u,p,m=this.aimMuzzle(u,p)){
        const s=this.shooterOf(u),side=this.peekSide||m.side||'right',o=m.step?new THREE.Vector3(m.step.x+.5,s.z+1,m.step.y+.5):new THREE.Vector3(s.x+.5,s.z+1,s.y+.5);
        this.aimStance={unitId:u.id,key:aimStanceKey(m),side,muzzle:m,at:{...p},blocked:shotBlocked(this.battle.store,m,p)};
        this.cutins.beginAim(u,{shoulder:side,weaponId:this.mode.weaponId});
        this.cameraDirector.prepareAim(o,new THREE.Vector3(p.x,p.h,p.y),{side});
    }
    /** Pointer-lock deltas never stop at the browser edge or feed back through the moving camera. */
    moveAim(dx,dy){
        const u=this.selectedUnit();if(!u||(!dx&&!dy))return;
        // The raw (unsnapped) aim keeps moving with the mouse, so the reticle can leave a sticky target again.
        const focus=this.rawAim||this.aim.target||this.freeAim;if(!focus)return;
        const origin=this.aimOrigin(u);
        const assist=this.options.aimAssist||'light',visible=t=>this.isVisible(t);
        // PLAN-15 light assist: friction near a visible hostile (slower mouse), never a snap.
        const friction=assist==='light'&&this.battle?.store?aimFriction(this.battle,u,origin,focus,{filter:visible}):1;
        const step=aimDelta(focus,origin,dx,dy,{fov:this.cameraDirector.cam.fov,height:this.scene.renderer.domElement.clientHeight||innerHeight,sensitivity:(this.options.aimSensitivity??.5)*friction});
        // PLAN-10: put the aim on whatever the crosshair line meets, so near and far targets line up with the shot.
        if(step){
            const w=WEAPONS[this.mode.weaponId]?weaponBuild(u,WEAPONS[this.mode.weaponId]):null;
            // PLAN-11: the reticle sticks to a visible enemy's body part when the line passes close to it, so it settles
            // on the enemy rather than the wall or cover beside them; otherwise it lands on whatever the line meets.
            this.rawAim=step;
            const stick=assist==='strong'&&this.battle?.store?stickyAim(this.battle,this.shooterOf(u),origin,step,{filter:visible}):null;
            if(stick){this.aimPick={unitId:stick.unit.id,part:stick.part};this.aim.setTarget(stick.point);this.lastTargetId=stick.unit.id;}
            else {
                // PLAN-15: the body part is whatever hitbox the line passes through; the aim point stays where the mouse put it.
                const under=this.battle?.store?partUnderRay(this.battle,u,origin,step,{filter:visible}):null;
                this.aimPick=under?{unitId:under.unit.id,part:under.part}:null;if(under)this.lastTargetId=under.unit.id;
                this.aim.setTarget(this.battle?.store?resolveAimPoint(this.battle,u,origin,step,(w?.maxRange??40)+12):step);
            }
            this.freeAimManual=true;
        }
    }
    /** PLAN-15: lean to the neighbouring peek tile in the camera-relative WASD direction (or back toward home). */
    stepPeek(key){
        const u=this.selectedUnit();if(!u||this.mode.kind!=='shoot')return;
        const cam=this.cameraDirector.active?this.cameraDirector.cam:this.scene.camera,f=new THREE.Vector3();cam.getWorldDirection(f);
        const next=peekStep(this.battle,u,this.peek||{x:u.x,y:u.y,z:u.z},key,{x:f.x,y:f.z});
        if(next===undefined){this.hud.toast('No room to lean that way','warn');return;}
        this.setPeek(next&&(next.x!==u.x||next.y!==u.y)?next:null);
    }
    /** PLAN-15: set or clear the peek tile; the sprite glides there and the aim camera re-frames from it. */
    setPeek(cell,{reframe=true}={}){
        const u=this.selectedUnit(),prev=this.peek;if(!cell&&!prev&&!reframe)return;this.peek=cell||null;this.peekInfo=null;
        if(u){
            this.peekSide=null;
            if(cell){const f=new THREE.Vector3();this.cameraDirector.cam.getWorldDirection(f);const rx=-f.z,ry=f.x,d=(cell.x-u.x)*rx+(cell.y-u.y)*ry;this.peekSide=d<-0.2?'left':d>0.2?'right':null;}
            const v=this.views.get(u.id),to=cell||u;
            if(v){const from=v.pos.clone();this.peekGlide={view:v,from,to:new THREE.Vector3(to.x+.5,to.z+1,to.y+.5),t:0,dur:0.14};}
            if(reframe&&this.mode.kind==='shoot'&&this.freeAim&&(prev?.x!==cell?.x||prev?.y!==cell?.y)){this.aimStance=null;this.frameAim(u,this.freeAim);}
        }
        this.hud.renderTarget?.();
    }
    /** PLAN-15: cover / overwatch read-out for the current peek tile (cached per tile and battle step). */
    peekStatus(){
        const u=this.selectedUnit();if(!u||this.mode.kind!=='shoot')return null;
        const c=this.peek||{x:u.x,y:u.y,z:u.z},key=`${u.id}:${c.x},${c.y},${c.z}:${this.battle.seq}`;
        if(this.peekInfo?.key!==key)this.peekInfo={key,peeking:!!this.peek,range:B.peekRange??1,...peekExposure(this.battle,u,c)};
        return this.peekInfo;
    }
    captureAim(){if(this.mode.kind==='shoot'&&!this.hud.equipment.open)this.aimPointer.request();}
    onClick(e) {
        if (!this.battle || this.dragging?.moved || this.hud.equipment.open) return;
        if(this.mode.kind==='shoot'&&!this.debug.tool){
            if(!this.canAct()||!this.controllable(this.selectedUnit()))return;
            if(!this.aimPointer.locked){if(!this.aimPointer.unavailable)this.captureAim();return;}
            this.confirmFire();return;
        }
        const unit = this.unitAt(e.clientX, e.clientY);
        const p = this.pick(e.clientX, e.clientY);
        if (this.debug.tool) { this.debug.click(p, unit, e); return; }
        const u = this.selectedUnit();
        if (u && unit && unit !== u && e.shiftKey && this.mode.kind === 'move' && this.battle.formations.of(u) && this.battle.formations.of(u) === this.battle.formations.of(unit)) {
            const asg = this.battle.formations.assignmentsOf(this.battle.formations.of(u));   // Shift+click a squadmate in your formation: trade places
            this.intent({ type: 'formation_swap', slot: asg[unit.id] }); return;
        }
        if (unit && (unit.side === 'player' || this.controllable(unit)) && alive(unit) && unit.side === (u?.side ?? unit.side) && (this.mode.kind === 'move' || !u)) { this.select(unit.id); return; }
        if (!u || !this.canAct() || !this.controllable(u)) return;
        switch (this.mode.kind) {
            case 'move': {
                const c = p?.cell;
                if (unit && unit.side !== u.side && this.isVisible(unit)) { this.targetById(unit.id); break; }
                { const slot = this.formationSlotAt(u, c); if (slot >= 0) { this.intent({ type: 'formation_swap', slot }); break; } }
                if(c&&this.zones?.has(nodeKey(c))){const key=nodeKey(c);if(this.options.confirmMoves&&this.moveConfirmation!==key){this.moveConfirmation=key;this.hud.toast('Click the destination again to move');break;}const f=this.battle.formations.of(u);this.intent({type:'move',to:c,group:!!f&&!f.assembling&&f.leaderId===u.id});}
                break;
            }
            case 'mark':if(p?.voxel)this.intent({type:'mark',color:this.mode.color,at:p.voxel});break;
            case 'melee': if (unit && unit.side !== u.side) this.intent({ type: 'melee', weaponId: this.mode.weaponId, targetId: unit.id, part: 'torso' }); break;
            case 'throw': if (p?.cell) this.intent({ type: 'throw', itemId: this.mode.itemId, cargo:this.mode.cargo, to: p.cell }); break;
            case 'gadget': this.intent({type:'gadget',itemId:this.mode.itemId,cargo:this.mode.cargo,targetId:unit?.id});break;
            case 'ability': this.intent({type:'ability',abilityId:this.mode.abilityId,to:this.hoverCell,targetId:unit?.id}); break;
            case 'overwatch': { const toward = p?.cell || p?.voxel; if(toward) this.intent({ type: 'overwatch', weaponId: watchWeapon(u), toward: {x:toward.x,y:toward.y} }); break; }
        }
    }
}

/** The aiming camera re-frames only when the tile the shot leaves from changes (a step out or back), not on leans. */
export function aimStanceKey(m){return m.step?`${m.step.x},${m.step.y}`:`tile:${Math.floor(m.x??0)},${Math.floor(m.y??0)}`;}
/** True when the straight line from the muzzle to the aim point meets a bullet-stopping voxel before it. */
export function shotBlocked(store,m,p){const r=castRay(store,m,p);return !!r.hit&&r.t<r.length-0.3;}

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
