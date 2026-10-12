// Experimental intel rules. Contacts are observations, never permission to shoot through cover.
import { ABILITIES, ENEMIES } from '../content/units.js';
import { AIR } from '../voxel/Materials.js';
import { alive, hasStatus } from './Units.js';

export const SUPPORT_IDS = ['carpet_bomb', 'orbital_laser'];
export function footprint(b, id, to) {
    const cells=[];
    for(let y=0;y<b.store.depth;y++)for(let x=0;x<b.store.width;x++) {
        const dx=x-to.x,dy=y-to.y;
        const inside=id==='orbital_laser' ? Math.abs(dy)<=1 && Math.abs(dx)<=8
            : [-4,0,4].some(offset=>(dx-offset)**2+dy**2<=9);
        if(inside)cells.push({x,y,z:to.z});
    }
    return cells;
}
export function validateIntel(b,u,intent) {
    const a=ABILITIES[intent.abilityId],t=intent.to;
    if(!b.intelMode||u.side!=='player')return 'bad_intent';
    if(a.targeting==='tile' && (!t || ![t.x,t.y,t.z].every(Number.isInteger)||!b.store.inBounds(t.x,t.y,t.z)))return 'bad_intent';
    if(a.range && b.distance(u,t)>a.range)return 'out_of_range';
    if(a.id==='quiet_cut') {
        if(![1,2].some(h=>{const m=b.store.material(t.x,t.y,t.z+h);return m.solid&&Number.isFinite(m.hp);}))return 'no_target';
    }
    if(SUPPORT_IDS.includes(a.id)) {
        if(b.supportChoices[u.owner]!==a.id)return 'bad_intent';
        if(!b.detected)return 'not_detected';
        if((b.personalTurns[u.owner]||0)<(b.supportReady[u.owner]||0))return 'support_cooldown';
    }
    return null;
}
function observe(b,source,enemies) {
    for(const e of enemies)b.contacts[e.id]={enemyId:e.id,x:e.x,y:e.y,z:e.z,source,round:b.round};
    b.emit({t:'intel',source,contacts:enemies.map(e=>b.contacts[e.id])});
}
export function executeIntel(b,u,intent) {
    const id=intent.abilityId,t=intent.to;
    if(id==='water_sense'||id==='seismic_sense') {
        observe(b,id,b.unitsOf('enemy').filter(e=>b.distance(u,e)<=14 && (id==='seismic_sense'
            ? b.store.isSolid(e.x,e.y,e.z)&&Math.abs(e.z-u.z)<=2
            : [-1,0,1].some(dx=>[-1,0,1].some(dy=>[0,1].some(dz=>b.store.material(e.x+dx,e.y+dy,e.z+dz).liquid))))));
    } else if(id==='scout_drone') {
        const drone={owner:u.owner,unitId:u.id,...t,active:true};
        b.drones[u.owner]=drone;
        const detectors=b.unitsOf('enemy').filter(e=>b.distance(e,drone)<=(ENEMIES[e.type]?.droneDetector?8:2)&&b.sightLine(b.eye(e),{x:t.x+.5,y:t.y+.5,h:t.z+2.5}));
        if(detectors.length){drone.active=false;b.detected=true;b.alertGroup(detectors.map(e=>e.group),'drone_detected');}
        else observe(b,id,b.unitsOf('enemy').filter(e=>b.distance(drone,e)<=10&&b.sightLine({x:t.x+.5,y:t.y+.5,h:t.z+2.5},b.chest(e))));
        b.emit({t:'drone',...drone,detected:!drone.active});
    } else {
        const cells=id==='quiet_cut'?[t]:footprint(b,id,t);
        const changes=b.store.record(()=>{
            for(const c of cells)for(let z=id==='quiet_cut'?t.z+1:1;z<(id==='quiet_cut'?t.z+3:b.store.height);z++) {
                const m=b.store.material(c.x,c.y,z);
                if(m.id!==AIR&&Number.isFinite(m.hp)&&!m.liquid){b.store.set(c.x,c.y,z,AIR);b.stats.voxelsDestroyed++;}
            }
            b.settle();
        });
        b.emit({t:'voxels',changes});
        if(id!=='quiet_cut') {
            b.supportReady[u.owner]=(b.personalTurns[u.owner]||0)+10;
            for(const e of b.units.filter(alive))if(cells.some(c=>c.x===e.x&&c.y===e.y))b.dealDamage(e,'torso',40,{pierce:99,source:id,applyStatuses:false});
            b.noise(t.x,t.y,t.z,30,u);
        }
        b.checkFalls();
    }
}
export function intelSpread(u,weapon,b,target) {
    let spread=weapon.spread*.12;
    const mods=[];
    for(const [id,k] of [['suppressed',2],['staggered',1.6]])if(hasStatus(u,id)){spread*=k;mods.push([id,k]);}
    if(u.parts.armL.disabled||u.parts.armR.disabled){spread*=1.8;mods.push(['arm injury',1.8]);}
    if(target&&(b.field.isSmoke(target.x,target.y,target.z+1)||b.field.isSmoke(target.x,target.y,target.z+2))){spread*=2;mods.push(['smoke',2]);}
    return {spread,mods};
}

export function refreshDrones(b) {
    for(const d of Object.values(b.drones))if(d.active) {
        const detectors=b.unitsOf('enemy').filter(e=>b.distance(e,d)<=(ENEMIES[e.type]?.droneDetector?8:2)&&b.sightLine(b.eye(e),{x:d.x+.5,y:d.y+.5,h:d.z+2.5}));
        if(detectors.length){d.active=false;b.detected=true;b.alertGroup(detectors.map(e=>e.group),'drone_detected');b.emit({t:'drone',...d,detected:true});}
    }
}
