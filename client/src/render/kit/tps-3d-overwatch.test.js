import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { Battle } from '../../../../shared/battle/Battle.js';
import { watchSector, watchWeapon } from '../../../../shared/battle/WatchSector.js';
import { buildWatchPreview } from '../../../../shared/battle/WatchPreview.js';
import { CameraRig, wrapAngle } from '../CameraRig.js';
import { CameraDirector, SHOULDER_3D, TPS_DEFAULT_FOV } from '../../anim/CameraDirector.js';
import {
    HumanoidModel,
    createCharacterModel,
    registerCharacterModel,
    getRegisteredCharacterModel
} from '../../units/CharacterModel.js';
import { UnitView } from '../../units/UnitView.js';
import { updateReticle } from '../../ui/AimReticle.js';

function flatMission({ width = 28, depth = 28, height = 10, build, spawns, enemies } = {}) {
    const store = new VoxelStore(width, depth, height);
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < depth; y++) {
            store.set(x, y, 0, MAT.asphalt);
            store.set(x, y, 1, MAT.asphalt);
        }
    }
    build?.(store);
    return {
        store,
        mission: {
            store,
            spawns: spawns || {
                player: [{ x: 10, y: 20, z: 1 }, { x: 8, y: 20, z: 1 }],
                enemy: enemies || [{ type: 'cultist', pos: { x: 20, y: 20, z: 1 }, group: 0, alerted: true }]
            },
            meta: { streetDatum: 1, buildings: [] }
        }
    };
}

function makeBattle(opts = {}) {
    const { mission } = flatMission(opts);
    return new Battle({
        mission,
        squad: opts.squad || [{ type: 'vanguard', name: 'Vanguard' }],
        enemies: opts.enemies || mission.spawns.enemy,
        seed: 7
    });
}

function withDomStub(fn) {
    const prevDoc = globalThis.document;
    globalThis.document = {
        createElement: () => ({
            width: 256,
            height: 128,
            getContext: () => ({
                clearRect() {},
                fillRect() {},
                strokeRect() {},
                fillText() {},
                beginPath() {},
                roundRect() {},
                fill() {},
                stroke() {},
                createRadialGradient: () => ({ addColorStop() {} })
            })
        })
    };
    try {
        return fn();
    } finally {
        globalThis.document = prevDoc;
    }
}

describe('CameraRig smooth rotation, pitch, and vertical glide', () => {
    test('wrapAngle takes the shortest arc across +/-pi boundaries', () => {
        const rig = new CameraRig(1);
        rig.yaw = Math.PI - 0.1;
        rig.yawTarget = -Math.PI + 0.1;
        const before = rig.yaw;
        rig.update(0.05);
        assert.ok(wrapAngle(rig.yaw - before) > 0, 'yaw advances positively (+0.2 rad) instead of snapping backward 350 degrees');
        for (let i = 0; i < 60; i++) rig.update(0.03);
        assert.ok(Math.abs(wrapAngle(rig.yaw - rig.yawTarget)) < 0.02);
    });

    test('glideYTo smooths vertical target transitions without instant jumps', () => {
        const rig = new CameraRig(1);
        rig.target.y = 1;
        rig.glideYTo(7);
        assert.equal(rig.target.y, 1, 'glideYTo sets targetYTarget rather than snapping target.y');
        for (let i = 0; i < 10; i++) rig.update(0.03);
        assert.ok(rig.target.y > 2 && rig.target.y < 7);
        for (let i = 0; i < 60; i++) rig.update(0.05);
        assert.ok(Math.abs(rig.target.y - 7) < 0.05);
    });
});

describe('CameraDirector TPS 3D FOV & spring-arm continuity', () => {
    test('tps3d uses 50 deg Phoenix Point TPS FOV and smoothed SHOULDER_3D boom', () => {
        const { store } = flatMission({
            build: s => {
                // Wall behind shooter across boom arc
                for (let x = 9; x <= 12; x++) for (let z = 2; z <= 5; z++) s.set(x, 22, z, MAT.concrete);
            }
        });
        const dir = new CameraDirector({ aspect: 16 / 9 });
        dir.store = store;
        assert.equal(TPS_DEFAULT_FOV, 50);
        assert.ok(SHOULDER_3D.back < 2.8);

        const shooter = new THREE.Vector3(10.5, 2, 20.5);
        const target = new THREE.Vector3(20.5, 3.2, 20.5);
        dir.prepareAim(shooter, target, { side: 'right', tps3d: true });
        for (let i = 0; i < 40; i++) dir.update(0.03);

        assert.equal(Math.round(dir.cam.fov), 50);
        assert.equal(dir.tps3d, true);

        // Subtle aim sweep across the wall behind shooter eases smoothly (bounded arc step + smooth _armFrac compression)
        const posA = dir.cam.position.clone();
        dir.track(new THREE.Vector3(20.5, 3.2, 19.6), 0.016);
        const stepDist = dir.cam.position.distanceTo(posA);
        assert.ok(stepDist < 0.35, `eased orbit step (${stepDist.toFixed(2)}) stays continuous`);
        const wallTarget = new THREE.Vector3(10.5, 3.2, 10.5);
        dir.track(wallTarget, 0.016);
        const fracAfterOneTick = dir._armFrac;
        assert.ok(fracAfterOneTick > 0.5 && fracAfterOneTick < 1, `spring-arm compresses gradually (${fracAfterOneTick.toFixed(2)}) instead of snapping to wall`);
        dir.end();
    });
});

describe('3D character models, 2D switch, and glTF registry', () => {
    afterEach(() => registerCharacterModel('__custom_test', null));

    test('UnitView defaults to articulated 3D HumanoidModel and transfers cleanly to 2D', () => {
        withDomStub(() => {
            const scene = { scene: { add() {}, remove() {} }, clipping: null };
            const { store } = flatMission();
            const unit = { id: 'p0', type: 'vanguard', side: 'player', x: 10, y: 20, z: 1, facing: 'E', hp: 10, maxHp: 10, ap: 4, maxAp: 4, wp: 4, maxWp: 4, weapon: 'carbine', items: {} };

            const v3d = new UnitView(scene, unit, null, store, { characterMode: '3d' });
            assert.equal(v3d.is3D, true);
            assert.ok(v3d.model instanceof HumanoidModel);
            v3d.setCoverStance(1, 'right', true);
            v3d.setAimTarget(new THREE.Vector3(20.5, 3, 20.5));
            v3d.setOpacity(0.5);
            v3d.update(0.05, 0, { position: new THREE.Vector3(12, 6, 25) }, 1);
            assert.ok(v3d.model.crouchAmt > 0);
            assert.ok(Math.abs(v3d.model.leanAmt) > 0);
            assert.equal(v3d.model.opacity, 0.5);
            v3d.dispose();

            const fakeArt = {
                field: { worldHeight: 1.9, frameWidth: 64, frameHeight: 96, anchor: [0.5, 0], fps: 8, columns: 1, rows: 1, clips: { idle: { column: 0, frames: 1 }, run: { column: 0, frames: 1 } } },
                image: Object.assign(new THREE.Texture(), { clone: () => new THREE.Texture() }),
                normal: Object.assign(new THREE.Texture(), { clone: () => new THREE.Texture() }),
                lighting: Object.assign(new THREE.Texture(), { clone: () => new THREE.Texture() })
            };
            const v2d = new UnitView(scene, unit, fakeArt, store, { characterMode: '2d' });
            assert.equal(v2d.is3D, false);
            assert.equal(v2d.model, undefined);
            v2d.dispose();
        });
    });

    test('registerCharacterModel supports custom future 3D builders', () => {
        const customRoot = new THREE.Group();
        const stub = { root: customRoot, setAnimation() {}, update() {}, setAimTarget() {}, setCoverStance() {}, setOpacity() {}, dispose() {} };
        registerCharacterModel('__custom_test', () => stub);
        assert.ok(getRegisteredCharacterModel('__custom_test'));
        const built = createCharacterModel({ id: 'p0', type: 'vanguard', side: 'player', art: '__custom_test', weapon: 'carbine' });
        assert.equal(built, stub);
    });
});

describe('Phoenix Point reticle + separate cover obstruction marker', () => {
    function makeEl() {
        const classes = new Set();
        const styleMap = {};
        const readSpan = { textContent: '' };
        return {
            classes,
            readSpan,
            querySelector: s => (s === 'span.read' ? readSpan : null),
            style: {
                left: '', top: '',
                setProperty: (k, v) => { styleMap[k] = v; },
                getProperty: k => styleMap[k]
            },
            classList: {
                add: c => classes.add(c),
                remove: c => classes.delete(c),
                toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)),
                contains: c => classes.has(c)
            }
        };
    }

    test('anchors reticle cleanly on freeAim and places .aim-cover-mark on blocking voxel', () => {
        const reticleEl = makeEl();
        const coverEl = makeEl();
        const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
        cam.position.set(10, 3, 22);
        cam.lookAt(20, 3, 20);
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();

        const g = {
            selectedUnit: () => ({ id: 'p0', x: 10, y: 20, z: 1, side: 'player', weapon: 'carbine', parts: {} }),
            mode: { kind: 'shoot', weaponId: 'carbine' },
            freeAim: { x: 20.5, y: 20.5, h: 3.0 },
            aimTrace: { kind: 'voxel', point: { x: 15.0, y: 20.2, h: 2.5 } },
            aimStance: { muzzle: { x: 10.5, y: 20.5, h: 2.35 } },
            aimTelemetry: () => ({ blocked: true, outOfRange: false, recoil: { finalSpread: 2.2, totalClimbDeg: 0 } }),
            aimTargetNear: () => null,
            battle: { spreadFor: () => ({ spread: 2.2 }) },
            hud: {
                el: () => reticleEl,
                root: { querySelector: s => (s === '.aim-cover-mark' ? coverEl : null) }
            },
            scene: {
                camera: cam,
                renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) } }
            }
        };

        updateReticle(g);
        assert.equal(reticleEl.classes.has('hidden'), false);
        assert.equal(reticleEl.classes.has('blocked'), true);
        assert.equal(reticleEl.style.getProperty('--inner-ratio'), '0.5');
        assert.equal(coverEl.classes.has('hidden'), false);
        assert.ok(coverEl.style.getProperty('--cx')?.endsWith('px'));
        assert.ok(coverEl.style.getProperty('--cy')?.endsWith('px'));
    });
});

describe('Step-out and half-cover lean overwatch exposure + multi-elevation Overwatch zones', () => {
    test('leaning out from half cover triggers enemy overwatch during Battle.doShoot', () => {
        const b = makeBattle({
            build: s => {
                // Half-height wall right in front of p0 at (11,20,2) plus solid flank walls at y=19 & y=21 so p0 leans over half cover
                s.set(11, 20, 2, MAT.concrete);
                for (let h = 2; h <= 4; h++) {
                    s.set(11, 19, h, MAT.concrete);
                    s.set(11, 21, h, MAT.concrete);
                }
            },
            enemies: [{ type: 'cultist', pos: { x: 20, y: 20, z: 1 }, group: 0, alerted: true }]
        });
        const u = b.unit('p0'), w = b.unit('e0');
        b.activeSide = 'enemy';
        const ow = b.apply({ type: 'overwatch', unitId: w.id, weaponId: w.weapon, toward: { x: 11, y: 20 } });
        assert.ok(ow.ok, ow.reason);
        b.activeSide = 'player';
        b.visible = b.visibleTo('player');

        const r = b.apply({ type: 'shoot', unitId: u.id, weaponId: u.weapon, aim: { point: { x: 20.5, y: 20.5, h: 3.1 } } });
        assert.ok(r.ok, r.reason);
        assert.ok(r.events.some(e => e.t === 'reaction'), 'leaning over half cover exposes shooter to overwatch');
    });

    test('WatchPreview covers multi-elevation tiers below cutZ and corner step-out sightlines', () => {
        const b = makeBattle({
            build: s => {
                // Raised upper ledge around x=16..18, y=18..22 at z=4 (surfaces top at z=4)
                for (let x = 16; x <= 18; x++) {
                    for (let y = 18; y <= 22; y++) {
                        for (let z = 2; z <= 4; z++) s.set(x, y, z, MAT.concrete);
                    }
                }
                // Full wall pillar blocking straight LOS directly ahead at (12, 20), with open step-out beside at (10, 19)
                for (let z = 2; z <= 4; z++) s.set(11, 20, z, MAT.concrete);
            }
        });
        const u = b.unit('p0');
        const sector = watchSector(u, { x: 20, y: 20 }, watchWeapon(u));
        assert.ok(sector);
        const pv = buildWatchPreview(b, u, sector, { cutZ: 10 });
        assert.ok(Array.isArray(pv.tiles) && Array.isArray(pv.faces));
        // Should include BOTH lower ground z=1 tiles AND raised z=4 ledge tiles within the sector
        const groundTiles = pv.tiles.filter(t => t.z === 1);
        const ledgeTiles = pv.tiles.filter(t => t.z === 4);
        assert.ok(groundTiles.length > 0, 'includes street-level watched tiles');
        assert.ok(ledgeTiles.length > 0, 'includes upper-elevation ledge watched tiles');
        // Corner step-out from (10,19) sees behind the (11,20) pillar to (14,20)
        assert.ok(pv.tiles.some(t => t.x === 14 && t.y === 20), 'step-out sightline includes tile beyond cover corner');
    });
});
