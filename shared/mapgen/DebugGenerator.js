// Local map-builder sandbox: regenerate architecture rather than re-scatter a saved layout.
import { createRng } from '../util/Rng.js';
import { validateSite, buildPackagedMap } from './PackageBuilder.js';
import { solveLayout } from './LayoutSolver.js';

export const DEBUG_PROGRAMS = ['office', 'house', 'shop', 'warehouse', 'diner', 'garage'];
export const DEBUG_TIMES = ['day', 'dusk', 'night', 'dawn', 'overcast', 'night-ops'];
export function debugSite({ seed = 1, program = 'office', storeys = 3, timeOfDay = 'day' } = {}) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('Map builder seed must be an integer from 0 to 4294967295');
    if (!DEBUG_PROGRAMS.includes(program)) throw Error('Unknown map builder programme');
    if (!Number.isInteger(storeys) || storeys < 1 || storeys > 4) throw Error('Map builder storeys must be 1–4');
    if (!DEBUG_TIMES.includes(timeOfDay)) throw Error('Unknown map builder time of day');
    const rng = createRng(seed);
    const x = rng.int(16, 21) / 100, y = rng.int(12, 18) / 100;
    return validateSite({
        version: 2, id: 'debug-generated', name: `Builder test ${seed}`, theme: program === 'house' ? 'Suburbs' : program === 'warehouse' ? 'Industrial' : 'Downtown',
        timeOfDay, frame: { width: rng.int(48, 56), height: rng.int(36, 42) },
        buildings: [{ id: 'test-building', bounds: [x, y, x + rng.int(40, 46) / 100, y + rng.int(36, 40) / 100], program, front: 'e', storeys }],
        surfaces: [{ bounds: [0, 0, 1, 1], material: program === 'house' ? 'lawn' : 'concrete' }, { bounds: [0, .72, 1, .84], material: 'asphalt' }],
        insertion: [.1, .92], flow: [[.82, .66], [.82, .4], [.82, .1]],
        storyHooks: ['Recover the records from the upper command room.'],
    });
}

export function generateDebugMap(options = {}) {
    const seed = options.seed ?? 1;
    const site = debugSite(options);
    const { layout, design } = solveLayout(site, { seed });
    const mission = buildPackagedMap({ site, layout, design }, { seed });
    // Keep the exact inputs and solver output available for inspection/export in the console.
    mission.meta.debugGeneration = { options: { seed, program: site.buildings[0].program, storeys: site.buildings[0].storeys, timeOfDay: site.timeOfDay }, site, layout, design };
    return mission;
}
