import * as THREE from 'three';
import { WEAPONS } from '../../../shared/content/weapons.js';
/** On-screen radius: projected spread, kept visible and within a useful screen bound. */
export function reticleRadius(px){return Math.max(1.5,Math.min(260,px));}
/** One accuracy circle for every firearm, projected from the same angular spread used by ballistics. */
export function projectedSpreadRadius(camera, height, spread, distance, width=height*(camera.aspect||1)) {
    const angle=Math.tan(spread*Math.PI/180);
    const radius=reticleRadius(camera.isPerspectiveCamera ? angle/Math.tan(camera.fov*Math.PI/360)*height/2 : distance*angle/(camera.top-camera.bottom)*camera.zoom*height);
    return Math.min(radius,Math.max(1.5,Math.min(width,height)/2-36));
}
export function updateReticle(g){
    const el=g.hud.el('.aim-reticle'),u=g.selectedUnit();
    if(!u||g.mode.kind!=='shoot'||!g.freeAim||g.hud.equipment.open||g.player?.busy||g.cutins?.current){el.classList.add('hidden');return;}
    const p=g.freeAim,camera=g.scene.camera,impact=g.aimTrace?.point || p,point=new THREE.Vector3(impact.x,impact.h,impact.y),ndc=point.clone().project(camera),rect=g.scene.renderer.domElement.getBoundingClientRect();
    if(ndc.z>1||ndc.z< -1){el.classList.add('hidden');return;}
    el.classList.remove('hidden');el.classList.toggle('blocked',g.aimTrace?.kind==='voxel');
    const shooter=g.shooterOf?.(u)||u,spread=g.battle.spreadFor(shooter,WEAPONS[g.mode.weaponId],p,{target:g.aimTargetNear?.(p)}).spread;
    const m=g.aimStance?.muzzle,dist=(m?new THREE.Vector3(m.x,m.h,m.y):new THREE.Vector3(shooter.x+.5,shooter.z+2.35,shooter.y+.5)).distanceTo(point);
    // Perspective size depends on impact depth from the camera, while the cone grows from the muzzle.
    const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const apparentSpread = camera.isPerspectiveCamera
        ? Math.atan(Math.tan(spread*Math.PI/180)*dist/Math.max(camera.near,depth))*180/Math.PI : spread;
    const R=projectedSpreadRadius(camera,rect.height,apparentSpread,dist,rect.width);
    el.style.left=`${(ndc.x+1)*rect.width/2+rect.left}px`;el.style.top=`${(1-ndc.y)*rect.height/2+rect.top}px`;
    el.style.setProperty('--aim-radius',`${R}px`);
    const pick=g.aimPick&&g.battle.unit(g.aimPick.unitId);
    el.classList.toggle('on-target',!!pick&&!!g.isVisible?.(pick));
    const friendly = pick && pick.side === u.side;
    el.classList.toggle('friendly', !!friendly);
    el.querySelector('span.read').textContent=`${friendly ? 'Ally · ' : ''}${dist.toFixed(1)} m`;
    g.cutins?.placeAim?.(point);
}
