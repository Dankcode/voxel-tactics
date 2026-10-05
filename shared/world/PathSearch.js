import { MinHeap } from '../util/MinHeap.js';
import { AGENT_PROFILES, surfacesAt, stepCost } from './TraversalRules.js';
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
