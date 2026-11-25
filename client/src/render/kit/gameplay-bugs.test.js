// Regression tests for the two reported gameplay bugs:
// 1) Clicking a reachable move tile adjacent to an ally moves there instead of selecting the neighbor ally.
// 2) Shooting down an enemy Search Drone (animator: null) does not throw or lock actionPending/followup aiming.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Battle } from '../../../../shared/battle/Battle.js';
import { VoxelStore, CHUNK } from '../../../../shared/voxel/VoxelStore.js';
import { MAT, AIR } from '../../../../shared/voxel/Materials.js';
import { destroyVoxel } from '../../../../shared/voxel/Destruction.js';
import { MAPS } from '../../../../shared/mission/Maps.js';
import { nodeKey } from '../../../../shared/world/PathSearch.js';
import { WEAPONS } from '../../../../shared/content/weapons.js';
import { partCentre } from '../../../../shared/battle/Ballistics.js';
import { Game } from '../../Game.js';
import { EventPlayer } from '../../anim/EventPlayer.js';
import { Hud } from '../../ui/Hud.js';
import { KitView } from './KitView.js';
import { buildAllPieces } from './KitPieces.js';
import { BuildingView } from '../BuildingView.js';
import { VoxelView } from '../VoxelView.js';
import { unitCutLevel } from '../FloorCutaway.js';

function droneArena() {
    const store = new VoxelStore(28, 28, 12);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    return new Battle({
        mission: { id: 'bug-arena', store, rooms: [], buildings: [], spawns: { player: [{ x: 10, y: 16, z: 1 }, { x: 12, y: 16, z: 1 }], enemy: [] } },
        squad: [{ type: 'grenadier' }, { type: 'marksman' }],
        enemies: [
            { type: 'search_drone', drone: true, pos: { x: 10, y: 11, z: 1 }, group: 1, alerted: true },
            { type: 'cultist', pos: { x: 12, y: 9, z: 1 }, group: 1, alerted: true }
        ],
        seed: 4
    });
}

test('Bug #1: clicking a reachable move tile near an ally moves instead of selecting that ally; clicking on the ally selects it', () => {
    const u0 = { id: 'p0', side: 'player', x: 10, y: 16, z: 1, dead: false, ap: 4, moveOnlyAp: 0, hp: 30, maxHp: 30 };
    const u1 = { id: 'p1', side: 'player', x: 12, y: 16, z: 1, dead: false, ap: 4, moveOnlyAp: 0, hp: 30, maxHp: 30 };
    const tileNextToAlly = { x: 11, y: 16, z: 1 };
    const allyTile = { x: 12, y: 16, z: 1 };

    let pickCell = tileNextToAlly;
    let pickPoint = new THREE.Vector3(11.85, 2.5, 16.5);
    const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
    camera.position.set(11.85, 20, 30);
    camera.lookAt(11.85, 2, 16.5);
    camera.updateMatrixWorld();

    const hoveredArgs = [];
    const actions = [];
    const fakeStore = { get: () => 0 };

    const g = {
        battle: {
            store: fakeStore,
            formations: { of: () => null },
            preview: () => ({ ok: true, ap: 1, cover: 1 }),
            overwatchThreats: () => [],
            enemiesOf: () => [],
            visible: new Set(),
            mission: { meta: {} }
        },
        mode: { kind: 'move' },
        dragging: null,
        hud: { equipment: { open: false }, cursorTip() {}, toast() {} },
        debug: { tool: null, onHover() {}, click() {} },
        options: { confirmMoves: false },
        zones: new Map([[nodeKey(tileNextToAlly), 'blue']]),
        search: { nodes: new Map([[nodeKey(tileNextToAlly), tileNextToAlly]]), parents: new Map([[nodeKey(tileNextToAlly), null]]) },
        selected: u0.id,
        cutLevel: 99,
        levelLocked: false,
        views: new Map([
            ['p0', { group: { visible: true }, unit: u0, setHovered: v => hoveredArgs.push(['p0', v]) }],
            ['p1', { group: { visible: true }, unit: u1, setHovered: v => hoveredArgs.push(['p1', v]) }]
        ]),
        overlays: { setHover() {}, clearPath() {}, showPath() {}, showAlerts() {}, showCover() {}, clearRange() {} },
        scene: {
            rayAt: () => {
                // Cast ray passing near p1 hitbox at (12.5, 16.5) while ground cell pick is tileNextToAlly (11,16,1)
                const origin = new THREE.Vector3(pickPoint.x, 12, pickPoint.z + 10);
                const target = pickPoint.clone();
                const direction = target.sub(origin).normalize();
                return { ray: { origin, direction }, intersectObjects: () => [] };
            }
        },
        selectedUnit: () => g.selected === 'p0' ? u0 : u1,
        canAct: () => true,
        controllable: () => true,
        pick: () => ({ cell: pickCell }),
        unitAt(px, py, hint) { return Game.prototype.unitAt.call(this, px, py, hint); },
        formationSlotAt: () => -1,
        pathFor: () => [u0, tileNextToAlly],
        select(id) { actions.push({ type: 'select', id }); g.selected = id; },
        intent(i) { actions.push(i); }
    };

    // Case A: Ray grazes ally billboard/edge box, but cursor cell (11,16,1) is a valid reachable move zone
    g.onClick = e => Game.prototype.onClick.call(g, e);
    g.onClick({ clientX: 500, clientY: 400, shiftKey: false });
    assert.equal(actions[0]?.type, 'move', 'clicking reachable blue tile near ally moves instead of switching selection');
    assert.deepEqual(actions[0]?.to, tileNextToAlly);
    assert.equal(g.selected, 'p0', 'active character stayed selected');

    // Case B: Hover over reachable tile near ally does not light up ally hover ring
    g.onHover = e => Game.prototype.onHover.call(g, e);
    g._hoverAllyId = 'p1';
    g.onHover({ clientX: 500, clientY: 400 });
    assert.equal(g._hoverAllyId, null, 'ally hover ring cleared on reachable move destination');

    // Case C: Clicking directly on the ally's occupied tile (not in move zones) switches selection to ally
    actions.length = 0;
    pickCell = allyTile;
    pickPoint = new THREE.Vector3(12.5, 2.8, 16.5);
    g.onClick({ clientX: 520, clientY: 400, shiftKey: false });
    assert.deepEqual(actions[0], { type: 'select', id: 'p1' }, 'clicking directly on ally tile selects that ally');
});

test('Bug #2: killing a Search Drone (animator: null) settles cleanly and allows immediate follow-up shooting', async () => {
    const b = droneArena();
    const u = b.unit('p0');
    const drone = b.units.find(x => x.drone && x.side === 'enemy');
    const cultist = b.units.find(x => !x.drone && x.side === 'enemy');
    assert.ok(drone && cultist);

    // Lower drone HP so one shot guarantees lethal death event
    drone.hp = 1;
    drone.parts.torso.hp = 1;

    let hudRefreshes = 0, targetRefreshes = 0;
    let settled = false;
    const stubAnimator = { play() {} };
    const stubMesh = { position: { copy() {}, lerp() {}, set() {} }, visible: true, scale: { setScalar() {}, set() {} } };

    const views = new Map(b.units.map(unit => [
        unit.id,
        {
            unit,
            animator: unit.drone ? null : stubAnimator,
            group: { ...stubMesh },
            snap() {},
            drawBar() {},
            flash() {},
            flashStatus() {},
            face() {},
            worldPosition() { return new THREE.Vector3(unit.x + 0.5, unit.z + 1, unit.y + 0.5); },
            aimAt() {},
            stepOut() {},
            stepBack() {}
        }
    ]));

    const g = {
        battle: b,
        views,
        actionPending: false,
        aiRunning: false,
        discoveryVisible: new Set(),
        sightings: new Map(),
        mode: { kind: 'shoot', weaponId: 'repeater', fireMode: 'single' },
        selected: u.id,
        framedTargetId: drone.id,
        aimPick: { unitId: drone.id, part: 'torso' },
        aimTelemetryCache: new Map(),
        partChanceCache: new Map(),
        session: { submit(intent) { return b.apply(intent); } },
        scene: { flash() {}, shake() {}, hitStop() {} },
        audio: new Proxy({}, { get: () => () => {} }),
        fx: new Proxy({}, { get: () => () => {} }),
        cameraDirector: {
            beginAction() {},
            commitAim() {},
            completeAction: () => Promise.resolve(),
            focus() {},
            snap() {},
            phase: 'prepare'
        },
        cutins: null,
        voxelView: { flush() { return false; }, interiorVisibility: { hiddenAt: () => false } },
        lanterns: { scan() {} },
        overlays: { clearAll() {}, clearPath() {}, clearRange() {}, showCover() {}, showAlerts() {}, showPath() {}, setHover() {}, showOverwatch() {}, showObjective() {} },
        hud: {
            equipment: { open: false },
            refresh() { hudRefreshes++; this.renderTargets(); this.renderTarget(); },
            renderTargets() { targetRefreshes++; },
            renderTarget() { targetRefreshes++; },
            cursorTip() {},
            toast() {},
            autoEndBar() {}
        },
        debug: { refresh() {} },
        cancelAutoEnd() {},
        setLevel() {},
        onOutcome() {},
        afterUnitAction() {},
        updateEnemyVisibility() {},
        refreshZones() {},
        refreshRange() {},
        applyCutForUnit() {},
        updateReticle() {},
        isVisible: () => true,
        selectedUnit: () => b.unit(g.selected),
        canAct() { return Game.prototype.canAct.call(this); },
        controllable: unit => unit?.side === 'player',
        visibleTargets: () => b.enemiesOf(u).filter(t => !t.dead),
        aimOrigin: unit => ({ x: unit.x + 0.5, y: unit.y + 0.5, h: unit.z + 2.4 }),
        aimMuzzle: (unit, pt) => ({ x: unit.x + 0.5, y: unit.y + 0.5, h: unit.z + 2.4 }),
        defaultAimPoint: unit => ({ x: unit.x + 0.5, y: unit.y - 4.5, h: unit.z + 2 }),
        aim: { snap() {}, clear() {} },
        frameAim() {},
        updateAimPick() {},
        enterTargeting() { Game.prototype.enterTargeting.call(this); },
        setMode(m) {
            this.mode = m;
            this.aimPick = null;
            this.framedTargetId = null;
            this.aimTelemetryCache = null;
            if (m.kind === 'shoot') this.enterTargeting();
        },
        settleViews() { settled = true; Game.prototype.settleViews.call(this); },
        freeAim: { x: drone.x + 0.5, y: drone.y + 0.5, h: drone.z + 2.8 }
    };
    g.player = new EventPlayer(g);

    const p1 = Game.prototype.intent.call(g, {
        type: 'shoot',
        unitId: u.id,
        weaponId: 'repeater',
        fireMode: 'single',
        aim: { point: partCentre(drone, 'torso') }
    });
    await p1;

    assert.ok(drone.dead, 'Search Drone was destroyed cleanly');
    assert.ok(settled, 'settleViews ran cleanly even with drone.animator === null');
    assert.equal(g.actionPending, false, 'actionPending returned to false (not locked)');
    assert.equal(g.player.busy, false, 'EventPlayer queue unlocked');
    assert.notEqual(g.framedTargetId, drone.id, 'dead drone cleared from framedTargetId');
    assert.equal(g.framedTargetId, cultist.id, 'targeting automatically shifted to surviving hostile');
    assert.ok(hudRefreshes > 0 && targetRefreshes > 0);
    assert.equal(g.canAct(), true, 'player can immediately act again after killing drone');

    // Immediately fire follow-up shot at surviving cultist with continuousAim enabled (cameraDirector.phase === 'prepare')
    g.cameraDirector.aimContinuity = true;
    g.cameraDirector.aimUnitId = u.id;
    assert.ok(u.ap >= b.shotAp(u, WEAPONS.repeater), 'soldier still has AP for follow-up shot');
    const hpBefore = cultist.hp;
    const p2 = Game.prototype.intent.call(g, {
        type: 'shoot',
        unitId: u.id,
        weaponId: 'repeater',
        fireMode: 'burst',
        aim: { unitId: cultist.id, part: 'torso' }
    });
    await p2;
    assert.equal(g.actionPending, false, 'follow-up shot resolved cleanly');
    assert.ok(cultist.hp < hpBefore || u.ammo.repeater < 29, 'follow-up shot actually fired and spent ammo');
});

test('fog-hidden enemy moves snap immediately without awaiting walk loops and enemy ballistic cut-ins stay live', async () => {
    const snaps = [];
    let vis = null;
    let cutinPlayed = 0;
    const enemy = { id: 'e0', side: 'enemy', x: 2, y: 2, z: 1, weapons: ['musket'], weapon: 'musket' };
    const view = {
        id: 'e0',
        unit: enemy,
        group: { scale: { y: 1 } },
        animator: { play() {} },
        face() {},
        setCell(x, y, z) { snaps.push({ x, y, z }); },
        setVisible(v) { vis = v; }
    };
    const g = {
        fog: true,
        discoveryVisible: new Set(),
        battle: { unit: id => (id === 'e0' ? enemy : null), unitsOf: () => [] },
        views: new Map([['e0', view]]),
        voxelView: { flush() {}, interiorVisibility: { hiddenAt: () => false } },
        fx: new Proxy({}, { get: () => () => {} }),
        audio: new Proxy({}, { get: () => () => {} }),
        hud: { log() {}, banner() {}, refresh() {} },
        options: { followCamera: false },
        cutins: { async play() { cutinPlayed++; } },
        isVisible: () => true,
        focusUnit() {},
        focusFloor() {},
        settleViews() {}
    };
    const player = new EventPlayer(g);
    const t0 = performance.now();
    await player.play({
        t: 'move',
        unitId: 'e0',
        path: [{ x: 2, y: 2, z: 1 }, { x: 5, y: 2, z: 1 }, { x: 8, y: 8, z: 1 }]
    });
    const elapsed = performance.now() - t0;
    assert.equal(snaps.length, 1, 'snaps directly to destination');
    assert.deepEqual(snaps[0], { x: 8, y: 8, z: 1 });
    assert.equal(vis, false, 'remains hidden in fog');
    assert.ok(elapsed < 80, `instant snap completed in ${elapsed.toFixed(1)}ms`);

    await player.play({ t: 'cutin', unitId: 'e0', weaponId: 'musket', kind: 'shot', targetIds: [] });
    assert.equal(cutinPlayed, 0, 'routine enemy shot does not trigger blocking 2D cut-in');
});

test('UX flow: clicking a visible enemy in move mode aims directly or warns when empty/spent; Finish soldier sits last in slotsFor', () => {
    const b = droneArena();
    const u = b.unit('p0'), enemy = b.unit('e1');
    const aimed = [];
    const toasts = [];
    const g = {
        battle: b,
        mode: { kind: 'move' },
        selected: u.id,
        zones: new Map(),
        search: null,
        dragging: null,
        debug: { tool: null, manualEnemy: false },
        hud: { equipment: { open: false }, toast(msg) { toasts.push(msg); } },
        actionPending: false,
        aiRunning: false,
        session: { local: true },
        player: { idle: () => true },
        selectedUnit: () => u,
        canAct: () => true,
        controllable: unit => unit?.side === 'player',
        isVisible: () => true,
        pick: () => ({ cell: { x: enemy.x, y: enemy.y, z: enemy.z } }),
        unitAt: () => enemy,
        nearestDoor: () => null,
        formationSlotAt: () => -1,
        setMode(m) { this.mode = m; },
        aimAtTarget(id) { aimed.push(id); },
        intent() {}
    };

    Game.prototype.onClick.call(g, { clientX: 400, clientY: 300, shiftKey: false });
    assert.deepEqual(aimed, [enemy.id], 'clicking a visible hostile in move mode frames shoulder aim on it');

    // Empty weapon gives clear reload prompt
    u.ammo[u.weapon] = 0;
    Game.prototype.onClick.call(g, { clientX: 400, clientY: 300, shiftKey: false });
    assert.match(toasts.at(-1), /reload/i);

    // Out of AP gives clear AP warning
    u.ammo[u.weapon] = 9;
    u.ap = 0;
    Game.prototype.onClick.call(g, { clientX: 400, clientY: 300, shiftKey: false });
    assert.match(toasts.at(-1), /AP/i);

    // slotsFor puts Finish soldier at the very end, after tactical/commander abilities
    u.ap = 4;
    const slots = Hud.prototype.slotsFor.call({ game: g }, u);
    assert.equal(slots.at(-1).act, 'wait');
    assert.equal(slots.at(-1).name, 'Finish soldier');
});

test('destroying a tree voxel prevents KitView from redrawing the intact whole tree piece (no tree regrowth)', () => {
    const pieces = buildAllPieces();
    const fakeKit = { piece: id => { id = id.replace(/@sharp$/, ''); return pieces.get(id) || pieces.get(`${id}#0`); }, material: () => new THREE.MeshBasicMaterial() };
    const m = MAPS.find(d => d.id === 'cedar-close').build({ seed: 1 });
    const entry = Object.entries(m.visual.hints).find(([, h]) => h.tree && h.cells?.length > 1);
    assert.ok(entry, 'cedar-close has a tree hint');
    const [ak, tree] = entry;
    const nonAnchor = tree.cells.find(c => c !== ak && m.store.get(...c.split(',').map(Number)) !== AIR);
    assert.ok(nonAnchor, 'tree has a foliage/non-anchor cell');

    const s2 = m.store.clone();
    const [fx, fy, fz] = nonAnchor.split(',').map(Number);
    destroyVoxel(s2, fx, fy, fz);
    const view = new KitView(fakeKit, []);
    view.setVisual(m.visual);

    const [ax, ay, az] = ak.split(',').map(Number);
    const cx = Math.floor(ax / CHUNK), cy = Math.floor(ay / CHUNK), cz = Math.floor(az / CHUNK);
    const meshes = view.buildChunk(s2, cx, cy, cz, { cutZ: Infinity });
    const wholeTreeGeos = new Set((pieces.get(tree.piece) || []).map(p => p.geometry));
    const drawnWholeTree = meshes.some(mesh => wholeTreeGeos.has(mesh.geometry));
    assert.equal(drawnWholeTree, false, 'scarred/damaged tree renders surviving fragments instead of the intact tree mesh');
});

test('BuildingView.lastChanged and VoxelView.rebuildBoxes only rebuild chunks around changed buildings', () => {
    const store = new VoxelStore(36, 20, 8);
    store.fill(0, 0, 0, 35, 19, 1, 'concrete');
    const b1 = { id: 'west', x0: 2, y0: 4, w: 6, d: 6, baseZ: 1, storeys: 2, top: 7 };
    const b2 = { id: 'east', x0: 24, y0: 4, w: 6, d: 6, baseZ: 1, storeys: 2, top: 7 };
    const bv = new BuildingView({ store, buildings: [b1, b2] });

    assert.ok(bv.update({ unit: { x: 1, y: 6, z: 1 }, mode: 'auto', cutZ: Infinity }));
    assert.deepEqual(bv.lastChanged.map(b => b.id), ['west']);

    const rebuilt = [];
    const vvStub = {
        store,
        deps: new Map(),
        rebuild(k) { rebuilt.push(k); },
        refreshConcealment() {},
        rebuildAll() { throw Error('should not rebuild whole map'); }
    };
    VoxelView.prototype.rebuildBoxes.call(vvStub, bv.lastChanged);
    assert.ok(rebuilt.length > 0, 'rebuilt chunks around changed building');
    assert.ok(rebuilt.every(k => Number(k.split(',')[0]) <= 1), `did not rebuild distant east building chunks (${rebuilt})`);
});

test('fog-hidden enemy shots/throws/deaths skip animation holds and elevated enemy cutin keeps target storey', async () => {
    const enemy = { id: 'e0', side: 'enemy', x: 2, y: 2, z: 7, weapons: ['shortbow'], weapon: 'shortbow' };
    const squad = { id: 'p0', side: 'player', x: 20, y: 20, z: 1, weapons: ['repeater'], weapon: 'repeater' };
    const focusFloorCalls = [];
    let tracerCalls = 0;
    const g = {
        fog: true,
        discoveryVisible: new Set(),
        battle: {
            unit: id => (id === 'e0' ? enemy : id === 'p0' ? squad : null),
            unitsOf: s => (s === 'player' ? [squad] : [enemy])
        },
        views: new Map([
            ['e0', { id: 'e0', unit: enemy, group: { scale: { y: 1 } }, animator: { play() {} }, drawBar() {}, worldPosition: () => new THREE.Vector3(2.5, 8, 2.5) }],
            ['p0', { id: 'p0', unit: squad, group: { scale: { y: 1 } }, animator: { play() {} }, drawBar() {}, worldPosition: () => new THREE.Vector3(20.5, 2, 20.5) }]
        ]),
        voxelView: { flush() {} },
        fx: { tracer() { tracerCalls++; }, flash() {}, impact() {}, defeat() {}, float() {}, syncField() {} },
        audio: new Proxy({}, { get: () => () => {} }),
        hud: { log() {}, banner() {}, refresh() {} },
        options: { followCamera: true },
        cutins: { async play() {} },
        isVisible: u => u.id === 'p0',
        focusUnit() {},
        focusFloor(...args) { focusFloorCalls.push(args); },
        settleViews() {}
    };
    const player = new EventPlayer(g);
    const t0 = performance.now();
    await player.play({ t: 'shot', unitId: 'e0', weaponId: 'shortbow', muzzle: { x: 2.5, y: 2.5, h: 9 }, aim: { x: 8, y: 8, h: 9 }, rounds: 1, projectiles: [{ to: { x: 8, y: 8, h: 9 }, kind: 'none' }] });
    await player.play({ t: 'throw', unitId: 'e0', points: [{ x: 2.5, y: 2.5, h: 9 }, { x: 5.5, y: 5.5, h: 8 }] });
    await player.play({ t: 'death', unitId: 'e0' });
    const elapsed = performance.now() - t0;
    assert.equal(tracerCalls, 0, 'no off-screen tracers spawned for hidden enemy shot');
    assert.ok(elapsed < 60, `hidden enemy actions resolved immediately in ${elapsed.toFixed(1)}ms`);

    await player.play({ t: 'cutin', unitId: 'e0', targetIds: ['p0'], weaponId: 'shortbow', kind: 'breach' });
    assert.equal(focusFloorCalls.length, 1);
    assert.deepEqual(focusFloorCalls[0].map(u => u?.id), ['p0'], 'cutin focuses targeted player floor instead of elevated shooter');
});

test('throw/overwatch picking reaches street tiles from Floor 2 (cutLevel = 7) and throwCell resolves obstacles/units', () => {
    const store = new VoxelStore(20, 20, 12);
    store.fill(0, 0, 0, 19, 19, 1, 'concrete');
    for (let y = 10; y <= 16; y++) for (let x = 10; x <= 16; x++) {
        store.setKey(x, y, 4, 'oak_floor');
        store.setKey(x, y, 7, 'roof');
    }
    store.setKey(4, 4, 2, 'tree_trunk');
    const origin = new THREE.Vector3(5.5, 10, 12);
    const target = new THREE.Vector3(5.5, 2, 5.5);
    const dir = target.clone().sub(origin).normalize();
    const g = {
        battle: { store },
        cutLevel: 7,
        buildingView: null,
        search: { costs: new Map() },
        zones: new Map(),
        mode: { kind: 'throw', itemId: 'frag_grenade' },
        selectedUnit: () => ({ id: 'p0', x: 2, y: 5, z: 1 }),
        scene: { rayAt: () => ({ ray: { origin, direction: dir } }) }
    };

    const throwHit = Game.prototype.pick.call(g, 400, 400);
    assert.deepEqual(throwHit?.cell, { x: 5, y: 5, z: 1 }, 'throw mode picks street ground tile under Floor 2 cut');

    g.mode = { kind: 'overwatch' };
    const watchHit = Game.prototype.pick.call(g, 400, 400);
    assert.deepEqual(watchHit?.cell, { x: 5, y: 5, z: 1 }, 'overwatch mode picks street ground tile under Floor 2 cut');

    g.mode = { kind: 'move' };
    const moveMiss = Game.prototype.pick.call(g, 400, 400);
    assert.equal(moveMiss, null, 'move mode preserves preferredFloor filtering when tile is unreachable');

    assert.deepEqual(
        Game.prototype.throwCell.call(g, { cell: null, voxel: { x: 4, y: 4, z: 2 } }, null),
        { x: 4, y: 4, z: 1 },
        'throwCell resolves solid obstacle voxel down to standable ground surface'
    );
    assert.deepEqual(
        Game.prototype.throwCell.call(g, null, { id: 'e0', x: 7, y: 6, z: 1 }),
        { x: 7, y: 6, z: 1 },
        'throwCell falls back to hovered unit cell'
    );
});

test('exiting 3D shoot mode and focusFloor preserve manual Floor 1 lock while lifting if unit climbs above cut', () => {
    const store = new VoxelStore(20, 20, 12);
    store.fill(0, 0, 0, 19, 19, 1, 'concrete');
    const mission = { meta: { streetDatum: 1, cutLevels: [4, 7, Infinity] }, store, buildings: [{ id: 'b0', x0: 10, y0: 10, w: 6, d: 6, storeys: 2 }] };
    const outdoorUnit = { id: 'p0', side: 'player', x: 2, y: 2, z: 1, facing: 'e', weapon: 'repeater', weapons: ['repeater'], ap: 4, ammo: { repeater: 30 } };
    const floor1Unit = { id: 'p1', side: 'player', x: 12, y: 12, z: 1, facing: 'e', weapon: 'repeater', weapons: ['repeater'], ap: 4, ammo: { repeater: 30 } };
    const floor2Unit = { id: 'p2', side: 'player', x: 12, y: 12, z: 4, facing: 'e', weapon: 'repeater', weapons: ['repeater'], ap: 4, ammo: { repeater: 30 } };

    const g = Object.create(Game.prototype);
    Object.assign(g, {
        battle: { mission, store, units: [outdoorUnit, floor1Unit, floor2Unit], enemiesOf: () => [], unit: () => null },
        options: { buildingView: 'auto', followCamera: true },
        mode: { kind: 'move' },
        selected: outdoorUnit.id,
        cutLevel: 4,
        levelLocked: true,
        levelSource: 'manual',
        preAimFloor: null,
        views: new Map(),
        overlays: { clearAim() {}, clearPath() {}, showCover() {}, clearRange() {} },
        hud: {
            el: () => ({ classList: { contains: () => true, add() {} } }),
            hidePanel() {},
            refresh() {}
        },
        audio: { play() {} },
        aimPointer: { locked: false, release() {}, setEnabled() {} },
        aim: { snap() {}, clear() {} },
        cameraDirector: { phase: null, prepareAim() {}, track() {}, end() {} },
        cutins: { beginAim() {} },
        scene: { setCut() {}, rig: { distanceTarget: 27, minLayerHeight: 2 }, renderer: { domElement: { classList: { toggle() {} } } } },
        cancelAutoEnd() {},
        refreshBuildingView() {},
        refreshRange() {},
        selectedUnit: () => outdoorUnit
    });

    g.setMode({ kind: 'shoot', weaponId: 'repeater' });
    assert.equal(g.cutLevel, Infinity, 'entering shoot mode shows full map (Infinity)');
    assert.deepEqual(g.preAimFloor, { cutLevel: 4, levelLocked: true, levelSource: 'manual' });

    // Re-entering shoot mode mid-aim (follow-up shot) must not overwrite preAimFloor with Infinity
    g.setMode({ kind: 'shoot', weaponId: 'repeater', fireMode: 'single' });
    assert.equal(g.preAimFloor.cutLevel, 4);

    // Exiting shoot mode restores manual Floor 1 instead of Roof
    g.setMode({ kind: 'move' });
    assert.equal(g.cutLevel, 4);
    assert.equal(g.levelLocked, true);
    assert.equal(g.levelSource, 'manual');

    // Manual lock stays fixed for outdoor and Floor 1 units during enemy turns/camera focus
    g.focusFloor(outdoorUnit);
    assert.equal(g.cutLevel, 4);
    assert.equal(g.levelSource, 'manual');
    g.focusFloor(floor1Unit);
    assert.equal(g.cutLevel, 4);
    assert.equal(g.levelSource, 'manual');

    // Climbing above cutLevel lifts the floor so the active unit stays visible
    g.focusFloor(floor2Unit);
    assert.equal(g.cutLevel, 7);
});

test('unitCutLevel returns null on open-sky canal/sunken basin terrain and triggers base cut only underground', () => {
    const mission = {
        meta: {
            streetDatum: 4,
            cutLevels: [4, 7, 10, Infinity],
            underground: { cells: [{ x: 18, y: 18 }] }
        },
        buildings: [{ x0: 2, y0: 2, w: 6, d: 6, storeys: 2 }]
    };
    assert.equal(unitCutLevel(mission, { x: 10, y: 12, z: 2 }), null, 'open-sky sunken basin does not clip buildings');
    assert.equal(unitCutLevel(mission, { x: 12, y: 12, z: 3 }), null, 'open-sky canal towpath does not clip buildings');
    assert.equal(unitCutLevel(mission, { x: 18, y: 18, z: 2 }), 4, 'underground subway tunnel triggers street datum cutaway');
    assert.equal(unitCutLevel(mission, { x: 10, y: 12, z: 1 }), 4, 'z <= 1 subsurface triggers street datum cutaway');
});

test('enemy cutins stay on overview camera without angle switches or 2D overlays and highlight the shooter', async () => {
    const { CameraRig } = await import('../CameraRig.js');
    const enemy = { id: 'e0', side: 'enemy', name: 'Gunman', x: 6, y: 6, z: 1, facing: 's', weapons: ['musket'], weapon: 'musket' };
    const squad = { id: 'p0', side: 'player', name: 'Ranger', x: 14, y: 10, z: 1 };
    const rig = new CameraRig(16 / 9);
    rig.target.set(2, 2, 2);
    const yaw0 = rig.yaw, pitch0 = rig.pitch(), dist0 = rig.distance;
    const actorCalls = [], animatorPlays = [], floorFocus = [];
    let cameraBegins = 0, cameraEnds = 0, cutinPlays = 0;
    const enemySpan = { textContent: 'ENEMY ACTIVITY' };
    const eView = {
        id: 'e0', unit: enemy, pos: new THREE.Vector3(6.5, 2, 6.5), group: { scale: { y: 1 } },
        animator: { play: c => animatorPlays.push(c) },
        face() {}, drawBar() {}, worldPosition: () => new THREE.Vector3(6.5, 2, 6.5),
        setActiveActor: (mode, label) => actorCalls.push([mode, label])
    };
    const pView = {
        id: 'p0', unit: squad, pos: new THREE.Vector3(14.5, 2, 10.5), group: { scale: { y: 1 } },
        animator: { play() {} }, face() {}, drawBar() {}, worldPosition: () => new THREE.Vector3(14.5, 2, 10.5)
    };
    const g = {
        fog: true,
        discoveryVisible: new Set(['e0']),
        battle: {
            unit: id => (id === 'e0' ? enemy : id === 'p0' ? squad : null),
            unitsOf: s => (s === 'player' ? [squad] : [enemy])
        },
        views: new Map([['e0', eView], ['p0', pView]]),
        options: { followCamera: true },
        scene: { rig, target: rig.target, glideTo: (v, spd) => rig.glideTo(v, spd) },
        cameraDirector: {
            active: true, phase: 'action',
            begin() { cameraBegins++; },
            end() { cameraEnds++; this.active = false; this.phase = null; }
        },
        cutins: { async play() { cutinPlays++; } },
        fx: new Proxy({}, { get: () => () => {} }),
        audio: new Proxy({}, { get: () => () => {} }),
        hud: {
            el: s => (s === '.enemyturn span' ? enemySpan : null),
            log() {}, banner() {}, refresh() {},
            setEnemyActivity(text) { Hud.prototype.setEnemyActivity.call(this, text); }
        },
        isVisible: () => true,
        focusFloor: u => floorFocus.push(u.id),
        settleViews() {}
    };
    const player = new EventPlayer(g);
    player.speed = 100;
    for (const kind of ['shot', 'burst', 'heavy', 'melee', 'throw', 'skill', 'breach']) {
        g.cameraDirector.active = true;
        await player.play({ t: 'cutin', unitId: 'e0', weaponId: 'musket', itemId: 'powder_bomb', abilityId: 'rally', kind, targetIds: ['p0'] });
    }
    rig.update(0.2);
    assert.equal(cutinPlays, 0, 'no 2D cut-in overlays for any enemy action kind');
    assert.equal(cameraBegins, 0, 'no cameraDirector angle switch on enemy cutins');
    assert.equal(cameraEnds, 7, 'active 3D cameraDirector is closed for enemy actions');
    assert.ok(animatorPlays.includes('aim'), 'ballistic enemy cutin poses shooter to aim');
    assert.ok(actorCalls.some(([m, l]) => m === 'shoot' && /GUNMAN/.test(l)), 'highlights shooting enemy');
    assert.match(enemySpan.textContent, /GUNMAN/);
    assert.ok(rig.target.x > 2 && rig.target.z > 2, 'overview camera glides smoothly toward enemy action');
    assert.equal(rig.yaw, yaw0);
    assert.equal(rig.pitch(), pitch0);
    assert.equal(rig.distance, dist0);
    assert.ok(floorFocus.includes('p0'));
});

test('visible enemy shot highlights shooter with callout ring and shotLine, then clears after queue drains; enemy moves track smoothly on overview', async () => {
    const enemy = { id: 'e0', side: 'enemy', name: 'Raider', x: 2, y: 4, z: 1, weapons: ['musket'], weapon: 'musket' };
    const actorCalls = [], pulses = [], rings = [], lines = [], tracers = [], glides = [];
    const eView = {
        id: 'e0', unit: enemy, pos: new THREE.Vector3(2.5, 2, 4.5), visualZ: 1,
        group: { scale: { y: 1 } },
        animator: { play() {} },
        face() {}, drawBar() {},
        setCell(x, y, z) { this.pos.set(x + 0.5, z + 1, y + 0.5); },
        setVisible() {},
        worldPosition() { return this.pos.clone(); },
        setActiveActor: (mode, label) => actorCalls.push([mode, label]),
        pulseAction: kind => pulses.push(kind)
    };
    const g = {
        fog: true,
        discoveryVisible: new Set(['e0']),
        battle: { unit: id => (id === 'e0' ? enemy : null), unitsOf: () => [] },
        views: new Map([['e0', eView]]),
        voxelView: { flush() {}, interiorVisibility: { hiddenAt: () => false } },
        cameraDirector: { phase: null, active: false },
        options: { followCamera: true },
        scene: { glideTo: (pos, spd) => glides.push({ pos, spd }), shake: 0 },
        fx: {
            calloutRing: (...a) => rings.push(a),
            shotLine: (...a) => lines.push(a),
            tracer: (...a) => tracers.push(a),
            flash() {}, impact() {}, float() {}
        },
        audio: new Proxy({}, { get: () => () => {} }),
        hud: { log() {}, banner() {}, refresh() {}, setEnemyActivity(t) { g.hudText = t; } },
        isVisible: () => true,
        focusFloor() {},
        settleViews() {}
    };
    const player = new EventPlayer(g);
    player.speed = 500;
    player.enqueue([
        { t: 'move', unitId: 'e0', path: [{ x: 2, y: 4, z: 1 }, { x: 4, y: 4, z: 1 }, { x: 6, y: 4, z: 1 }] },
        { t: 'shot', unitId: 'e0', weaponId: 'musket', muzzle: { x: 6.5, y: 4.5, h: 2.3 }, aim: { x: 12.5, y: 4.5, h: 2.0 }, rounds: 1, projectiles: [{ to: { x: 12.5, y: 4.5, h: 2.0 }, kind: 'none' }] }
    ]);
    await player.whenIdle();
    assert.ok(glides.length >= 1, 'visible enemy movement tracks via overview glide');
    assert.equal(rings.length, 1, 'emits overview calloutRing on enemy shot');
    assert.equal(lines.length, 1, 'emits overview shotLine telegraph');
    assert.equal(tracers.length, 1);
    assert.ok(pulses.includes('fire'), 'triggers sprite fire recoil pulse');
    assert.ok(actorCalls.some(([m]) => m === 'shoot'), 'highlighted enemy shooter');
    assert.equal(actorCalls.at(-1)[0], null, 'pump() clears active enemy highlight when queue finishes');
    assert.equal(g.activeEnemyLabel, null);
    assert.equal(g.hudText, null);
});
