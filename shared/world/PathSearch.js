import { ladderAttachment } from './LadderAttachment.js';
import { MinHeap } from '../util/MinHeap.js';
import { AGENT_PROFILES, surfacesAt, stepCost } from './TraversalRules.js';
import { materialById, MAT } from '../voxel/Materials.js';

const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
/** Jump down off a ledge, balcony or container to a landing 2–4 voxels lower (one storey). Controlled: no fall damage,
 *  but the jumper lands Staggered (Battle.doMove). */
export const JUMP_COST = 3;
export const JUMP_DROP = Object.freeze({ min: 2, max: 4 });
export function canJumpDown(world, from, dx, dy, profile = AGENT_PROFILES.player) {
    if (profile.width !== 1) return null;
    const bx = from.x + dx, by = from.y + dy;
    for (let h = 1; h <= profile.clearance; h++) if (world.isSolid(from.x, from.y, from.z + h)) return null;
    const land = surfacesAt(world, bx, by, profile).filter(s => s.z <= from.z - JUMP_DROP.min && s.z >= from.z - JUMP_DROP.max).at(-1);
    if (!land) return null;
    // The column beside the ledge is open from the landing to above the jumper's head (no railing, wall or awning).
    // A ladder column is climbed down, not jumped (ladderMoves).
    for (let z = land.z + 1; z <= from.z + profile.clearance; z++) if (world.isSolid(bx, by, z) || world.get(bx, by, z) === MAT.ladder) return null;
    return { x: bx, y: by, z: land.z };
}

/** Ladders: climb from the foot of a ladder column to the ledge level with its top rung, or back down. */
export const LADDER_BASE_COST = 1.5;
export function ladderMoves(world, from, profile = AGENT_PROFILES.player) {
    const out = [];
    if (profile.width !== 1) return out;
    const L = MAT.ladder, at = (x, y, z) => world.get(x, y, z) === L;
    if (at(from.x, from.y, from.z + 1)&&ladderAttachment(world,from.x,from.y,from.z+1)) {                                        // up: the ladder rises from this cell
        let top = from.z + 1; while (at(from.x, from.y, top + 1)) top++;
        if (top - from.z >= 2 && !world.isSolid(from.x, from.y, top + 1)) for (const [dx, dy] of CARDINAL) {
            const s = surfacesAt(world, from.x + dx, from.y + dy, profile).find(q => q.z === top);
            if (s) out.push({ x: s.x, y: s.y, z: top, rise: top - from.z });
        }
    }
    for (const [dx, dy] of CARDINAL) {                                             // down: a ladder top beside this ledge
        const lx = from.x + dx, ly = from.y + dy;
        if (!ladderAttachment(world,lx,ly,from.z)||!at(lx, ly, from.z) || at(lx, ly, from.z + 1) || world.isSolid(lx, ly, from.z + 1)) continue;
        let bottom = from.z; while (at(lx, ly, bottom - 1)) bottom--;
        const foot = surfacesAt(world, lx, ly, profile).find(q => q.z === bottom - 1);
        if (foot && from.z - foot.z >= 2) out.push({ x: lx, y: ly, z: foot.z, rise: from.z - foot.z });
    }
    return out;
}
export const ladderCost = rise => LADDER_BASE_COST + rise;

/** How a path step from a to b is made: 'walk', 'vault', 'jump' or 'climb' (animation, stagger). */
export function stepKind(world, a, b) {
    const dz = b.z - a.z, flat = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    if (Math.abs(dz) >= 2) {
        const L = MAT.ladder;
        const ladder = dz > 0 ? world.get(a.x, a.y, a.z + 1) === L : world.get(b.x, b.y, b.z + 1) === L && world.get(b.x, b.y, a.z) === L;
        return ladder ? 'climb' : 'jump';
    }
    return flat >= 2 ? 'vault' : 'walk';
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
        for (const [dx, dy] of options.vault === false ? [] : CARDINAL) {
            const to = canVault(world, from, dx, dy, profile);
            if (!to || options.blocked?.(to)) continue;
            const next = priority + VAULT_COST * ((world.surfaces(to.x, to.y).find(q => q.z === to.z)?.info.moveCost) ?? 1), nextKey = nodeKey(to);
            if (next > budget || next >= (costs.get(nextKey) ?? Infinity)) continue;
            costs.set(nextKey, next); parents.set(nextKey, key); nodes.set(nextKey, { x: to.x, y: to.y, z: to.z });
            heap.push(nodes.get(nextKey), next);
        }
        const extra = [];
        if (options.jump !== false) for (const [dx, dy] of CARDINAL) { const to = canJumpDown(world, from, dx, dy, profile); if (to) extra.push([to, JUMP_COST]); }
        if (options.ladders !== false) for (const to of ladderMoves(world, from, profile)) extra.push([to, ladderCost(to.rise)]);
        for (const [to, cost] of extra) {
            if (options.blocked?.(to)) continue;
            const next = priority + cost, nextKey = nodeKey(to);
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
