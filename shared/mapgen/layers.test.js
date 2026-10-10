import { materialById } from '../voxel/Materials.js';
import test from 'node:test';import assert from 'node:assert/strict';
import { CEDAR_IMAGE_SITE } from '../mission/generated/CedarImage.js';
import { solveLayout } from './LayoutSolver.js';
import { buildPackagedMap } from './PackageBuilder.js';
import { layerCompatible } from './LayerSolver.js';
import { canJumpDown, ladderMoves, reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
test('three-layer sockets reject rock beneath an entrance and compile 20 deterministic seeds',()=>{
 assert.equal(layerCompatible('rock','entrance','up'),false);assert.equal(layerCompatible('tunnel','drop','up'),true);
 for(let seed=1;seed<=20;seed++) {
  const solved=solveLayout(CEDAR_IMAGE_SITE,{seed}),m=buildPackagedMap({site:CEDAR_IMAGE_SITE,...solved},{seed});
  const u=m.meta.underground;assert.equal(u.openings.length,3);const d=u.openings.find(e=>e.kind==='jump');assert.deepEqual(canJumpDown(m.store,d.from,-1,0),d.to);
  const c=u.openings.find(e=>e.kind==='climb');assert.ok(ladderMoves(m.store,c.to).some(p=>nodeKey(p)===nodeKey(c.from)));
  const reach=reachable(m.store,m.spawns.player[0],Infinity,AGENT_PROFILES.player);assert.ok(u.cells.every(p=>reach.costs.has(nodeKey(p))||m.store.isSolid(p.x,p.y,2)));assert.deepEqual(solved.layout,solveLayout(CEDAR_IMAGE_SITE,{seed}).layout);
 }
});
import { MAP_PACKAGES } from '../mission/generated/PackageCatalog.js';
import { checkLayerGates } from './Gates.js';
test('installed bridge and subway fixture passes flank gates on four seeds and rejects a sealed socket',()=>{
 const pkg=MAP_PACKAGES.find(p=>p.manifest.id==='subway-crossing');assert.ok(pkg);
 for(const seed of [1,2,3,4]){const m=buildPackagedMap(pkg,{seed});assert.ok(m.metrics.pass);assert.ok(m.store.mat.some(id=>['lantern','emergency_light'].includes(materialById(id).key)));assert.ok(Object.values(checkLayerGates(m)).every(Boolean));
 const e=m.meta.underground.openings.find(e=>e.kind==='climb');m.store.set(e.to.x,e.to.y,2,1);assert.equal(checkLayerGates(m).twoEntrances,false);}
});
test('single-storey fillers omit fire escapes but keep attached roof access; storm drains retain banks',()=>{
 const site=structuredClone(CEDAR_IMAGE_SITE);site.buildings.forEach(b=>b.storeys=1);site.underground={kind:'storm-drain'};
 const solved=solveLayout(site),m=buildPackagedMap({site,...solved});assert.ok(m.buildings.every(b=>b.storeys===1&&b.escapes.length===0&&b.roofAccess));
 const reach=reachable(m.store,m.spawns.player[0],Infinity,AGENT_PROFILES.player);assert.ok(m.buildings.every(b=>reach.costs.has(nodeKey({x:b.x0,y:b.y0+1,z:b.top}))));
 assert.ok(m.meta.underground.route.some(p=>m.store.material(p.x,p.y,p.z).liquid));
});
