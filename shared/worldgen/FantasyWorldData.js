import { ACTIVE_WORLD } from './ActiveWorldData.js';
import {
    createGeographicWorldPlan,
    GEOGRAPHIC_WORLD_VIEW_HEIGHT,
    GEOGRAPHIC_WORLD_VIEW_WIDTH,
    sampleGeographicField
} from './GeographicWFCGenerator.js';

export const WORLD_VIEW_WIDTH = GEOGRAPHIC_WORLD_VIEW_WIDTH;
export const WORLD_VIEW_HEIGHT = GEOGRAPHIC_WORLD_VIEW_HEIGHT;
export const FANTASY_WORLD = ACTIVE_WORLD;

export function getWorldMapLocations() {
    return (FANTASY_WORLD.locations || []).map(cloneLocation);
}

export function getDefaultWorldLocation() {
    const locations = getWorldMapLocations();
    if (!locations.length) {
        return { id: 'world-center', name: FANTASY_WORLD.name, x: FANTASY_WORLD.width / 2, y: FANTASY_WORLD.height / 2 };
    }
    return locations
        .map((location) => ({ location, score: scoreDefaultLocation(location) }))
        .sort((a, b) => b.score - a.score || a.location.id.localeCompare(b.location.id))[0].location;
}

export function createFantasyWorldPlanAt(worldX, worldY, options = {}) {
    return createGeographicWorldPlan({
        worldX,
        worldY,
        width: options.width || WORLD_VIEW_WIDTH,
        height: options.height || WORLD_VIEW_HEIGHT,
        variant: options.variant || 0,
        includeTerrainSnapshot: options.includeTerrainSnapshot === true
    });
}

function scoreDefaultLocation(location) {
    const field = sampleGeographicField(location.x, location.y);
    const edgeDistance = Math.min(
        location.x,
        location.y,
        FANTASY_WORLD.width - location.x,
        FANTASY_WORLD.height - location.y
    );
    return (location.flags?.capital ? 40 : 0) +
        (location.flags?.port ? -10 : 8) +
        Math.log2(1 + Math.max(0, Number(location.population) || 0)) * 4 +
        field.land * 34 +
        Math.min(18, Math.max(0, field.height - 20) * 0.42) +
        Math.min(16, edgeDistance * 0.18);
}

function cloneLocation(location) {
    return {
        ...location,
        flags: { ...(location.flags || {}) }
    };
}
