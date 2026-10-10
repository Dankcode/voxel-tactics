import { solveLayers } from './LayerSolver.js';
import { solveSite } from './SiteSolver.js';
import { designLevel } from './LevelDesigner.js';
import { solveFloor } from './FloorSolver.js';
import { solveFacade } from './FacadeSolver.js';

import { plotFromSite, solveLayoutV3 } from './Generator.js';
import { buildWithRepair } from './Repair.js';

/**
 * A picture read (site.json) → layout. v3 (PLAN-04, the default): the picture becomes a plot whose buildings,
 * surfaces and flow are pinned; lots, bays, interiors and facades are solved by the field-guided WFC, and the layout
 * is repaired locally until the gates pass for `seeds` (the runtime seeds the package promises). v2 keeps the
 * PLAN-02/03 solvers for rollback (generatorVersion 3.x packages).
 */
export function solveLayout(site,{seed=1,design=null,floorSpecs=[],version=3,seeds=null}={}) {
    if(version===2)return solveLayoutV2(site,{seed,design,floorSpecs});
    let last;
    // The picture pins the architecture; when local repair runs out, the lots, bays and interiors are reseeded.
    for(let attempt=0;attempt<4;attempt++) {
        const s0=seed+attempt*7919,plot=plotFromSite(site,seed);
        const solved=solveLayoutV3(plot,{seed:s0,design:design?structuredClone(design):null,siteRead:site,floorSpecs,id:site.id,name:site.name,timeOfDay:site.timeOfDay});
        const op={site,layout:solved.layout,design:solved.design,context:solved.context};
        const list=[...new Set(seeds||[seed])];
        try {
            for(let round=0;round<2;round++)for(const s of list)buildWithRepair(op,{seed:s});
            if(attempt)op.layout.repairs.push({kind:'reseed-layout',from:seed,to:s0,reason:last?.message?.slice(0,120)});
            return {layout:op.layout,design:op.design};
        }catch(e){if(!/^repair\./.test(e.message))throw e;last=e;}
    }
    throw last;
}

export function solveLayoutV2(site,{seed=1,design=null,floorSpecs=[]}={}) {
    const layout=solveSite(site,seed);
    design=designLevel(site,layout,design);
    for(const b of layout.buildings) {
        b.floors=design.programs.filter(p=>p.building===b.id).sort((a,c)=>a.floor-c.floor).map(p=>solveFloor(b,p,floorSpecs.find(s=>s.building===b.id&&s.floor===p.floor)||{},seed));
        b.facade=solveFacade(b,b.floors,seed);
    }
    layout.layers=solveLayers(layout,site,seed);
    layout.parcels=layout.layers.parcels.filter(p=>p.id.endsWith(',1')).map(p=>({id:p.id.slice(0,-2),kind:['drop','entrance','manhole'].includes(p.kind)?'sidewalk':p.kind}));
    return {layout,design};
}
