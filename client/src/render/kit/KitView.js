import { ladderAttachment } from '../../../../shared/world/LadderAttachment.js';
// Autotiles structure and cover voxels into tile-set pieces, chunk by chunk, as instanced meshes.
//
// The voxel grid stays the gameplay truth. This only decides what each voxel looks like, from its material, its
// neighbours and — for present-day maps — the mission's render hints:
//   * walls become thin panels joined at posts; modern walls (stucco, brick, concrete, siding) get a dark metal cap on
//     exposed tops, a plinth at the floor and dark section caps under the cutaway;
//   * glass in a modern wall becomes slim-framed glazing (floor-to-ceiling where glass is stacked), doors become flush
//     timber doors, glazed storefront doors or roller shutters;
//   * furniture voxels are drawn with the piece and orientation the building generator chose (hints), falling back to
//     autotiling when a voxel has no hint (e.g. placed in debug mode);
//   * cars, containers, dumpsters and trees are drawn as ONE object while every voxel of them is intact; once one is
//     destroyed the rest are drawn as wreck fragments (trees: trunk + canopy blobs);
//   * decor (rugs, plants, lamps, street lights …) is visual only and is drawn while its cell is empty and its floor
//     still stands.
// Destroying a voxel rebuilds its chunk (and, through VoxelView's dependency map, the chunk holding the object anchor).
import * as THREE from 'three';
import { MATERIALS, MAT, AIR } from '../../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../../shared/voxel/VoxelStore.js';
import { wallMask, openingAxis, bandMask, BANDS } from '../../../../shared/voxel/ConnectedShapes.js';
import { buildRoofGeometry } from './RoofBuilder.js';

export const MODERN_WALLS = new Set(['stucco', 'brick', 'concrete_wall', 'siding']);
const WALLS = new Set(['stone', 'plaster', 'timber', ...MODERN_WALLS]);
const WALL_LIKE = new Set([...WALLS, 'city_wall', 'glass', 'door', 'door_locked', 'door_open', 'lantern']);
const FURNITURE = new Set(['sofa', 'cabinet', 'bed', 'desk', 'appliance', 'shelving', 'pallet']);
const PROPS = new Set(['planter', 'privacy_fence', 'chainlink', 'railing', 'jersey', 'bench', 'bin', 'pump']);
const OBJECTS = new Set(['car_body', 'car_cabin', 'container', 'dumpster']);
// Outdoor objects taller than a storey are not sliced by the storey cutaway (trees, street lights, signs).
const NO_CLIP = new Set(['canopy', 'tree_round', 'tree_conifer', 'streetlight', 'floodlight', 'price_sign', 'motel_sign', 'crane_leg', 'bus_stop', 'umbrella', 'gate_sign']);
const DIRS = [[1, 0, 0], [0, 1, -Math.PI / 2], [-1, 0, Math.PI], [0, -1, Math.PI / 2]];   // dx, dy, yaw (+X arm → dir)
const keyOf = id => MATERIALS[id]?.key;
const yawToward = (dx, dy) => Math.atan2(-dx, -dy);          // rotation that points a piece's −Z (its back) at (dx, dy)
function hash(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export const chunkKeyOf = (x, y, z) => `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`;

/** Which kit handler draws this voxel (null → the cube mesher draws it). Shared with ChunkMesher. */
export function kitHandler(store, x, y, z, id = store.get(x, y, z)) {
    const k = keyOf(id);
    if (!k) return null;
    if (WALLS.has(k)) return 'wall';
    if (FURNITURE.has(k)) return 'furniture';
    if (PROPS.has(k)) return 'prop';
    if (OBJECTS.has(k)) return 'object';
    switch (k) {
        case 'glass': return 'window';
        case 'door': case 'door_locked': case 'door_open': return 'door';
        case 'steel_stair': case 'stairs_wood': case 'stairs_stone': return 'stairs';
        case 'roof': return 'roof';
        case 'crate': return 'crate';
        case 'barrel_powder': case 'barrel_water': return 'barrel';
        case 'sandbag': case 'drystone': case 'fence': case 'hay': case 'cart': case 'stall': return k;
        case 'rock': return 'rock';
        case 'hedge': return 'hedge';
        case 'leaves': return 'foliage';
        case 'trunk': return 'trunk';
        case 'lantern': return 'lantern';
        case 'ladder': return 'ladder';
        case 'furniture': return 'table';
        case 'shelf': return 'shelf';
        case 'cloth': return 'banner';
        case 'crystal': return 'crystal';
        case 'metal': {
            // A lone iron column is a lamp post (or a canopy column); iron blocks next to other solids stay cubes.
            for (const [dx, dy] of DIRS) if (store.isSolid(x + dx, y + dy, z)) return null;
            return 'post';
        }
        default: return null;
    }
}

export class KitView {
    constructor(kit, clipping) {
        this.kit = kit; this.clipping = clipping;
        this.hints = {};
        this.decorByChunk = new Map();
    }
    /** Mission render hints and decor (mission.visual). */
    setVisual(visual) {
        this.hints = visual?.hints || {};
        this.decorByChunk = new Map();
        for (const d of visual?.decor || []) {
            const k = chunkKeyOf(Math.floor(d.x + 0.5), Math.floor(d.y + 0.5), d.z);
            if (!this.decorByChunk.has(k)) this.decorByChunk.set(k, []);
            this.decorByChunk.get(k).push(d);
        }
    }
    /** Chunks another chunk's objects depend on: member chunk → anchor chunks (VoxelView rebuilds them together). */
    dependencies() {
        const deps = new Map();
        for (const [ak, h] of Object.entries(this.hints)) {
            if (!h.cells) continue;
            const [ax, ay, az] = ak.split(',').map(Number), a = chunkKeyOf(ax, ay, az);
            for (const c of h.cells) {
                const [x, y, z] = c.split(',').map(Number), m = chunkKeyOf(x, y, z);
                if (m === a) continue;
                if (!deps.has(m)) deps.set(m, new Set());
                deps.get(m).add(a);
            }
        }
        return deps;
    }
    /** Build the instanced meshes for one chunk. opts: { cutZ, tint(x,y,z) } → THREE.Object3D[] */
    buildChunk(store, cx, cy, cz, opts = {}) {
        const cut = opts.cutZ ?? Infinity;
        const inst = new Map();          // `${piece}|${part}|${selfKey}` → { part, selfKey, mats: [], cols: [] }
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
        const add = (piece, x, y, z, yaw = 0, selfKey = 'stone', { scale = 1, sx = 1, sz = 1, dx = 0, dy = 0, dz = 0, tint = null, tintSlots = null } = {}) => {
            const parts = this.kit.piece(piece); if (!parts) return false;
            q.setFromAxisAngle(up, yaw); s.set(scale * sx, scale, scale * sz); p.set(x + 0.5 + dx, z + dz, y + 0.5 + dy);
            m4.compose(p, q, s);
            const fog = opts.tint?.(Math.round(x), Math.round(y), z) || null;
            const shade = WALLS.has(selfKey) || ['glass', 'door', 'door_locked', 'door_open'].includes(selfKey) ? 1 : 0.97 + hash(x, y, z) * 0.04;
            parts.forEach((part, i) => {
                const k = `${piece}|${i}|${part.slot === 'self' || part.slot === 'barrel' ? selfKey : ''}`;
                let e = inst.get(k);
                if (!e) inst.set(k, e = { part, selfKey, mats: [], cols: [], noClip: NO_CLIP.has(piece) });
                e.mats.push(m4.clone());
                const t = tint && (!tintSlots || tintSlots.includes(part.slot)) ? tint : null;
                e.cols.push([0, 1, 2].map(c => shade * (fog ? fog[c] : 1) * (t ? t[c] : 1)));
            });
            return true;
        };
        const get = (x, y, z) => (z >= cut ? AIR : store.get(x, y, z));
        const wallLike = (x, y, z) => WALL_LIKE.has(keyOf(get(x, y, z)));
        const intactCache = new Map();
        const intact = (ak) => {
            if (intactCache.has(ak)) return intactCache.get(ak);
            const h = this.hints[ak];
            const ok = !!h && h.cells.every(c => { const [x, y, z] = c.split(',').map(Number); const kk = keyOf(store.get(x, y, z)); return h.tree ? true : OBJECTS.has(kk); })
                && (!h.tree || keyOf(store.get(...ak.split(',').map(Number))) === 'trunk');
            intactCache.set(ak, ok);
            return ok;
        };
        const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
        const ctx = { store, get, wallLike, add, cut, intact };
        for (let z = z0; z < Math.min(z0 + CHUNK, store.height, cut); z++)
            for (let y = y0; y < Math.min(y0 + CHUNK, store.depth); y++)
                for (let x = x0; x < Math.min(x0 + CHUNK, store.width); x++) {
                    const id = store.get(x, y, z);
                    if (id === AIR) continue;
                    const h = kitHandler(store, x, y, z, id);
                    if (!h) continue;
                    this.emit(h, keyOf(id), x, y, z, ctx);
                }
        // Decor: drawn while its cell is empty and what it stands on (or hangs on) still exists.
        for (const d of this.decorByChunk.get(`${cx},${cy},${cz}`) || []) {
            const x = Math.floor(d.x + 0.5), y = Math.floor(d.y + 0.5);
            if (d.free) { add(d.kind, d.x, d.y, d.z, d.yaw || 0, 'stone', { sx: d.w || 1, sz: d.d || 1 }); continue; }   // free-standing (canopies)
            if (d.z >= cut) continue;
            if (store.get(x, y, d.z) !== AIR) continue;
            if (d.kind === 'wall_art') {
                const [wx, wy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[d.side] || [0, 0];
                if (!store.isSolid(x + wx, y + wy, d.z)) continue;
                add('wall_art', x, y, d.z, yawToward(wx, wy), 'stone', { dx: wx * 0.3, dy: wy * 0.3 });
                continue;
            }
            if (!store.isSolid(x, y, d.z - 1)) continue;
            add(d.kind, d.x, d.y, d.z, d.yaw || 0, 'stone', { sx: d.w || 1, sz: d.d || 1 });
        }
        const out = [];
        for (const e of inst.values()) {
            const mesh = new THREE.InstancedMesh(e.part.geometry, this.kit.material(e.part.slot, e.selfKey, e.noClip ? null : this.clipping), e.mats.length);
            e.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(e.cols.flat()), 3);
            mesh.castShadow = !['glass', 'glow', 'cap', 'mesh', 'lamp', 'rug'].includes(e.part.slot);
            mesh.receiveShadow = true;
            mesh.computeBoundingSphere();
            mesh.userData.kit = true;
            out.push(mesh);
        }
        // Roofs: one continuous surface per chunk.
        const roof = buildRoofGeometry(store, cx, cy, cz, cut);
        if (roof) {
            const mesh = new THREE.Mesh(roof, this.kit.material('roof', 'roof', this.clipping));
            mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.kit = true;
            out.push(mesh);
        }
        return out;
    }

    emit(h, k, x, y, z, { store, get, wallLike, add, cut, intact }) {
        const mask = DIRS.map(([dx, dy]) => wallLike(x + dx, y + dy, z));
        const lineYaw = (same) => {
            const ex = same(x + 1, y) || same(x - 1, y), ey = same(x, y + 1) || same(x, y - 1);
            if (ex) return 0;
            if (ey) return -Math.PI / 2;
            return hash(x, y, 7) < 0.5 ? 0 : -Math.PI / 2;
        };
        const sameKey = (ax, ay) => keyOf(get(ax, ay, z)) === k;
        const wallAxis = () => openingAxis(store, x, y, z) === 'x' ? 0 : -Math.PI / 2;
        const hint = this.hints[`${x},${y},${z}`];
        // Grouped cover: one connected module per cell, chosen from the family's face neighbours (same rule as collision).
        const grouped = () => {
            const m2 = bandMask(store, x, y, z, BANDS[k].family);
            const full = keyOf(get(x, y, z + 1)) === k;
            add(`joined_${k}_${m2}_${full ? 'full' : 'top'}`, x, y, z, 0, k);
        };
        switch (h) {
            case 'wall': {
                const connections = wallMask(store, x, y, z);
                add(`joined_wall_${connections}`, x, y, z, 0, k);
                const above = store.get(x, y, z + 1);
                if (above === AIR || z + 1 >= cut) add(`joined_cap_${connections}`, x, y, z, 0, k);
                break;
            }
            case 'window': {
                const wall = neighbourWall(store, x, y, z) || 'plaster';
                const yaw = wallAxis();
                if (MODERN_WALLS.has(wall)) {
                    add('glaze', x, y, z, yaw, wall);
                    if (keyOf(store.get(x, y, z - 1)) !== 'glass') add('glaze_sill', x, y, z, yaw, wall);
                    if (keyOf(store.get(x, y, z + 1)) !== 'glass') add('glaze_head', x, y, z, yaw, wall);
                } else add('window', x, y, z, yaw, wall);
                if (z + 1 >= cut && store.get(x, y, z + 1) !== AIR) { add('cap_core', x, y, z, 0, wall); add('cap_arm', x, y, z, yaw, wall); add('cap_arm', x, y, z, yaw + Math.PI, wall); }
                break;
            }
            case 'door': {
                const isDoor = kk => kk === 'door' || kk === 'door_locked' || kk === 'door_open';
                const lower = !isDoor(keyOf(store.get(x, y, z - 1)));
                const open = k === 'door_open';
                const wall = neighbourWall(store, x, y, z) || 'plaster';
                const yaw = wallAxis();
                if (MODERN_WALLS.has(wall)) {
                    const baseZ = lower ? z : z - 1;
                    const roller = this.hints[`${x},${y},${baseZ}`]?.roller;
                    const glazed = DIRS.some(([dx, dy]) => [baseZ, baseZ + 1].some(zz => keyOf(store.get(x + dx, y + dy, zz)) === 'glass'));
                    const style = roller ? 'roller' : glazed ? 'gdoor' : 'mdoor';
                    add(`${style}${open ? '_open' : ''}_${lower ? 'lower' : 'upper'}`, x, y, z, yaw, wall);
                } else add(`${open ? 'door_open' : 'door'}_${lower ? 'lower' : 'upper'}`, x, y, z, yaw, wall);
                break;
            }
            case 'lantern': {
                const inWall = (mask[0] && mask[2]) || (mask[1] && mask[3]);
                if (inWall) {
                    const wall = neighbourWall(store, x, y, z) || 'plaster';
                    add('wall_core', x, y, z, 0, wall);
                    mask.forEach((on, i) => { if (on) add('wall_arm', x, y, z, DIRS[i][2], wall); });
                    add('sconce', x, y, z, wallAxis(), wall);
                } else add('lantern', x, y, z, 0, k);
                break;
            }
            case 'ladder': {
                // Back against the neighbour it leans on: the side with a solid voxel at this height (or the ledge above).
                let yaw = 0;
                const attachment=ladderAttachment(store,x,y,z);
                if(attachment)yaw=yawToward(...attachment);
                add(keyOf(get(x, y, z + 1)) === 'ladder' ? 'ladder' : 'ladder_top', x, y, z, yaw, k);
                break;
            }
            case 'stairs': {
                const top = !['stairs_wood', 'stairs_stone', 'steel_stair'].includes(keyOf(get(x, y, z + 1)));
                if (!top) { add('stair_block', x, y, z, 0, k); break; }
                add('stair_step', x, y, z, stairYaw(store, x, y, z), k);
                break;
            }
            case 'furniture': {
                if (hint?.piece && add(hint.piece, x, y, z, hint.yaw || 0, k)) break;
                const below = keyOf(store.get(x, y, z - 1)), above = keyOf(store.get(x, y, z + 1));
                const piece = {
                    sofa: 'sofa', bed: 'bed_foot', desk: 'desk_mid',
                    cabinet: above === 'cabinet' ? 'wardrobe_lower' : below === 'cabinet' ? 'wardrobe_upper' : 'kitchen',
                    appliance: above === 'appliance' ? 'fridge_lower' : below === 'appliance' ? 'fridge_upper' : 'washer',
                    shelving: below === 'shelving' ? 'store_shelf_upper' : 'store_shelf_lower',
                    pallet: below === 'pallet' ? 'pallet_top' : 'pallet'
                }[k];
                add(piece, x, y, z, furnitureYaw(store, x, y, z, k), k);
                break;
            }
            case 'prop': {
                const below = keyOf(store.get(x, y, z - 1)) === k;
                switch (k) {
                    case 'privacy_fence': add(below ? 'privacy_fence_top' : 'privacy_fence', x, y, z, lineYaw(sameKey), k); break;
                    case 'railing': grouped(); break;
                    case 'chainlink': add(below ? 'chainlink_top' : 'chainlink', x, y, z, lineYaw(sameKey), k); break;
                    case 'bench': add('bench', x, y, z, lineYaw(sameKey) + (hash(x >> 1, y >> 1, 5) < 0.5 ? 0 : Math.PI), k); break;
                    case 'bin': add('bin', x, y, z, (hash(x, y, z) - 0.5) * 0.6 + (hash(x, y, 9) < 0.5 ? 0 : Math.PI), k); break;
                    case 'pump': add('pump', x, y, z, lineYaw(sameKey), k); break;
                    case 'planter': grouped(); if (keyOf(get(x, y, z + 1)) !== 'planter') add('planter_plants', x, y, z, hash(x, y, z) < 0.5 ? 0 : Math.PI, k); break;
                    default: add(k, x, y, z, lineYaw(sameKey), k);
                }
                break;
            }
            case 'object': {
                if (hint?.member) { if (intact(hint.member)) break; }
                else if (hint?.piece && intact(`${x},${y},${z}`)) {
                    const [ccx, ccy] = hint.centre;
                    add(hint.piece, x, y, z, hint.yaw || 0, k, { dx: ccx - x - 0.5, dy: ccy - y - 0.5, tint: hint.tint, tintSlots: ['carpaint', 'self'] });
                    break;
                }
                add('wreck', x, y, z, hash(x, y, z) * 6.28, k, { tint: k === 'container' ? hint?.tint || null : null });
                break;
            }
            case 'crate': add('crate', x, y, z, (hash(x, y, z) - 0.5) * (keyOf(get(x, y, z - 1)) === 'crate' ? 0.5 : 0.18), k); break;
            case 'barrel': add('barrel', x, y, z, hash(x, y, z) * 6.28, k); break;
            case 'sandbag': grouped(); break;
            case 'drystone': grouped(); break;
            case 'fence': add('fence', x, y, z, lineYaw(sameKey), k); break;
            case 'hay': add('hay', x, y, z, lineYaw(sameKey) + (hash(x, y, z) - 0.5) * 0.2, k); break;
            case 'stall': add('stall', x, y, z, lineYaw(sameKey) + (hash(x >> 1, y >> 1, 3) < 0.5 ? 0 : Math.PI), k); break;
            case 'cart': {
                const yaw = lineYaw(sameKey);
                const fx = Math.round(Math.cos(yaw)), fy = Math.round(-Math.sin(yaw));   // +X of the piece in grid terms
                add('cart_body', x, y, z, yaw, k); add('cart_wheels', x, y, z, yaw, k);
                if (!sameKey(x + fx, y + fy)) { add('cart_end', x, y, z, yaw, k); if (!store.isSolid(x + fx, y + fy, z)) add('cart_shaft', x, y, z, yaw, k); }
                if (!sameKey(x - fx, y - fy)) add('cart_end', x, y, z, yaw + Math.PI, k);
                break;
            }
            case 'rock': {
                const onRock = keyOf(get(x, y, z - 1)) === 'rock';
                add(onRock ? 'rock_top' : `rock#${Math.floor(hash(x, y, z) * 3)}`, x, y, z, hash(x, y, z + 1) * 6.28, k, { scale: onRock ? 1 : 0.95 + hash(x, y, 2) * 0.12 });
                break;
            }
            case 'hedge': grouped(); break;
            case 'foliage': {
                if (hint?.member && intact(hint.member)) break;
                add('foliage', x, y, z, hash(x, y, z) * 6.28, k, { scale: 0.92 + hash(z, x, y) * 0.2 });
                break;
            }
            case 'trunk': {
                if (hint?.piece && intact(`${x},${y},${z}`)) { add(hint.piece, x, y, z, hint.yaw || 0, k, { scale: hint.scale || 1 }); break; }
                if (hint?.member && intact(hint.member)) break;
                add(keyOf(get(x, y, z - 1)) === 'trunk' ? 'trunk' : 'trunk_base', x, y, z, hash(x, y, z) * 6.28, k);
                break;
            }
            case 'post': {
                if (hint?.piece) { add(hint.piece, x, y, z, 0, k); break; }
                // A column that holds something up (a forecourt canopy) is a steel column; otherwise a lamp post.
                let t = z; while (keyOf(store.get(x, y, t + 1)) === 'metal') t++;
                if (store.isSolid(x, y, t + 1) && keyOf(store.get(x, y, t + 1)) !== 'lantern') { add('column', x, y, z, 0, k); break; }
                add(keyOf(get(x, y, z - 1)) === 'metal' ? 'lamp_post' : 'lamp_base', x, y, z, 0, k);
                break;
            }
            case 'table': add('table', x, y, z, lineYaw(sameKey), k); break;
            case 'shelf': add('shelf', x, y, z, shelfYaw(store, x, y, z), k); break;
            case 'banner': add('banner', x, y, z, lineYaw((ax, ay) => keyOf(get(ax, ay, z)) === 'cloth' || keyOf(get(ax, ay, z)) === 'trunk'), k); break;
            case 'crystal': add('crystal', x, y, z, hash(x, y, z) * 6.28, k); break;
            case 'roof': {
                // The surface is RoofBuilder's. The bottom roof voxel on the roof outline also gets a knee wall in the
                // building's wall material, closing the attic under the eaves.
                const isRoof = (ax, ay, az) => store.get(ax, ay, az) === MAT.roof;
                if (isRoof(x, y, z - 1)) break;
                const edge = (ax, ay) => DIRS.some(([dx, dy]) => !isRoof(ax + dx, ay + dy, z));
                if (!edge(x, y)) break;
                const wall = neighbourWall(store, x, y, z - 1) || 'plaster';
                add('wall_core', x, y, z, 0, wall);
                DIRS.forEach(([dx, dy, yaw]) => { if (isRoof(x + dx, y + dy, z) && edge(x + dx, y + dy)) add('wall_arm', x, y, z, yaw, wall); });
                break;
            }
        }
    }
}

function neighbourWall(store, x, y, z) {
    for (const dz of [0, -1, 1]) for (const [dx, dy] of DIRS) { const k = keyOf(store.get(x + dx, y + dy, z + dz)); if (WALLS.has(k)) return k; }
    return null;
}
/** The direction the stair run rises: the neighbour whose top is one voxel higher. */
function stairYaw(store, x, y, z) {
    const isStair = id => ['stairs_wood', 'stairs_stone', 'steel_stair'].includes(keyOf(id));
    for (const [dx, dy, yaw] of DIRS) {
        if (isStair(store.get(x + dx, y + dy, z + 1)) && !isStair(store.get(x + dx, y + dy, z + 2))) return yaw;
    }
    for (const [dx, dy, yaw] of DIRS) {   // the landing at the top of the run
        if (store.isSolid(x + dx, y + dy, z + 1) && !store.isSolid(x + dx, y + dy, z + 2) && !isStair(store.get(x + dx, y + dy, z + 1))) return yaw;
    }
    for (const [dx, dy, yaw] of DIRS) if (isStair(store.get(x + dx, y + dy, z - 1)) && !isStair(store.get(x + dx, y + dy, z))) return yaw + Math.PI;
    return 0;
}
/** Shelves stand with their back to a wall. */
function shelfYaw(store, x, y, z) {
    for (const [dx, dy, yaw] of DIRS) if (WALL_LIKE.has(keyOf(store.get(x + dx, y + dy, z)))) return yaw + Math.PI / 2;
    return 0;
}
/** Unhinted furniture: back to the nearest wall-like neighbour, else along its run. */
function furnitureYaw(store, x, y, z, key) {
    for (const [dx, dy] of DIRS) if (WALL_LIKE.has(keyOf(store.get(x + dx, y + dy, z)))) return yawToward(dx, dy);
    if (keyOf(store.get(x + 1, y, z)) === key || keyOf(store.get(x - 1, y, z)) === key) return 0;
    return -Math.PI / 2;
}
export { MAT };
