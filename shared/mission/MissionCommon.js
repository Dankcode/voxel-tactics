import {MAT} from '../voxel/Materials.js';
// Shared mission finishing: resolve spawn specs, guarantee reachability, measure the map.
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { measureMission } from './MissionMetrics.js';
import { castRay, blocksSight } from '../voxel/Raycast.js';
import { coverAgainst } from '../voxel/Cover.js';
import { facingToward } from '../battle/Units.js';
import { WALKERS, occupiedCells } from '../battle/Walker.js';

export function finalizeMission({ id, name, store, rooms, buildings, spawns, rng, objective, meta = {}, visual = null, secure = true }) {
    // PLAN-12: planters, benches and hedges stay what the map placed (they used to be converted into crates and
    // sandbags here, which put crates on every street).
    const occupied = new Set();
    const key = p => `${p.x},${p.y},${p.z}`;
    const player = spawns.player.map(p => {
        const s = store.surfaceNear(p.x, p.y, p.z ?? Infinity);
        const pos = s ? { x: p.x, y: p.y, z: s.z } : p;
        occupied.add(key(pos));
        return pos;
    });
    const search = reachable(store, player[0], Infinity, AGENT_PROFILES.player);
    const reach = p => search.costs.has(nodeKey(p));
    const nearestReachable = (p, ok = () => true, maxD = Infinity) => {
        let best = null, bd = Infinity;
        for (const n of search.nodes.values()) {
            if (occupied.has(key(n)) || !ok(n)) continue;
            const d = Math.hypot(n.x - p.x, n.y - p.y) + Math.abs(n.z - (p.z ?? n.z)) * 2;
            if (d < bd && d <= maxD) { bd = d; best = n; }
        }
        return best;
    };
    // PLAN-15 + XCOM 2 tactical spawn selection: members spread over their post and pick role-appropriate cover
    // and height facing the squad's insertion axis.
    const threat = player[0] || { x: Math.floor(store.width / 2), y: Math.floor(store.depth / 2), z: 1 };
    const podCells = new Map();
    const spaced = (c, group) => !(podCells.get(group ?? 0) || []).some(o => o.z === c.z && Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) < 2);
    const cellValid = (c, type) => {
        if (!c || !reach(c) || occupied.has(key(c))) return false;
        if (WALKERS[type]) {
            const cells = occupiedCells({ x: c.x, y: c.y, z: c.z, type });
            if (cells.some(oc => !store.inBounds(oc.x, oc.y, oc.z + 2) || !store.isSolid(oc.x, oc.y, oc.z) || store.isSolid(oc.x, oc.y, oc.z + 1) || store.isSolid(oc.x, oc.y, oc.z + 2) || occupied.has(key(oc)))) return false;
        }
        return true;
    };
    const roleScore = (type, c, anchor) => {
        const cov = coverAgainst(store, c.x, c.y, c.z, threat.x, threat.y, threat.z);
        const dThreat = Math.hypot(c.x - threat.x, c.y - threat.y);
        const dAnchor = anchor ? Math.hypot(c.x - anchor.x, c.y - anchor.y) : 0;
        const sky = !store.isSolid(c.x, c.y, c.z + 3) && !store.isSolid(c.x, c.y, c.z + 4);
        if (type === 'sniper' || type === 'archer') return cov * 5 + c.z * 2.5 + Math.min(8, dThreat * 0.25) - dAnchor * 0.4;
        if (type === 'heavy_gunner' || type === 'officer' || type === 'warden_foe') return cov * 6 + c.z * 0.5 - dAnchor * 0.5;
        if (type === 'breacher' || type === 'brute' || type === 'pyromancer') return cov * 4 - Math.min(8, dThreat * 0.2) - dAnchor * 0.4;
        if (type === 'medic' || type === 'tech') return (cov === 2 ? 12 : cov * 5) + Math.min(6, dThreat * 0.2) - dAnchor * 0.5;
        if (type === 'demolisher') return cov * 4 + (sky ? 5 : 0) - dAnchor * 0.4;
        return cov * 3 - dAnchor * 0.5;
    };
    objective = resolveObjective(objective, { id, store, buildings, rng, player, reach, occupied, key });
    const enemy = [];
    for (const spec of spawns.enemy) {
        let pos = null;
        if (spec.pos) pos = spec.pos;
        else if (spec.at) {
            const s = store.surfaceNear(spec.at.x, spec.at.y, spec.at.z ?? Infinity);
            const anchor = s ? { x: spec.at.x, y: spec.at.y, z: s.z } : null;
            if (anchor) {
                const cands = [...search.nodes.values()].filter(n =>
                    Math.hypot(n.x - anchor.x, n.y - anchor.y) <= 4 && Math.abs(n.z - anchor.z) <= 2
                    && cellValid(n, spec.type) && spaced(n, spec.group)
                ).sort((a, b) => roleScore(spec.type, b, anchor) - roleScore(spec.type, a, anchor) || a.z - b.z || a.y - b.y || a.x - b.x);
                pos = cands[0] || (cellValid(anchor, spec.type) && spaced(anchor, spec.group) ? anchor : null);
                if (!pos) pos = nearestReachable(anchor, n => cellValid(n, spec.type) && spaced(n, spec.group) && Math.abs(n.z - anchor.z) <= 2, 6) || anchor;
            }
        }
        else if (spec.room) {
            const b = buildings.find(b => b.id === spec.room.building);
            const list = b?.rooms.filter(r => r.gameplay !== false && r.storey === (spec.room.storey ?? 0)) || [];
            const room = roomFor(list, spec.room);
            if (room) {
                const cells = rng.shuffle(room.cells.map(([x, y]) => ({ x, y, z: room.floorZ })));
                const validSpaced = cells.filter(c => cellValid(c, spec.type) && spaced(c, spec.group))
                    .sort((a, b) => roleScore(spec.type, b, null) - roleScore(spec.type, a, null));
                pos = validSpaced[0] || cells.find(c => cellValid(c, spec.type)) || null;
            }
        } else if (spec.roof) {
            const b = buildings.find(b => b.id === spec.roof);
            if (b) {
                const cx = b.x0 + Math.floor(b.w / 2), cy = b.y0 + Math.floor(b.d / 2);
                const cells = [];
                for (let y = b.y0 + 1; y < b.y0 + b.d - 1; y++) for (let x = b.x0 + 1; x < b.x0 + b.w - 1; x++) cells.push({ x, y, z: b.top });
                cells.sort((a, c) => roleScore(spec.type, c, { x: cx, y: cy }) - roleScore(spec.type, a, { x: cx, y: cy }));
                pos = cells.find(c => cellValid(c, spec.type)) || null;
            }
        }
        if (!pos || !cellValid(pos, spec.type)) {
            // Fall back near where the spec meant (its building), never next to the squad.
            const b = buildings.find(b => b.id === (spec.room?.building || spec.roof));
            const near = pos || spec.at || (b ? { x: b.x0 + b.w / 2, y: b.y0 + b.d / 2, z: b.baseZ } : null);
            pos = near ? nearestReachable(near, n => cellValid(n, spec.type)) : null;
        }
        if (!pos) continue;
        occupied.add(key(pos));
        if (!podCells.has(spec.group ?? 0)) podCells.set(spec.group ?? 0, []); podCells.get(spec.group ?? 0).push(pos);
        const facing = spec.facing || facingToward(threat.x - pos.x, threat.y - pos.y);
        enemy.push({ type: spec.type, group: spec.group ?? 0, pos, facing });
    }
    if (secure) secureSpawns(store, player, enemy, search, occupied, key);
    const mission = { id, name, store, rooms, buildings, spawns: { player, enemy }, objective, meta, visual: visual || { hints: {}, decor: [] } };
    mission.metrics = measureMission(mission, { search });
    return mission;
}

/** A building room by kind (the index-th of that kind) or by index. */
function roomFor(list, spec) {
    const named = spec.kind ? list.filter(r => r.name === spec.kind) : [];
    const pool = named.length ? named : spec.kind ? list.filter(r => r.kind === spec.kind) : list;
    return pool.length ? pool[(spec.index ?? 0) % pool.length] : null;
}

/**
 * Objective specs may name places instead of coordinates; resolve them and check the squad can get there.
 *   item: { x, y, z } | { room: { building, kind?, index?, storey? } }   → a reachable floor cell in that room
 *   zone: { x0, y0, x1, y1, z? } | 'spawn' (the squad's arrival area, one cell round it)
 */
function resolveObjective(spec, { id, store, buildings, rng, player, reach, occupied, key }) {
    if (!spec || !spec.kind || spec.kind === 'eliminate') return spec;
    const o = { ...spec };
    if (o.zone === 'spawn') {
        const xs = player.map(p => p.x), ys = player.map(p => p.y);
        o.zone = { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 };
    }
    if (o.zone) {
        let ok = false;
        for (let y = o.zone.y0; y <= o.zone.y1 && !ok; y++) for (let x = o.zone.x0; x <= o.zone.x1 && !ok; x++)
            ok = store.surfaces(x, y).some(s => (o.zone.z == null || Math.abs(s.z - o.zone.z) <= (o.zone.dz ?? 1)) && reach({ x, y, z: s.z }));
        if (!ok) throw new Error(`${id}: objective zone ${JSON.stringify(o.zone)} has no reachable cell`);
    }
    if (o.item?.room) {
        const b = buildings.find(b => b.id === o.item.room.building);
        const room = roomFor(b?.rooms.filter(r => r.gameplay !== false && r.storey === (o.item.room.storey ?? 0)) || [], o.item.room);
        const cells = room ? rng.shuffle(room.cells.map(([x, y]) => ({ x, y, z: room.floorZ }))) : [];
        const at = cells.find(c => reach(c) && !occupied.has(key(c)));
        if (!at) throw new Error(`${id}: no reachable cell for the objective item in ${JSON.stringify(o.item.room)}`);
        const { room: _r, ...rest } = o.item;
        o.item = { ...rest, ...at, building: b.id, roomId: room.id };
    } else if (o.item) {
        const s = store.surfaceNear(o.item.x, o.item.y, o.item.z ?? Infinity);
        o.item = { ...o.item, z: s ? s.z : o.item.z };
        if (!reach(o.item)) throw new Error(`${id}: objective item at ${o.item.x},${o.item.y} is unreachable`);
    }
    if (o.item) occupied.add(key(o.item));
    return o;
}

/**
 * Spawn safety (the spawnSafe gate): no enemy may start with a clear line of sight to a squad member within 24 tiles.
 * An enemy that would is moved to the nearest reachable tile (same room or same outdoor/indoor status, within 8 tiles,
 * at least 10 from every squad member) that no squad member can see.
 */
export function secureSpawns(store, player, enemy, search, occupied, key) {
    const sees = (e) => player.some(p => Math.hypot(e.x - p.x, e.y - p.y) < 24 && !castRay(store, { x: e.x + 0.5, y: e.y + 0.5, h: e.z + 2.5 }, { x: p.x + 0.5, y: p.y + 0.5, h: p.z + 2 }, { blocks: blocksSight }).hit);
    const nodes = [...search.nodes.values()];
    for (const e of enemy) {
        if (!sees(e.pos)) continue;
        const room = store.roomAt(e.pos.x, e.pos.y, e.pos.z + 1);
        const options = nodes.filter(n => !occupied.has(key(n)) && Math.hypot(n.x - e.pos.x, n.y - e.pos.y) <= 8 && Math.abs(n.z - e.pos.z) <= 3
            && player.every(p => Math.hypot(n.x - p.x, n.y - p.y) >= 10))
            .sort((a, b) => {
                const ra = store.roomAt(a.x, a.y, a.z + 1), rb = store.roomAt(b.x, b.y, b.z + 1);
                const pa = (ra === room ? 0 : (ra >= 0) === (room >= 0) ? 2 : 6), pb = (rb === room ? 0 : (rb >= 0) === (room >= 0) ? 2 : 6);
                return (pa + Math.hypot(a.x - e.pos.x, a.y - e.pos.y)) - (pb + Math.hypot(b.x - e.pos.x, b.y - e.pos.y));
            });
        const to = options.find(n => !sees(n));
        if (!to) continue;
        occupied.delete(key(e.pos)); occupied.add(key(to));
        e.pos = { x: to.x, y: to.y, z: to.z };
    }
}
