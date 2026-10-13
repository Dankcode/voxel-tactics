const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
import {materialById,AIR} from '../../../shared/voxel/Materials.js';
export function topologyModel(mission) {
 const s=mission.store,cells=[];
 for(let y=0;y<s.depth;y++)for(let x=0;x<s.width;x++) {
  let z=s.height-1;while(z>=0&&s.get(x,y,z)===AIR)z--;
  cells.push({x,y,height:z,material:z<0?'void':materialById(s.get(x,y,z)).key,surfaces:s.surfaces(x,y).map(p=>({z:p.z,headroom:p.headroom}))});
 }
 return {name:mission.name,seed:mission.meta?.seed,dimensions:[s.width,s.depth,s.height],version:mission.meta?.generatorVersion||'authored-parcels',
  cells,buildings:(mission.buildings||[]).map(b=>({id:b.id,x:b.x0,y:b.y0,w:b.w,d:b.d,storeys:b.storeys,program:b.program||b.role,rounded:b.rounded!==false})),
  connectors:mission.meta?.connectionParcels||mission.meta?.underground?.connectionParcels||[],assignments:mission.meta?.parcelAssignments||[],
  routes:mission.meta?.lineOfPlay||{main:mission.meta?.lowerStreet?.map(p=>[p.x,p.y])||[],flanks:[]},metrics:{...(mission.metrics||{}),gates:{...(mission.metrics?.gates||{}),...Object.fromEntries(Object.entries(mission.meta?.districtGates?.gates||{}).map(([k,v])=>[`district.${k}`,v]))}},districtGates:mission.meta?.districtGates||null,decisions:mission.meta?.designDecisions||[],parcelGraph:mission.meta?.parcelGraph||[],algorithm:mission.meta||{},repairs:mission.meta?.repairs||mission.meta?.district?.repairs||[],spawns:mission.spawns.player};
}
/** Land-use colours for the debugger (PLAN-06 land-use codes). */
export const LAND_USE_COLORS=Object.freeze({'.':'#ff00ff',X:'#0b1418',R:'#3c4449',K:'#9aa0a2',S:'#b7b9b3',D:'#d8c58a',B:'#7a5c4a',L:'#5e6f86',A:'#4b5563',Y:'#7fae6a',P:'#c9b99a',F:'#e7e2d0',W:'#8b8f8a',G:'#5f9a55',C:'#b08a4a',U:'#9b7fb8',T:'#57534e',V:'#7ca86c',E:'#46703f',Z:'#c47b5a',H:'#4a7fa8',I:'#e0745c',Q:'#6b6f7a',O:'#a1a1a1',p:'#b5a27a',g:'#4f8a46',z:'#ff5d73'});
export class TopographyPreview {
 constructor(root,mission) {
  this.root=root;this.mission=mission;this.model=topologyModel(mission);
  root.innerHTML=`<div class="topo-toolbar"><label>Layer <select data-topo="layer"><option value="surface">Surface elevation</option><option value="lower">Lower level</option><option value="materials">Materials</option><option value="landuse">Land use (parcels, lots, strips)</option><option value="origins">Vehicle slots &amp; zones</option></select></label><label><input type="checkbox" data-topo="parcels" checked> Parcels</label><label><input type="checkbox" data-topo="routes" checked> Routes & sockets</label><button data-topo="json">Export debug JSON</button><button data-topo="png">Save preview PNG</button></div><canvas aria-label="Top-down parcel topography preview"></canvas><p class="topo-cell" role="status">Click a cell to inspect its elevation, surfaces and parcel.</p><div class="topo-diagnostics"></div>`;
  this.canvas=root.querySelector('canvas');this.canvas.width=960;this.canvas.height=Math.round(960*this.model.dimensions[1]/this.model.dimensions[0]);
  this.canvas.style.width=`min(100%, ${600*this.model.dimensions[0]/this.model.dimensions[1]}px)`;
  root.querySelectorAll('select,input').forEach(el=>el.onchange=()=>this.draw());
  this.canvas.onclick=e=>this.inspect(e);
  const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  root.querySelector('[data-topo="json"]').onclick=()=>download(new Blob([JSON.stringify(this.model,null,2)],{type:'application/json'}),'map-debug.json');
  root.querySelector('[data-topo="png"]').onclick=()=>this.canvas.toBlob(blob=>download(blob,'map-topography.png'));
  const gates=Object.entries(this.model.metrics.gates||{});
  root.querySelector('.topo-diagnostics').innerHTML=`<p>${this.model.dimensions.join(' × ')} · ${this.model.buildings.length} buildings · ${this.model.connectors.length} connectors · generator ${esc(this.model.version)}</p><div class="gate-list">${gates.map(([name,pass])=>`<span class="${pass?'pass':'fail'}">${pass?'✓':'✕'} ${esc(name)}</span>`).join('')}</div><p>Cover ${(100*(this.model.metrics.coverDensity||0)).toFixed(0)}% · maximum cover gap ${this.model.metrics.coverGap??'—'} · lanes ${this.model.metrics.lanes??'—'} · median sightline ${(this.model.metrics.sightlineMedian||0).toFixed(1)} · ${this.model.repairs.length} repairs</p><ul>${this.model.decisions.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>`;
  const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Compiled algorithm metadata & repairs';pre.textContent=JSON.stringify({assignments:this.model.assignments,repairs:this.model.repairs,algorithm:this.model.algorithm},null,2);details.append(summary,pre);root.querySelector('.topo-diagnostics').append(details);
  this.draw();
 }
 draw() {
  const ctx=this.canvas.getContext('2d'),[W,D,H]=this.model.dimensions,s=this.mission.store,q=this.canvas.width/W,layer=this.root.querySelector('select').value;
  ctx.fillStyle='#111e25';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
  for(const cell of this.model.cells) {
   let z=cell.height;if(layer==='lower'){z=(this.mission.meta?.streetDatum||4)-1;while(z>=0&&s.get(cell.x,cell.y,z)===AIR)z--;}
   if(z<0)continue;
   const mat=materialById(s.get(cell.x,cell.y,z));ctx.fillStyle=layer==='materials'?`#${mat.color.toString(16).padStart(6,'0')}`:`hsl(${190-z/H*160} 28% ${26+z/H*40}%)`;
   const lu=this.mission.meta?.landUse;
   if((layer==='landuse'||layer==='origins')&&lu){const code=lu.codes[cell.x+cell.y*lu.width];ctx.fillStyle=LAND_USE_COLORS[code]||'#ff00ff';if(layer==='origins')ctx.globalAlpha=.35;}
   ctx.fillRect(cell.x*q,cell.y*q,q+.3,q+.3);ctx.globalAlpha=1;
  }
  if(layer==='origins'){
   const d=this.mission.meta?.district;
   for(const v of d?.leaves||[]){ctx.strokeStyle='#ffffff55';ctx.lineWidth=1;ctx.strokeRect(v.rect.x0*q,v.rect.y0*q,v.rect.w*q,v.rect.d*q);ctx.fillStyle='#ffffffcc';ctx.font=`${Math.max(10,q*.7)}px monospace`;ctx.fillText(v.mix||'—',v.rect.x0*q+2,v.rect.y0*q+11);}
   for(const v of this.mission.meta?.streetObjects||[])if(v.kind){ctx.fillStyle='#ffd166';ctx.fillRect(v.x*q,v.y*q,q*2,q*2);}
   for(const z of d?.zones||[]){ctx.strokeStyle='#ff5d73';ctx.lineWidth=3;ctx.strokeRect(z.x0*q,z.y0*q,(z.x1-z.x0+1)*q,(z.y1-z.y0+1)*q);}
  }
  if(this.root.querySelector('[data-topo="parcels"]').checked) {
   ctx.strokeStyle='#9ebcca55';ctx.lineWidth=1;
   for(let x=0;x<W;x+=8){ctx.beginPath();ctx.moveTo(x*q,0);ctx.lineTo(x*q,D*q);ctx.stroke();}
   for(let y=0;y<D;y+=8){ctx.beginPath();ctx.moveTo(0,y*q);ctx.lineTo(W*q,y*q);ctx.stroke();}
   ctx.font=`${Math.max(11,q*.8)}px monospace`;
   for(const b of this.model.buildings){ctx.strokeStyle=b.rounded?'#77dfcd':'#f4c37c';ctx.lineWidth=2;ctx.strokeRect(b.x*q,b.y*q,b.w*q,b.d*q);ctx.fillStyle=ctx.strokeStyle;ctx.fillText(`${b.program||b.id} · ${b.rounded?'round':'square'}`,b.x*q+3,b.y*q+14);}
  }
  if(this.root.querySelector('[data-topo="routes"]').checked) {
   for(const [points,color] of [[this.model.routes.main,'#f6da81'],...(this.model.routes.flanks||[]).map(f=>[f.path,'#84aefa'])]){if(!points?.length)continue;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo((x+.5)*q,(y+.5)*q):ctx.moveTo((x+.5)*q,(y+.5)*q));ctx.stroke();}
   for(const p of this.model.connectors){const pts=p.sockets||[],route=p.cells||pts;ctx.strokeStyle='#ef9fdb';ctx.lineWidth=2;ctx.beginPath();route.filter(a=>Number.isFinite(a.x)).forEach((a,i)=>{const x=(a.x+.5)*q,y=(a.y+.5)*q;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();for(const a of pts)if(Number.isFinite(a.x)){ctx.fillStyle='#ef9fdb';ctx.fillRect(a.x*q,a.y*q,q,q);}}
  }
  ctx.fillStyle='#72dcfc';for(const p of this.model.spawns)ctx.fillRect((p.x+.2)*q,(p.y+.2)*q,.6*q,.6*q);
 }
 inspect(e) {
  const bounds=this.canvas.getBoundingClientRect(),[W,D]=this.model.dimensions,x=Math.min(W-1,Math.floor((e.clientX-bounds.left)/bounds.width*W)),y=Math.min(D-1,Math.floor((e.clientY-bounds.top)/bounds.height*D)),cell=this.model.cells[x+y*W];
  const building=this.model.buildings.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.d);
  this.root.querySelector('.topo-cell').textContent=`Cell ${x},${y} · top Z ${cell.height} · ${cell.material} · standing surfaces ${cell.surfaces.map(p=>`${p.z} (${p.headroom} clearance)`).join(', ')||'none'} · parcel ${building?.id||'street / connector'} · lot ${Math.floor(x/8)},${Math.floor(y/8)}`;
 }
}
