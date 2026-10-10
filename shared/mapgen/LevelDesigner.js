const KINDS={house:['living','kitchen','study','bathroom'],shop:['sales','stock','office','restroom'],office:['open_office','meeting','office','restroom'],warehouse:['warehouse','loading','office','utility'],garage:['workshop','storage','office','utility'],diner:['dining','kitchen','office','restroom']};
const ROOM_KINDS=new Set([...Object.values(KINDS).flat(),'bedroom','lobby','unit','galley','barracks','storeroom','armory']);
const upperKinds=(b,floor)=>floor===0?KINDS[b.program]||KINDS.office:
 b.program==='house'?[['bedroom','study','living','bathroom'],['unit','galley','study','bathroom'],['bedroom','armory','office','bathroom']][(floor-1)%3]:
 [['office','meeting','stock','restroom'],['barracks','storeroom','office','utility'],['armory','study','office','restroom']][(floor-1)%3];
export function designLevel(site,layout,proposal=null) {
    if(proposal) {
        if(!['eliminate','recover','extract','hold'].includes(proposal.mission?.kind))throw Error('design.objective: unsupported mission kind');
        if(!Array.isArray(proposal.beats)||proposal.beats.length<3||proposal.beats.length>6)throw Error('design.story: requires 3–6 located beats');
        if(!Array.isArray(proposal.programs)||proposal.programs.some(p=>!layout.buildings.some(b=>b.id===p.building)))throw Error('design.program: unknown building');
        for(const b of layout.buildings) {
            const programs=proposal.programs?.filter(p=>p.building===b.id)||[];
            if(programs.length!==b.storeys||new Set(programs.map(p=>p.floor)).size!==b.storeys||programs.some(p=>!Number.isInteger(p.floor)||p.floor<0||p.floor>=b.storeys))throw Error(`design.program: ${b.id} needs a unique programme for every floor`);
            for(const p of programs) {
                if(!Array.isArray(p.rooms)||new Set(p.rooms.map(r=>r.id)).size!==p.rooms.length||p.rooms.some(r=>!ROOM_KINDS.has(r.kind)||!(r.areaShare>0)||['bathroom','restroom','utility'].includes(r.kind)&&r.gameplay!==false))throw Error(`design.rooms: ${b.id}/${p.floor}: unsupported kind, invalid area, duplicate room or unlocked service room`);
            }
        }
        const placeExists=p=>proposal.programs.some(q=>q.building===p.building&&q.floor===p.floor&&(p.room==='hall'||q.rooms.some(r=>(r.id===p.room||r.kind===p.room)&&r.gameplay!==false)));
        if(![proposal.mission.target,...proposal.beats,...(proposal.encounters||[])].every(placeExists))throw Error('design.place: every objective, beat and pod must name a gameplay room');
        if(proposal.encounters?.some(e=>!e.types?.length||e.types.some(t=>!['cultist','archer','warden_foe','pyromancer','brute'].includes(t))))throw Error('design.encounter: unsupported enemy type');
        return proposal;
    }
    const target=layout.buildings.slice().sort((a,b)=>b.storeys-a.storeys)[0];
    const programmes=layout.buildings.flatMap(b=>Array.from({length:b.storeys},(_,floor)=>({building:b.id,floor,rooms:upperKinds(b,floor).map(kind=>({id:kind,kind,areaShare:0.25,gameplay:!['bathroom','restroom','utility'].includes(kind)})),adjacencies:upperKinds(b,floor).filter(k=>!['bathroom','restroom','utility'].includes(k)).map(kind=>[kind,'hall'])})));
    const primary=programmes.find(p=>p.building===target.id&&p.floor===target.storeys-1).rooms.find(r=>r.gameplay).kind;
    const kind=site.objective || (site.storyHooks?.some(s=>/hostage|evac/i.test(s))?'extract':site.storyHooks?.some(s=>/defend|alarm/i.test(s))?'hold':'recover');
    return {version:1,mission:{kind,title:site.name || site.id,briefing:`The Syndicate has occupied this ${site.theme || 'urban'} block. Advance through cover and use the flank to reach ${target.id}. Its upper floors control the approach. Secure the objective and withdraw.`,timeOfDay:site.timeOfDay,target:{building:target.id,floor:target.storeys-1,room:primary}},programs:programmes,
        beats:[{id:'approach',text:'Reach cover beneath the lookout.',building:target.id,floor:0,room:'hall'}, {id:'escalation',text:'Push past the guarded stair core.',building:target.id,floor:Math.min(1,target.storeys-1),room:'hall'}, {id:'climax',text:'Secure the Syndicate command room.',building:target.id,floor:target.storeys-1,room:primary}],
        encounters:layout.buildings.flatMap((b,group)=>[{group:group*2,building:b.id,floor:Math.min(1,b.storeys-1),room:'hall',types:['cultist','warden_foe']},{group:group*2+1,building:b.id,floor:b.storeys-1,room:upperKinds(b,b.storeys-1)[0],types:['archer']}])};
}
