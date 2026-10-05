// TacticalBuildingBuilder (PLAN-01 rev 2 §12.1–12.2).
//
// vibe-game's open-world buildings are solid 3-voxel shells with mesh roofs. A mission rebuilds each
// one from its record as a hollow, multi-storey voxel building: 1-voxel walls, a storey every 3 voxels
// (slab + 2 headroom, vibe-game INTERIOR_FLOOR_SPACING), corridors for large footprints, partitioned
// rooms for small ones, doors, glass windows, stair runs (vibe-game createStairRun), destructible
// furniture placed with interior-v2's connectivity guard, and voxel roofs.
import { MAT, AIR } from '../voxel/Materials.js';
import { createStairRun } from '../world/StairRun.js';

export const STOREY = 3;
const SIDES = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

/** Furniture recipes per room kind. h = height in voxels; len = cells along the wall. */
const ITEMS = {
    table: { mat: 'furniture', h: 1, place: 'center', len: 2 }, bench: { mat: 'furniture', h: 1, place: 'center', len: 1 },
    shelf: { mat: 'shelf', h: 2, place: 'wall', len: 2 }, crate: { mat: 'crate', h: 1, place: 'wall', len: 1 },
    crates: { mat: 'crate', h: 2, place: 'wall', len: 1 }, keg: { mat: 'barrel_powder', h: 1, place: 'wall', len: 1 },
    water: { mat: 'barrel_water', h: 1, place: 'wall', len: 1 }, bed: { mat: 'furniture', h: 1, place: 'wall', len: 2 },
    counter: { mat: 'furniture', h: 1, place: 'center', len: 3 }, forge: { mat: 'metal', h: 1, place: 'wall', len: 2 },
    altar: { mat: 'stone', h: 1, place: 'center', len: 2 }, pew: { mat: 'furniture', h: 1, place: 'center', len: 3 },
    rack: { mat: 'shelf', h: 2, place: 'wall', len: 1 }
};
const ROOM_FURNITURE = {
    living: ['table', 'bench', 'shelf', 'crate'], bedroom: ['bed', 'crate', 'shelf'], shop: ['counter', 'shelf', 'crate'],
    storeroom: ['crates', 'crates', 'keg', 'water', 'crate'], hall: ['table', 'bench', 'bench', 'keg', 'counter'],
    forge: ['forge', 'rack', 'keg', 'crate'], nave: ['altar', 'pew', 'pew', 'pew'], armory: ['rack', 'rack', 'keg', 'crates'],
    barracks: ['bed', 'bed', 'crate'], study: ['shelf', 'shelf', 'table'], office: ['table', 'shelf', 'crate'],
    corridor: ['crate'], cellar: ['crates', 'keg', 'water']
};
const ROLE_ROOMS = {
    home: ['living', 'bedroom'], shop: ['shop', 'storeroom'], inn: ['hall', 'bedroom', 'storeroom'],
    workshop: ['forge', 'storeroom'], temple: ['nave', 'study'], keep: ['hall', 'armory', 'barracks', 'study', 'storeroom', 'office']
};

export function roleFor(record = {}) {
    const text = [record.archetype, record.activity, record.name, record.blueprintId, record.type].filter(Boolean).join(' ').toLowerCase();
    if (/tavern|inn\b|gather/.test(text)) return 'inn';
    if (/church|temple|cathedral|chapel|shrine|abbey/.test(text)) return 'temple';
    if (/manor|keep|castle|palace|guard|barrack|\bhall\b/.test(text)) return 'keep';
    if (/smith|forge|workshop|craft|mill|tannery/.test(text)) return 'workshop';
    if (/shop|market|trade|store|merchant/.test(text)) return 'shop';
    return 'home';
}
export function wallMaterialFor(record = {}) {
    const t = `${record.wallTextureId || ''} ${record.facadeKit || ''} ${record.architectureStyle || ''}`.toLowerCase();
    if (/timber|wood|log/.test(t)) return 'timber';
    if (/stone|castle|granite|keep/.test(t)) return 'stone';
    return 'plaster';
}

/**
 * Build one building into the store.
 * spec: { id, x0, y0, w, d, baseZ, storeys, wall, role, entry: {side, offset}, roof, lit }
 * ctx:  { rng, nextRoomId(), rooms: [] }  — rooms are appended to ctx.rooms with global ids.
 */
export function buildBuilding(store, spec, ctx) {
    const { x0, y0, w, d, baseZ } = spec;
    const storeys = Math.max(1, Math.min(3, spec.storeys | 0 || 1));
    const wallKey = spec.wall || 'plaster';
    const floorKey = wallKey === 'stone' ? 'stone_floor' : 'plank';
    const top = baseZ + STOREY * storeys;
    const rng = ctx.rng;
    const result = { id: spec.id, name: spec.name || spec.id, role: spec.role, x0, y0, w, d, baseZ, storeys, rooms: [], doors: [], windows: [], stairs: [], top };

    // 1. Clear the volume, give it a foundation, lay slabs and the outer wall.
    for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) {
        for (let z = 1; z < baseZ; z++) if (!store.isSolid(x, y, z)) store.set(x, y, z, MAT.soil);
        for (let z = baseZ; z <= top + 4 && z < store.height; z++) store.set(x, y, z, AIR);
    }
    const perimeter = (x, y) => x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + d - 1;
    for (let s = 0; s <= storeys; s++) {
        const fz = baseZ + STOREY * s;
        for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) {
            if (s === storeys) continue;                         // the roof is laid in step 6
            store.set(x, y, fz, MAT[floorKey]);
            if (perimeter(x, y)) for (let h = 1; h < STOREY; h++) store.set(x, y, fz + h, MAT[wallKey]);
        }
    }

    // Roof first, so stair runs to the roof can cut their hatch through it.
    buildRoof(store, spec, top, wallKey);

    // 2. Plan the interior once; every storey shares it so stairs and corridors line up.
    const plan = planInterior(spec, rng);
    const entry = resolveEntry(spec, plan);

    // 3. Partitions, doors and doorways, per storey.
    const roomIdsByStorey = [];
    for (let s = 0; s < storeys; s++) {
        const fz = baseZ + STOREY * s;
        for (const [x, y] of plan.walls) for (let h = 1; h < STOREY; h++) store.set(x, y, fz + h, MAT[wallKey === 'stone' ? 'stone' : wallKey]);
        for (const door of plan.doors) {
            for (let h = 1; h < STOREY; h++) store.set(door.x, door.y, fz + h, door.open ? AIR : MAT.door);
            result.doors.push({ x: door.x, y: door.y, z: fz, storey: s, exterior: false });
        }
        const ids = plan.rooms.map((room, i) => {
            const id = ctx.nextRoomId();
            const kinds = ROLE_ROOMS[spec.role] || ROLE_ROOMS.home;
            const kind = room.kind || (s > 0 && spec.role !== 'keep' ? 'bedroom' : kinds[i % kinds.length]);
            const rec = { id, buildingId: spec.id, storey: s, kind, cells: room.cells, floorZ: fz, lit: rng.next() < 0.55, doors: [] };
            for (const [x, y] of room.cells) for (let h = 1; h < STOREY; h++) store.rooms[store.index(x, y, fz + h)] = id;
            result.rooms.push(rec); ctx.rooms.push(rec);
            return rec;
        });
        roomIdsByStorey.push(ids);
    }

    // 4. Exterior doors (ground storey): the recorded entry plus a back door on the opposite side.
    const exterior = [entry];
    const back = oppositeDoor(spec, plan, entry);
    if (back) exterior.push(back);
    for (const door of exterior) {
        for (let h = 1; h < STOREY; h++) store.set(door.x, door.y, baseZ + h, MAT.door);
        result.doors.push({ x: door.x, y: door.y, z: baseZ, storey: 0, exterior: true, side: door.side });
        // Keep the step outside walkable: clear anything solid right in front of it.
        const [dx, dy] = SIDES[door.side];
        for (let h = 1; h < STOREY; h++) if (store.isSolid(door.x + dx, door.y + dy, baseZ + h)) store.set(door.x + dx, door.y + dy, baseZ + h, AIR);
    }

    // 5. Stairs between storeys (and to the roof of a keep).
    const floorKeys = new Set(plan.floor.map(([x, y]) => `${x},${y}`));
    const doorFront = (x, y) => Object.values(SIDES).map(([dx, dy]) => `${x + dx},${y + dy}`).filter(k => floorKeys.has(k));
    const reserved = new Set([...plan.doors.flatMap(dr => doorFront(dr.x, dr.y)), ...exterior.flatMap(e => doorFront(e.x, e.y))]);
    const flatRoof = !spec.roof || spec.roof === 'flat';
    const runs = storeys - 1 + (flatRoof && (spec.roofAccess ?? (spec.role === 'keep' || (storeys === 1 && w * d >= 80))) ? 1 : 0);
    const footprint = new Set(plan.floor.map(([x, y]) => `${x},${y}`));
    const stairCells = new Set();
    for (let s = 0; s < runs; s++) {
        const fz = baseZ + STOREY * s;
        const run = placeStairRun(plan, footprint, reserved, stairCells, fz);
        if (!run) break;
        run.cells.forEach((c, i) => { for (let z = fz + 1; z <= fz + 1 + i; z++) store.set(c.x, c.y, z, MAT[wallKey === 'stone' ? 'stairs_stone' : 'stairs_wood']); });
        for (const c of [run.before, run.cells[0], run.cells[1]]) for (let z = fz + STOREY; z <= fz + STOREY + 0; z++) store.set(c.x, c.y, z, AIR);
        for (const c of [run.before, ...run.cells, run.after]) { stairCells.add(`${c.x},${c.y}`); reserved.add(`${c.x},${c.y}`); }
        result.stairs.push({ storey: s, cells: run.cells.map(c => ({ x: c.x, y: c.y, z: c.z })), before: run.before, after: run.after, toRoof: s === storeys - 1 });
    }

    // 6. Windows on outer walls (upper voxel of each storey; the sill stays as half cover).
    for (let s = 0; s < storeys; s++) {
        const fz = baseZ + STOREY * s;
        for (const p of perimeterRuns(spec)) {
            p.cells.forEach(([x, y], i) => {
                if (i === 0 || i === p.cells.length - 1 || (i + (s % 2)) % 3 !== 1) return;
                const [ix, iy] = [x - SIDES[p.side][0], y - SIDES[p.side][1]];
                if (!footprint.has(`${ix},${iy}`) || plan.wallSet.has(`${ix},${iy}`)) return;  // a partition meets the wall here
                if (exterior.some(e => Math.abs(e.x - x) + Math.abs(e.y - y) <= 1)) return;
                store.set(x, y, fz + 2, MAT.glass);
                result.windows.push({ x, y, z: fz + 2, side: p.side, storey: s });
            });
        }
    }

    // 8. Furniture (with the interior-v2 connectivity guard) and wall lanterns in lit rooms.
    for (let s = 0; s < storeys; s++) {
        const fz = baseZ + STOREY * s;
        const anchor = s === 0 ? inward(entry) : (result.stairs[s - 1]?.after || null);
        // Stair runs on this storey and the holes cut for the run below are not floor.
        const obstacles = new Set();
        for (const run of result.stairs) {
            if (run.storey === s) run.cells.forEach(c => obstacles.add(`${c.x},${c.y}`));
            if (run.storey === s - 1) [run.before, run.cells[0], run.cells[1]].forEach(c => obstacles.add(`${c.x},${c.y}`));
        }
        furnish(store, plan, roomIdsByStorey[s], fz, reserved, rng, anchor, obstacles);
        for (const room of roomIdsByStorey[s]) {
            if (!room.lit) continue;
            const wallCell = room.cells.flatMap(([x, y]) => Object.values(SIDES).map(([dx, dy]) => [x + dx, y + dy]))
                .find(([x, y]) => store.get(x, y, fz + 2) === MAT[wallKey] || store.get(x, y, fz + 2) === MAT.stone);
            if (wallCell) store.set(wallCell[0], wallCell[1], fz + 2, MAT.lantern);
        }
    }
    result.entry = entry;
    result.exits = exterior;
    return result;
}

function around(x, y) { return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => `${x + dx},${y + dy}`); }
function inward(door) { const [dx, dy] = SIDES[door.side]; return { x: door.x - dx, y: door.y - dy }; }

/**
 * Interior plan: floor cells, partition walls, interior doors/doorways and rooms.
 * Large footprints get a 2-wide corridor down the long axis with rooms either side (each with a door
 * onto the corridor); small ones a single partition with a doorway; tiny ones one room.
 */
export function planInterior(spec, rng) {
    const { x0, y0, w, d } = spec;
    const ix0 = x0 + 1, iy0 = y0 + 1, ix1 = x0 + w - 2, iy1 = y0 + d - 2;
    const iw = ix1 - ix0 + 1, id = iy1 - iy0 + 1;
    const horizontal = iw >= id;                      // long axis runs along x
    const longLen = horizontal ? iw : id, shortLen = horizontal ? id : iw;
    // Map long/short axis coordinates to x/y.
    const at = (l, s) => horizontal ? [ix0 + l, iy0 + s] : [ix0 + s, iy0 + l];
    const walls = [], doors = [], rooms = [];
    const wallSet = new Set();
    const addWall = (l, s) => { const c = at(l, s); walls.push(c); wallSet.add(`${c[0]},${c[1]}`); };
    let layout = 'single';

    if (shortLen >= 8 && longLen >= 8) {
        layout = 'corridor';
        const c0 = Math.floor((shortLen - 2) / 2);    // corridor occupies short rows c0, c0+1
        const wallA = c0 - 1, wallB = c0 + 2;
        for (let l = 0; l < longLen; l++) { addWall(l, wallA); addWall(l, wallB); }
        const corridorCells = [];
        for (let l = 0; l < longLen; l++) corridorCells.push(at(l, c0), at(l, c0 + 1));
        rooms.push({ kind: 'corridor', cells: corridorCells, corridor: true });
        for (const [s0, s1, doorRow] of [[0, wallA - 1, wallA], [wallB + 1, shortLen - 1, wallB]]) {
            if (s1 < s0) continue;
            // Split the band into rooms 4–6 cells long.
            const count = Math.max(1, Math.round(longLen / 5));
            const size = Math.floor((longLen - (count - 1)) / count);
            let l0 = 0;
            for (let r = 0; r < count; r++) {
                const l1 = r === count - 1 ? longLen - 1 : l0 + size - 1;
                if (r < count - 1) {
                    for (let s = s0; s <= s1; s++) addWall(l1 + 1, s);
                    // Connecting door between neighbouring rooms (a second way in for breaching).
                    if (s1 - s0 >= 1 && rng.next() < 0.6) { const [cx, cy] = at(l1 + 1, Math.floor((s0 + s1) / 2)); doors.push({ x: cx, y: cy, open: false, connecting: true }); }
                }
                const cells = [];
                for (let l = l0; l <= l1; l++) for (let s = s0; s <= s1; s++) cells.push(at(l, s));
                rooms.push({ cells });
                const dl = Math.floor((l0 + l1) / 2);
                const [dx, dy] = at(dl, doorRow);
                doors.push({ x: dx, y: dy, open: false });
                l0 = l1 + 2;
            }
        }
    } else if (longLen >= 6) {
        layout = 'split';
        const split = Math.max(3, Math.min(longLen - 3, Math.round(longLen * (0.5 + (rng.next() - 0.5) * 0.15))));
        for (let s = 0; s < shortLen; s++) addWall(split, s);
        const mid = Math.floor(shortLen / 2);
        const [dx, dy] = at(split, mid);
        doors.push({ x: dx, y: dy, open: shortLen <= 3 || rng.next() < 0.35 });
        const a = [], b = [];
        for (let l = 0; l < longLen; l++) for (let s = 0; s < shortLen; s++) { if (l < split) a.push(at(l, s)); else if (l > split) b.push(at(l, s)); }
        rooms.push({ cells: a }, { cells: b });
    } else {
        const cells = [];
        for (let l = 0; l < longLen; l++) for (let s = 0; s < shortLen; s++) cells.push(at(l, s));
        rooms.push({ cells });
    }
    // Doors replace the wall cell they sit in.
    for (const dr of doors) { wallSet.delete(`${dr.x},${dr.y}`); }
    const wallsFinal = walls.filter(([x, y]) => wallSet.has(`${x},${y}`));
    const floor = [];
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) if (!wallSet.has(`${x},${y}`)) floor.push([x, y]);
    return { layout, horizontal, walls: wallsFinal, wallSet, doors, rooms, floor, ix0, iy0, ix1, iy1 };
}

function sideCells(spec, side) {
    const { x0, y0, w, d } = spec, out = [];
    if (side === 'n' || side === 's') { const y = side === 'n' ? y0 : y0 + d - 1; for (let x = x0; x < x0 + w; x++) out.push([x, y]); }
    else { const x = side === 'w' ? x0 : x0 + w - 1; for (let y = y0; y < y0 + d; y++) out.push([x, y]); }
    return out;
}
function perimeterRuns(spec) { return ['n', 'e', 's', 'w'].map(side => ({ side, cells: sideCells(spec, side) })); }

/** Entry door on the recorded side, nudged so it opens onto floor (into the corridor when possible). */
function resolveEntry(spec, plan) {
    const side = spec.entry?.side || 's';
    const cells = sideCells(spec, side);
    const corridor = plan.rooms.find(r => r.corridor);
    const ok = ([x, y]) => { const [dx, dy] = SIDES[side]; return !plan.wallSet.has(`${x - dx},${y - dy}`) && plan.floor.some(([fx, fy]) => fx === x - dx && fy === y - dy); };
    const scored = cells.slice(1, -1).filter(ok).map(c => {
        const [dx, dy] = SIDES[side];
        const inCorridor = corridor?.cells.some(([x, y]) => x === c[0] - dx && y === c[1] - dy) ? 0 : 10;
        const want = spec.entry?.offset != null ? cells[Math.min(cells.length - 2, Math.max(1, spec.entry.offset))] : cells[Math.floor(cells.length / 2)];
        return { c, score: inCorridor + Math.abs(c[0] - want[0]) + Math.abs(c[1] - want[1]) };
    }).sort((a, b) => a.score - b.score);
    const [x, y] = (scored[0] || { c: cells[Math.floor(cells.length / 2)] }).c;
    return { x, y, side };
}
function oppositeDoor(spec, plan, entry) {
    const opp = { n: 's', s: 'n', e: 'w', w: 'e' }[entry.side];
    const cells = sideCells(spec, opp).slice(1, -1);
    const [dx, dy] = SIDES[opp];
    const candidates = cells.filter(([x, y]) => !plan.wallSet.has(`${x - dx},${y - dy}`) && plan.floor.some(([fx, fy]) => fx === x - dx && fy === y - dy));
    if (!candidates.length) return null;
    const mid = candidates[Math.floor(candidates.length / 2)];
    return { x: mid[0], y: mid[1], side: opp };
}

function placeStairRun(plan, footprint, reserved, stairCells, baseZ) {
    const dirs = plan.horizontal ? ['east', 'west', 'south', 'north'] : ['south', 'north', 'east', 'west'];
    // Prefer the corridor's far lane, then any room cell along a wall.
    const corridor = plan.rooms.find(r => r.corridor);
    const origins = [...(corridor ? corridor.cells.slice().reverse() : []), ...plan.floor];
    const floorSet = new Set(plan.floor.map(([x, y]) => `${x},${y}`));
    for (const [ox, oy] of origins) for (const direction of dirs) {
        // Landing cells may sit in front of a door; the steps themselves may not.
        const run = createStairRun({ origin: { x: ox, y: oy }, direction, rise: STOREY, footprintSet: footprint, reserved: stairCells, baseZ });
        if (!run || run.cells.some(c => reserved.has(`${c.x},${c.y}`))) continue;
        const blocked = new Set([...run.cells.map(c => `${c.x},${c.y}`), ...stairCells]);
        // Lower floor: everything except the stair cells stays connected and touches the run's foot.
        if (!connected(floorSet, blocked, [run.before.x, run.before.y])) continue;
        // Upper floor: the two cut cells become holes; the landing must reach the rest.
        const holes = new Set([`${run.cells[0].x},${run.cells[0].y}`, `${run.cells[1].x},${run.cells[1].y}`, `${run.before.x},${run.before.y}`, ...stairCells]);
        if (!connected(floorSet, holes, [run.after.x, run.after.y])) continue;
        return run;
    }
    return null;
}

function connected(floorSet, blocked, start) {
    const k0 = `${start[0]},${start[1]}`;
    if (!floorSet.has(k0) || blocked.has(k0)) return false;
    const seen = new Set([k0]), q = [start];
    while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const k = `${x + dx},${y + dy}`;
            if (!seen.has(k) && floorSet.has(k) && !blocked.has(k)) { seen.add(k); q.push([x + dx, y + dy]); }
        }
    }
    let total = 0; for (const k of floorSet) if (!blocked.has(k)) total++;
    return seen.size === total;
}

function furnish(store, plan, rooms, fz, reserved, rng, anchor, obstacles = new Set()) {
    const floorSet = new Set(plan.floor.map(([x, y]) => `${x},${y}`));
    const blocked = new Set(obstacles);
    // Cells in front of doors and on stair runs stay free.
    const keepFree = new Set([...reserved, ...obstacles]);
    const start = anchor ? [anchor.x, anchor.y] : plan.floor[0];
    for (const room of rooms) {
        const list = ROOM_FURNITURE[room.kind] || ROOM_FURNITURE.living;
        const cells = room.cells.filter(([x, y]) => !keepFree.has(`${x},${y}`) && store.get(x, y, fz + 1) === AIR);
        const isWall = ([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => store.isSolid(x + dx, y + dy, fz + 1));
        for (const itemKey of list) {
            const item = ITEMS[itemKey]; if (!item) continue;
            const pool = cells.filter(c => (item.place === 'wall') === isWall(c) && !blocked.has(`${c[0]},${c[1]}`));
            rng.shuffle(pool);
            let placed = false;
            for (const [x, y] of pool.slice(0, 24)) {
                const span = [[x, y]];
                for (let i = 1; i < item.len; i++) {
                    const nx = plan.horizontal ? x + i : x, ny = plan.horizontal ? y : y + i;
                    if (!room.cells.some(([cx, cy]) => cx === nx && cy === ny) || keepFree.has(`${nx},${ny}`) || blocked.has(`${nx},${ny}`)) { span.length = 0; break; }
                    span.push([nx, ny]);
                }
                if (!span.length) continue;
                for (const [sx, sy] of span) blocked.add(`${sx},${sy}`);
                if (!connected(floorSet, new Set([...blocked]), start)) { for (const [sx, sy] of span) blocked.delete(`${sx},${sy}`); continue; }
                for (const [sx, sy] of span) for (let h = 1; h <= item.h; h++) store.set(sx, sy, fz + h, MAT[item.mat]);
                placed = true; break;
            }
            if (!placed) continue;
        }
    }
}

function buildRoof(store, spec, top, wallKey) {
    const { x0, y0, w, d } = spec;
    const style = spec.roof || 'flat';
    const slab = wallKey === 'timber' ? 'plank' : wallKey === 'stone' ? 'stone_floor' : 'plaster';
    for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) store.set(x, y, top, MAT[style === 'flat' || style === 'terrace' ? slab : 'roof']);
    if (style === 'flat' || style === 'terrace') {
        for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) {
            const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + d - 1;
            if (edge) store.set(x, y, top + 1, MAT[wallKey === 'timber' ? 'plank' : wallKey]);
        }
        if (style === 'terrace' && w > 6 && d > 6) {
            const ox = Math.floor(w / 3), oy = Math.floor(d / 3);
            for (let y = y0 + oy; y < y0 + d - oy; y++) for (let x = x0 + ox; x < x0 + w - ox; x++) store.set(x, y, top + 1, MAT[slab]);
        }
        // Roof hatches made by keep stair runs are already cut by buildBuilding.
    } else {
        // Pitched / dome: shrinking layers of tiles.
        for (let layer = 1; layer <= 3; layer++) {
            const inset = layer;
            if (w - inset * 2 < 1 || d - inset * 2 < 1) break;
            for (let y = y0 + inset; y < y0 + d - inset; y++) for (let x = x0 + inset; x < x0 + w - inset; x++) store.set(x, y, top + layer, MAT.roof);
        }
    }
}
