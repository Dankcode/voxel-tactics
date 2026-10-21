import { GEAR } from '../../../shared/content/gear.js';
import { WEAPONS, THROWABLES } from '../../../shared/content/weapons.js';
import { CLASSES } from '../../../shared/content/units.js';
import { STATUS_DEFS } from '../../../shared/elements/Elements.js';
import { carryWeight, loadPenalty, storageOf, reserveAmmo, inventoryMove } from '../../../shared/inventory/Equipment.js';
import { INVENTORY_ITEMS, footprint } from '../../../shared/inventory/Inventory.js';
import { InventoryDrag } from './InventoryDrag.js';
import { ICONS, weaponIcon } from './Icons.js';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const names={head:'Head',torso:'Torso',armL:'Left arm',armR:'Right arm',legs:'Legs'};
const shapes={head:'M45 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0',torso:'M39 31L49 27L61 27L71 31L69 79L41 79Z',armL:'M39 32L30 35L15 89L23 94L42 52Z',armR:'M71 32L80 35L95 89L87 94L68 52Z',legs:'M41 82L69 82L73 153L64 167L57 164L55 113L53 164L46 167L37 153Z'};
export function bodyStatus(u,part){
    const nodes=Object.entries(shapes).map(([key,d])=>{const p=u.parts[key],ratio=p.hp/p.max;return `<g data-eq="part" data-value="${key}" tabindex="0" role="button" aria-label="${names[key]} ${p.hp} of ${p.max}"><path d="${d}" class="${p.disabled?'disabled':ratio<.7?'injured':''} ${part===key?'selected':''}"/><title>${names[key]} · ${p.hp}/${p.max} · armor ${p.armor}</title></g>`;}).join('');
    return `<svg class="body-model" viewBox="0 0 110 178" role="img" aria-label="Body part status, arms lowered">${nodes}<path class="body-detail" d="M55 31V76M42 45H68M42 60H68M41 80H69M55 86V109M42 120H52M58 120H70"/></svg>`;
}
export class EquipmentPanel{
    constructor(root,game){this.root=root;this.game=game;this.open=false;this.nested=null;this.part='torso';this.selected=null;
        root.addEventListener('click',e=>this.click(e));
        root.addEventListener('dblclick',e=>{const el=e.target.closest('[data-cargo]');if(!el)return;e.preventDefault();this.openCargo(el.dataset.path,el.dataset.cargo);});
        this.drag=new InventoryDrag(root,{
            begin:(el,e)=>{this.select(el);const rect=el.getBoundingClientRect(),slot=this.selectedSlot(),f=footprint(slot);return {offset:{x:Math.min(f.w-1,Math.floor((e.clientX-rect.left)/rect.width*f.w)),y:Math.min(f.h-1,Math.floor((e.clientY-rect.top)/rect.height*f.h))}};},
            target:(grid,x,y)=>{const slot=this.selectedSlot();if(!slot)return null;const f=footprint({...slot,rotated:this.selected.rotated}),intent=this.moveIntent(grid.dataset.path,x,y);return {...f,path:grid.dataset.path,valid:!inventoryMove(this.game.selectedUnit(),intent)};},
            drop:d=>this.placeAt(d.path,d.x,d.y)
        });
    }
    toggle(){this.drag.cancel();this.open=!this.open;this.selected=null;this.nested=null;if(this.open){this.game.hud.hidePanel();this.game.hud.el('.options').classList.add('hidden');this.game.setMode({kind:'move'});}this.game.hud.refresh();}
    select(el){if(this.selected?.id===el.dataset.cargo&&this.selected.path===el.dataset.path)return;this.selected={id:el.dataset.cargo,path:el.dataset.path,rotated:el.dataset.rotated==='true'};}
    selectedSlot(){return this.selected&&storageOf(this.game.selectedUnit(),this.selected.path)?.slots.find(s=>s.id===this.selected.id);}
    moveIntent(to,x,y){return {type:'inventoryMove',itemId:this.selected.id,from:this.selected.path,to,x,y,rotated:this.selected.rotated};}
    rotate(){if(!this.selected)return;this.selected.rotated=!this.selected.rotated;const slot=this.selectedSlot();if(this.drag.pending&&slot){const f=footprint({...slot,rotated:this.selected.rotated});this.drag.rotateOffset(f.w,f.h);}else this.render();}
    async placeAt(path,x,y){if(!this.selected)return;const r=await this.game.intent(this.moveIntent(path,x,y));if(r.ok)this.selected=null;this.render();}
    place(el){return this.placeAt(el.dataset.path,Number(el.dataset.x),Number(el.dataset.y));}
    openCargo(path,id){const u=this.game.selectedUnit(),c=storageOf(u,path),s=c?.slots.find(s=>s.id===id);if(!s)return;const item=INVENTORY_ITEMS[s.itemId];if(item.storage){this.nested={path:`${path}/${id}`,id:s.id,name:item.name};this.render();}else if(THROWABLES[s.itemId]){this.game.setMode({kind:THROWABLES[s.itemId].kind==='gadget'?'gadget':THROWABLES[s.itemId].placed?'breach':'throw',itemId:s.itemId,cargo:{path,id}});this.open=false;this.game.hud.refresh();if(THROWABLES[s.itemId].placed)this.game.hud.showBreachPanel();}}
    async click(e){
        e.stopPropagation();const a=e.target.closest('[data-eq]'),cargo=e.target.closest('[data-cargo]'),cell=e.target.closest('[data-grid]');
        if(cargo){this.select(cargo);this.root.querySelectorAll('.cargo-item.selected').forEach(el=>el.classList.remove('selected'));cargo.classList.add('selected');this.root.querySelectorAll('.cargo-tools button').forEach(el=>el.disabled=false);const msg=this.root.querySelector('.cargo-tools>span');if(msg)msg.textContent='Item selected · drag or choose a cell · R to rotate';return;}if(cell){await this.place(cell);return;}if(!a)return;
        const u=this.game.selectedUnit();switch(a.dataset.eq){
            case 'close':this.toggle();return;case 'nestedClose':this.nested=null;break;case 'part':this.part=a.dataset.value;break;
            case 'rotate':this.rotate();return;
            case 'open':if(this.selected)this.openCargo(this.selected.path,this.selected.id);return;
            case 'equip':if(this.selected){const r=await this.game.intent({type:'equipCargo',from:this.selected.path,itemId:this.selected.id});if(r.ok)this.selected=null;}break;
            case 'weapon':await this.game.intent({type:'switchWeapon',weaponId:a.dataset.value});break;
        }this.render(u);
    }
    grid(u,path,label){const c=storageOf(u,path);if(!c)return '';const {width:w,height:h}=c.capacity;
        return `<section class="cargo-section"><header><h3>${esc(label)}</h3><span>${c.slots.length} ITEMS · ${w} × ${h}</span></header><div class="cargo-grid" data-storage-grid="1" data-path="${esc(path)}" style="--cols:${w};--rows:${h}">${Array.from({length:w*h},(_,i)=>`<button class="cargo-cell" data-grid="1" data-path="${esc(path)}" data-x="${i%w}" data-y="${Math.floor(i/w)}" style="grid-column:${i%w+1};grid-row:${Math.floor(i/w)+1}" aria-label="${esc(label)} column ${i%w+1} row ${Math.floor(i/w)+1}"></button>`).join('')}${c.slots.map(s=>{const it=INVENTORY_ITEMS[s.itemId],f=footprint(s);return `<button draggable="false" class="cargo-item ${it.category.toLowerCase()} ${this.selected?.id===s.id?'selected':''}" data-cargo="${s.id}" data-path="${esc(path)}" data-rotated="${s.rotated}" style="grid-column:${s.x+1}/span ${f.w};grid-row:${s.y+1}/span ${f.h}" aria-label="${esc(it.name)}${s.quantity?` ${s.quantity} rounds`:''}" title="${esc(it.name)} · ${(it.weight*(s.quantity||1)).toFixed(2)} kg${it.storage?' · Double-click to open':''}"><span class="cargo-symbol">${it.category==='Ammo'?'▥':it.storage?'▤':it.category==='Grenade'?ICONS.grenade:it.category==='Weapon'?ICONS.rifle:ICONS.gear}</span><b>${esc(it.short||it.name)}</b><small>${s.quantity|| (it.storage?`${it.storage.width}×${it.storage.height}`:it.ap?`${it.ap} AP`:'')}</small></button>`;}).join('')}</div></section>`;
    }
    render(u=this.game.selectedUnit()){
        this.root.classList.toggle('hidden',!this.open||!u);this.game.hud.root.classList.toggle('inventory-open',this.open);if(!this.open||!u)return;
        if(this.unitId!==u.id){this.unitId=u.id;this.selected=null;this.nested=null;}
        if(this.drag.active)return;
        if(this.selected&&!this.selectedSlot())this.selected=null;
        const p=u.parts[this.part],weight=carryWeight(u),bpm=Math.round(68+u.stress*.55+(1-u.hp/u.maxHp)*30+Math.min(15,(u.movedThisTurn||0)*2));
        const effects=[...u.statuses.map(s=>({name:STATUS_DEFS[s.id]?.name||s.id,text:`${s.rounds} turns`,bad:!['wet','braced'].includes(s.id)})),...Object.entries(u.buffs).filter(([,v])=>v).map(([name])=>({name,text:'Active',bad:false}))];
        const scroll=this.root.querySelector('.equipment-workspace')?.scrollTop||0;
        this.root.innerHTML=`<aside class="body-status" aria-label="Soldier body status"><header><span>PERSONNEL / ${String(u.id).toUpperCase()}</span><h2>${esc(u.name)}</h2><p>${esc(CLASSES[u.type]?.name||u.type)}</p></header><div class="vital-stats"><span>HEALTH <b>${u.hp} / ${u.maxHp}</b></span><span>ACTION POINTS <b>${u.ap} / ${u.maxAp}</b></span><span>CARRIED <b>${weight.toFixed(1)} KG</b></span><span>MOBILITY <b>${this.game.battle.mobility(u).toFixed(1)} TILES / AP</b></span></div><div class="body-map">${bodyStatus(u,this.part)}<div class="limb-readout"><b>${names[this.part]}</b><strong>${p.hp}<small> / ${p.max}</small></strong><span>${p.disabled?'DISABLED':p.hp<p.max?'INJURED':'INTACT'} · ARMOR ${p.armor}</span></div></div><div class="heartbeat"><svg viewBox="0 0 100 30"><path d="M0 20H24L30 15L36 24L42 3L49 28L56 16L61 20H100"/></svg><strong>${bpm}</strong><span>BPM · ${u.stress>60?'STRESSED':'STEADY'}</span></div><h3>CONDITION</h3><div class="conditions">${effects.map(e=>`<p class="${e.bad?'bad':'good'}"><b>${esc(e.name)}</b><span>${e.text}</span></p>`).join('')||'<p><b>No active effects</b><span>Stable</span></p>'}<p><b>Encumbrance</b><span>−${Math.round(loadPenalty(u)*100)}% movement</span></p></div></aside><aside class="equipment-workspace" aria-label="Equipment and storage"><header class="equipment-header"><h2>EQUIPMENT</h2><button data-eq="close" aria-label="Close inventory">✕</button></header><div class="worn-slots">${['helmet','armor'].map(k=>`<div class="worn-slot"><span>${k==='armor'?'BODY ARMOR':'HELMET'}</span>${ICONS[k==='helmet'?'helmet':'armor']||ICONS.gear}<b>${esc(GEAR[u.equipment[k]]?.name||'None')}</b><small>${GEAR[u.equipment[k]]?.weight||0} KG${GEAR[u.equipment[k]]?.move?` · ${GEAR[u.equipment[k]].move>0?'+':''}${GEAR[u.equipment[k]].move} MOVE`:''}</small></div>`).join('')}</div><div class="equipped-weapons">${u.weapons.map(id=>{const w=WEAPONS[id];return `<button data-eq="weapon" data-value="${id}" class="${u.weapon===id?'on':''}">${weaponIcon(w)}<span>${esc(w.name)}<small>${w.ammo?`${u.ammo[id]} - ${reserveAmmo(u,w)} · ${w.ammoType?.toUpperCase()||'FUEL'}`:'MELEE'}${u.attachments[id]?.scope?' · SCOPE':''}${u.attachments[id]?.barrel?' · LONG BARREL':''}</small></span></button>`;}).join('')}</div>${this.grid(u,'rig',GEAR[u.equipment.rig].name)}${this.grid(u,'backpack',GEAR[u.equipment.backpack].name)}${this.grid(u,'pockets','Pockets')}<div class="cargo-tools"><span>${this.selected?`${esc(INVENTORY_ITEMS[storageOf(u,this.selected.path)?.slots.find(s=>s.id===this.selected.id)?.itemId]?.name||'Item')} selected`:'Drag items between grids · R to rotate.'}</span><button data-eq="rotate" ${!this.selected?'disabled':''}>Rotate R</button><button data-eq="open" ${!this.selected?'disabled':''}>Open / Use</button><button data-eq="equip" ${!this.selected?'disabled':''}>Equip</button></div><p class="cargo-hint">Double-click rigs or pouches to open. Stored contents add to carried weight.</p></aside>${this.nested&&storageOf(u,this.nested.path)?`<aside class="nested-cargo"><header><h3>${esc(this.nested.name)}</h3><button data-eq="nestedClose" aria-label="Close nested storage">✕</button></header>${this.grid(u,this.nested.path,'Internal storage')}</aside>`:''}<button class="close-loadout" data-eq="close"><kbd>I</kbd> CLOSE INVENTORY</button>`;
        this.root.querySelector('.equipment-workspace').scrollTop=scroll;
    }
}
