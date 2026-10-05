import { ELEMENTS, getTileDefinition } from './TileRegistry.js';
import { BUILDING_PARTS as B, TEXTURE_IDS as T } from './TileLibrary.js';

const directions = [
    { x: 0, y: -1, edge: 'north', part: B.STAIRS_NORTH },
    { x: 1, y: 0, edge: 'east', part: B.STAIRS_EAST },
    { x: 0, y: 1, edge: 'south', part: B.STAIRS_SOUTH },
    { x: -1, y: 0, edge: 'west', part: B.STAIRS_WEST }
];
const stairs = new Set([B.STAIRS, B.STAIRS_NORTH, B.STAIRS_EAST, B.STAIRS_SOUTH, B.STAIRS_WEST]);
const walkable = cell => cell && (cell.walkable ?? (
    stairs.has(cell.building) || cell.building === B.DOOR || cell.building === B.FLOOR ||
    cell.building === B.GROUND_FLOOR || getTileDefinition(cell.element, cell.texture).walkable));
const outdoor = cell => walkable(cell) && !cell.buildingMatrixTag &&
    cell.element !== ELEMENTS.HYDRO && cell.element !== ELEMENTS.PYRO &&
    (cell.building === B.NONE || stairs.has(cell.building));

/** Validate AFTER relief compression, plateau stabilization and structural stamping.
 * Entrances are repaired atomically along their outward normal. No water, fixed
 * structures or other buildings may be consumed by a repair. A failed repair is
 * an explicit diagnostic, never a partial staircase into a wall.
 */
export function validateMaterializedPlacement(rows, buildings = []) {
    const ox = Math.floor((rows[0]?.length || 0) / 2), oy = Math.floor(rows.length / 2);
    const at = (x, y) => rows[y + oy]?.[x + ox];
    const report = { repairedEntrances: 0, removedStairs: 0, orientedStairs: 0, issues: [] };
    for (const building of buildings) {
        if (!building.door) continue;
        const door = building.door;
        const x = building.x + door.x, y = building.y + door.y;
        const d = directions.find(d => d.edge === door.edge) || directions.find(d =>
            outdoor(at(x + d.x, y + d.y)) && at(x - d.x, y - d.y)?.buildingMatrixTag);
        const base = building.baseElevation || 0;
        if (!d) { report.issues.push({ buildingId: building.id, reason: 'entrance-direction' }); continue; }
        const inside = at(x - d.x, y - d.y);
        if (!walkable(inside) || inside.height < base || inside.building === B.WALL) {
            report.issues.push({ buildingId: building.id, reason: 'interior-landing' });
        }
        const landing = at(x + d.x, y + d.y);
        if (outdoor(landing) && Math.abs(landing.height - base) <= 1) {
            landing.entranceReserved = true;
            continue;
        }
        const proposed = [];
        let previous = base, connected = false;
        for (let distance = 1; distance <= 16; distance++) {
            const cell = at(x + d.x * distance, y + d.y * distance);
            if (!outdoor(cell) || cell.entranceReserved) break;
            const height = Math.max(previous - 1, Math.min(previous + 1, cell.height));
            proposed.push({ cell, height });
            if (height === cell.height) { connected = true; break; }
            previous = height;
        }
        if (!connected) { report.issues.push({ buildingId: building.id, reason: 'exterior-approach' }); continue; }
        for (const { cell, height } of proposed) { cell.height = height; cell.entranceReserved = true; }
        report.repairedEntrances++;
    }
    // A stair prefab is a connector, not decoration. Require two opposite dry
    // landings and a strictly rising, unit-step profile. Use a snapshot so a
    // rejected neighbor cannot change later decisions based on scan order.
    const changes = [];
    for (let row = 0; row < rows.length; row++) for (let col = 0; col < rows[row].length; col++) {
        const cell = rows[row][col];
        if (!stairs.has(cell.building) || cell.buildingMatrixTag) continue;
        const d = directions.find(d => {
            const low = rows[row - d.y]?.[col - d.x], high = rows[row + d.y]?.[col + d.x];
            return walkable(low) && walkable(high) && low.element !== ELEMENTS.HYDRO && high.element !== ELEMENTS.HYDRO &&
                low.height <= cell.height && cell.height <= high.height && high.height > low.height &&
                cell.height - low.height <= 1 && high.height - cell.height <= 1;
        });
        changes.push({ cell, d });
    }
    for (const { cell, d } of changes) {
        if (d) { cell.building = d.part; report.orientedStairs++; }
        else {
            Object.assign(cell, { element: ELEMENTS.GEO, texture: T.CITY_COBBLE, effect: ELEMENTS.GEO, building: B.NONE });
            report.removedStairs++;
        }
    }
    report.valid = report.issues.length === 0;
    return report;
}
