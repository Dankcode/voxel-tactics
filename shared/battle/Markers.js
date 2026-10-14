import { materialById } from '../voxel/Materials.js';
export const MARK_COLORS=Object.freeze({red:0xff4949,blue:0x4c9cff,green:0x56ef93});
export function validateMark(b,u,i){
    if(u.side!=='player'||!Object.hasOwn(MARK_COLORS,i.color))return 'bad_intent';
    const p=i.at;if(!p||![p.x,p.y,p.z].every(Number.isInteger)||!b.store.inBounds(p.x,p.y,p.z)||!b.store.isSolid(p.x,p.y,p.z))return 'bad_intent';
    return null;
}
export function putMark(b,u,i){
    const owner=u.owner,existing=b.markers.find(m=>m.owner===owner&&m.source==='manual'&&m.x===i.at.x&&m.y===i.at.y&&m.z===i.at.z&&m.color===i.color);
    if(existing){b.markers=b.markers.filter(m=>m!==existing);b.emit({t:'marker',action:'remove',id:existing.id});return;}
    const own=b.markers.filter(m=>m.owner===owner&&m.source==='manual');if(own.length>=12)b.markers=b.markers.filter(m=>m!==own[0]);
    const m={id:`mark-${b.seq+1}`,owner,source:'manual',color:i.color,...i.at};b.markers.push(m);b.emit({t:'marker',action:'put',marker:{...m}});
}
export function settleMarks(b){
    for(const m of [...b.markers]){
        if(b.store.isSolid(m.x,m.y,m.z)&&!materialById(b.store.get(m.x,m.y,m.z)).liquid)continue;
        let z=m.z-1;while(z>=0&&(!b.store.isSolid(m.x,m.y,z)||materialById(b.store.get(m.x,m.y,z)).liquid))z--;
        if(z<0){b.markers=b.markers.filter(o=>o!==m);b.emit({t:'marker',action:'remove',id:m.id});}
        else{m.z=z;b.emit({t:'marker',action:'fall',marker:{...m}});}
    }
}
export function sensorMarks(b,source,contacts,owner='team'){
    for(const c of contacts){const id=`sensor-${source}-${c.enemyId}`;let m=b.markers.find(m=>m.id===id);if(!m){m={id,source:'sensor',sensor:source,owner,color:'red'};b.markers.push(m);}Object.assign(m,{x:c.x,y:c.y,z:c.z,round:c.round});}
    settleMarks(b);
}
