// Shared mission finishing: resolve spawn specs, guarantee reachability, measure the map.
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { measureMission } from './MissionMetrics.js';
import { castRay, blocksSight } from '../voxel/Raycast.js';

export function finalizeMission({ id, name, store, rooms, buildings, spawns, rng, objective, meta = {}, visual = null, secure = true }) {
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
    const nearestReachable = (p) => {
        let best = null, bd = Infinity;
        for (const n of search.nodes.values()) {
            if (occupied.has(key(n))) continue;
            const d = Math.hypot(n.x - p.x, n.y - p.y) + Math.abs(n.z - (p.z ?? n.z)) * 2;
            if (d < bd) { bd = d; best = n; }
        }
        return best;
    };
    const enemy = [];
    for (const spec of spawns.enemy) {
        let pos = null;
        if (spec.pos) pos = spec.pos;
        else if (spec.at) { const s = store.surfaceNear(spec.at.x, spec.at.y, spec.at.z ?? Infinity); pos = s ? { x: spec.at.x, y: spec.at.y, z: s.z } : null; }
        else if (spec.room) {
            const b = buildings.find(b => b.id === spec.room.building);
            const list = b?.rooms.filter(r => r.gameplay !== false && r.storey === (spec.room.storey ?? 0)) || [];
            const room = spec.room.kind ? list.find(r => r.kind === spec.room.kind) : list[(spec.room.index ?? 0) % Math.max(1, list.length)];
            if (room) {
                const cells = rng.shuffle(room.cells.map(([x, y]) => ({ x, y, z: room.floorZ })));
                pos = cells.find(c => reach(c) && !occupied.has(key(c))) || null;
            }
        } else if (spec.roof) {
            const b = buildings.find(b => b.id === spec.roof);
            if (b) {
                const cx = b.x0 + Math.floor(b.w / 2), cy = b.y0 + Math.floor(b.d / 2);
                const cells = [];
                for (let y = b.y0 + 1; y < b.y0 + b.d - 1; y++) for (let x = b.x0 + 1; x < b.x0 + b.w - 1; x++) cells.push({ x, y, z: b.top });
                cells.sort((a, c) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(c.x - cx, c.y - cy));
                pos = cells.find(c => reach(c) && !occupied.has(key(c))) || null;
            }
        }
        if (!pos || !reach(pos) || occupied.has(key(pos))) {
            // Fall back near where the spec meant (its building), never next to the squad.
            const b = buildings.find(b => b.id === (spec.room?.building || spec.roof));
            const near = pos || spec.at || (b ? { x: b.x0 + b.w / 2, y: b.y0 + b.d / 2, z: b.baseZ } : null);
            pos = near ? nearestReachable(near) : null;
        }
        if (!pos) continue;
        occupied.add(key(pos));
        enemy.push({ type: spec.type, group: spec.group ?? 0, pos, facing: spec.facing || 's' });
    }
    if (secure) secureSpawns(store, player, enemy, search, occupied, key);
    const mission = { id, name, store, rooms, buildings, spawns: { player, enemy }, objective, meta, visual: visual || { hints: {}, decor: [] } };
    mission.metrics = measureMission(mission, { search });
    return mission;
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
