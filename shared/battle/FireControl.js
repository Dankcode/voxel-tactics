export const FIRE_MODES=Object.freeze({single:1,burst:3,auto:5});
export const FIRE_MODE_SPREAD=Object.freeze({single:0.72,burst:1.15,auto:1.65});
export function fireModes(w){return w.fireModes||['single'];}
export function fireMode(u,w,requested){return fireModes(w).includes(requested)?requested:fireModes(w).includes(u.fireModes?.[w.id])?u.fireModes[w.id]:w.defaultMode||'single';}
export function roundsFor(u,w,requested){return Math.min(u.ammo[w.id]||0,FIRE_MODES[fireMode(u,w,requested)]);}
export function weaponBuild(u,w){
    const mods=u.attachments?.[w.id]||{},scope=w.scoped||mods.scope;
    const scopeMult=!w.scoped&&mods.scope?0.6:1;
    const barrelRecoil=mods.barrel?0.85:1;
    const recoil=w.recoil?{climb:(w.recoil.climb||0)*barrelRecoil,drift:(w.recoil.drift||0)*barrelRecoil,bloom:(w.recoil.bloom||0)*barrelRecoil,heat:w.recoil.heat??0.5}:undefined;
    return {...w,spread:w.spread*scopeMult*(mods.barrel?0.8:1),range:w.range*(mods.barrel?1.25:1),maxRange:w.maxRange*(mods.barrel?1.2:1),velocity:(w.velocity||0)*(mods.barrel?1.1:1),...(recoil?{recoil}:{}),scoped:!!scope};
}
/** Smooth range damage curve: 100% up to effective `range`, tapering smoothly to `minRangeMult` at `maxRange`. */
export function projectileDamage(w,distance,index=0){
    const base=w.shellDamage??w.damage??0, pellets=w.pellets||1;
    const range=w.range||18, maxRange=Math.max(range+1,w.maxRange||range*1.8);
    const minMult=w.minRangeMult??(pellets>1?0.45:0.65);
    const over=distance<=range?0:Math.min(1,(distance-range)/(maxRange-range));
    const total=Math.max(pellets,Math.round(base*(1-(1-minMult)*over)));
    return Math.floor((index%pellets+1)*total/pellets)-Math.floor((index%pellets)*total/pellets);
}
