import { hashString, createRng } from '../util/Rng.js';
import { createVoxelBlock } from '../world/TileLibrary.js';
import { createStairRun } from '../world/StairRun.js';
import { VoxelWorld } from '../world/VoxelWorld.js';
import { reachable, nodeKey } from '../world/PathSearch.js';

/**
 * Building interiors (interior-v2).
 *
 * v1 laid every building out as a maze of 3×3 cells divided by walls, with the same fixture in
 * each cell, so a cottage read like a dungeon. v2 builds the floor plan from the building's role:
 *
 *   home      living room with hearth and table, and a bedroom behind a partition
 *   shop      shop floor with a counter, storeroom behind
 *   inn       common hall with a bar, tables and hearth; bedrooms upstairs
 *   workshop  forge, anvil and racks in one open room, a small store at the side
 *   temple    a nave of pews facing the altar
 *   keep      a great hall with a long table and hearth, a study at the side
 *
 * Rooms are spacious (≈1.7× the exterior footprint, MapleStory-2-style open interiors), walls are
 * three blocks high, upper floors are reached by a stair run along the east wall. Furniture is
 * placed against walls first and never blocks a doorway, the stair or the path to any room (a
 * flood fill rejects any piece that would). Deterministic: the same spec gives the same layout
 * and content hash on every client and the server.
 */
export const INTERIOR_VERSION = 'interior-v2';
// Two empty headroom cells plus a solid floor slab between storeys.
export const INTERIOR_FLOOR_SPACING = 3;
const cache = new Map();
const ROLES = ['home', 'shop', 'inn', 'workshop', 'temple', 'keep'];

/** Interior role for a building (blueprint id, archetype, activity, name). */
export function interiorRoleFor(building = {}) {
    const text = [building.blueprintId, building.archetype, building.landmarkType, building.activity, building.name, building.type]
        .filter(Boolean).join(' ').toLowerCase();
    if (/tavern|inn\b|gather/.test(text)) return 'inn';
    if (/church|temple|cathedral|chapel|shrine|abbey/.test(text)) return 'temple';
    if (/manor|keep|castle|palace|guard|barrack|\bhall\b/.test(text)) return 'keep';
    if (/smith|forge|workshop|craft|mill|tannery/.test(text)) return 'workshop';
    if (/shop|market|trade|store|bayfront|merchant/.test(text)) return 'shop';
    return 'home';
}

export function interiorSpec(world, building) {
    return {
        seed: hashString(`${world.id}:${world.generationVersion}:${world.burgId}:${building.id}:${INTERIOR_VERSION}`),
        archetype: interiorRoleFor(building),
        footprintArea: building.footprintCells?.length || building.width * building.height,
        aspect: building.width / building.height,
        storeys: Math.max(1, building.stories || 1),
        themeId: building.architectureThemeId || 'northern-european',
        wealth: 1
    };
}

export function generateInterior(spec) {
    const role = ROLES.includes(spec.archetype) ? spec.archetype : interiorRoleFor({ archetype: spec.archetype });
    const cacheKey = JSON.stringify([INTERIOR_VERSION, spec.seed, role, spec.footprintArea, spec.aspect, spec.storeys, spec.themeId, spec.wealth]);
    if (cache.has(cacheKey)) { const value = cache.get(cacheKey); cache.delete(cacheKey); cache.set(cacheKey, value); return structuredClone(value); }
    const rng = createRng(spec.seed);
    const levels = Math.max(1, Math.min(3, Math.floor(spec.storeys || 1)), role === 'inn' ? 2 : 1);

    // --- size: spacious, aspect follows the exterior -----------------------------------------
    const area = Math.max(16, Number(spec.footprintArea) || 24), aspect = Math.max(0.5, Math.min(2, Number(spec.aspect) || 1));
    const minW = role === 'temple' || role === 'keep' || role === 'inn' ? 13 : 10;
    const minH = role === 'temple' || role === 'keep' || role === 'inn' ? 11 : 9;
    const width = clamp(Math.round(Math.sqrt(area * aspect) * 1.7) + 2, minW, 19);
    const height = clamp(Math.round(Math.sqrt(area / aspect) * 1.7) + 2, minH, 15);
    const ox = Math.floor(width / 2), oy = Math.floor(height / 2);
    const columns = Array.from({ length: height }, () => Array.from({ length: width }, () => []));
    const put = (x, y, z, wall = false, part = 3) => {
        const col = columns[y][x], voxel = createVoxelBlock({ z, element: 6, texture: wall ? 3 : 11, effect: 6,
            building: wall ? 1 : part, architectureThemeId: spec.themeId });
        const index = col.findIndex(v => v.z === z); if (index < 0) col.push(voxel); else col[index] = voxel;
    };

    // --- stairs: one run per storey change, in the east-most inner columns, heading south -----
    const stairColumns = Array.from({ length: levels - 1 }, (_, i) => width - 2 - i);
    const stairX0 = levels > 1 ? Math.min(...stairColumns) : width - 1;   // first column used by stairs
    const door = { x: Math.floor((Math.min(stairX0, width - 1) - 1) / 2) + 1, y: height - 1 };

    const rooms = [], fixtureAnchors = [], stairRuns = [];
    for (let level = 0; level < levels; level++) {
        const z = level * INTERIOR_FLOOR_SPACING;
        // 2D plan: '#' wall, '.' floor. Outer walls, then this storey's partitions.
        const plan = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
            x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.'));
        const reserved = new Set();   // cells furniture must leave free
        for (const sx of stairColumns) for (let y = 1; y <= 6 && y < height - 1; y++) reserved.add(`${sx},${y}`);
        for (const sx of stairColumns) reserved.add(`${sx - 1},${1}`);
        if (level === 0) {
            for (let y = height - 2; y >= height - 4; y--) reserved.add(`${door.x},${y}`);
        }
        const roomPlan = layoutRooms(role, level, { width, height, stairX0, door, rng });
        for (const wall of roomPlan.walls) {
            for (const [x, y] of wallCells(wall)) if (plan[y]?.[x] === '.') plan[y][x] = '#';
            for (const [x, y] of wall.openings) { plan[y][x] = '.'; reserved.add(`${x},${y}`); reserved.add(`${x + (wall.vertical ? -1 : 0)},${y + (wall.vertical ? 0 : -1)}`); reserved.add(`${x + (wall.vertical ? 1 : 0)},${y + (wall.vertical ? 0 : 1)}`); }
        }
        // Floor slab everywhere. Cutaway walls (MS2 dollhouse view, camera from the south-east):
        // the north and west outer walls are full height, the south and east outer walls and the
        // partitions are one block (knee height), so every room stays visible from the camera.
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const wall = plan[y][x] === '#';
            put(x, y, z, wall);
            if (!wall) continue;
            const backWall = y === 0 || x === 0;
            for (let h = 1; h <= (backWall ? 2 : 1); h++) put(x, y, z + h, true);
        }
        if (level === 0) {
            // The door: an opening in the south wall (the exit prompt sits on the cell inside it).
            columns[door.y][door.x] = columns[door.y][door.x].filter(v => v.z <= z);
        }
        // Furniture, room by room; anything that would cut the floor in two is skipped.
        const blocked = new Set();
        const free = (x, y) => plan[y]?.[x] === '.' && !blocked.has(`${x},${y}`);
        const connected = () => {
            const start = level === 0 ? [door.x, height - 2] : firstFree();
            if (!start) return true;
            const seen = new Set([`${start[0]},${start[1]}`]), queue = [start];
            while (queue.length) {
                const [x, y] = queue.pop();
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const k = `${x + dx},${y + dy}`;
                    if (!seen.has(k) && free(x + dx, y + dy)) { seen.add(k); queue.push([x + dx, y + dy]); }
                }
            }
            let total = 0;
            for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) if (free(x, y)) total++;
            return seen.size === total;
        };
        const firstFree = () => { for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) if (free(x, y)) return [x, y]; return null; };
        roomPlan.rooms.forEach((room, roomIndex) => {
            for (const piece of room.furniture) {
                const [x, y] = piece.at;
                if (!free(x, y) || reserved.has(`${x},${y}`)) continue;
                const blocking = piece.type !== 'rug';
                if (blocking) {
                    blocked.add(`${x},${y}`);
                    if (!connected()) { blocked.delete(`${x},${y}`); continue; }
                }
                fixtureAnchors.push({ id: `${level}:${roomIndex}:${fixtureAnchors.length}`, type: piece.type, x: x - ox, y: y - oy, z, level,
                    visualOnly: !blocking, blocking, room: room.kind });
            }
            const centre = nearestFree(room, free);
            rooms.push({ id: `${level}:${roomIndex}`, level, moduleId: room.kind, kind: room.kind,
                center: { x: centre[0] - ox, y: centre[1] - oy, z }, width: room.x1 - room.x0 + 1, height: room.y1 - room.y0 + 1 });
        });
    }

    // --- stair runs (cut the upper slab above each run) ---------------------------------------
    const footprint = new Set();
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) footprint.add(`${x},${y}`);
    for (let level = 0; level < levels - 1; level++) {
        const run = createStairRun({ origin: { x: stairColumns[level], y: 2 }, direction: 'south',
            rise: INTERIOR_FLOOR_SPACING, baseZ: level * INTERIOR_FLOOR_SPACING, footprintSet: footprint });
        if (!run) throw new Error('INTERIOR_STAIR_CONTRADICTION');
        const approach = columns[run.before.y][run.before.x];
        columns[run.before.y][run.before.x] = approach.filter(v => v.z !== run.before.z + 3);
        for (const p of run.cells) {
            columns[p.y][p.x] = columns[p.y][p.x].filter(v => v.z < level * 3 || v.z > p.z + 2);
            put(p.x, p.y, p.z, false, 11);
        }
        stairRuns.push(run);
    }
    for (const fixture of fixtureAnchors) {
        if (!fixture.blocking) continue;
        const x = fixture.x + ox, y = fixture.y + oy;
        columns[y][x].push({ ...createVoxelBlock({ z: fixture.z + 1, element: 6, texture: 3, building: 1 }), collisionOnly: true });
    }
    for (const row of columns) for (const col of row) col.sort((a, b) => a.z - b.z);
    const entryCell = { x: door.x - ox, y: height - 2 - oy, z: 0 };
    const matrix = { encoding: 'voxel-matrix-v1', width, height, offsetX: ox, offsetY: oy, columns, seed: spec.seed };
    const world = VoxelWorld.fromMatrix(matrix), search = reachable(world, entryCell);
    const unreachable = rooms.filter(room => !search.costs.has(nodeKey(room.center)));
    if (unreachable.length) throw new Error(`INTERIOR_CONNECTIVITY_CONTRADICTION: ${unreachable.map(r => r.id).join(',')}`);
    const contentHash = `${INTERIOR_VERSION}:${hashString(JSON.stringify({ columns, rooms, fixtureAnchors }))}`;
    const rows = columns.map(row => row.map(col => { const v = col.filter(b => !b.collisionOnly).at(-1) || col.at(-1); return { ...v, texture: v.textureValue ?? v.texture, height: v.z }; }));
    Object.assign(rows, { voxelMatrix: matrix, spawn: entryCell, entries: [], buildings: [], decorations: [], generator: 'interior-v2', contentHash,
        generationVersion: INTERIOR_VERSION, townName: ROLE_NAMES[role], seed: spec.seed, theme: { paletteId: 'meadow' } });
    const result = { rows, matrix, storeys: levels, role, entryCell, exitCell: entryCell, rooms, fixtureAnchors, stairRuns, contentHash, spec };
    cache.set(cacheKey, result); if (cache.size > 64) cache.delete(cache.keys().next().value);
    return structuredClone(result);
}

const ROLE_NAMES = { home: 'House', shop: 'Shop', inn: 'Tavern', workshop: 'Workshop', temple: 'Temple', keep: 'Hall' };

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function wallCells(wall) {
    const cells = [];
    if (wall.vertical) for (let y = wall.from; y <= wall.to; y++) cells.push([wall.at, y]);
    else for (let x = wall.from; x <= wall.to; x++) cells.push([x, wall.at]);
    return cells;
}

function nearestFree(room, free) {
    const cx = Math.round((room.x0 + room.x1) / 2), cy = Math.round((room.y0 + room.y1) / 2);
    let best = null;
    for (let y = room.y0; y <= room.y1; y++) for (let x = room.x0; x <= room.x1; x++) {
        if (!free(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (!best || d < best[2]) best = [x, y, d];
    }
    return best ? [best[0], best[1]] : [cx, cy];
}

/**
 * Rooms and partitions for one storey. Coordinates are plan cells (1..width-2 inside the outer
 * wall). Partitions never cross the stair columns (x ≥ stairX0 - 1 stays open).
 */
function layoutRooms(role, level, { width, height, stairX0, door, rng }) {
    const xMax = width - 2, yMax = height - 2;
    const openRight = Math.min(xMax, stairX0 - 2);   // last column a partition may use
    const walls = [], rooms = [];
    const room = (kind, x0, y0, x1, y1) => { const r = { kind, x0, y0, x1, y1, furniture: [] }; rooms.push(r); return r; };
    const add = (r, type, x, y) => { if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) r.furniture.push({ type, at: [x, y] }); };
    const along = (r, type, side, step = 2, start = 0) => {
        if (side === 'north') for (let x = r.x0 + start; x <= r.x1; x += step) add(r, type, x, r.y0);
        if (side === 'west') for (let y = r.y0 + start; y <= r.y1; y += step) add(r, type, r.x0, y);
    };
    // A vertical partition at column `at` with a 2-cell doorway near its middle.
    // On the ground floor a partition must not run through the entrance lane.
    const clearOfDoor = (x) => level > 0 || Math.abs(x - door.x) > 1 ? x
        : (door.x + 2 <= openRight - 2 ? door.x + 2 : door.x - 2);
    const vWall = (at, y0 = 1, y1 = yMax) => {
        const mid = Math.floor((y0 + y1) / 2);
        walls.push({ vertical: true, at, from: y0, to: y1, openings: [[at, mid], [at, mid + 1]] });
    };
    const hWall = (at, x0 = 1, x1 = openRight) => {
        const mid = Math.floor((x0 + x1) / 2) + (rng.next() < 0.5 ? 0 : 1);
        walls.push({ vertical: false, at, from: x0, to: x1, openings: [[mid, at], [mid + 1, at]] });
    };
    const upstairs = level > 0;

    if (role === 'temple' && !upstairs) {
        const r = room('nave', 1, 1, xMax, yMax);
        const cx = Math.floor((1 + openRight) / 2);
        add(r, 'altar', cx, 1); add(r, 'potted_plant', cx - 2, 1); add(r, 'potted_plant', cx + 2, 1);
        for (let y = 3; y <= yMax - 3; y += 2) for (const x of [cx - 3, cx - 2, cx + 2, cx + 3]) add(r, 'pew', x, y);
        add(r, 'bookshelf', 1, 1);
        return { walls, rooms };
    }
    if (role === 'inn' && !upstairs) {
        const r = room('hall', 1, 1, xMax, yMax);
        for (let x = 2; x <= Math.min(openRight, 6); x++) add(r, x === 2 ? 'keg' : 'bar', x, 1);
        add(r, 'shelf', Math.min(openRight, 7), 1);
        add(r, 'hearth', 1, Math.floor(yMax / 2));
        for (let y = 4; y <= yMax - 3; y += 3) for (let x = 3; x <= openRight - 1; x += 4) {
            add(r, 'table', x, y); add(r, 'stool', x - 1, y); add(r, 'stool', x + 1, y);
        }
        add(r, 'potted_plant', 1, yMax);
        return { walls, rooms };
    }
    if ((role === 'inn' || role === 'home') && upstairs) {
        // Bedrooms off a corridor along the south side.
        const corridorY = yMax - 1;
        hWall(corridorY - 1);
        const span = openRight;
        const count = Math.max(1, Math.min(3, Math.floor(span / 4)));
        const roomW = Math.floor(span / count);
        for (let i = 0; i < count; i++) {
            const x0 = 1 + i * roomW, x1 = i === count - 1 ? openRight : x0 + roomW - 2;
            if (i > 0) walls.push({ vertical: true, at: x0 - 1, from: 1, to: corridorY - 2, openings: [] });
            const r = room('bedroom', x0, 1, x1, corridorY - 2);
            add(r, 'bed', x0, 1); add(r, 'chest', x0 + 1, 1); add(r, 'rug', x0 + 1, 3);
            if (x1 - x0 >= 3) add(r, 'wardrobe', x1, 1);
        }
        // Doorways from the corridor into each bedroom.
        walls[0].openings = Array.from({ length: count }, (_, i) => [1 + i * roomW + 1, corridorY - 1]);
        room('corridor', 1, corridorY, xMax, yMax);
        return { walls, rooms };
    }
    if (role === 'home') {
        const split = clearOfDoor(clamp(Math.round(openRight * 0.6), 4, openRight - 3));
        vWall(split);
        const living = room('living', 1, 1, split - 1, yMax);
        add(living, 'hearth', Math.floor(split / 2), 1); add(living, 'shelf', 1, 1); add(living, 'potted_plant', split - 1, 1);
        const ty = Math.floor(yMax / 2) + 1;
        add(living, 'table', Math.floor(split / 2), ty); add(living, 'stool', Math.floor(split / 2) - 1, ty); add(living, 'stool', Math.floor(split / 2) + 1, ty);
        add(living, 'rug', Math.floor(split / 2), ty + 2);
        const bed = room('bedroom', split + 1, 1, xMax, yMax);
        add(bed, 'bed', split + 1, 1); add(bed, 'chest', split + 2, 1); add(bed, 'wardrobe', Math.min(openRight, split + 4), 1);
        add(bed, 'rug', split + 2, 3);
        return { walls, rooms };
    }
    if (role === 'shop') {
        const split = clamp(Math.round(yMax * 0.4), 3, yMax - 4);
        hWall(split);
        const store = room('storeroom', 1, 1, xMax, split - 1);
        along(store, 'crate', 'north', 2, 0); add(store, 'barrel', 1, split - 1); add(store, 'shelf', openRight, split - 1);
        const shop = room('shop', 1, split + 1, xMax, yMax);
        for (let x = 2; x <= Math.min(openRight - 1, 6); x++) add(shop, 'counter', x, split + 2);
        along(shop, 'shelf', 'west', 2, 1); add(shop, 'potted_plant', openRight, yMax);
        add(shop, 'rug', door.x, yMax - 1);
        return { walls, rooms };
    }
    if (role === 'workshop') {
        const split = clearOfDoor(clamp(Math.round(openRight * 0.3), 3, openRight - 5));
        vWall(split);
        const store = room('store', 1, 1, split - 1, yMax);
        along(store, 'crate', 'north'); add(store, 'barrel', 1, yMax - 1); add(store, 'barrel', 2, yMax - 1);
        const shop = room('forge', split + 1, 1, xMax, yMax);
        add(shop, 'forge', split + 2, 1); add(shop, 'anvil', split + 3, 3); add(shop, 'weapon_rack', Math.min(openRight, split + 5), 1);
        add(shop, 'table', Math.min(openRight, split + 5), Math.floor(yMax / 2) + 1); add(shop, 'barrel', split + 1, yMax - 1);
        return { walls, rooms };
    }
    // keep / hall (and any upper storey of a shop, workshop, temple or keep): great hall + study.
    const split = clearOfDoor(clamp(Math.round(openRight * 0.68), 5, openRight - 3));
    vWall(split);
    const hall = room(upstairs ? 'gallery' : 'great-hall', 1, 1, split - 1, yMax);
    add(hall, 'hearth', Math.floor(split / 2), 1);
    const ty = Math.floor(yMax / 2) + 1;
    for (let x = 2; x <= split - 2; x++) add(hall, 'table', x, ty);
    for (let x = 2; x <= split - 2; x += 2) { add(hall, 'bench', x, ty - 1); add(hall, 'bench', x, ty + 1); }
    add(hall, 'potted_plant', 1, 1);
    const study = room('study', split + 1, 1, xMax, yMax);
    add(study, 'bookshelf', split + 1, 1); add(study, 'bookshelf', split + 2, 1); add(study, 'table', split + 2, 4); add(study, 'chest', split + 1, yMax - 1);
    return { walls, rooms };
}
