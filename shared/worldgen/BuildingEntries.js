import { getBuildingFootprintCells } from './StructuralMatrixRules.js';
import { ELEMENTS, getTileDefinition } from './TileRegistry.js';
import { BUILDING_PARTS as B, TEXTURE_IDS as T } from './TileLibrary.js';

const dirs = [{ x: 0, y: -1, edge: 'north' }, { x: 1, y: 0, edge: 'east' },
    { x: 0, y: 1, edge: 'south' }, { x: -1, y: 0, edge: 'west' }];
export function materializeBuildingExteriors(rows, buildings) {
    const ox = Math.floor(rows[0].length / 2), oy = Math.floor(rows.length / 2);
    const at = (x, y) => rows[y + oy]?.[x + ox];
    const occupied = new Set(buildings.flatMap(b => getBuildingFootprintCells(b).cells.map(c => `${b.x + c.x},${b.y + c.y}`)));
    const anchors = new Set(), entries = [];
    for (const building of buildings) {
        const footprint = getBuildingFootprintCells(building), candidates = [];
        for (const p of footprint.cells) {
            const outward = dirs.filter(d => !footprint.set.has(`${p.x + d.x},${p.y + d.y}`));
            if (outward.length !== 1) continue;
            const d = outward[0], x = building.x + p.x + d.x, y = building.y + p.y + d.y;
            const tile = at(x, y), key = `${x},${y}`;
            if (!tile || occupied.has(key) || anchors.has(key) || tile.building ||
                tile.element === ELEMENTS.HYDRO || !getTileDefinition(tile.element, tile.texture).walkable ||
                Math.abs(tile.height - building.baseElevation) > 1) continue;
            const road = [T.ROAD, T.CITY_COBBLE, T.CITY_PLAZA].includes(tile.texture) && tile.element === ELEMENTS.GEO;
            const preferred = building.door?.x === p.x && building.door?.y === p.y;
            candidates.push({ x, y, z: tile.height, edge: d.edge, door: p, score: (preferred ? 100 : 0) + (road ? 30 : 0) });
        }
        candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
        const anchor = candidates[0];
        if (!anchor) throw new Error(`BUILDING_ENTRY_CONTRADICTION: ${building.id} has no dry, reachable exterior anchor`);
        anchors.add(`${anchor.x},${anchor.y}`);
        at(anchor.x, anchor.y).entranceReserved = true;
        building.exteriorOnly = true;
        building.entryDoor = { ...anchor.door, edge: anchor.edge };
        building.entryAnchor = { x: anchor.x, y: anchor.y, z: anchor.z, edge: anchor.edge };
        building.entrance = { ...building.entrance, approachGrid: { x: anchor.x, y: anchor.y } };
        delete building.door; delete building.doorBaseElevation;
        if (building.placementConstraints) delete building.placementConstraints.exteriorApproachElevation;
        building.stairs = []; building.stairCells = [];
        for (const p of footprint.cells) {
            const tile = at(building.x + p.x, building.y + p.y);
            if (!tile) continue;
            // Exteriors contain no traversable rooms or upper-floor furniture.
            const paletteId = tile.paletteId, visualVariant = tile.visualVariant;
            for (const key of Object.keys(tile)) delete tile[key];
            Object.assign(tile, { element: ELEMENTS.STRUCTURE, texture: building.style === 'stone' ? T.STONE_BUILDING_WALL : T.TIMBER_BUILDING_WALL,
                effect: ELEMENTS.STRUCTURE, building: B.WALL, height: building.baseElevation + (building.stories || 1) * 2,
                buildingBaseElevation: building.baseElevation, buildingGroundFloorZ: building.baseElevation,
                buildingMatrixTag: 'building-exterior', paletteId, visualVariant });
        }
        entries.push({ buildingId: building.id, name: building.name || building.archetype || 'Building', ...building.entryAnchor });
    }
    return entries;
}
