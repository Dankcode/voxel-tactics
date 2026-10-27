import * as THREE from 'three';
import { WEAPONS } from '../../../shared/content/weapons.js';
import { weaponBuild } from '../../../shared/battle/FireControl.js';
import { aimClass } from './AimController.js';
import { estimateShot } from '../../../shared/battle/Ballistics.js';
import { partArmor } from '../../../shared/battle/Units.js';
import { B } from '../../../shared/content/balance.js';
/** PLAN-15 shotgun reticle: range band at the aim distance. */
export function shotgunBand(w, dist) { return dist <= w.range ? 'effective' : dist <= w.maxRange ? 'falloff' : 'out'; }
/** PLAN-15: eight pellet marks in a fixed sunflower pattern inside radius R (stable while aiming). */
export function pelletPattern(n, R) { return Array.from({ length: n }, (_, i) => { const r = R * Math.sqrt((i + 0.5) / n), a = i * 2.39996; return [Math.cos(a) * r, Math.sin(a) * r]; }); }
/** PLAN-15: expected pellets on the target and the damage they carry through its torso armour. */
export function pelletEstimate(battle, shooter, w, target, point, spread) {
    const n = w.pellets || w.projectiles || 1, raw = Math.round(w.damage || 0);
    let onTarget = 0;
    if (target) onTarget = estimateShot(battle, shooter, { point, unitId: target.id }, { weapon: w, spread, samples: 48 }).hit ?? 0;
    const per = target ? Math.max(raw - Math.max(0, partArmor(target, 'torso') - (w.pierce || 0)), Math.ceil(raw * (B.armorMinDamage || 0))) : raw;
    const pellets = onTarget * n;
    return { pellets, n, damage: Math.round(pellets * per) };
}
/** On-screen radius for a projected cone radius: real size, kept visible (≥ 1.5 px) and on screen (≤ 260 px). */
const PART_NAMES={head:'HEAD',torso:'TORSO',armL:'LEFT ARM',armR:'RIGHT ARM',legs:'LEGS'};
export function reticleRadius(px){return Math.max(1.5,Math.min(260,px));}
export function updateReticle(g){
    const el=g.hud.el('.aim-reticle'),u=g.selectedUnit();if(!u||g.mode.kind!=='shoot'||!g.freeAim||g.hud.equipment.open){el.classList.add('hidden');return;}
    el.classList.remove('hidden');el.classList.toggle('blocked',!!g.aimStance?.blocked);el.classList.toggle('stepped',!!g.aimStance?.muzzle?.step);const p=g.freeAim,camera=g.scene.camera,point=new THREE.Vector3(p.x,p.h,p.y),ndc=point.clone().project(camera),rect=g.scene.renderer.domElement.getBoundingClientRect();
    const shooter=g.shooterOf?.(u)||u,w=weaponBuild(u,WEAPONS[g.mode.weaponId]),spread=g.battle.spreadFor(shooter,WEAPONS[g.mode.weaponId],p,{target:g.aimTargetNear?.(p)}).spread;   // PLAN-10: same spread as the shot (target modifiers included)
    const m=g.aimStance?.muzzle,dist=(m?new THREE.Vector3(m.x,m.h,m.y):new THREE.Vector3(shooter.x+.5,shooter.z+2.35,shooter.y+.5)).distanceTo(point),cone=dist*Math.tan(spread*Math.PI/180);
    const radius=camera.isPerspectiveCamera?Math.tan(spread*Math.PI/180)/Math.tan(camera.fov*Math.PI/360)*rect.height/2:cone/(camera.top-camera.bottom)*camera.zoom*rect.height;
    const x=(ndc.x+1)*rect.width/2+rect.left,y=(1-ndc.y)*rect.height/2+rect.top;
    // PLAN-07: the outer ring is the whole cone at the aim distance (every round lands inside it), the inner ring holds
    // half of them (uniform disc: r·√0.5). No artificial floor: a sniper's pinpoint is a pinpoint.
    // PLAN-15: the shotgun gets a pattern reticle — corner brackets for the pellet spread (capped so it never fills the
    // screen), eight pellet marks, a range band and the expected pellets / damage on the enemy under it.
    const pattern=aimClass(WEAPONS[g.mode.weaponId])==='shotgun';el.classList.toggle('pattern',pattern);
    const wide=pattern&&reticleRadius(radius)>120,R=pattern?Math.min(120,reticleRadius(radius)):reticleRadius(radius);
    const band=pattern?shotgunBand(w,dist):'';el.classList.toggle('falloff',band==='falloff');el.classList.toggle('out',band==='out');
    if(pattern){
        const dots=el.querySelector('.pellets'),n=WEAPONS[g.mode.weaponId].pellets||8,key=`${n}:${R.toFixed(0)}`;
        if(dots&&dots.dataset.key!==key){dots.dataset.key=key;dots.innerHTML=pelletPattern(n,R*0.82).map(([x,y])=>`<i style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px"></i>`).join('');}
        const b=el.querySelector('.band');if(b){b.className=`band ${band}`;b.textContent=`${band==='effective'?'EFFECTIVE':band==='falloff'?'FALLOFF':'OUT OF RANGE'}${wide?' · WIDE':''}`;}
    }
    el.style.left=`${x}px`;el.style.top=`${y}px`;g.cutins?.placeAim?.(point);el.style.setProperty('--aim-radius',`${R}px`);el.style.setProperty('--aim-inner',`${(R*Math.SQRT1_2).toFixed(1)}px`);
    const zoom=camera.isPerspectiveCamera?Math.tan(19*Math.PI/180)/Math.tan(camera.fov*Math.PI/360):1;
    // PLAN-14: the reticle is the targeting. On an enemy it names the body part under it and the odds for that part
    // (and for any hit); otherwise the distance and spread.
    const pick=g.aimPick&&g.battle.unit(g.aimPick.unitId),odds=pick&&g.isVisible?.(pick)?g.partChance?.(pick,g.aimPick.part):null;
    el.classList.toggle('on-target',!!odds);
    const status=`${g.aim?.settled===false?' · STEADYING':''}${g.aimStance?.blocked?' · BLOCKED':g.aimStance?.muzzle?.step?' · STEP OUT':''}`;
    let pelletText='';
    if(pattern){
        const t=pick&&g.isVisible?.(pick)?pick:g.aimTargetNear?.(p),key=`${u.id}:${t?.id}:${t?.x},${t?.y}:${p.x.toFixed(1)},${p.y.toFixed(1)},${p.h.toFixed(1)}:${g.battle.seq}:${g.peek?.x},${g.peek?.y}`;
        if(t&&g.pelletCache?.key!==key&&(!g.pelletCache||g.pelletCache.tid!==t.id||performance.now()-g.pelletCache.at>120)){g.pelletCache={key,tid:t.id,at:performance.now(),value:pelletEstimate(g.battle,shooter,w,t,p,spread)};}
        const pe=t&&g.pelletCache?.tid===t.id?g.pelletCache.value:null;
        pelletText=pe?`${t.name.toUpperCase()} · ~${pe.pellets.toFixed(1)}/${pe.n} PELLETS · ~${pe.damage} DMG`:'';
    }
    el.querySelector('span.read').textContent=pelletText?`${pelletText}${status}`:odds?`${pick.name.toUpperCase()} · ${PART_NAMES[g.aimPick.part]||g.aimPick.part} ${odds.part}% · ANY HIT ${odds.any}%${status}`
        :`${w.name} · ${dist.toFixed(1)} M · ±${(cone).toFixed(2)} M · ${zoom.toFixed(1)}×${status}`;
}
