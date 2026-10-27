// PLAN-15 peek. While aiming, the shooter may lean out up to `range` tiles (B.peekRange) from the tile it stands on
// to find an angle. The shot then fires from the peek tile: the soldier is exposed there (known overwatch fires at
// it, reaction shots use the peek tile's cover) and steps back home afterwards, like an XCOM 2 step-out.
//
// Shared by client (preview, WASD stepping) and Battle (validation), so lockstep stays deterministic.
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { MAT } from '../voxel/Materials.js';
import { coverAgainst, COVER } from '../voxel/Cover.js';
import { inWatchSector } from './WatchSector.js';
import { alive, hasStatus } from './Units.js';
import { B } from '../content/balance.js';

const PROFILE = AGENT_PROFILES.player;
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * Tiles the unit may peek to: same storey, standable, unoccupied, within Chebyshev `range` of its tile, reached by
 * plain walking steps only (no doors, vaults, ladders or drops; corner-cutting follows the path rules).
 * The unit's own tile is always first.
 */
export function peekCells(battle, u, range = B.peekRange ?? 1) {
    const home = { x: u.x, y: u.y, z: u.z };
    if (!range || range <= 0 || u.drone) return [home];
    const search = reachable(battle.store, home, range * 1.5 + 0.05, PROFILE, {
        vault: false, jump: false, ladders: false,
        blocked: to => {
            if (to.z !== home.z) return true;
            if (Math.max(Math.abs(to.x - home.x), Math.abs(to.y - home.y)) > range) return true;
            const id = battle.store.get(to.x, to.y, to.z + 1);
            if (id === MAT.door || id === MAT.door_open) return true;
            const o = battle.occupant?.(to.x, to.y, to.z);
            return !!o && o.id !== u.id;
        }
    });
    const out = [home];
    for (const n of search.nodes.values()) if (!same(n, home) && n.z === home.z) out.push({ x: n.x, y: n.y, z: n.z });
    out.sort((a, b) => (same(a, home) ? -1 : same(b, home) ? 1 : 0) || Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y) || a.y - b.y || a.x - b.x);
    return out;
}

export function isPeekCell(battle, u, cell, range = B.peekRange ?? 1) {
    if (!cell || ![cell.x, cell.y, cell.z].every(Number.isInteger)) return false;
    return peekCells(battle, u, range).some(c => same(c, cell));
}

/** A copy of `u` standing on `cell` (for muzzle, spread and estimates from a peek tile). */
export function atCell(u, cell) {
    if (!cell || same(cell, u)) return u;
    return Object.assign(Object.create(Object.getPrototypeOf(u)), u, { x: cell.x, y: cell.y, z: cell.z });
}

/**
 * How exposed a peek tile is against what the unit's side knows: the worst cover against any known hostile
 * (COVER.NONE when one has it flanked) and whether a known overwatch covers the tile.
 */
export function peekExposure(battle, u, cell) {
    const known = battle.visibleTo ? battle.visibleTo(u.side) : new Set();
    const hostiles = battle.enemiesOf(u).filter(e => alive(e) && known.has(e.id));
    let cover = hostiles.length ? COVER.FULL : null, flankedBy = 0;
    for (const e of hostiles) {
        const c = coverAgainst(battle.store, cell.x, cell.y, cell.z, e.x, e.y, e.z);
        if (c === COVER.NONE) flankedBy++;
        cover = Math.min(cover, c);
    }
    const overwatch = hostiles.some(w => w.overwatch && !hasStatus(w, 'surprised') && inWatchSector(w, w.overwatch, cell)
        && battle.sightLine?.(battle.eye(w), { x: cell.x + 0.5, y: cell.y + 0.5, h: cell.z + 2.05 }));
    return { cover, flankedBy, overwatch, label: cover === null ? 'NO CONTACT' : cover === COVER.NONE ? 'EXPOSED' : cover === COVER.HALF ? 'HALF COVER' : 'FULL COVER' };
}

export { nodeKey };
