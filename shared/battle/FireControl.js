export const FIRE_MODES=Object.freeze({single:1,burst:3,auto:5});
export function fireModes(w){return w.fireModes||['single'];}
export function fireMode(u,w,requested){return fireModes(w).includes(requested)?requested:fireModes(w).includes(u.fireModes?.[w.id])?u.fireModes[w.id]:w.defaultMode||'single';}
export function roundsFor(u,w,requested){return Math.min(u.ammo[w.id]||0,FIRE_MODES[fireMode(u,w,requested)]);}
export function weaponBuild(u,w){
    const mods=u.attachments?.[w.id]||{},scope=w.scoped||mods.scope;
    return {...w,spread:w.spread*(scope?0.6:1)*(mods.barrel?0.8:1),range:w.range*(mods.barrel?1.25:1),maxRange:w.maxRange*(mods.barrel?1.2:1),scoped:!!scope};
}
export function projectileDamage(w,distance,index=0){
    const close=distance<=(w.critRange??5),total=close?(w.shellDamage??w.damage):(w.farDamage??w.damage),pellets=w.pellets||1;
    return Math.floor((index%pellets+1)*total/pellets)-Math.floor((index%pellets)*total/pellets);
}
