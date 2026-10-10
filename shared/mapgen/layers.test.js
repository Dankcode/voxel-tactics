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
