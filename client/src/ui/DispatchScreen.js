import {portraitSrc} from './Portraits.js';
import {ABILITIES,displayName} from '../../../shared/content/units.js';
import {WEAPONS} from '../../../shared/content/weapons.js';
import {packMarkup} from './InventoryPrep.js';
import {TopographyPreview} from './TopographyPreview.js';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/** Local review screen only; dispatch has no party vote or campaign dependency. */
export function reviewDispatch(root,session) {
 const battle=session.battle,units=battle.unitsOf('player');let selected=units[0],view='loadout';
 return new Promise(resolve=>{
  root.classList.remove('hidden');root.innerHTML=`<div class="dispatch-card"><header><div><p class="eyebrow">Operation ready · seed ${esc(session.desc.seed)}</p><h1>${esc(battle.mission.name)}</h1><p>${esc(battle.mission.objective?.text)}</p>${session.roomId?`<p>Room code: <b>${esc(session.roomId)}</b> · Your seat ${esc(session.playerId)}</p>`:''}</div><button class="primary" id="dispatch-now">Dispatch to scene</button><button id="dispatch-cancel">Back</button></header><p id="m-status" role="status"></p><div class="dispatch-layout"><section class="dispatch-roster"><h2>Squad review</h2><nav>${units.map(u=>`<button data-soldier="${u.id}">${esc(u.name)}<small>${esc(displayName(u.type,battle.intelMode))}</small></button>`).join('')}</nav><div id="dispatch-soldier"></div></section><section class="dispatch-map"><h2>Parcel & topography debugger</h2><p>Elevation colors: low teal → high warm. Gold: main route. Blue: flanks / insertion. Pink: connector sockets. Eight-tile grid: planning lots.</p><div id="dispatch-topography"></div></section></div></div>`;
  const drawSoldier=()=>{
   root.querySelectorAll('[data-soldier]').forEach(b=>b.classList.toggle('on',b.dataset.soldier===selected.id));
   root.querySelector('#dispatch-soldier').innerHTML=`<div class="dispatch-portrait"><img src="${portraitSrc(selected)}" alt="${esc(selected.name)}"><div><h2>${esc(selected.name)}</h2><p>${esc(displayName(selected.type,battle.intelMode))}</p><p>HP ${selected.hp}/${selected.maxHp} · AP ${selected.ap} · Will ${selected.will}</p></div></div><nav class="dispatch-detail-tabs"><button data-view="loadout" class="${view==='loadout'?'on':''}">Loadout</button><button data-view="skills" class="${view==='skills'?'on':''}">Skills</button><button data-view="backpack" class="${view==='backpack'?'on':''}">Backpack</button></nav><div ${view==='loadout'?'':'hidden'}><h3>Weapons</h3>${selected.weapons.map(id=>{const w=WEAPONS[id];return `<div class="dispatch-item"><b>${esc(w?.name||id)}</b><small>${w?.ap??'—'} AP · range ${w?.range??w?.maxRange??'—'} · ammo ${selected.ammo[id]??'—'}</small></div>`;}).join('')}</div><div ${view==='skills'?'':'hidden'}><h3>Skills</h3>${selected.abilities.map(id=>{const a=ABILITIES[id];return `<div class="dispatch-item"><b>${esc(a?.name||id)}</b><small>${a?.ap??0} AP · ${a?.wp??0} Will${a?.intel&&!battle.intelMode?' · Intel mode required':''}</small><p>${esc(a?.text)}</p></div>`;}).join('')}</div><div ${view==='backpack'?'':'hidden'}><h3>Backpack · 6 × 5</h3>${packMarkup(selected.inventory||[],false)}</div>`;
   root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;drawSoldier();});
  };
  root.querySelectorAll('[data-soldier]').forEach(b=>b.onclick=()=>{selected=units.find(u=>u.id===b.dataset.soldier);drawSoldier();});drawSoldier();
  new TopographyPreview(root.querySelector('#dispatch-topography'),battle.mission);
  root.querySelector('#dispatch-now').onclick=()=>resolve(true);root.querySelector('#dispatch-cancel').onclick=()=>resolve(false);
 });
}
