import * as THREE from 'three';
import { WEAPONS } from '../../../shared/content/weapons.js';
import { weaponBuild } from '../../../shared/battle/FireControl.js';
export function updateReticle(g){
    const el=g.hud.el('.aim-reticle'),u=g.selectedUnit();if(!u||g.mode.kind!=='shoot'||!g.freeAim||g.hud.equipment.open){el.classList.add('hidden');return;}
    el.classList.remove('hidden');const p=g.freeAim,camera=g.scene.camera,point=new THREE.Vector3(p.x,p.h,p.y),ndc=point.clone().project(camera),rect=g.scene.renderer.domElement.getBoundingClientRect();
    const w=weaponBuild(u,WEAPONS[g.mode.weaponId]),spread=g.battle.spreadFor(u,WEAPONS[g.mode.weaponId],p).spread;
    const dist=new THREE.Vector3(u.x+.5,u.z+2.35,u.y+.5).distanceTo(point),cone=dist*Math.tan(spread*Math.PI/180);
    const radius=camera.isPerspectiveCamera?Math.tan(spread*Math.PI/180)/Math.tan(camera.fov*Math.PI/360)*rect.height/2:cone/(camera.top-camera.bottom)*camera.zoom*rect.height;
    const x=(ndc.x+1)*rect.width/2+rect.left,y=(1-ndc.y)*rect.height/2+rect.top;
    el.style.left=`${x}px`;el.style.top=`${y}px`;el.style.setProperty('--aim-radius',`${Math.max(4,Math.min(220,radius))}px`);
    el.querySelector('span').textContent=`${w.name} · ${dist.toFixed(1)} M · ${g.freeAimManual?'FREE AIM':'BODY AIM'}`;
}
