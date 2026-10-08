import { MinHeap } from '../util/MinHeap.js';
import { AGENT_PROFILES, surfacesAt, stepCost } from './TraversalRules.js';
import { materialById } from '../voxel/Materials.js';

/** XCOM vault: over a one-voxel-high obstacle you can't stand on (low wall, sandbags, hedge, planter, barrier …). */
export const VAULT_COST = 2.6;
export function canVault(world, from, dx, dy, profile = AGENT_PROFILES.player) {
    if (profile.width !== 1) return null;
    const bx = from.x + dx, by = from.y + dy, z = from.z;
    const ob = materialById(world.get(bx, by, z + 1));
    if (!ob.solid || ob.walkable || ob.liquid || ob.part === 2) return null;
    for (let h = 2; h <= 1 + profile.clearance; h++) if (world.isSolid(bx, by, z + h)) return null;          // one high, room to go over
    for (let h = 1; h <= profile.clearance; h++) if (world.isSolid(from.x, from.y, z + h)) return null;
    const land = surfacesAt(world, bx + dx, by + dy, profile).find(s => s.z === z);
    return land ? { x: land.x, y: land.y, z } : null;
}
export const nodeKey = p => `${p.x},${p.y},${p.z}`;
export function reachable(world, start, budget = Infinity, profile = AGENT_PROFILES.player, options = {}) {
    const heap = new MinHeap(), costs = new Map(), parents = new Map(), nodes = new Map();
    if (!surfacesAt(world, start.x, start.y, profile).some(s => s.z === start.z)) return { costs, parents, nodes };
    const root = nodeKey(start); costs.set(root, 0); nodes.set(root, start); heap.push(start, 0);
    while (heap.size) {
        const { value: from, priority } = heap.pop(), key = nodeKey(from);
        if (priority !== costs.get(key)) continue;
        if (options.goal?.(from)) break;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            for (const to of surfacesAt(world, from.x + dx, from.y + dy, profile)) {
                if (options.blocked?.(to)) continue;
                const next = priority + stepCost(world, from, to, profile), nextKey = nodeKey(to);
                if (next > budget || !Number.isFinite(next) || next >= (costs.get(nextKey) ?? Infinity)) continue;
                costs.set(nextKey, next); parents.set(nextKey, key); nodes.set(nextKey, { x: to.x, y: to.y, z: to.z });
                heap.push(nodes.get(nextKey), next);
            }
        }
        if (options.vault === false) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const to = canVault(world, from, dx, dy, profile);
            if (!to || options.blocked?.(to)) continue;
            const next = priority + VAULT_COST * ((world.surfaces(to.x, to.y).find(q => q.z === to.z)?.info.moveCost) ?? 1), nextKey = nodeKey(to);
            if (next > budget || next >= (costs.get(nextKey) ?? Infinity)) continue;
            costs.set(nextKey, next); parents.set(nextKey, key); nodes.set(nextKey, { x: to.x, y: to.y, z: to.z });
            heap.push(nodes.get(nextKey), next);
        }
    }
    return { costs, parents, nodes };
}
export function pathTo(search, goal) {
    let key = typeof goal === 'string' ? goal : nodeKey(goal);
    if (!search.nodes.has(key)) return [];
    const path = [];
    while (key) { path.push(search.nodes.get(key)); key = search.parents.get(key); }
    return path.reverse();
}
