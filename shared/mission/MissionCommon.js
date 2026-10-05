// Shared mission finishing: resolve spawn specs, guarantee reachability, measure the map.
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { measureMission } from './MissionMetrics.js';

export function finalizeMission({ id, name, store, rooms, buildings, spawns, rng, objective, meta = {} }) {
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
            const list = b?.rooms.filter(r => r.storey === (spec.room.storey ?? 0)) || [];
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
        if (!pos || !reach(pos) || occupied.has(key(pos))) pos = nearestReachable(pos || spec.at || player[0]);
        if (!pos) continue;
        occupied.add(key(pos));
        enemy.push({ type: spec.type, group: spec.group ?? 0, pos, facing: spec.facing || 's' });
    }
    const mission = { id, name, store, rooms, buildings, spawns: { player, enemy }, objective, meta };
    mission.metrics = measureMission(mission, { search });
    return mission;
}
