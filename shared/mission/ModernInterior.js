// Domestic circulation loop: open living/kitchen frontage, private rooms at the rear.
// Uses the same floor/wall/door contract and connectivity checks as the legacy builder.
export function planModernInterior({ x0, y0, w, d, layout = 'family' }) {
    const ix0 = x0 + 1, iy0 = y0 + 1, ix1 = x0 + w - 2, iy1 = y0 + d - 2;
    const splitX = x0 + Math.floor(w / 2), splitY = y0 + Math.floor(d / 2);
    const walls = [], doors = [], rooms = [];
    for (let x = ix0; x <= ix1; x++) walls.push([x, splitY]);
    for (let y = iy0; y < splitY; y++) walls.push([splitX, y]);
    // Two doors into the open-plan space plus an interconnecting rear door form a loop.
    doors.push({ x: ix0 + 2, y: splitY, open: false }, { x: ix1 - 2, y: splitY, open: false },
        { x: splitX, y: iy0 + 2, open: false });
    const region = (kind, ax, ay, bx, by) => {
        const cells = [];
        for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) cells.push([x, y]);
        rooms.push({ kind, cells });
    };
    region(layout === 'studio' ? 'office' : 'bedroom', ix0, iy0, splitX - 1, splitY - 1);
    region(layout === 'studio' ? 'utility' : 'bathroom', splitX + 1, iy0, ix1, splitY - 1);
    region('living', ix0, splitY + 1, splitX, iy1);
    region('kitchen', splitX + 1, splitY + 1, ix1, iy1);
    const doorSet = new Set(doors.map(p => `${p.x},${p.y}`));
    const wallsFinal = walls.filter(([x, y]) => !doorSet.has(`${x},${y}`));
    const wallSet = new Set(wallsFinal.map(([x, y]) => `${x},${y}`));
    const floor = [];
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) if (!wallSet.has(`${x},${y}`)) floor.push([x, y]);
    return { layout: 'domestic-loop', horizontal: true, walls: wallsFinal, wallSet, doors, rooms, floor, ix0, iy0, ix1, iy1 };
}
