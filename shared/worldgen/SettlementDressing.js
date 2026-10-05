import { sampleWfcNoiseMask } from './WfcNoiseMask.js';
import { ELEMENTS, getTileDefinition } from './TileRegistry.js';
import { BUILDING_PARTS } from './TileLibrary.js';

/** Pre-authored dressing modules, applied only after the geographic WFC, streets,
 * baked buildings and elevations have resolved. They never alter a solver cell.
 * Road and doorway reservations always win over decorative placement.
 */
export const SETTLEMENT_DRESSING_KITS = Object.freeze({
    home: Object.freeze(['woodpile', 'plant', 'garden']),
    artisan: Object.freeze(['barrel', 'woodpile', 'crate']),
    market: Object.freeze(['barrel', 'crate', 'plant']),
    civic: Object.freeze(['plant', 'lamp', 'shrub']),
    harbor: Object.freeze(['barrel', 'crate', 'woodpile'])
});
const hash = value => {
    let result = 2166136261;
    for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
    return result >>> 0;
};
const wetBiomes = new Set(['forest', 'jungle', 'wetland', 'meadow', 'taiga']);

export function sampleSettlementNoise(x, y, seed, world = {}) {
    const scale = Number(world.sampleScale) || 1;
    return sampleWfcNoiseMask({
        mapId: 'overworld', seed,
        x: Math.round((Number(world.sampleCenterX ?? world.centerX) || 0) / scale) + x,
        y: Math.round((Number(world.sampleCenterY ?? world.centerY) || 0) / scale) + y
    });
}

export function createSettlementDressing(tileRows, buildings = [], existing = [], seed = 0, world = {}) {
    const offsetX = Math.floor((tileRows[0]?.length || 0) / 2), offsetY = Math.floor(tileRows.length / 2);
    const cellAt = (x, y) => tileRows[y + offsetY]?.[x + offsetX];
    const output = existing.map(item => ({ ...item }));
    const additions = [];
    const reserved = new Set();
    for (const building of buildings) {
        for (let y = building.y; y < building.y + building.height; y++) {
            for (let x = building.x; x < building.x + building.width; x++) reserved.add(`${x},${y}`);
        }
    }
    const isEligible = (x, y) => {
        const cell = cellAt(x, y);
        if (!cell || cell.entranceReserved || cell.building !== BUILDING_PARTS.NONE || reserved.has(`${x},${y}`)) return false;
        if (![ELEMENTS.GEO, ELEMENTS.ANEMO, ELEMENTS.CRYO].includes(cell.element)) return false;
        const definition = getTileDefinition(cell.element, cell.texture);
        if (!definition.walkable || !['grass', 'forest', 'gardenGround', 'sand', 'hill', 'ice'].includes(definition.pattern)) return false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const neighbor = cellAt(x + dx, y + dy);
            if (!neighbor || Math.abs(neighbor.height - cell.height) > 1 || neighbor.building === BUILDING_PARTS.DOOR) return false;
        }
        return !output.concat(additions).some(item => Math.hypot(item.x - x, item.y - y) < 1.7);
    };
    for (const building of buildings) {
        const district = building.district || 'home';
        const kit = SETTLEMENT_DRESSING_KITS[district] || SETTLEMENT_DRESSING_KITS.home;
        const points = [
            [building.x - 1, building.y + 1], [building.x + building.width, building.y + building.height - 2],
            [building.x + 1, building.y - 1], [building.x + building.width - 2, building.y + building.height]
        ];
        let placed = 0;
        for (const [x, y] of points) {
            if (!isEligible(x, y) || placed >= 2) continue;
            const biome = cellAt(x, y).paletteId || 'meadow';
            const noise = sampleSettlementNoise(x, y, seed, world);
            let type = kit[Math.min(kit.length - 1, Math.floor(noise.value * kit.length))];
            if (type === 'garden' && !wetBiomes.has(biome)) type = 'barrel';
            additions.push({ type, x, y, district, biome, dressingKit: district, buildingId: building.id, rotation: hash(building.id) % 4 * Math.PI / 2 });
            placed++;
        }
    }
    // Coherent groves on dry, gentle ground. Global coordinates keep placement
    // stable when a player returns to the same solved geographic window.
    const candidates = [];
    for (let row = 2; row < tileRows.length - 2; row++) for (let col = 2; col < tileRows[row].length - 2; col++) {
        const cell = tileRows[row][col], x = col - offsetX, y = row - offsetY;
        const biome = cell.paletteId || 'meadow';
        if (!wetBiomes.has(biome) || !isEligible(x, y)) continue;
        const noise = sampleSettlementNoise(x, y, seed, world);
        const chance = hash(`${seed}:sapling:${noise.x}:${noise.y}`) % 100;
        if (noise.noise < 0.38 || chance > (biome === 'meadow' ? 9 : 20) * (0.5 + noise.value)) continue;
        if (buildings.some(b => x >= b.x - 2 && x <= b.x + b.width + 1 && y >= b.y - 2 && y <= b.y + b.height + 1)) continue;
        candidates.push({ type: 'tree', x, y, biome, district: 'wilderness', dressingKit: 'grove', priority: hash(`${seed}:${x}:${y}`) });
    }
    candidates.sort((a, b) => a.priority - b.priority);
    for (const candidate of candidates) {
        if (additions.length >= 64 || output.length + additions.length >= 210) break;
        if (isEligible(candidate.x, candidate.y)) { const { priority, ...item } = candidate; additions.push(item); }
    }
    return output.concat(additions);
}
