// Crop an observed map region before rasterisation. Physical scale stays uniform in both axes.
function clipLine(a,b,box) {
    const [x0,y0,x1,y1]=box,dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
    for(const [p,q] of [[-dx,a[0]-x0],[dx,x1-a[0]],[-dy,a[1]-y0],[dy,y1-a[1]]]) {
        if(!p){if(q<0)return null;continue;}const t=q/p;
        if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
    }
    return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];
}
export function cropReferenceRegion(source,box,{buildingIds=null,name=source.name}={}) {
    const [x0,y0,x1,y1]=box,dx=x1-x0,dy=y1-y0;if(dx<=0||dy<=0)throw Error('reference.crop: empty region');
    const point=([x,y])=>[(x-x0)/dx,(y-y0)/dy].map(v=>v>=-1e-8&&v<=1+1e-8?Math.max(0,Math.min(1,v)):v);
    const intersect=b=>{const r=[Math.max(x0,b[0]),Math.max(y0,b[1]),Math.min(x1,b[2]),Math.min(y1,b[3])];return r[2]>r[0]&&r[3]>r[1]?[...point(r.slice(0,2)),...point(r.slice(2))]:null;};
    const selected=source.buildings.filter(b=>buildingIds?buildingIds.includes(b.id):b.bounds[0]>=x0&&b.bounds[1]>=y0&&b.bounds[2]<=x1&&b.bounds[3]<=y1);
    const buildings=selected.map(b=>{if(b.bounds[0]<x0||b.bounds[1]<y0||b.bounds[2]>x1||b.bounds[3]>y1)throw Error(`reference.crop: selected ${b.id} crosses crop boundary`);return {...b,bounds:intersect(b.bounds)};});
    const roads=[];
    for(const r of source.roads||[]) {
        let points=[],part=0;const flush=()=>{if(points.length>1)roads.push({...r,id:`${r.id}-${part++}`,points:points.map(point)});points=[];};
        for(let i=1;i<r.points.length;i++) {
            const segment=clipLine(r.points[i-1],r.points[i],box);if(!segment){flush();continue;}
            if(points.length&&Math.hypot(points.at(-1)[0]-segment[0][0],points.at(-1)[1]-segment[0][1])>.00001)flush();
            if(!points.length)points.push(segment[0]);points.push(segment[1]);
        }flush();
    }
    const rects=items=>items.flatMap(s=>{const bounds=intersect(s.bounds);return bounds?[{...s,bounds}]:[];});
    return {...source,name,frame:{width:source.frame.width*dx,height:source.frame.height*dy},buildings,roads,surfaces:rects(source.surfaces||[]),parking:rects(source.parking||[]),
        playableBoundary:source.playableBoundary?.map(point),insertion:point(source.insertion),flow:source.flow.map(point).filter(p=>p.every(v=>v>0&&v<1)),
        parcelPlan:source.parcelPlan?{...source.parcelPlan,slots:source.parcelPlan.slots.filter(s=>selected.some(b=>b.id===s.id))}:undefined,
        crop:{bounds:box,excludedBuildings:source.buildings.filter(b=>!selected.includes(b)).map(b=>b.id)}
    };
}
