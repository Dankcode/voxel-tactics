// Tile-set rules without a GPU: autotiling decisions, roof surfaces and coverage (every voxel is drawn by exactly one
// of the cube mesher or the tile set).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildProvingGrounds } from '../../../../shared/mission/ProvingGrounds.js';
import { MATERIALS, MAT, AIR } from '../../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../../shared/voxel/VoxelStore.js';
import { buildAllPieces, PIECES } from './KitPieces.js';
import { MODERN_OVERHANG } from './ModernPieces.js';
import { MAPS } from '../../../../shared/mission/Maps.js';
import { KitView, kitHandler } from './KitView.js';
import { buildRoofGeometry, roofColumn } from './RoofBuilder.js';

const pieces = buildAllPieces();
const fakeKit = { piece: id => pieces.get(id) || pieces.get(`${id}#0`), material: () => new THREE.MeshBasicMaterial() };
const mission = buildProvingGrounds({ seed: 1 });
const store = mission.store;

function buildAll(cut = Infinity, m = mission) {
    const store = m.store;
    const view = new KitView(fakeKit, []);
    view.setVisual(m.visual);
    const byPiece = new Map();
    let roofs = 0;
    for (let cz = 0; cz < Math.ceil(store.height / CHUNK); cz++) for (let cy = 0; cy < Math.ceil(store.depth / CHUNK); cy++) for (let cx = 0; cx < Math.ceil(store.width / CHUNK); cx++) {
        for (const m of view.buildChunk(store, cx, cy, cz, { cutZ: cut })) {
            if (!m.isInstancedMesh) { roofs++; continue; }
            const id = [...pieces].find(([, parts]) => parts.some(p => p.geometry === m.geometry))?.[0];
            byPiece.set(id, (byPiece.get(id) || 0) + m.count);
        }
    }
    return { byPiece, roofs };
}

test('every piece builds within its cell (except the documented overhangs)', () => {
    const overhang = new Set(['cart_shaft', 'stall', 'foliage', 'hedge', 'stair_rail', 'rock#0', 'rock#1', 'rock#2', 'rock_top', 'door_open_lower', 'door_open_upper', 'cart_wheels', 'mdoor_open_lower', 'mdoor_open_upper', 'gdoor_open_lower', 'gdoor_open_upper', ...MODERN_OVERHANG]);
    for (const [id, parts] of pieces) {
        for (const { geometry } of parts) {
            geometry.computeBoundingBox();
            const b = geometry.boundingBox;
            if (overhang.has(id)) continue;
            assert.ok(b.min.x >= -0.53 && b.max.x <= 0.53 && b.min.z >= -0.53 && b.max.z <= 0.53, `${id} leaves its cell: ${JSON.stringify(b)}`);
            assert.ok(b.min.y >= -0.01 && b.max.y <= 1.11, `${id} height ${b.min.y}..${b.max.y}`);
        }
    }
    assert.ok(Object.keys(PIECES).length >= 40);
});

test('the training facility draws walls, glazing, doors, stairs, roofs, furniture, vehicles and cover with tile-set pieces', () => {
    const { byPiece, roofs } = buildAll();
    for (const id of ['joined_wall_5', 'joined_wall_10', 'glaze', 'glaze_head', 'mdoor_lower', 'mdoor_upper', 'stair_step', 'crate', 'barrel', 'car', 'tree_round', 'jersey', 'column'].filter(id => id !== 'column'))
        assert.ok((byPiece.get(id) || 0) > 0, `no ${id} instances`);
    for (const family of ['sandbag', 'hedge'])
        assert.ok([...byPiece].some(([id, n]) => id?.startsWith(`joined_${family}_`) && n > 0), `no connected ${family} modules`);
    assert.ok(roofs > 0, 'the fuel store has a pitched roof surface');
});

test('every present-day map draws its furniture from hints, whole vehicles and trees, and its decor', () => {
    for (const def of MAPS) {
        const m = def.build({ seed: 1 });
        const { byPiece } = buildAll(Infinity, m);
        const hinted = new Set(Object.values(m.visual.hints).map(h => h.piece).filter(Boolean));
        for (const id of hinted) assert.ok(pieces.has(id) || pieces.has(`${id}#0`), `${def.id}: hint names unknown piece ${id}`);
        for (const d of m.visual.decor) assert.ok(pieces.has(d.kind), `${def.id}: unknown decor ${d.kind}`);
        const drawn = [...hinted].filter(id => (byPiece.get(id) || 0) > 0);
        assert.ok(drawn.length >= hinted.size * 0.8, `${def.id}: hinted pieces drawn ${drawn.length}/${hinted.size}`);
        assert.equal(byPiece.get('wreck') || 0, 0, `${def.id}: intact vehicles are drawn whole`);
    }
});

test('a damaged car falls back to wreck fragments; destroying a tree trunk drops back to canopy blobs', () => {
    const m = MAPS.find(d => d.id === 'cedar-close').build({ seed: 1 });
    const [ak, car] = Object.entries(m.visual.hints).find(([, h]) => h.piece === 'car');
    const s2 = m.store.clone();
    const [x, y, z] = car.cells[0].split(',').map(Number);
    s2.set(x, y, z, AIR);
    const view = new KitView(fakeKit, []); view.setVisual(m.visual);
    let wrecks = 0;
    for (let cz = 0; cz < Math.ceil(s2.height / CHUNK); cz++) for (let cy = 0; cy < Math.ceil(s2.depth / CHUNK); cy++) for (let cx = 0; cx < Math.ceil(s2.width / CHUNK); cx++)
        for (const mesh of view.buildChunk(s2, cx, cy, cz)) if (mesh.isInstancedMesh && pieces.get('wreck').some(p => p.geometry === mesh.geometry)) wrecks += mesh.count;
    assert.ok(wrecks >= car.cells.length - 1 - 1, `wreck fragments ${wrecks}`);
    assert.ok(view.dependencies() instanceof Map);
    assert.ok(ak);
});

test('every visible voxel is drawn by exactly one system', () => {
    for (let z = 0; z < store.height; z++) for (let y = 0; y < store.depth; y++) for (let x = 0; x < store.width; x++) {
        const id = store.get(x, y, z);
        if (id === AIR) continue;
        const m = MATERIALS[id];
        const kit = kitHandler(store, x, y, z, id);
        if (m.render === 'none' && m.key !== 'door_open') continue;
        assert.ok(kit !== undefined, `${m.key} at ${x},${y},${z}`);
        // cube-drawn materials must not be wall-like props the kit expects
        if (!kit) assert.ok(!['plaster', 'timber', 'stucco', 'brick', 'concrete_wall', 'siding', 'crate', 'sandbag', 'sofa', 'cabinet', 'bed', 'desk', 'appliance', 'shelving', 'pallet', 'planter', 'privacy_fence', 'chainlink', 'jersey', 'bench', 'bin', 'pump', 'car_body', 'car_cabin', 'container', 'dumpster', 'roof', 'glass', 'door'].includes(m.key), `${m.key} left to the cube mesher`);
    }
});

test('the storey cutaway drops roofs and caps cut walls', () => {
    const house = mission.buildings.find(b => b.id === 'house');
    const cut = house.baseZ + 3;
    const { byPiece, roofs } = buildAll(cut);
    assert.ok([...byPiece].some(([id, count]) => id.startsWith('joined_cap_') && count > 0), 'cut walls get connected section caps');
    const full = buildAll();
    assert.ok(roofs <= full.roofs);
});

test('roof surfaces slope from eaves to ridge and hole where a roof voxel is destroyed', () => {
    const shack = mission.buildings.find(b => b.id === 'shack');
    const cx = Math.floor((shack.x0 + 3) / CHUNK), cy = Math.floor((shack.y0 + 3) / CHUNK);
    const col = roofColumn(store, shack.x0 + 3, shack.y0 + 3);
    assert.ok(col && col.top > col.bottom, 'stacked roof voxels in the middle of the roof');
    const g = buildRoofGeometry(store, cx, cy, Math.floor(col.top / CHUNK));
    assert.ok(g && g.attributes.position.count > 0);
    const ys = g.attributes.position.array.filter((_, i) => i % 3 === 1);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= 2, 'the roof rises at least two voxels from eave to ridge');
    const s2 = store.clone();
    const cz = Math.floor(col.top / CHUNK);
    const before = buildRoofGeometry(s2, cx, cy, cz).attributes.position.count;
    for (let z = col.bottom; z <= col.top; z++) s2.set(shack.x0 + 3, shack.y0 + 3, z, AIR);
    const after = buildRoofGeometry(s2, cx, cy, cz)?.attributes.position.count ?? 0;
    assert.ok(after < before, 'a destroyed roof column leaves a hole');
});

test('pitched roofs are not walkable; flat roofs are', () => {
    assert.equal(MATERIALS[MAT.roof].walkable, false);
    const tower = mission.buildings.find(b => b.id === 'tower');
    const s = store.surfaces(tower.x0 + 3, tower.y0 + 3).at(-1);
    assert.ok(s && s.z >= tower.top, 'the watchtower roof is a walkable surface');
});

test('fire escapes draw uniform edge rails within their two-tile footprint, without beams', async () => {
    const {compileFireEscape}=await import('../../../../shared/mapgen/AccessModules.js');
    const {VoxelStore}=await import('../../../../shared/voxel/VoxelStore.js');
    const s=new VoxelStore(16,16,16);s.fill(0,0,0,15,15,1,'concrete');
    s.fill(2,2,2,7,2,13,'brick');
    const rec=compileFireEscape(s,{side:'s',origin:[2,2],datum:1,storeys:4,doors:{}});
    const {byPiece}=buildAll(Infinity,{store:s});
    assert.equal(byPiece.get('escape_rail'),12*rec.landings.length);
    assert.equal(byPiece.get('steel_post')||0,0);
    const parts=pieces.get('escape_rail');assert.ok(parts?.length);
    for(const {geometry} of parts){geometry.computeBoundingBox();assert.ok(geometry.boundingBox.max.z<=.5);}
});
