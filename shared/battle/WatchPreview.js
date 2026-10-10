import { inWatchSector } from './WatchSector.js';
import { createUnit, facingToward } from './Units.js';
import { WEAPONS } from '../content/weapons.js';
import { estimateShot, partCentre, chooseMuzzle, sampleCone, rayUnit } from './Ballistics.js';
import { materialById } from '../voxel/Materials.js';
import { collisionFootprint } from '../voxel/ConnectedShapes.js';
import { createRng, hashString } from '../util/Rng.js';

export const WATCH_COLORS = Object.freeze({ high: 0x5ff2d6, low: 0xffb347 });
export const WATCH_HIGH = 0.65;
export const watchBand = accuracy => accuracy >= WATCH_HIGH ? 'high' : 'low';

// Potential reaction shot against a standard standing body, not a promise about a moving enemy.
// The existing ballistic estimator accounts for cover, weapon spread, wounds and reaction penalties.
export function watchAccuracy(battle, unit, cell, weaponId, { terrain = false } = {}) {
    const target = createUnit('cultist', unit.side === 'player' ? 'enemy' : 'player', cell, '__watch_target');
    target.facing = facingToward(unit.x-cell.x, unit.y-cell.y);
    const weapon = WEAPONS[weaponId], point = partCentre(target, 'torso');
    const { spread } = battle.spreadFor(unit, weapon, point, { reaction: true, target });
    if (!terrain) {
        const preview = { store: battle.store, units: [unit, target], unit: id => id === target.id ? target : unit };
        return estimateShot(preview, unit, { unitId: target.id, part: 'torso' }, { weapon, spread, samples: 32 }).hit;
    }
    // Solid surfaces cannot contain a soldier: show the same body's aim quality before terrain obstruction.
    const muzzle = chooseMuzzle(battle.store, unit, point);
    const delta = [point.x-muzzle.x, point.y-muzzle.y, point.h-muzzle.h], distance = Math.hypot(...delta);
    const direction = delta.map(v=>v/distance), rng = createRng(hashString(`watch:${unit.id}:${cell.x},${cell.y},${cell.z}:${spread}`));
    let hits=0;
    for(let i=0;i<32;i++) if(rayUnit(muzzle,sampleCone(direction,spread,rng),target,weapon.maxRange??40))hits++;
    return hits/32;
}

/** Filled ground cells and exposed terrain faces within a planar sector. No gameplay state changes. */
export function buildWatchPreview(battle, unit, sector, { hidden = () => false, cutZ = Infinity, cache = new Map() } = {}) {
    const tiles=[], faces=[];
    if(!sector)return {tiles,faces};
    const store=battle.store, eye=battle.eye(unit), radius=Math.ceil(sector.range);
    const accuracy=(c,terrain=false)=>{
        const key=`${terrain?'face':'tile'}:${c.x},${c.y},${c.z}`;
        if(!cache.has(key))cache.set(key,watchAccuracy(battle,unit,c,sector.weaponId,{terrain}));
        return cache.get(key);
    };
    for(let y=Math.max(0,unit.y-radius);y<=Math.min(store.depth-1,unit.y+radius);y++)
        for(let x=Math.max(0,unit.x-radius);x<=Math.min(store.width-1,unit.x+radius);x++) {
            if(!inWatchSector(unit,sector,{x,y}))continue;
            const c=store.surfaceNear(x,y,unit.z);
            if(c && c.z+1<cutZ && !hidden(x,y,c.z+1) && battle.sightLine(eye,{x:x+.5,y:y+.5,h:c.z+2.05})) {
                const hit=accuracy(c);tiles.push({...c,accuracy:hit,band:watchBand(hit)});
            }
            for(let z=0;z<Math.min(store.height,cutZ);z++) {
                const material=materialById(store.get(x,y,z));
                if((!material.solid && material.render!=='glass') || (material.walkable && z<=unit.z) || hidden(x,y,z))continue;
                const polygon=collisionFootprint(store,x,y,z)||[[0,0],[1,0],[1,1],[0,1]];
                const addFace=(points,normal)=>{
                    const centre=points.reduce((s,p)=>s.map((v,i)=>v+p[i]/points.length),[0,0,0]);
                    if(normal[0]*(eye.x-centre[0])+normal[1]*(eye.y-centre[1])+normal[2]*(eye.h-centre[2])<=0)return;
                    if(!battle.sightLine(eye,{x:centre[0],y:centre[1],h:centre[2]}))return;
                    const hit=accuracy({x,y,z:z-1},true);faces.push({x,y,z,points,accuracy:hit,band:watchBand(hit)});
                };
                for(let i=0;i<polygon.length;i++) {
                    const a=polygon[i],b=polygon[(i+1)%polygon.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
                    if(length<.001)continue;
                    const nx=(b[1]-a[1])/length,ny=-(b[0]-a[0])/length,offset=.025;
                    const ax=x+a[0]+nx*offset,ay=y+a[1]+ny*offset,bx=x+b[0]+nx*offset,by=y+b[1]+ny*offset;
                    addFace([[ax,ay,z],[bx,by,z],[bx,by,Math.min(z+1,cutZ)],[ax,ay,Math.min(z+1,cutZ)]],[nx,ny,0]);
                }
                if(!materialById(store.get(x,y,z+1)).solid && z+1<cutZ)
                    addFace(polygon.map(p=>[x+p[0],y+p[1],z+1.025]),[0,0,1]);
            }
        }
    return {tiles,faces};
}
