// Where a unit's feet are: the voxel top, minus the recess of roads and lawns (RenderTable drop). Views that place
// things on the ground (units, move zones, the path ribbon) read it so nothing floats over a recessed road.
import { groundDrop } from './RenderTable.js';

let store = null;
export function setGroundStore(s) { store = s; }
/** World height of the walkable surface on top of voxel (x, y, z) — fractional x / y round to the nearest cell. */
export function surfaceY(x, y, z) {
    const zi = Math.round(z);
    if (!store) return zi + 1;
    return z + 1 - groundDrop(store, Math.round(x), Math.round(y), zi);
}
export const dropAt = (x, y, z) => (store ? groundDrop(store, Math.round(x), Math.round(y), Math.round(z)) : 0);
