import { solveSite } from './SiteSolver.js';
import { designLevel } from './LevelDesigner.js';
import { solveFloor } from './FloorSolver.js';
import { solveFacade } from './FacadeSolver.js';

export function solveLayout(site,{seed=1,design=null,floorSpecs=[]}={}) {
    const layout=solveSite(site,seed);
    design=designLevel(site,layout,design);
    for(const b of layout.buildings) {
        b.floors=design.programs.filter(p=>p.building===b.id).sort((a,c)=>a.floor-c.floor).map(p=>solveFloor(b,p,floorSpecs.find(s=>s.building===b.id&&s.floor===p.floor)||{},seed));
        b.facade=solveFacade(b,b.floors,seed);
    }
    return {layout,design};
}
