import { solveWaveFunctionCollapse } from './WaveFunctionCollapse.js';

// A hierarchical town model: JSON cells are projected into continuous mathematical features,
// districts are collapsed first, and building archetypes are collapsed second. No town names or
// individual building ids are hand-tuned; the same rules work for every compatible package.

export const TOWN_DISTRICTS = Object.freeze([
    { id: 'civic', weight: 0.45 },
    { id: 'market', weight: 0.9 },
    { id: 'residential', weight: 1.8 },
    { id: 'artisan', weight: 1.1 },
    { id: 'garden', weight: 0.95 },
    { id: 'harbor', weight: 0.7 }
]);

export const DISTRICT_PALETTES = Object.freeze({
    civic: Object.freeze({ id: 'sunlit-stone', roofs: ['copper', 'slate', 'tower'], accent: 0xf2c35a, activity: 'gather' }),
    market: Object.freeze({ id: 'festival', roofs: ['clay', 'market', 'copper'], accent: 0xf07b4f, activity: 'trade' }),
    residential: Object.freeze({ id: 'storybook', roofs: ['gabled', 'clay', 'slate'], accent: 0x4fb7a7, activity: 'home' }),
    artisan: Object.freeze({ id: 'workyard', roofs: ['slate', 'timber', 'thatch'], accent: 0xb56d43, activity: 'craft' }),
    garden: Object.freeze({ id: 'meadow', roofs: ['thatch', 'gabled', 'copper'], accent: 0x77b84e, activity: 'grow' }),
    harbor: Object.freeze({ id: 'seabright', roofs: ['copper', 'slate', 'clay'], accent: 0x2fa7c4, activity: 'dock' })
});

const DISTRICT_ACTIVITY = Object.freeze(Object.fromEntries(
    Object.entries(DISTRICT_PALETTES).map(([district, palette]) => [district, palette.activity])
));

const ARCHETYPE_DISTRICT_PRIORS = Object.freeze({
    civic: { hall: 5, manor: 3.5, tower: 2.5, townhouse: 1.4 },
    market: { bayfront: 3.8, townhouse: 3.1, hall: 2.2, workshop: 1.5 },
    residential: { cottage: 3.8, townhouse: 2.8, bayfront: 1.5, manor: 1.2 },
    artisan: { workshop: 5, townhouse: 1.8, cottage: 1.4, bayfront: 1.2 },
    garden: { cottage: 4.2, manor: 1.8, workshop: 1.1 },
    harbor: { bayfront: 4.4, workshop: 2.5, townhouse: 1.4, tower: 1.2 }
});

export function projectTownFeatures({ buildings = [], rows = [], elevationRows = [] } = {}) {
    const height = rows.length;
    const width = rows[0]?.length || 0;
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    const fields = buildTownDistanceFields(rows);
    const diagonal = Math.max(1, Math.hypot(width / 2, height / 2));
    const features = new Map();

    for (const building of [...buildings].sort((a, b) => compareIds(a?.id, b?.id))) {
        if (!building?.id) continue;
        const footprint = normalizeFootprint(building);
        const centerX = Number(building.x || 0) + (Math.max(1, Number(building.width || 1)) - 1) / 2;
        const centerY = Number(building.y || 0) + (Math.max(1, Number(building.height || 1)) - 1) / 2;
        const rowX = clamp(Math.round(centerX + offsetX), 0, Math.max(0, width - 1));
        const rowY = clamp(Math.round(centerY + offsetY), 0, Math.max(0, height - 1));
        const area = Math.max(1, footprint.cells.length);
        const perimeter = footprintPerimeter(footprint.set, footprint.cells);
        const compactness = clamp((4 * Math.PI * area) / Math.max(1, perimeter * perimeter), 0, 1);
        const span = Math.max(1, Number(building.width || 1), Number(building.height || 1));
        const meanElevation = meanFootprintElevation(building, footprint.cells, elevationRows, offsetX, offsetY);
        const centrality = clamp(1 - Math.hypot(centerX, centerY) / diagonal, 0, 1);
        const distanceWater = fieldValue(fields.water, rowX, rowY, width, height);
        const distanceRoad = fieldValue(fields.road, rowX, rowY, width, height);
        const distancePlaza = fieldValue(fields.plaza, rowX, rowY, width, height);
        const distanceWall = Math.min(
            fieldValue(fields.wall, rowX, rowY, width, height),
            rowX,
            rowY,
            Math.max(0, width - 1 - rowX),
            Math.max(0, height - 1 - rowY)
        );
        const metrics = {
            centerX,
            centerY,
            rowX,
            rowY,
            area,
            areaNorm: clamp(Math.sqrt(area) / 10, 0, 1),
            span,
            compactness,
            centrality,
            elevation: meanElevation,
            elevationNorm: clamp(meanElevation / 6, 0, 1),
            distanceWater,
            distanceRoad,
            distancePlaza,
            distanceWall,
            water: proximity(distanceWater, 7),
            road: proximity(distanceRoad, 5),
            plaza: proximity(distancePlaza, 6),
            wall: proximity(distanceWall, 5)
        };
        metrics.districtScores = districtScores(metrics);
        features.set(building.id, metrics);
    }
    return features;
}

export function buildTownAdjacencyGraph(buildings = [], { radius = 22, neighborCap = 16 } = {}) {
    const safeRadius = Math.max(1, Number(radius) || 22);
    const bucketSize = safeRadius;
    const records = [...buildings]
        .filter((building) => building?.id !== undefined && building?.id !== null)
        .map((building) => ({
            id: building.id,
            x: Number(building.x || 0) + (Math.max(1, Number(building.width || 1)) - 1) / 2,
            y: Number(building.y || 0) + (Math.max(1, Number(building.height || 1)) - 1) / 2
        }))
        .sort((a, b) => compareIds(a.id, b.id));
    const buckets = new Map();
    for (const record of records) {
        const key = bucketKey(record.x, record.y, bucketSize);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(record);
    }
    const links = new Map(records.map((record) => [record.id, new Set()]));
    for (const record of records) {
        const bx = Math.floor(record.x / bucketSize);
        const by = Math.floor(record.y / bucketSize);
        const candidates = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                for (const other of buckets.get(`${bx + dx},${by + dy}`) || []) {
                    if (other.id === record.id) continue;
                    const distance = Math.hypot(other.x - record.x, other.y - record.y);
                    if (distance <= safeRadius) candidates.push({ id: other.id, distance });
                }
            }
        }
        candidates.sort((a, b) => a.distance - b.distance || compareIds(a.id, b.id));
        for (const candidate of candidates.slice(0, Math.max(1, neighborCap))) {
            links.get(record.id).add(candidate.id);
            links.get(candidate.id).add(record.id);
        }
    }
    return records.map((record) => ({
        id: record.id,
        neighbors: [...links.get(record.id)]
            .sort(compareIds)
            .map((id) => ({ id, direction: 'near' }))
    }));
}

export function planTownWave({
    buildings = [],
    rows = [],
    elevationRows = [],
    seed = 'town',
    townId = 'town',
    archetypes = {},
    landmarkArchetypes = new Set()
} = {}) {
    const orderedBuildings = [...buildings]
        .filter((building) => building?.id !== undefined && building?.id !== null)
        .sort((a, b) => compareIds(a.id, b.id));
    if (orderedBuildings.length === 0) {
        return {
            assignments: new Map(),
            diagnostics: { buildings: 0, districtHistogram: {}, archetypeHistogram: {}, anchors: {} }
        };
    }

    const features = projectTownFeatures({ buildings: orderedBuildings, rows, elevationRows });
    const nodes = buildTownAdjacencyGraph(orderedBuildings);
    const districtDomains = new Map();
    for (const building of orderedBuildings) {
        const metrics = features.get(building.id);
        const ranked = Object.entries(metrics.districtScores)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const domain = ranked.slice(0, 4).map(([district]) => district);
        if (metrics.water < 0.22) removeValue(domain, 'harbor');
        districtDomains.set(building.id, domain.length ? domain : ['residential']);
    }
    const anchors = chooseDistrictAnchors(orderedBuildings, features);
    const fixedDistricts = new Map(Object.entries(anchors)
        .filter(([, buildingId]) => buildingId !== undefined && buildingId !== null)
        .map(([district, buildingId]) => [buildingId, district]));
    for (const [buildingId, district] of fixedDistricts) {
        if (!districtDomains.get(buildingId).includes(district)) districtDomains.get(buildingId).push(district);
    }

    const districtAssignment = solveWaveFunctionCollapse({
        nodes,
        tiles: TOWN_DISTRICTS,
        domains: districtDomains,
        fixed: fixedDistricts,
        seed: `${seed}:${townId}:districts`,
        compatible: (a, b) => !(a === b && ['civic', 'market', 'harbor'].includes(a)),
        nodeWeights: (buildingId, district) => Math.max(0.001, features.get(buildingId).districtScores[district] || 0.001)
    });

    const archetypeEntries = Object.entries(archetypes).sort(([a], [b]) => a.localeCompare(b));
    if (archetypeEntries.length === 0) {
        throw new Error('planTownWave requires at least one archetype specification.');
    }
    const landmarkSet = landmarkArchetypes instanceof Set ? landmarkArchetypes : new Set(landmarkArchetypes || []);
    const archetypeDomains = new Map();
    for (const building of orderedBuildings) {
        const span = features.get(building.id).span;
        const fitting = archetypeEntries
            .filter(([, spec]) => span >= Number(spec.minSpan ?? 0) && span <= Number(spec.maxSpan ?? Infinity))
            .map(([id]) => id);
        archetypeDomains.set(building.id, fitting.length ? fitting : [archetypeEntries[0][0]]);
    }
    const fixedArchetypes = chooseLandmarkAnchor(fixedDistricts, districtAssignment, archetypeDomains, landmarkSet, features);
    const archetypeAssignment = solveWaveFunctionCollapse({
        nodes,
        tiles: archetypeEntries.map(([id, spec]) => ({ id, weight: Number(spec.weight ?? 1) })),
        domains: archetypeDomains,
        fixed: fixedArchetypes,
        seed: `${seed}:${townId}:archetypes`,
        compatible: (a, b) => !(landmarkSet.has(a) && landmarkSet.has(b)),
        nodeWeights: (buildingId, archetype) => {
            const building = orderedBuildings.find((candidate) => candidate.id === buildingId);
            const district = districtAssignment.get(buildingId) || 'residential';
            const base = Number(archetypes[archetype]?.weight ?? 1);
            const districtPrior = ARCHETYPE_DISTRICT_PRIORS[district]?.[archetype] || 1;
            const sourcePrior = sourceArchetypePrior(building?.sourceType, archetype);
            return Math.max(0.001, base * districtPrior * sourcePrior);
        }
    });

    const assignments = new Map();
    for (const building of orderedBuildings) {
        const district = districtAssignment.get(building.id) || 'residential';
        const palette = DISTRICT_PALETTES[district] || DISTRICT_PALETTES.residential;
        assignments.set(building.id, {
            district,
            archetype: archetypeAssignment.get(building.id) || archetypeEntries[0][0],
            palette,
            activity: DISTRICT_ACTIVITY[district] || 'home',
            metrics: features.get(building.id)
        });
    }
    return {
        assignments,
        diagnostics: {
            buildings: assignments.size,
            districtHistogram: histogram([...assignments.values()].map((entry) => entry.district)),
            archetypeHistogram: histogram([...assignments.values()].map((entry) => entry.archetype)),
            anchors
        }
    };
}

function buildTownDistanceFields(rows) {
    const height = rows.length;
    const width = rows[0]?.length || 0;
    const seeds = { water: [], road: [], plaza: [], wall: [] };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const symbol = rows[y]?.[x];
            if (['W', '~', 'B', 'I'].includes(symbol)) seeds.water.push([x, y]);
            if (['R', '.', ':', ';'].includes(symbol)) seeds.road.push([x, y]);
            if (symbol === ';' || symbol === 'P') seeds.plaza.push([x, y]);
            if (['T', '9', '!', '@', '#', '$'].includes(symbol)) seeds.wall.push([x, y]);
        }
    }
    return Object.fromEntries(Object.entries(seeds).map(([key, points]) => [key, manhattanDistanceField(width, height, points)]));
}

function manhattanDistanceField(width, height, seeds) {
    const size = width * height;
    const distance = new Int32Array(size);
    distance.fill(width + height + 1);
    const queueX = new Int32Array(Math.max(1, size));
    const queueY = new Int32Array(Math.max(1, size));
    let head = 0;
    let tail = 0;
    for (const [x, y] of seeds) {
        const index = y * width + x;
        if (distance[index] === 0) continue;
        distance[index] = 0;
        queueX[tail] = x;
        queueY[tail] = y;
        tail++;
    }
    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;
        const nextDistance = distance[y * width + x] + 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const index = ny * width + nx;
            if (distance[index] <= nextDistance) continue;
            distance[index] = nextDistance;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail++;
        }
    }
    return distance;
}

function districtScores(metrics) {
    return {
        civic: 0.08 + metrics.centrality * 2.2 + metrics.areaNorm * 1.3 + metrics.road * 0.8 + metrics.elevationNorm * 0.25,
        market: 0.12 + metrics.plaza * 2.2 + metrics.road * 1.5 + metrics.centrality * 0.9,
        residential: 0.4 + metrics.compactness * 0.8 + metrics.road * 0.55 + (1 - metrics.plaza) * 0.35,
        artisan: 0.18 + metrics.road * 1.25 + metrics.areaNorm * 0.85 + (1 - metrics.centrality) * 0.25,
        garden: 0.15 + (1 - metrics.centrality) * 1.25 + metrics.water * 0.45 + metrics.compactness * 0.35,
        harbor: 0.02 + metrics.water * 2.7 + metrics.road * 0.65 + (1 - metrics.elevationNorm) * 0.35
    };
}

function chooseDistrictAnchors(buildings, features) {
    const pick = (district, excluded = new Set()) => buildings
        .filter((building) => !excluded.has(building.id))
        .map((building) => ({ id: building.id, score: features.get(building.id).districtScores[district] }))
        .sort((a, b) => b.score - a.score || compareIds(a.id, b.id))[0]?.id;
    const used = new Set();
    const civic = pick('civic', used);
    if (civic !== undefined) used.add(civic);
    const market = buildings.length >= 4 ? pick('market', used) : undefined;
    if (market !== undefined) used.add(market);
    const harborCandidate = buildings
        .filter((building) => !used.has(building.id) && features.get(building.id).water >= 0.35)
        .sort((a, b) => features.get(b.id).districtScores.harbor - features.get(a.id).districtScores.harbor || compareIds(a.id, b.id))[0];
    return { civic, market, harbor: buildings.length >= 5 ? harborCandidate?.id : undefined };
}

function chooseLandmarkAnchor(fixedDistricts, districtAssignment, domains, landmarkSet, features) {
    const civicEntry = [...fixedDistricts].find(([, district]) => district === 'civic');
    if (!civicEntry) return new Map();
    const buildingId = civicEntry[0];
    const choices = domains.get(buildingId).filter((archetype) => landmarkSet.has(archetype));
    if (!choices.length) return new Map();
    const metrics = features.get(buildingId);
    const preferred = choices.sort((a, b) => {
        const score = (id) => id === 'hall' ? metrics.areaNorm * 3 : id === 'tower' ? metrics.elevationNorm + 1 : id === 'manor' ? metrics.areaNorm * 2 : 0;
        return score(b) - score(a) || a.localeCompare(b);
    })[0];
    return new Map([[buildingId, preferred]]);
}

function sourceArchetypePrior(sourceType, archetype) {
    const type = String(sourceType || '').toLowerCase();
    if (/tower|keep/.test(type) && archetype === 'tower') return 6;
    if (/church|temple|hall|market|guild|palace|castle/.test(type) && archetype === 'hall') return 4;
    if (/manor/.test(type) && archetype === 'manor') return 6;
    if (/tavern|inn/.test(type) && ['bayfront', 'townhouse'].includes(archetype)) return 2.5;
    if (/blacksmith|workshop|forge|mill|farm/.test(type) && archetype === 'workshop') return 4;
    if (/house_large/.test(type) && archetype === 'townhouse') return 3;
    if (/house_small|hut|shack/.test(type) && archetype === 'cottage') return 3;
    return 1;
}

function normalizeFootprint(building) {
    const cells = Array.isArray(building.footprintCells) && building.footprintCells.length
        ? building.footprintCells.map((cell) => ({ x: Math.floor(cell.x), y: Math.floor(cell.y) }))
        : Array.from({ length: Math.max(1, Math.floor(building.height || 1)) }, (_, y) =>
            Array.from({ length: Math.max(1, Math.floor(building.width || 1)) }, (_, x) => ({ x, y }))).flat();
    return { cells, set: new Set(cells.map((cell) => `${cell.x},${cell.y}`)) };
}

function footprintPerimeter(set, cells) {
    let perimeter = 0;
    for (const cell of cells) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!set.has(`${cell.x + dx},${cell.y + dy}`)) perimeter++;
        }
    }
    return Math.max(1, perimeter);
}

function meanFootprintElevation(building, cells, elevationRows, offsetX, offsetY) {
    const values = cells
        .map((cell) => Number(elevationRows?.[Math.round(Number(building.y || 0) + cell.y + offsetY)]?.[
            Math.round(Number(building.x || 0) + cell.x + offsetX)
        ]))
        .filter(Number.isFinite);
    if (!values.length) return Math.max(0, Number(building.baseElevation || 0));
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fieldValue(field, x, y, width, height) {
    if (!field || width <= 0 || height <= 0) return width + height + 1;
    return field[y * width + x];
}

function proximity(distance, scale) {
    return Math.exp(-Math.max(0, distance) / Math.max(1, scale));
}

function histogram(values) {
    return values.reduce((result, value) => {
        result[value] = (result[value] || 0) + 1;
        return result;
    }, {});
}

function bucketKey(x, y, size) {
    return `${Math.floor(x / size)},${Math.floor(y / size)}`;
}

function removeValue(array, value) {
    const index = array.indexOf(value);
    if (index >= 0) array.splice(index, 1);
}

function compareIds(a, b) {
    return `${typeof a}:${String(a)}`.localeCompare(`${typeof b}:${String(b)}`);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
