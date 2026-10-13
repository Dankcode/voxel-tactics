/** Discrete interior floors across the tactical zoom range. Far zoom shows roofs. */
export function floorCutLevels(mission) {
    const base=mission.meta?.streetDatum??1;
    const floors=Math.max(1,...(mission.buildings||[]).map(b=>b.storeys||1));
    return [...new Set([...(mission.meta?.cutLevels||[]).filter(Number.isFinite),...Array.from({length:floors},(_,i)=>base+3*(i+1)),Infinity])].sort((a,b)=>a-b);
}
export function zoomCutLevel(mission,distance) {
    if(distance>=36)return Infinity;
    const levels=floorCutLevels(mission).filter(z=>Number.isFinite(z)&&z>(mission.meta?.streetDatum??1));
    const index=Math.max(0,Math.min(levels.length-1,Math.ceil((distance-8)/28*levels.length)-1));
    return levels[index];
}

export function navigationFloors(mission) {
    const base=mission.meta?.streetDatum??1;
    return floorCutLevels(mission).map(cut=>({cut,label:Number.isFinite(cut)?mission.meta?.floorNames?.[cut]||(cut<=base?'Lower street':`Floor ${Math.round((cut-base)/3)}`):'Roof'}));
}
