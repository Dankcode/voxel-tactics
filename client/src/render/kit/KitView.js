// Autotiles structure and cover voxels into tile-set pieces, chunk by chunk, as instanced meshes.
//
// The voxel grid stays the gameplay truth. This only decides what each voxel looks like, from its material and its
// neighbours: wall runs become thin panels that join at posts, with timber beams, corner posts or quoins, coping on
// exposed tops and dark section caps under the cutaway; glass in a wall run becomes a framed window; door voxels
// become framed doors (open ones swing in); the top stair voxel becomes two treads facing up the run; roof voxels
// become a continuous sloped roof with eaves (RoofBuilder); cover voxels become sandbags, field walls, fences, crates,
// barrels, hay, carts, stalls and boulders oriented along their line. Destroying a voxel rebuilds its chunk, so a shot
// wall loses a panel and a blasted roof gets a hole.
import * as THREE from 'three';
import { MATERIALS, MAT, AIR } from '../../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../../shared/voxel/VoxelStore.js';
import { buildRoofGeometry } from './RoofBuilder.js';

const WALLS = new Set(['stone', 'plaster', 'timber']);
const WALL_LIKE = new Set(['stone', 'plaster', 'timber', 'city_wall', 'glass', 'door', 'door_open', 'lantern']);
const LINEAR = new Set(['sandbag', 'drystone', 'fence', 'hay', 'cart', 'stall']);
const DIRS = [[1, 0, 0], [0, 1, -Math.PI / 2], [-1, 0, Math.PI], [0, -1, Math.PI / 2]];   // dx, dy, yaw (+X arm → dir)
const keyOf = id => MATERIALS[id]?.key;
function hash(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

/** Which kit handler draws this voxel (null → the cube mesher draws it). Shared with ChunkMesher. */
export function kitHandler(store, x, y, z, id = store.get(x, y, z)) {
    const k = keyOf(id);
    if (!k) return null;
    if (WALLS.has(k)) return 'wall';
    switch (k) {
        case 'glass': return 'window';
        case 'door': case 'door_open': return 'door';
        case 'stairs_wood': case 'stairs_stone': return 'stairs';
        case 'roof': return 'roof';
        case 'crate': return 'crate';
        case 'barrel_powder': case 'barrel_water': return 'barrel';
        case 'sandbag': case 'drystone': case 'fence': case 'hay': case 'cart': case 'stall': return k;
        case 'rock': return 'rock';
        case 'hedge': return 'hedge';
        case 'leaves': return 'foliage';
        case 'trunk': return 'trunk';
        case 'lantern': return 'lantern';
        case 'furniture': return 'table';
        case 'shelf': return 'shelf';
        case 'cloth': return 'banner';
        case 'crystal': return 'crystal';
        case 'metal': {
            // A lone iron column is a lamp post; iron blocks next to other solids (forges) stay cubes.
            for (const [dx, dy] of DIRS) if (store.isSolid(x + dx, y + dy, z)) return null;
            return 'post';
        }
        default: return null;
    }
}

export class KitView {
    constructor(kit, clipping) {
        this.kit = kit; this.clipping = clipping;
        this.geoCache = new Map();
    }
    /** Build the instanced meshes for one chunk. opts: { cutZ, tint(x,y,z,m) } → THREE.Object3D[] */
    buildChunk(store, cx, cy, cz, opts = {}) {
        const cut = opts.cutZ ?? Infinity;
        const inst = new Map();          // `${piece}|${slot}|${selfKey}` → { piece, part, selfKey, mats: [], cols: [] }
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
        const add = (piece, x, y, z, yaw = 0, selfKey = 'stone', { scale = 1, dx = 0, dy = 0, dz = 0, tint = null } = {}) => {
            const parts = this.kit.piece(piece); if (!parts) return;
            q.setFromAxisAngle(up, yaw); s.set(scale, scale, scale); p.set(x + 0.5 + dx, z + dz, y + 0.5 + dy);
            m4.compose(p, q, s);
            const t = tint || opts.tint?.(x, y, z) || null;
            const shade = 0.94 + hash(x, y, z) * 0.1;
            parts.forEach((part, i) => {
                const k = `${piece}|${i}|${part.slot === 'self' || part.slot === 'barrel' ? selfKey : ''}`;
                let e = inst.get(k);
                if (!e) inst.set(k, e = { part, selfKey, mats: [], cols: [] });
                e.mats.push(m4.clone());
                e.cols.push(t ? [t[0] * shade, t[1] * shade, t[2] * shade] : [shade, shade, shade]);
            });
        };
        const get = (x, y, z) => (z >= cut ? AIR : store.get(x, y, z));
        const wallLike = (x, y, z) => WALL_LIKE.has(keyOf(get(x, y, z)));
        const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
        for (let z = z0; z < Math.min(z0 + CHUNK, store.height, cut); z++)
            for (let y = y0; y < Math.min(y0 + CHUNK, store.depth); y++)
                for (let x = x0; x < Math.min(x0 + CHUNK, store.width); x++) {
                    const id = store.get(x, y, z);
                    if (id === AIR && keyOf(id) !== 'door_open') continue;
                    const h = kitHandler(store, x, y, z, id);
                    if (!h) continue;
                    const k = keyOf(id);
                    this.emit(h, k, x, y, z, { store, get, wallLike, add, cut });
                }
        // door_open voxels are not 'solid' but still drawn: scan for them explicitly (already handled above when id is
        // door_open because MATERIALS[door_open] exists).
        const out = [];
        for (const e of inst.values()) {
            const mesh = new THREE.InstancedMesh(e.part.geometry, this.kit.material(e.part.slot, e.selfKey, this.clipping), e.mats.length);
            e.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(e.cols.flat()), 3);
            mesh.castShadow = !['glass', 'glow', 'cap'].includes(e.part.slot);
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

    emit(h, k, x, y, z, { store, get, wallLike, add, cut }) {
        const mask = DIRS.map(([dx, dy]) => wallLike(x + dx, y + dy, z));
        const lineYaw = (same) => {
            const ex = same(x + 1, y) || same(x - 1, y), ey = same(x, y + 1) || same(x, y - 1);
            if (ex) return 0;
            if (ey) return -Math.PI / 2;
            return hash(x, y, 7) < 0.5 ? 0 : -Math.PI / 2;
        };
        const wallAxis = () => lineYaw((ax, ay) => wallLike(ax, ay, z));
        switch (h) {
            case 'wall': {
                add('wall_core', x, y, z, 0, k);
                mask.forEach((on, i) => { if (on) add('wall_arm', x, y, z, DIRS[i][2], k); });
                const above = get(x, y, z + 1), aboveKey = keyOf(above);
                const corner = (mask[0] || mask[2]) && (mask[1] || mask[3]);
                const end = mask.filter(Boolean).length === 1;
                if (k !== 'stone' && (corner || end)) add('wall_post', x, y, z, 0, k);
                if (k === 'stone' && (corner || end)) add('wall_quoin', x, y, z, 0, k);
                const topOfStorey = !WALL_LIKE.has(aboveKey);
                if (k !== 'stone' && topOfStorey && aboveKey !== undefined && above !== AIR) {
                    add('wall_beam_core', x, y, z, 0, k);
                    mask.forEach((on, i) => { if (on) add('wall_beam', x, y, z, DIRS[i][2], k); });
                }
                if (k === 'timber' && !topOfStorey && !corner && mask.filter(Boolean).length === 2 && hash(x, y, z) < 0.35) add('wall_brace', x, y, z, wallAxis(), k);
                // Exposed top (parapet, ruin, range wall): coping. Cut by the storey cutaway: a dark section cap.
                const realAbove = store.get(x, y, z + 1);
                if (z + 1 >= cut && realAbove !== AIR) {
                    add('cap_core', x, y, z, 0, k); mask.forEach((on, i) => { if (on) add('cap_arm', x, y, z, DIRS[i][2], k); });
                } else if (realAbove === AIR) {
                    add('coping_core', x, y, z, 0, k); mask.forEach((on, i) => { if (on) add('coping_arm', x, y, z, DIRS[i][2], k); });
                }
                break;
            }
            case 'window': {
                const wall = neighbourWall(store, x, y, z) || 'plaster';
                const yaw = wallAxis();
                add('window', x, y, z, yaw, wall);
                if (z + 1 >= cut && store.get(x, y, z + 1) !== AIR) { add('cap_core', x, y, z, 0, wall); add('cap_arm', x, y, z, yaw, wall); add('cap_arm', x, y, z, yaw + Math.PI, wall); }
                break;
            }
            case 'door': {
                const lower = keyOf(store.get(x, y, z - 1)) !== 'door' && keyOf(store.get(x, y, z - 1)) !== 'door_open';
                const open = k === 'door_open';
                add(`${open ? 'door_open' : 'door'}_${lower ? 'lower' : 'upper'}`, x, y, z, wallAxis(), neighbourWall(store, x, y, z) || 'plaster');
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
            case 'stairs': {
                const top = !['stairs_wood', 'stairs_stone'].includes(keyOf(get(x, y, z + 1)));
                if (!top) { add('stair_block', x, y, z, 0, k); break; }
                add('stair_step', x, y, z, stairYaw(store, x, y, z), k);
                break;
            }
            case 'crate': add('crate', x, y, z, (hash(x, y, z) - 0.5) * (keyOf(get(x, y, z - 1)) === 'crate' ? 0.5 : 0.18), k); break;
            case 'barrel': add('barrel', x, y, z, hash(x, y, z) * 6.28, k); break;
            case 'sandbag': add('sandbags', x, y, z, lineYaw((ax, ay) => keyOf(get(ax, ay, z)) === 'sandbag'), k); break;
            case 'drystone': add('drystone', x, y, z, lineYaw((ax, ay) => keyOf(get(ax, ay, z)) === 'drystone') + (hash(x, y, z) < 0.5 ? 0 : Math.PI), k); break;
            case 'fence': add('fence', x, y, z, lineYaw((ax, ay) => keyOf(get(ax, ay, z)) === 'fence'), k); break;
            case 'hay': add('hay', x, y, z, lineYaw((ax, ay) => keyOf(get(ax, ay, z)) === 'hay') + (hash(x, y, z) - 0.5) * 0.2, k); break;
            case 'stall': add('stall', x, y, z, lineYaw((ax, ay) => keyOf(get(ax, ay, z)) === 'stall') + (hash(x >> 1, y >> 1, 3) < 0.5 ? 0 : Math.PI), k); break;
            case 'cart': {
                const same = (ax, ay) => keyOf(get(ax, ay, z)) === 'cart';
                const yaw = lineYaw(same);
                const fx = Math.round(Math.cos(yaw)), fy = Math.round(-Math.sin(yaw));   // +X of the piece in grid terms
                add('cart_body', x, y, z, yaw, k); add('cart_wheels', x, y, z, yaw, k);
                if (!same(x + fx, y + fy)) { add('cart_end', x, y, z, yaw, k); if (!store.isSolid(x + fx, y + fy, z)) add('cart_shaft', x, y, z, yaw, k); }
                if (!same(x - fx, y - fy)) add('cart_end', x, y, z, yaw + Math.PI, k);
                break;
            }
            case 'rock': {
                const onRock = keyOf(get(x, y, z - 1)) === 'rock';
                add(onRock ? 'rock_top' : `rock#${Math.floor(hash(x, y, z) * 3)}`, x, y, z, hash(x, y, z + 1) * 6.28, k, { scale: onRock ? 1 : 0.95 + hash(x, y, 2) * 0.12 });
                break;
            }
            case 'hedge': add('hedge', x, y, z, hash(x, y, z) * 6.28, k); break;
            case 'foliage': add('foliage', x, y, z, hash(x, y, z) * 6.28, k, { scale: 0.92 + hash(z, x, y) * 0.2 }); break;
            case 'trunk': add(keyOf(get(x, y, z - 1)) === 'trunk' ? 'trunk' : 'trunk_base', x, y, z, hash(x, y, z) * 6.28, k); break;
            case 'post': add(keyOf(get(x, y, z - 1)) === 'metal' ? 'lamp_post' : 'lamp_base', x, y, z, 0, k); break;
            case 'table': add('table', x, y, z, lineYaw((ax, ay) => keyOf(get(ax, ay, z)) === 'furniture'), k); break;
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
    const isStair = id => ['stairs_wood', 'stairs_stone'].includes(keyOf(id));
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
export { MAT };
