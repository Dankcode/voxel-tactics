import { InventoryPrep } from '../ui/InventoryPrep.js';
import { Client } from 'colyseus.js';
import { CONTENT_CONTRACT } from '../../../shared/session/ContentContract.js';
import { SQUADS, CLASSES } from '../../../shared/content/units.js';
import { SCENARIOS } from '../../../shared/session/Scenarios.js';
const root=document.querySelector('#shell');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const url=`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:2567`;
let room,state,myId;
let draft=null;try{draft=JSON.parse(sessionStorage.getItem('fireteam.stagingDraft')||'null');}catch{}
root.innerHTML=`<a href="/">← Battle menu</a><p class="eyebrow">Cooperative operations</p><h1>Mission briefing</h1><p>Assign the squad, review the mission, launch immediately.</p><section id="entry"><div class="row"><label>Name <input id="name" value="Player" maxlength="24"></label><label>Server <input id="server" value="${url}"></label></div><div class="row" style="margin-top:16px"><button id="host" class="primary">Host briefing</button><label>Room code <input id="code"></label><button id="join">Join briefing</button></div></section><div id="lobby"></div><section id="equipment" hidden></section><p id="status" role="status"></p>`;
const status=message=>document.querySelector('#status').textContent=message;
async function connect(host) {
    try {
        const client=new Client(document.querySelector('#server').value);
        const options={name:document.querySelector('#name').value,contract:CONTENT_CONTRACT};
        room=host?await client.create('staging',{...options,desc:draft?.desc||{scenario:'proving-grounds',seed:27,intel:true,asyncCoop:true}}):await client.joinById(document.querySelector('#code').value.trim(),options);
        room.onMessage('state',m=>{state=m;render();});room.onMessage('seat',m=>{myId=m.id;render();});
        room.onMessage('error',m=>status(m.message));room.onMessage('launched',m=>{
            // Only the validated, frozen launch contract crosses into the battle entry point.
            sessionStorage.setItem('fireteam.launch',JSON.stringify({url:document.querySelector('#server').value,roomId:m.roomId,ticket:m.ticket}));
            room.leave();location.assign('/?staged=1');
        });
        room.onLeave(()=>{if(!state?.launched)status('Left briefing. Reload to reconnect.');});
        document.querySelector('#entry').hidden=true;status('');
    }catch(error){status(error.message);}
}
function render() {
    if(!state||!myId)return;
    const host=state.host===myId,frozen=state.launching||state.launched,squad=Array.isArray(state.desc.squad)?state.desc.squad:SQUADS[state.desc.squad]||SQUADS.standard;
    document.querySelector('#lobby').innerHTML=`<section><p class="eyebrow">Room ${esc(room.roomId)}</p><h2>Squad briefing</h2><ul>${state.seats.map(s=>`<li>${esc(s.name)} · ${s.id}${s.id===state.host?' · host':''}</li>`).join('')}</ul><div class="row"><label>Map <select id="map" ${!host||frozen?'disabled':''}>${SCENARIOS.map(s=>`<option value="${s.id}" ${s.id===state.desc.scenario?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>Seed <input id="seed" type="number" min="1" max="4294967295" value="${state.desc.seed}" ${!host||frozen?'disabled':''}></label><button id="config" ${!host||frozen?'disabled':''}>Apply mission</button></div><button id="edit-pack" ${!host||frozen?'disabled':''}>Prepare equipment</button><p>${state.desc.intel?'Intel rules · independent personal turns':'Classic squad turns'} · Revision ${state.revision}</p><table><thead><tr><th>Soldier / equipment</th><th>Controller</th></tr></thead><tbody>${squad.map((type,i)=>`<tr><td>${esc(CLASSES[type].intelName||CLASSES[type].name)}<br><small>${esc(CLASSES[type].weapons.join(', '))} · ${(state.desc.inventories?.[i]?.length??Object.values(CLASSES[type].items).reduce((a,b)=>a+b,0))} packed items</small></td><td><select data-soldier="${i}" ${!host||frozen?'disabled':''}>${state.seats.map((s,n)=>`<option value="${s.id}" ${(state.owners[i]||state.seats[i%state.seats.length].id)===s.id?'selected':''}>${esc(s.name)} (${s.id})</option>`).join('')}</select></td></tr>`).join('')}</tbody></table><div class="row" style="margin-top:24px"><button id="launch" ${!host||frozen?'disabled':''}>${state.launching?'Building battlefield…':'Launch mission'}</button></div></section>`;
    document.querySelector('#edit-pack').onclick=()=>{
        const panel=document.querySelector('#equipment');panel.hidden=false;
        panel.innerHTML='<div id="pack-editor"></div><button id="save-pack" class="primary">Apply equipment</button><button id="cancel-pack">Cancel</button>';
        const prep=new InventoryPrep(panel.querySelector('#pack-editor'),state.desc.squad);
        if(state.desc.inventories){prep.packs=structuredClone(state.desc.inventories);prep.render();}
        panel.querySelector('#save-pack').onclick=()=>{room.send('configure',{desc:{...state.desc,inventories:prep.inventories()}});panel.hidden=true;};
        panel.querySelector('#cancel-pack').onclick=()=>panel.hidden=true;
    };
    document.querySelector('#config').onclick=()=>room.send('configure',{desc:{...state.desc,scenario:document.querySelector('#map').value,seed:Number(document.querySelector('#seed').value)}});
    document.querySelectorAll('[data-soldier]').forEach(el=>el.onchange=()=>room.send('draft',{index:Number(el.dataset.soldier),owner:el.value}));

    document.querySelector('#launch').onclick=()=>room.send('launch');
}
document.querySelector('#host').onclick=()=>connect(true);document.querySelector('#join').onclick=()=>connect(false);

if(new URLSearchParams(location.search).has('host')){if(draft?.url)document.querySelector('#server').value=draft.url;connect(true);}
