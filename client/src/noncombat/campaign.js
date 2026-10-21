import { SOLO_ONLY } from '../net/Hosting.js';
import { fixtureCampaign, loadCampaign, workshopFixture, fixtureLaunch, applyFixtureResult } from './CampaignState.js';
const key='fireteam.campaign.fixture.v1';let state=fixtureCampaign();
const root=document.querySelector('#shell');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const labels={hub:'Headquarters',roster:'Roster & equipment',workshop:'Workshop',operations:'Regional operations',briefing:'Mission briefing',debrief:'Debrief'};
function render(message='') {
    const body={
        hub:`<h2>Headquarters</h2><p>${state.roster.length} soldiers available · ${state.completed.length} fixture operations completed.</p><p>Select a department above. Progress changes only through explicit actions.</p>`,
        roster:`<h2>Roster & equipment</h2><table><thead><tr><th>Soldier</th><th>Role</th><th>Pack</th></tr></thead><tbody>${state.roster.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.type)}</td><td>${s.inventory.length} items · 6 × 5 capacity</td></tr>`).join('')}</tbody></table>`,
        workshop:`<h2>Workshop</h2><p>${state.materials} fixture materials. Demonstration recipe: 2 materials → one medkit record.</p><button id="craft" ${state.materials<2?'disabled':''}>Complete fixture craft</button><ul>${state.workshop.map(w=>`<li>${esc(w.item)} · ${esc(w.status)}</li>`).join('')}</ul>`,
        operations:`<h2>Regional operations</h2><p>Training district · reconnaissance fixture · Seed 27.</p><button id="prepare" ${state.mission?'disabled':''}>Prepare operation</button>`,
        briefing:`<h2>Mission briefing</h2>${state.mission?`<p>Training district · Seed ${state.mission.seed} · ${state.mission.squad.length} soldiers</p><p>The mission draft is frozen. This prototype uses fixture results; it does not launch a live battle.</p><button id="result">Apply fixture completion</button>`:'<p>Select a regional operation first.</p>'}${SOLO_ONLY ? '' : '<p><a href="/staging.html">Open live co-op briefing separately</a></p>'}`,
        debrief:`<h2>Debrief</h2><p>${state.completed.length} fixture operations completed. Completion is recorded once per mission.</p><button id="home">Return to headquarters</button>`
    };
    root.innerHTML=`<a href="/">← Battle menu</a><p class="eyebrow">Separate campaign application · fixture data</p><h1>Fireteam headquarters</h1><p>Navigation and save/load prototype. Craft costs and results are demonstrations; campaign balance and live mission rewards are deferred.</p><nav>${Object.entries(labels).map(([id,label])=>`<button data-screen="${id}" ${state.screen===id?'class="primary"':''}>${label}</button>`).join('')}</nav><section>${body[state.screen]}</section><div class="row"><button id="save">Save fixture</button><button id="load">Load fixture</button><small>Save revision ${state.revision} · schema ${state.schema}</small></div><p id="status" role="status">${esc(message)}</p>`;
    root.querySelectorAll('[data-screen]').forEach(b=>b.onclick=()=>{state.screen=b.dataset.screen;render();});
    root.querySelector('#save').onclick=()=>{try{localStorage.setItem(key,JSON.stringify(state));render('Fixture saved.');}catch(e){render(e.message);}};
    root.querySelector('#load').onclick=()=>{try{const text=localStorage.getItem(key);if(!text)throw Error('No fixture save yet.');state=loadCampaign(text);render('Fixture loaded.');}catch(e){render(e.message);}};
    const action=(id,fn)=>{const b=root.querySelector(id);if(b)b.onclick=()=>{try{fn();render();}catch(e){render(e.message);}};};
    action('#craft',()=>state=workshopFixture(state,crypto.randomUUID()));
    action('#prepare',()=>state=fixtureLaunch(state,crypto.randomUUID(),27));
    action('#result',()=>state=applyFixtureResult(state,{campaignId:state.id,missionId:state.mission.missionId,revision:state.mission.revision}));
    action('#home',()=>{state.screen='hub';});
}
render();
