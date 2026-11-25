import { CALIBERS } from '../content/calibers.js';
import { B } from '../content/balance.js';

export const FIRE_MODES=Object.freeze({single:1,burst:3,auto:5});
export const FIRE_MODE_SPREAD=Object.freeze({single:0.72,burst:1.15,auto:1.65});
export function fireModes(w){return w.fireModes||['single'];}
export function fireMode(u,w,requested){return fireModes(w).includes(requested)?requested:fireModes(w).includes(u.fireModes?.[w.id])?u.fireModes[w.id]:w.defaultMode||'single';}
export function roundsFor(u,w,requested){return Math.min(u.ammo[w.id]||0,FIRE_MODES[fireMode(u,w,requested)]);}
const BUILT_WEAPONS=new WeakSet();
export function weaponBuild(u,w){
    if(!w||BUILT_WEAPONS.has(w))return w;
    const mods=u?.attachments?.[w.id]||{},scope=w.scoped||mods.scope;
    const scopeMult=!w.scoped&&mods.scope?0.6:1;
    const barrelRecoil=mods.barrel?0.85:1;
    const recoil=w.recoil?{climb:(w.recoil.climb||0)*barrelRecoil,drift:(w.recoil.drift||0)*barrelRecoil,bloom:(w.recoil.bloom||0)*barrelRecoil,heat:w.recoil.heat??0.5}:undefined;
    const built={...w,spread:w.spread*scopeMult*(mods.barrel?0.8:1),range:w.range*(mods.barrel?1.25:1),maxRange:w.maxRange*(mods.barrel?1.2:1),velocity:(w.velocity||0)*(mods.barrel?1.1:1),...(mods.barrel?{minRangeMult:Math.min(0.95,(w.minRangeMult??((w.pellets||1)>1?0.45:0.65))+0.1)}:{}),...(recoil?{recoil}:{}),scoped:!!scope};
    BUILT_WEAPONS.add(built);
    return built;
}
/** Smooth range damage curve: 100% of bullet damage (balanced by gun multiplier) up to `range`, tapering to `minRangeMult` at `maxRange`. */
export function projectileDamage(w,distance,index=0){
    const pellets=w.pellets||1;
    const bulletBase=w.shellDamage??((w.damage??0)*pellets);
    const gunMult=w.damageMult??1;
    const range=w.range||18, maxRange=Math.max(range+1,w.maxRange||range*1.8);
    const minMult=w.minRangeMult??(pellets>1?0.45:0.65);
    const over=distance<=range?0:Math.min(1,(distance-range)/(maxRange-range));
    const total=Math.max(pellets,Math.round(bulletBase*gunMult*(1-(1-minMult)*over)));
    return Math.floor((index%pellets+1)*total/pellets)-Math.floor((index%pellets)*total/pellets);
}
/** Caliber-driven bullet damage and weapon-balanced salvo summary at `distance`. */
export function bulletDamageSummary(w,distance,{rounds=1,suppress=false,armor=0,headMult=1,flankMult=1}={}){
    const pellets=w.pellets||1;
    const dmgK=suppress?0.5:1;
    const effArmor=Math.max(0,armor-(w.pierce||0));
    const minShare=B.armorMinDamage||0;
    let perRound=0, netPerRound=0;
    for(let i=0;i<pellets;i++){
        const base=projectileDamage(w,distance,i)*dmgK;
        perRound+=base;
        const raw=Math.round(base*headMult*flankMult);
        if(raw>0) netPerRound+=Math.max(0,raw-effArmor,Math.ceil(raw*minShare));
    }
    perRound=Math.round(perRound);
    return {
        caliberId:w.caliber||null,
        caliberName:w.caliber?CALIBERS[w.caliber]?.name||w.caliber:null,
        perRound,
        ...(pellets>1?{perPellet:+(perRound/pellets).toFixed(2)}:{}),
        netPerRound,
        salvoMax:perRound*rounds,
        netSalvoMax:netPerRound*rounds,
        rounds,
        pellets,
        pierce:w.pierce||0,
        gunMult:w.damageMult??1
    };
}
