import { THROWABLES } from '../content/weapons.js';
export const PACK={width:6,height:5};
const sizes={fire_flask:[1,2],frost_flask:[1,3],water_flask:[1,1],gale_flask:[3,1],powder_bomb:[2,2],smoke_pot:[2,1],breach_charge:[3,2],medkit:[2,3]};
export const INVENTORY_ITEMS=Object.freeze(Object.fromEntries(Object.entries(THROWABLES).map(([id,item])=>[id,{...item,width:sizes[id][0],height:sizes[id][1],category:item.kind==='gadget'||item.placed?'Gadget':'Grenade'}])));
export function footprint(slot){const item=INVENTORY_ITEMS[slot.itemId];return slot.rotated?{w:item.height,h:item.width}:{w:item.width,h:item.height};}
export function validateInventory(slots){
    if(!Array.isArray(slots)||slots.length>30)return 'Invalid inventory';
    const occupied=new Set(),ids=new Set();
    for(const s of slots){
        if(!s||!Object.hasOwn(INVENTORY_ITEMS,s.itemId)||typeof s.id!=='string'||!/^[-\w]{1,64}$/.test(s.id)||ids.has(s.id)||!Number.isInteger(s.x)||!Number.isInteger(s.y)||typeof s.rotated!=='boolean')return 'Invalid item';
        ids.add(s.id);const {w,h}=footprint(s);
        if(s.x<0||s.y<0||s.x+w>PACK.width||s.y+h>PACK.height)return 'Item outside pack';
        for(let y=s.y;y<s.y+h;y++)for(let x=s.x;x<s.x+w;x++){const key=`${x},${y}`;if(occupied.has(key))return 'Items overlap';occupied.add(key);}
    }
    return null;
}
export function normalizeInventory(slots){const why=validateInventory(slots);if(why)throw Error(why);return slots.map(s=>({id:s.id,itemId:s.itemId,x:s.x,y:s.y,rotated:s.rotated}));}
export function inventoryCounts(slots){const counts={};for(const s of slots)counts[s.itemId]=(counts[s.itemId]||0)+1;return counts;}
export function packItems(items){
    const slots=[];
    for(const [itemId,n] of Object.entries(items))for(let i=0;i<n;i++){
        let placed=false;
        for(const rotated of [false,true]){for(let y=0;y<PACK.height&&!placed;y++)for(let x=0;x<PACK.width&&!placed;x++){
            const s={id:`${itemId}-${i}`,itemId,x,y,rotated};if(!validateInventory([...slots,s])){slots.push(s);placed=true;}
        }if(placed)break;}
        if(!placed)throw Error('Default pack exceeds capacity');
    }
    return slots;
}
export function consumeItem(unit,itemId){unit.items[itemId]--;const i=unit.inventory?.findIndex(s=>s.itemId===itemId);if(i>=0)unit.inventory.splice(i,1);}
