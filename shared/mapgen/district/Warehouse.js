// PLAN-06 §5.6 — warehouse interiors for open-floor CQB.
//
// The hall of a `warehouse` building is laid out as a designed floor, not furnished at random:
//   distribution  double pallet racking (2 high, blocks sight) in rows with 3-wide aisles and a cross aisle
//   workshop      machine blocks, workbenches and drum stores in bays
//   cold-store    mesh cages (see-through, no cover) with racking along the walls
//   gutted        half-empty bulk floor: pallet and crate stacks on a storage grid (a good hold-zone floor)
// Structural columns (steel, very tough) stand on an 8-cell grid in every variant — the durable cover anchors.
// After the layout three passes enforce the CQB rules with a connectivity guard (nothing may cut off floor):
//   sightline breakers (no straight run of open floor longer than MAX_RUN), cover within COVER_REACH moves,
//   and door landings kept clear.
import { MAT, materialById, coverWeight } from '../../voxel/Materials.js';
import { k2, k3, registerCells } from './Core.js';
import { hashString, createRng } from '../../util/Rng.js';

export const WAREHOUSE_VARIANTS = Object.freeze(['distribution', 'workshop', 'cold-store', 'gutted']);
export const MAX_RUN = 14, COVER_REACH = 2;

/** Lay out the hall of a warehouse building. Returns a report used by the warehouse gate. */
export function layoutWarehouse(m, b, { variant = null, seed = 1, origin = null } = {}) {
    const rng = createRng(hashString(`warehouse:${m.id}:${b.id}:${seed}`));
    variant ||= WAREHOUSE_VARIANTS[rng.int(0, WAREHOUSE_VARIANTS.length - 1)];
    origin ||= `warehouse:${b.id}`;
    const hall = b.rooms.filter(r => r.kind === 'warehouse' || r.kind === 'loading').sort((a, c) => c.cells.length - a.cells.length)[0];
    if (!hall) return { building: b.id, variant, pass: false, reason: 'no hall' };
    const s = m.store, z = hall.floorZ;
    const cells = new Set(hall.cells.map(([x, y]) => k2(x, y)));
    const xs = hall.cells.map(c => c[0]), ys = hall.cells.map(c => c[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const longX = box.x1 - box.x0 >= box.y1 - box.y0;
    // Local (i along the long axis, j across) ↔ world.
    const I = (longX ? box.x1 - box.x0 : box.y1 - box.y0) + 1, J = (longX ? box.y1 - box.y0 : box.x1 - box.x0) + 1;
    const W = (i, j) => longX ? [box.x0 + i, box.y0 + j] : [box.x0 + j, box.y0 + i];

    // Door landings (interior side of every door that touches the hall) stay clear, 2 cells deep.
    const landing = new Set();
    for (const d of b.doors.concat(b.exits.map(e => ({ ...e, z })))) {
        if (d.z != null && d.z !== z) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) landing.add(k2(d.x + dx, d.y + dy));
    }
    const placed = [];
    const free = (x, y) => cells.has(k2(x, y)) && !landing.has(k2(x, y)) && !s.isSolid(x, y, z + 1);
    const setCol = (x, y, key, h, part) => { const cs = []; for (let k = 1; k <= h; k++) { s.set(x, y, z + k, MAT[key]); cs.push([x, y, z + k]); } registerCells(m, cs, `${origin}/${part}`); placed.push({ x, y, key, h, part }); };
    const unset = p => { for (let k = 1; k <= p.h; k++) s.set(p.x, p.y, z + k, 0); };

    // Connectivity guard: every open hall cell must stay reachable from the hall's doors.
    const entries = [...landing].filter(k => cells.has(k)).map(k => k.split(',').map(Number));
    const connected = () => {
        const open = c => cells.has(k2(c[0], c[1])) && !s.isSolid(c[0], c[1], z + 1);
        const start = entries.find(open) || hall.cells.find(open);
        if (!start) return false;
        const seen = new Set([k2(...start)]), q = [start];
        while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [x + dx, y + dy], k = k2(...n); if (!seen.has(k) && open(n)) { seen.add(k); q.push(n); } } }
        return hall.cells.every(c => !open(c) || seen.has(k2(...c)));
    };
    const tryPut = (x, y, key, h, part) => { if (!free(x, y)) return false; setCol(x, y, key, h, part); if (connected()) return true; unset(placed.pop()); return false; };

    // Columns on an 8-cell grid, offset from the walls.
    for (let i = 4; i < I - 3; i += 8) for (let j = 3; j < J - 2; j += 7) { const [x, y] = W(i, j); tryPut(x, y, 'steel_post', 2, 'column'); }

    if (variant === 'distribution' || variant === 'cold-store') {
        const mid = Math.floor(J / 2);
        const segs = [[3, mid - 2], [mid + 2, J - 4]].filter(([a, c]) => c - a >= 1);
        const start = variant === 'cold-store' ? 3 : 3;
        for (let i = start; i + 1 < I - 3; i += 5) for (const [a, c] of segs) for (let j = a; j <= c; j++) for (const di of [0, 1]) {
            const [x, y] = W(i + di, j);
            if (variant === 'cold-store' && (j === a || j === c)) continue;
            tryPut(x, y, 'shelving', 2, 'racking');
        }
        if (variant === 'cold-store') {
            // Mesh cages against the far wall: see-through, a gated door on the aisle side.
            for (let i = 3; i + 4 < I - 3; i += 7) {
                const ring = [];
                for (let di = 0; di < 4; di++) ring.push([i + di, J - 5], [i + di, J - 2]);
                for (let dj = -4; dj <= -1; dj++) ring.push([i, J + dj], [i + 3, J + dj]);
                for (const [ii, jj] of ring) { if (ii === i + 1 && jj === J - 5) continue; const [x, y] = W(ii, jj); tryPut(x, y, 'chainlink', 2, 'cage'); }
            }
        }
    } else if (variant === 'workshop') {
        for (let i = 3; i + 2 < I - 3; i += 6) for (const j of [3, J - 5]) {
            // Machine block (2 × 2, full cover) beside a workbench run (half cover).
            for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const [x, y] = W(i + di, j + dj); tryPut(x, y, 'appliance', 2, 'machine'); }
            for (let di = 0; di < 3; di++) { const [x, y] = W(i + di, j === 3 ? j + 3 : j - 2); tryPut(x, y, 'shelving', 1, 'workbench'); }
        }
        for (let i = 6; i < I - 4; i += 9) { const [x, y] = W(i, Math.floor(J / 2)); tryPut(x, y, 'barrel_powder', 1, 'drum-store'); const [x2, y2] = W(i + 1, Math.floor(J / 2)); tryPut(x2, y2, 'barrel_water', 1, 'drum-store'); }
    } else {
        // Gutted bulk floor: 2 × 2 stacks on a 5-cell storage grid; alternate pallets (half) and crates (full).
        for (let i = 3; i + 1 < I - 3; i += 5) for (let j = 3; j + 1 < J - 3; j += 5) {
            const full = ((i + j) / 5) % 2 === 0;
            for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const [x, y] = W(i + di, j + dj); tryPut(x, y, full ? 'crate' : 'pallet', full ? 2 : 1, full ? 'crate-stack' : 'pallet-stack'); }
        }
    }
    // A shipping container on the bulk floor of big halls (full cover, very tough).
    if (I >= 20 && J >= 12 && variant !== 'cold-store') {
        const i = Math.floor(I / 2) - 2, j = 1;
        const cs = []; for (let di = 0; di < 5; di++) for (let dj = 0; dj < 2; dj++) cs.push(W(i + di, j + dj));
        if (cs.every(([x, y]) => free(x, y) && !s.isSolid(x, y, z + 2))) {
            const before = placed.length;
            for (const [x, y] of cs) setCol(x, y, 'container', 2, 'container');
            if (!connected()) while (placed.length > before) unset(placed.pop());
            else m.object('container', cs.flatMap(([x, y]) => [[x, y, z + 1], [x, y, z + 2]]), { axis: longX ? 'x' : 'y', dir: 1, size: [5, 2], tint: [0.16, 0.3, 0.5] });
        }
    }
    // A forklift parked at an aisle end (half cover).
    { const [x, y] = W(2, Math.floor(J / 2)), [x2, y2] = W(3, Math.floor(J / 2));
        if (free(x, y) && free(x2, y2)) { setCol(x, y, 'appliance', 1, 'forklift'); setCol(x2, y2, 'appliance', 1, 'forklift'); if (!connected()) { unset(placed.pop()); unset(placed.pop()); } } }

    // Sightline breakers: no straight open run longer than MAX_RUN cells (crate stacks block sight).
    for (let pass = 0; pass < 6; pass++) {
        const long = longestRuns(s, cells, z, box);
        if (!long.length) break;
        let fixed = false;
        for (const r of long) {
            const mid = (r.cells.length - 1) / 2;
            const order = r.cells.map((_, i) => i).filter(i => i >= 3 && i <= r.cells.length - 4).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
            for (const idx of order) { const [x, y] = r.cells[idx]; if (tryPut(x, y, 'crate', 2, 'sightline-breaker')) { fixed = true; break; } }
        }
        if (!fixed) break;
    }
    // Cover within COVER_REACH moves of every open hall cell (pallet stacks, half cover).
    for (let pass = 0; pass < 12; pass++) {
        const far = coverDistances(s, cells, z).filter(c => c.d > COVER_REACH).sort((a, c) => c.d - a.d);
        if (!far.length) break;
        let ok = false;
        for (const c of far.slice(0, 4)) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (!ok && tryPut(c.x + dx, c.y + dy, 'pallet', 1, 'bulk-stack')) ok = true;
        if (!ok) break;
    }
    // Racking uses open steel beams; workshop benches use a table/pegboard silhouette.
    for(const p of placed)if(p.key==='shelving')for(let h=0;h<p.h;h++){
        const piece=p.part==='workbench'?'workbench':h===0?'warehouse_rack_lower':'warehouse_rack_upper';
        m.hints[k3(p.x,p.y,z+1+h)]={piece,yaw:longX?Math.PI/2:0};
    }
    const report = warehouseReport(m, b, hall, { variant, cells, box, z, landing });
    m.district?.warehouses.push(report);
    return report;
}

/** Straight runs of open floor (rows and columns of the hall's bounding box) longer than MAX_RUN. */
export function longestRuns(s, cells, z, box) {
    const out = [];
    const scan = (pts) => {
        let cur = [];
        const flush = () => { if (cur.length > MAX_RUN) out.push({ cells: cur }); cur = []; };
        for (const [x, y] of pts) { if (cells.has(k2(x, y)) && !blocksSightAt(s, x, y, z)) cur.push([x, y]); else flush(); }
        flush();
    };
    for (let y = box.y0; y <= box.y1; y++) { const pts = []; for (let x = box.x0; x <= box.x1; x++) pts.push([x, y]); scan(pts); }
    for (let x = box.x0; x <= box.x1; x++) { const pts = []; for (let y = box.y0; y <= box.y1; y++) pts.push([x, y]); scan(pts); }
    return out.sort((a, c) => c.cells.length - a.cells.length);
}
const blocksSightAt = (s, x, y, z) => { const m = materialById(s.get(x, y, z + 2)); return m.solid && m.opaque !== false; };

/** Moves from every open hall cell to the nearest cell with cover beside it. */
export function coverDistances(s, cells, z) {
    const open = (x, y) => cells.has(k2(x, y)) && !s.isSolid(x, y, z + 1);
    const covered = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => coverWeight(materialById(s.get(x + dx, y + dy, z + 1))) >= 1);
    const dist = new Map(), q = [];
    for (const k of cells) { const [x, y] = k.split(',').map(Number); if (open(x, y) && covered(x, y)) { dist.set(k, 0); q.push([x, y]); } }
    for (let i = 0; i < q.length; i++) { const [x, y] = q[i], d = dist.get(k2(x, y)); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = k2(x + dx, y + dy); if (!dist.has(k) && open(x + dx, y + dy)) { dist.set(k, d + 1); q.push([x + dx, y + dy]); } } }
    const out = [];
    for (const k of cells) { const [x, y] = k.split(',').map(Number); if (open(x, y)) out.push({ x, y, d: dist.get(k) ?? 99 }); }
    return out;
}

export function warehouseReport(m, b, hall, { variant, cells, box, z, landing }) {
    const s = m.store;
    const runs = longestRuns(s, cells, z, box);
    const dists = coverDistances(s, cells, z);
    const sides = new Set(b.exits.map(e => e.side));
    // Loops: removing any single open cell of degree 2 in a corridor must not disconnect the hall too often — we
    // approximate "no long dead ends" by the longest chain of degree-1/2 cells that ends in a dead end.
    const open = (x, y) => cells.has(k2(x, y)) && !s.isSolid(x, y, z + 1);
    let deadEnd = 0;
    for (const k of cells) {
        const [x, y] = k.split(',').map(Number); if (!open(x, y)) continue;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => open(x + dx, y + dy));
        if (nb.length !== 1) continue;
        let len = 1, px = x, py = y, [cx, cy] = [x + nb[0][0], y + nb[0][1]];
        while (len < 20) {
            const n2 = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy]).filter(([ax, ay]) => open(ax, ay) && !(ax === px && ay === py));
            if (n2.length !== 1) break;
            len++; [px, py] = [cx, cy]; [cx, cy] = n2[0];
        }
        deadEnd = Math.max(deadEnd, len);
    }
    const coverReach = Math.max(0, ...dists.map(d => d.d));
    const longestRun = runs.length ? runs[0].cells.length : 0;
    const report = { building: b.id, variant, hallCells: cells.size, longestRun, coverReach, deadEnd, entrances: b.exits.length, entranceSides: sides.size,
        pieces: [...new Set([])], gates: {} };
    report.gates = { sightline: longestRun <= MAX_RUN, cover: coverReach <= COVER_REACH, deadEnds: deadEnd <= 6, entrances: b.exits.length >= 3 && sides.size >= 2 };
    report.pass = Object.values(report.gates).every(Boolean);
    return report;
}
