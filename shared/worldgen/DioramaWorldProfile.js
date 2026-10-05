/** Materialization profile shared by every generated window. The WFC/noise field
 * retains its full relief information; gameplay gets broader, lower terraces.
 * This monotonic world-wide mapping cannot create a new >1-step terrain seam.
 */
export const DIORAMA_WORLD_VERSION = 'rustic-diorama-v2';
export function dioramaElevation(value) {
    return Math.floor(Math.max(0, Number(value) || 0) / 3);
}
export function createDioramaWorldPlan(plan) {
    if (plan.visualProfile === DIORAMA_WORLD_VERSION) return plan;
    return {
        ...plan,
        visualProfile: DIORAMA_WORLD_VERSION,
        contentHash: `${plan.contentHash}:${DIORAMA_WORLD_VERSION}`,
        elevationRows: (plan.elevationRows || []).map(row => row.map(dioramaElevation)),
        wallHeightRows: (plan.wallHeightRows || []).map(row => row.map(height => height > 0 ? Math.max(3, Math.ceil(height / 2)) : 0)),
        buildings: (plan.buildings || []).map(building => {
            const result = structuredClone(building);
            delete result.doorBaseElevation;
            if (result.placementConstraints) delete result.placementConstraints.exteriorApproachElevation;
            return { ...result, baseElevation: dioramaElevation(building.baseElevation), visualProfile: DIORAMA_WORLD_VERSION };
        }),
        world: { ...plan.world, visualProfile: DIORAMA_WORLD_VERSION },
        generation: { ...plan.generation, visualProfile: DIORAMA_WORLD_VERSION,
            elevationMaterialization: 'floor(sourceTier / 3)' }
    };
}
