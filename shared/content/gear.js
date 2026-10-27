// Physical equipment and loose rounds. Storage dimensions are gameplay constraints, not UI decorations.
import { WEAPONS, ARMOR } from './weapons.js';
export const AMMO = Object.freeze({
    ar: { id:'ammo_ar', name:'AR rounds', short:'AR', width:1, height:1, weight:0.012, maxStack:120, category:'Ammo' },
    high: { id:'ammo_high', name:'High caliber rounds', short:'HC', width:1, height:1, weight:0.028, maxStack:60, category:'Ammo' },
    shotgun: { id:'ammo_shotgun', name:'Shotgun shells', short:'12G', width:1, height:2, weight:0.045, maxStack:40, category:'Ammo' }
});
// PLAN-14: `move` is tiles per AP the worn piece adds (light kit) or takes off (heavy kit), on top of armour mobility.
const item=(id,name,slot,w,h,weight,extra={})=>({id,name,short:name,width:w,height:h,weight,slot,category:'Gear',...extra});
export const GEAR = Object.freeze(Object.fromEntries([
    item('helmet_patrol','Patrol helmet','helmet',2,2,1.2,{protection:{head:1}}),
    item('helmet_heavy','Ballistic helmet','helmet',2,2,2.3,{protection:{head:2},move:-0.1}),
    item('armor_light','Recon armor','armor',3,3,3.5,{protection:ARMOR.light,move:0.3}),
    item('armor_medium','Plate carrier','armor',3,3,7.2,{protection:ARMOR.medium}),
    item('armor_heavy','Assault armor','armor',3,4,11.5,{protection:ARMOR.heavy}),
    item('armor_plate','Ballistic shield armor','armor',3,4,14.5,{protection:ARMOR.plate}),
    item('armor_hide','Field vest','armor',3,2,2.2,{protection:ARMOR.hide}),
    item('rig_scout','Scout rig','rig',2,2,0.6,{storage:{width:3,height:2},move:0.4}),
    item('rig_patrol','Patrol rig','rig',2,2,1.1,{storage:{width:4,height:3}}),
    item('rig_assault','Assault rig','rig',3,2,1.8,{storage:{width:5,height:3},move:-0.3}),
    item('pack_day','Daypack','backpack',2,3,1.2,{storage:{width:6,height:5}}),
    item('pack_recon','Recon backpack','backpack',2,3,0.7,{storage:{width:5,height:4},move:0.3}),
    item('pack_raid','Raid backpack','backpack',3,3,2.4,{storage:{width:7,height:7},move:-0.4}),
    item('pouch_utility','Utility pouch','pouch',1,2,0.2,{storage:{width:2,height:2}}),
    item('optic_scope','Magnified optic','attachment',1,1,0.45,{mod:'scope'}),
    item('barrel_precision','Precision barrel','attachment',3,1,0.8,{mod:'barrel'})
].map(g=>[g.id,g])));
export const WEAPON_ITEMS = Object.freeze(Object.fromEntries(Object.values(WEAPONS).map(w=>[`weapon_${w.id}`,{
    id:`weapon_${w.id}`,name:w.name,short:w.name,width:w.kind==='melee'?1:w.id==='handcannon'?2:4,height:w.kind==='melee'?3:2,
    weight:w.weight||3,category:'Weapon',weaponId:w.id
}])));
export const CARGO_ITEMS = Object.freeze({...Object.fromEntries(Object.values(AMMO).map(a=>[a.id,a])),...GEAR,...WEAPON_ITEMS});
