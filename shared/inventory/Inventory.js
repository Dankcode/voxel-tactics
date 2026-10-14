import { THROWABLES } from '../content/weapons.js';
import { CARGO_ITEMS } from '../content/gear.js';
export const PACK={width:6,height:5};
const sizes={fire_flask:[1,2],frost_flask:[1,3],water_flask:[1,1],gale_flask:[3,1],powder_bomb:[2,2],smoke_pot:[2,1],breach_charge:[3,2],medkit:[2,3]};
export const INVENTORY_ITEMS=Object.freeze({...Object.fromEntries(Object.entries(THROWABLES).map(([id,item])=>[id,{...item,width:sizes[id][0],height:sizes[id][1],weight:id==='medkit'?0.6:0.4,short:({fire_flask:'INC',frost_flask:'CRYO',water_flask:'HYDRO',gale_flask:'FLASH',powder_bomb:'FRAG',smoke_pot:'SMOKE',breach_charge:'CHARGE',medkit:'MED'})[id],category:item.kind==='gadget'||item.placed?'Gadget':'Grenade'}])),...CARGO_ITEMS});
export function footprint(slot){const item=INVENTORY_ITEMS[slot.itemId];return slot.rotated?{w:item.height,h:item.width}:{w:item.width,h:item.height};}
export function validateInventory(slots,capacity=PACK,depth=0,ids=new Set()){
    if(!Array.isArray(slots)||slots.length>96||depth>3)return 'Invalid inventory';
    const occupied=new Set();
    for(const s of slots){
        if(!s||!Object.hasOwn(INVENTORY_ITEMS,s.itemId)||typeof s.id!=='string'||!/^[-\w]{1,64}$/.test(s.id)||ids.has(s.id)||!Number.isInteger(s.x)||!Number.isInteger(s.y)||typeof s.rotated!=='boolean')return 'Invalid item';
        const item=INVENTORY_ITEMS[s.itemId];
        if(s.quantity!==undefined&&(!Number.isInteger(s.quantity)||s.quantity<1||s.quantity>(item.maxStack||1)))return 'Invalid quantity';
        ids.add(s.id);const {w,h}=footprint(s);
        if(s.x<0||s.y<0||s.x+w>capacity.width||s.y+h>capacity.height)return 'Item outside pack';
        for(let y=s.y;y<s.y+h;y++)for(let x=s.x;x<s.x+w;x++){const key=`${x},${y}`;if(occupied.has(key))return 'Items overlap';occupied.add(key);}
        if(s.contents!==undefined){if(!item.storage)return 'Item has no storage';const why=validateInventory(s.contents,item.storage,depth+1,ids);if(why)return why;}
    }
    return null;
}
export function normalizeInventory(slots){const why=validateInventory(slots);if(why)throw Error(why);return structuredClone(slots).map(function clean(s){return {id:s.id,itemId:s.itemId,x:s.x,y:s.y,rotated:s.rotated,...(s.quantity!==undefined?{quantity:s.quantity}:{}),...(s.contents?{contents:s.contents.map(clean)}:{})};});}
export function* walkInventory(slots=[]){for(const s of slots){yield s;if(s.contents)yield*walkInventory(s.contents);}}
export function inventoryCounts(slots){const counts={};for(const s of walkInventory(slots))counts[s.itemId]=(counts[s.itemId]||0)+(s.quantity||1);return counts;}
export function findSpace(slots,item,capacity=PACK){for(const rotated of [false,true])for(let y=0;y<capacity.height;y++)for(let x=0;x<capacity.width;x++){const slot={...item,x,y,rotated};if(!validateInventory([...slots,slot],capacity))return slot;}return null;}
export function packItems(items){
    const slots=[];
    for(const [itemId,n] of Object.entries(items))for(let i=0;i<n;i++){
        const s=findSpace(slots,{id:`${itemId}-${i}`,itemId,x:0,y:0,rotated:false});
        if(!s)throw Error('Default pack exceeds capacity');slots.push(s);
    }return slots;
}
export function takeFrom(slots,itemId,amount=1){let left=amount;for(let i=slots.length-1;i>=0&&left;i--){const s=slots[i];if(s.itemId===itemId){const n=Math.min(left,s.quantity||1);left-=n;if((s.quantity||1)===n)slots.splice(i,1);else s.quantity-=n;}else if(s.contents)left-=takeFrom(s.contents,itemId,left);}return amount-left;}
