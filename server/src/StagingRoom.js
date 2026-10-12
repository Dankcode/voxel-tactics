import colyseus from 'colyseus';
import { randomUUID } from 'node:crypto';
import { CONTENT_CONTRACT } from '../../shared/session/ContentContract.js';
import { sanitizeDesc } from '../../shared/session/Scenarios.js';
import { SQUADS } from '../../shared/content/units.js';
/** Separate lobby: no battle, renderer, or campaign timers exist before launch. */
export class StagingRoom extends colyseus.Room {
    onCreate(options) {
        this.maxClients=4; this.seats=[]; this.nextSeat=1; this.revision=0;
        this.desc=sanitizeDesc(options.desc || {}); this.owners={}; this.launching=false;this.launched=false;
        this.onMessage('configure',(client,m)=>this.edit(client,()=>{this.desc=sanitizeDesc(m.desc);this.owners={};}));
        this.onMessage('draft',(client,m)=>this.edit(client,()=>{
            if (!Number.isInteger(m.index)||m.index<0||m.index>=this.squad().length||!this.seats.some(s=>s.id===m.owner)) throw Error('Invalid soldier assignment');
            this.owners[m.index]=m.owner;
        }));
        this.onMessage('ready',(client,m)=>{const s=this.seat(client);if(!s||this.launching||this.launched)return;if(m.revision!==this.revision)return client.send('error',{message:'Lobby changed; review before readying.'});s.ready=!!m.ready;this.publish();});
        this.onMessage('launch',client=>this.launch(client));
    }
    onAuth(client, options) {
        if(options.contract?.content!==CONTENT_CONTRACT.content||options.contract?.protocol!==CONTENT_CONTRACT.protocol)throw new colyseus.ServerError(4213,'Incompatible game content');
        return true;
    }
    squad() { return Array.isArray(this.desc.squad)?this.desc.squad:(SQUADS[this.desc.squad]||SQUADS.standard); }
    seat(client) { return this.seats.find(s=>s.sessionId===client.sessionId); }
    onJoin(client,options) {
        if(this.launching||this.launched||this.seats.length>=this.squad().length)throw new colyseus.ServerError(4212,'No staging seat available');
        const id=`P${this.nextSeat++}`;
        this.seats.push({id,sessionId:client.sessionId,name:String(options.name||'Player').slice(0,24),ready:false,ticket:randomUUID()});
        this.host ||= id;this.changed();client.send('seat',{id});
    }
    onLeave(client) {
        const id=this.seat(client)?.id;this.seats=this.seats.filter(s=>s.id!==id);
        if(this.host===id)this.host=this.seats[0]?.id;
        for(const i of Object.keys(this.owners))if(this.owners[i]===id)delete this.owners[i];
        if(!this.launching&&!this.launched)this.changed();
    }
    edit(client,fn) {
        if(this.seat(client)?.id!==this.host)return client.send('error',{message:'Only the host can change the briefing.'});
        if(this.launching||this.launched)return client.send('error',{message:'Launch descriptor is frozen.'});
        const previous={desc:this.desc,owners:{...this.owners}};
        try {fn();if(this.squad().length<this.seats.length)throw Error('Squad needs one soldier per player');this.changed();}
        catch(error){this.desc=previous.desc;this.owners=previous.owners;client.send('error',{message:error.message});}
    }
    changed() {this.revision++;for(const s of this.seats)s.ready=false;this.publish();}
    lobbyState() {return {host:this.host,revision:this.revision,desc:this.desc,owners:this.owners,
        seats:this.seats.map(({ticket,sessionId,...s})=>s),launching:this.launching,launched:this.launched};}
    publish() {this.broadcast('state',this.lobbyState());}
    async launch(client) {
        if(this.seat(client)?.id!==this.host||this.launching||this.launched)return;
        if(!this.seats.length)return;
        const roster=structuredClone(this.seats),desc=structuredClone(this.desc),owners={};
        this.squad().forEach((_,i)=>owners[`p${i}`]=this.owners[i]||roster[i%roster.length].id);
        this.launching=true;this.publish();
        try {
            const room=await colyseus.matchMaker.createRoom('mission',{desc,contract:CONTENT_CONTRACT,roster,owners,host:this.host});
            this.launched=true;this.launching=false;this.publish();
            for(const peer of this.clients) {
                const s=roster.find(s=>s.sessionId===peer.sessionId);
                if(s)peer.send('launched',{roomId:room.roomId,ticket:s.ticket,desc,owners,contract:CONTENT_CONTRACT});
            }
        } catch(error) {this.launching=false;client.send('error',{message:error.message});this.publish();}
    }
}
