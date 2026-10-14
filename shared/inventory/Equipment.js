import { GEAR, AMMO } from '../content/gear.js';
import { WEAPONS } from '../content/weapons.js';
import { INVENTORY_ITEMS, validateInventory, walkInventory, inventoryCounts, findSpace, takeFrom } from './Inventory.js';
export const STORAGE_ROOTS=['backpack','rig','pockets'];
const fields={backpack:'inventory',rig:'rigInventory',pockets:'pocketInventory'};
export function storageOf(u,path,create=false){
    if(typeof path!=='string')return null;
    const [root,...ids]=path.split('/');if(!STORAGE_ROOTS.includes(root)||ids.length>3)return null;
    let slots=u[fields[root]],capacity=root==='pockets'?{width:2,height:2}:GEAR[u.equipment?.[root]]?.storage;
    if(!slots||!capacity)return null;
    for(const id of ids){const s=slots.find(s=>s.id===id);capacity=s&&INVENTORY_ITEMS[s.itemId]?.storage;if(!capacity)return null;if(!s.contents&&create)s.contents=[];slots=s.contents||[];}
    return {slots,capacity};
}
export function allCargo(u){return STORAGE_ROOTS.flatMap(root=>[...walkInventory(u[fields[root]]||[])]);}
/** Physical storage is authoritative; the HUD count is only a derived summary. */
export function itemCount(u,itemId,cargo=null){
    if(cargo){const s=storageOf(u,cargo.path)?.slots.find(s=>s.id===cargo.id&&s.itemId===itemId);return s?(s.quantity||1):0;}
    return allCargo(u).filter(s=>s.itemId===itemId).reduce((n,s)=>n+(s.quantity||1),0);
}
export function consumeItem(u,itemId,cargo=null){
    let taken=0;
    if(cargo){const slots=storageOf(u,cargo.path)?.slots,s=slots?.find(s=>s.id===cargo.id&&s.itemId===itemId);if(s){if((s.quantity||1)>1)s.quantity--;else slots.splice(slots.indexOf(s),1);taken=1;}}
    else for(const root of STORAGE_ROOTS){taken=takeFrom(u[fields[root]]||[],itemId,1);if(taken)break;}
    syncItems(u);return taken;
}
export function reserveAmmo(u,weapon){const id=AMMO[weapon.ammoType]?.id;return id?allCargo(u).filter(s=>s.itemId===id).reduce((n,s)=>n+(s.quantity||1),0):0;}
export function consumeAmmo(u,weapon,n){const id=AMMO[weapon.ammoType]?.id;if(!id)return 0;let left=n;for(const root of STORAGE_ROOTS)left-=takeFrom(u[fields[root]]||[],id,left);return n-left;}
export function carryWeight(u){
    const worn=Object.values(u.equipment||{}).reduce((n,id)=>n+(GEAR[id]?.weight||0),0);
    const weapons=u.weapons.reduce((n,id)=>n+(WEAPONS[id]?.weight||0),0);
    const cargo=allCargo(u).reduce((n,s)=>n+(INVENTORY_ITEMS[s.itemId]?.weight||0)*(s.quantity||1),0);
    const loaded=Object.entries(u.ammo).reduce((n,[id,q])=>n+(AMMO[WEAPONS[id]?.ammoType]?.weight||0)*q,0);
    const attachments=Object.values(u.attachments||{}).reduce((n,parts)=>n+(parts.scope?0.45:0)+(parts.barrel?0.8:0),0);
    return Math.round((worn+weapons+cargo+loaded+attachments)*100)/100;
}
export function loadPenalty(u){return Math.min(.65,Math.max(0,carryWeight(u)-12)/45);}
export function initializeEquipment(u,def){
    u.equipment={helmet:'helmet_patrol',armor:GEAR[`armor_${def.armor}`]?`armor_${def.armor}`:'armor_light',rig:'rig_patrol',backpack:'pack_day'};
    u.parts.head.armor=GEAR[u.equipment.helmet].protection.head;
    u.rigInventory=[];u.pocketInventory=[];u.attachments={};u.fireModes={};
    for(const id of u.weapons){const w=WEAPONS[id];if(w.ammoType){const a=AMMO[w.ammoType];if(!u.rigInventory.some(s=>s.itemId===a.id)){const s=findSpace(u.rigInventory,{id:`reserve-${w.ammoType}`,itemId:a.id,quantity:w.ammoType==='ar'?90:w.ammoType==='high'?18:24},GEAR.rig_patrol.storage);if(s)u.rigInventory.push(s);}}}
}
export function validateLoadout(u){const ids=new Set();for(const root of STORAGE_ROOTS){const c=storageOf(u,root);if(!c)return 'Invalid equipment';const why=validateInventory(c.slots,c.capacity,0,ids);if(why)return why;}return null;}
export function inventoryMove(u,intent,apply=false){
    const copy=structuredClone(u),from=storageOf(copy,intent.from,true),to=storageOf(copy,intent.to,true);
    if(!from||!to||typeof intent.itemId!=='string'||intent.to.startsWith(`${intent.from}/${intent.itemId}`))return 'Invalid container';
    const i=from.slots.findIndex(s=>s.id===intent.itemId);if(i<0)return 'Missing item';
    const [slot]=from.slots.splice(i,1);Object.assign(slot,{x:intent.x,y:intent.y,rotated:intent.rotated});to.slots.push(slot);
    const why=validateLoadout(copy);if(why)return why;
    if(apply){for(const f of Object.values(fields))u[f]=copy[f];syncItems(u);}return null;
}
export function syncItems(u){const counts=inventoryCounts(STORAGE_ROOTS.flatMap(root=>u[fields[root]]||[]));u.items=Object.fromEntries(Object.entries(counts).filter(([id])=>INVENTORY_ITEMS[id]?.category==='Grenade'||INVENTORY_ITEMS[id]?.category==='Gadget'));}
export function equipCargo(u,intent,apply=false){
    const c=structuredClone(u),src=storageOf(c,intent.from,true),i=src?.slots.findIndex(s=>s.id===intent.itemId)??-1;if(i<0)return 'Missing item';
    const item=src.slots[i],def=INVENTORY_ITEMS[item.itemId];
    if(def.category==='Weapon'){if(c.weapons.includes(def.weaponId))return 'Already equipped';src.slots.splice(i,1);c.weapons.push(def.weaponId);c.ammo[def.weaponId]=0;c.weapon=def.weaponId;}
    else if(def.slot==='attachment'){
        const w=WEAPONS[c.weapon];if(w?.kind!=='ballistic'||!w.ammoType)return 'No compatible gun';
        const mods=c.attachments[c.weapon]||={};if(mods[def.mod])return 'Already equipped';mods[def.mod]=true;src.slots.splice(i,1);
    }else if(['helmet','armor','rig','backpack'].includes(def.slot)){
        if(intent.from.startsWith(`${def.slot}/`))return 'Cannot wear a container from inside itself';
        const old=c.equipment[def.slot],cargo=fields[def.slot]&&c[fields[def.slot]];
        src.slots.splice(i,1);c.equipment[def.slot]=def.id;
        if(cargo)c[fields[def.slot]]=item.contents||[];
        const oldItem={id:item.id,itemId:old,contents:cargo||undefined};
        const target=storageOf(c,intent.from),placement=target&&findSpace(target.slots,oldItem,target.capacity);
        if(!placement)return 'No space for removed equipment';target.slots.push(placement);
        if(def.slot==='armor'||def.slot==='helmet')for(const [p,v] of Object.entries(def.protection||{}))if(c.parts[p]&&(def.slot==='helmet'||p!=='head'))c.parts[p].armor=v;
    }else return 'Item cannot be equipped';
    const why=validateLoadout(c);if(why)return why;
    if(apply){for(const k of [...Object.values(fields),'equipment','weapons','ammo','weapon','parts','attachments'])u[k]=c[k];syncItems(u);}return null;
}
export function grantTestArsenal(u){
    u.equipment.backpack='pack_raid';u.equipment.rig='rig_assault';
    u.weapons=Object.keys(WEAPONS);for(const w of Object.values(WEAPONS))if(w.ammo)u.ammo[w.id]=w.ammo;
    const add=(root,item)=>{const c=storageOf(u,root),s=findSpace(c.slots,item,c.capacity);if(s)c.slots.push(s);};
    u.inventory=[];u.rigInventory=[];u.pocketInventory=[];
    for(const a of Object.values(AMMO))add('rig',{id:`test-${a.id}`,itemId:a.id,quantity:a.maxStack});
    for(const [id,item] of Object.entries(INVENTORY_ITEMS))if(['Grenade','Gadget'].includes(item.category))add('backpack',{id:`test-${id}`,itemId:id});
    add('backpack',{id:'spare-rig',itemId:'rig_scout',contents:[{id:'spare-ammo',itemId:'ammo_ar',quantity:60,x:0,y:0,rotated:false}]});
    for(const id of ['pouch_utility','optic_scope','barrel_precision','helmet_heavy'])add('backpack',{id:`test-${id}`,itemId:id,...(GEAR[id].storage?{contents:[]}: {})});
    syncItems(u);
}
