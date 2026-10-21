import * as THREE from 'three';
import { WEAPONS } from '../../../shared/content/weapons.js';
import { weaponBuild } from '../../../shared/battle/FireControl.js';
/** On-screen radius for a projected cone radius: real size, kept visible (≥ 1.5 px) and on screen (≤ 260 px). */
const PART_NAMES={head:'HEAD',torso:'TORSO',armL:'LEFT ARM',armR:'RIGHT ARM',legs:'LEGS'};
export function reticleRadius(px){return Math.max(1.5,Math.min(260,px));}
export function updateReticle(g){
    const el=g.hud.el('.aim-reticle'),u=g.selectedUnit();if(!u||g.mode.kind!=='shoot'||!g.freeAim||g.hud.equipment.open){el.classList.add('hidden');return;}
    el.classList.remove('hidden');el.classList.toggle('blocked',!!g.aimStance?.blocked);el.classList.toggle('stepped',!!g.aimStance?.muzzle?.step);const p=g.freeAim,camera=g.scene.camera,point=new THREE.Vector3(p.x,p.h,p.y),ndc=point.clone().project(camera),rect=g.scene.renderer.domElement.getBoundingClientRect();
    const w=weaponBuild(u,WEAPONS[g.mode.weaponId]),spread=g.battle.spreadFor(u,WEAPONS[g.mode.weaponId],p,{target:g.aimTargetNear?.(p)}).spread;   // PLAN-10: same spread as the shot (target modifiers included)
    const m=g.aimStance?.muzzle,dist=(m?new THREE.Vector3(m.x,m.h,m.y):new THREE.Vector3(u.x+.5,u.z+2.35,u.y+.5)).distanceTo(point),cone=dist*Math.tan(spread*Math.PI/180);
    const radius=camera.isPerspectiveCamera?Math.tan(spread*Math.PI/180)/Math.tan(camera.fov*Math.PI/360)*rect.height/2:cone/(camera.top-camera.bottom)*camera.zoom*rect.height;
    const x=(ndc.x+1)*rect.width/2+rect.left,y=(1-ndc.y)*rect.height/2+rect.top;
    // PLAN-07: the outer ring is the whole cone at the aim distance (every round lands inside it), the inner ring holds
    // half of them (uniform disc: r·√0.5). No artificial floor: a sniper's pinpoint is a pinpoint.
    const R=reticleRadius(radius);el.style.left=`${x}px`;el.style.top=`${y}px`;g.cutins?.placeAim?.(point);el.style.setProperty('--aim-radius',`${R}px`);el.style.setProperty('--aim-inner',`${(R*Math.SQRT1_2).toFixed(1)}px`);
    const zoom=camera.isPerspectiveCamera?Math.tan(19*Math.PI/180)/Math.tan(camera.fov*Math.PI/360):1;
    // PLAN-14: the reticle is the targeting. On an enemy it names the body part under it and the odds for that part
    // (and for any hit); otherwise the distance and spread.
    const pick=g.aimPick&&g.battle.unit(g.aimPick.unitId),odds=pick&&g.isVisible?.(pick)?g.partChance?.(pick,g.aimPick.part):null;
    el.classList.toggle('on-target',!!odds);
    const status=`${g.aim?.settled===false?' · STEADYING':''}${g.aimStance?.blocked?' · BLOCKED':g.aimStance?.muzzle?.step?' · STEP OUT':''}`;
    el.querySelector('span').textContent=odds?`${pick.name.toUpperCase()} · ${PART_NAMES[g.aimPick.part]||g.aimPick.part} ${odds.part}% · ANY HIT ${odds.any}%${status}`
        :`${w.name} · ${dist.toFixed(1)} M · ±${(cone).toFixed(2)} M · ${zoom.toFixed(1)}×${status}`;
}
