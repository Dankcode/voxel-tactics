// Car-park stripes as road paint (presentation only; the client's RoadMarkings draws the plan). The street paint of a
// real place — centre, lane and edge lines, crosswalks, stop bars — comes from Geo-voxel's own plan in its layers
// (layers.paint.quads); the game only adds the stall dividers of the car parks it stripes.
//
// Output quads: { c: [[x, y] ×4], z, color: 'white' | 'yellow' } in cell coordinates (x right, y south).
const W_LINE = 0.12;

/**
 * Car-park stripes: every `road_mark` voxel on lot ground becomes asphalt again and each straight run of them a thin
 * white line along its centre. Returns the quads (mutates the store).
 */
export function lotStripesToPaint(store, cells, MAT, zAt = (x, y) => store.topSolid(x, y)) {
    const set = new Set(cells.map(([x, y]) => `${x},${y}`)), mark = (x, y) => set.has(`${x},${y}`) && store.get(x, y, zAt(x, y)) === MAT.road_mark;
    const quads = [], seen = new Set();
    for (const [x, y] of cells) {
        if (!mark(x, y) || seen.has(`${x},${y}`)) continue;
        const alongX = mark(x + 1, y) || mark(x - 1, y);
        let x0 = x, y0 = y; while (alongX ? mark(x0 - 1, y0) : mark(x0, y0 - 1)) alongX ? x0-- : y0--;
        let x1 = x0, y1 = y0; while (alongX ? mark(x1 + 1, y1) : mark(x1, y1 + 1)) alongX ? x1++ : y1++;
        const z = zAt(x0, y0);
        for (let cx = x0, cy = y0; ; alongX ? cx++ : cy++) { seen.add(`${cx},${cy}`); store.set(cx, cy, zAt(cx, cy), MAT.asphalt); if (cx === x1 && cy === y1) break; }
        const c = alongX ? [[x0 + 0.1, y0 + 0.5 - W_LINE / 2], [x1 + 0.9, y0 + 0.5 - W_LINE / 2], [x1 + 0.9, y0 + 0.5 + W_LINE / 2], [x0 + 0.1, y0 + 0.5 + W_LINE / 2]]
            : [[x0 + 0.5 - W_LINE / 2, y0 + 0.1], [x0 + 0.5 + W_LINE / 2, y0 + 0.1], [x0 + 0.5 + W_LINE / 2, y1 + 0.9], [x0 + 0.5 - W_LINE / 2, y1 + 0.9]];
        quads.push({ c, z, color: 'white' });
    }
    return quads;
}
