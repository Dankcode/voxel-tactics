// PLAN 15A §6.2 — what blocks a projectile. Movement never calls this.
export const UPPER_WINDOW = new Set([14, 15, 16, 17]);               // WINDOW_UPPER_* — glazing (decision 12)
export const STAIR_PARTS = new Set([4, 10, 11, 12, 13, 19, 20, 21, 22, 25]);

export function voxelAt(world, x, y, z) {
    const col = world.column(x, y); if (!col) return null;
    for (const v of col) if (v.z === z) return v;
    return null;
}

/** h is a continuous height; voxel z spans [z, z+1). */
export function isProjectileBlocking(world, x, y, h) {
    const z = Math.floor(h);
    const v = voxelAt(world, x, y, z);
    if (!v || v.element === 0 || v.collision?.active === false) return false;
    if (v.projectilePassable || UPPER_WINDOW.has(v.building)) return false;
    if (STAIR_PARTS.has(v.building)) return (h - z) < 0.5;             // half-height slope approximation
    return true;
}
