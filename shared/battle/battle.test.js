import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { Battle } from './Battle.js';
import { runAiSide } from './Ai.js';
import { estimateShot } from './Ballistics.js';
import { WEAPONS } from '../content/weapons.js';
import { buildProvingGrounds } from '../mission/ProvingGrounds.js';
import { finalizeMission } from '../mission/MissionCommon.js';
import { createRng } from '../util/Rng.js';

/** Flat arena with optional walls; enemies are placed alerted so they act. */
function arena({ walls = [], enemies = [{ type: 'cultist', pos: { x: 10, y: 4, z: 1 } }], squad = ['marksman'], player = [{ x: 10, y: 16, z: 1 }] } = {}) {
    const s = new VoxelStore(24, 24, 10);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { s.set(x, y, 0, MAT.bedrock); s.set(x, y, 1, MAT.grass); }
    for (const [x, y, z, k] of walls) s.set(x, y, z, MAT[k]);
    const mission = finalizeMission({ id: 'arena', name: 'Arena', store: s, rooms: [], buildings: [], rng: createRng(1),
        spawns: { player, enemy: enemies.map(e => ({ type: e.type, group: 0, pos: e.pos })) }, objective: { kind: 'eliminate' } });
    const b = new Battle({ mission, squad: squad.map(type => ({ type })), seed: 9 });
    return b;
}

test('moving spends AP by path cost / mobility and is rejected beyond the budget', () => {
    const b = arena();
    const u = b.unit('p0');
    const r = b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 13, z: 1 } });
    assert.ok(r.ok);
    assert.equal(u.ap, 2);
    assert.equal(b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 1, z: 1 } }).reason, 'no_ap');
});

test('a wall between shooter and target turns hits into cover hits (physical cover)', () => {
    const open = arena();
    const shooter = open.unit('p0'), target = open.units.find(u => u.side === 'enemy');
    const w = WEAPONS.longrifle;
    const est = estimateShot(open, shooter, { unitId: target.id, part: 'torso' }, { weapon: w, spread: 2, samples: 128 });
    const walled = arena({ walls: [[10, 6, 2, 'stone'], [10, 6, 3, 'stone'], [9, 6, 2, 'stone'], [9, 6, 3, 'stone'], [11, 6, 2, 'stone'], [11, 6, 3, 'stone']] });
    const est2 = estimateShot(walled, walled.unit('p0'), { unitId: walled.units.find(u => u.side === 'enemy').id, part: 'torso' }, { weapon: w, spread: 2, samples: 128 });
    assert.ok(est.hit > 0.3, `open hit ${est.hit}`);
    assert.ok(est2.hit < est.hit * 0.4, `walled ${est2.hit} vs ${est.hit}`);
    assert.ok(est2.cover > 0.5);
});

test('half cover protects the legs but not the head', () => {
    const b = arena({ walls: [[10, 5, 2, 'sandbag'], [9, 5, 2, 'sandbag'], [11, 5, 2, 'sandbag']] });
    const t = b.units.find(u => u.side === 'enemy');
    const legs = estimateShot(b, b.unit('p0'), { unitId: t.id, part: 'legs' }, { weapon: WEAPONS.longrifle, spread: 0.5, samples: 96 });
    const head = estimateShot(b, b.unit('p0'), { unitId: t.id, part: 'head' }, { weapon: WEAPONS.longrifle, spread: 0.5, samples: 96 });
    assert.ok(head.parts.head > 0.5, `head ${head.parts.head}`);
    assert.ok(legs.parts.legs < 0.2, `legs ${legs.parts.legs}`);
});

test('shots resolve deterministically: same seed and intents give the same hash', () => {
    const run = () => {
        const b = arena({ squad: ['grenadier'] });
        const t = b.units.find(u => u.side === 'enemy');
        b.apply({ type: 'shoot', unitId: 'p0', aim: { unitId: t.id, part: 'torso' } });
        return b.hash();
    };
    assert.equal(run(), run());
});

test('disabling an arm reduces accuracy; killing removes the unit and ends the battle', () => {
    const b = arena();
    const t = b.units.find(u => u.side === 'enemy');
    b.dealDamage(t, 'armR', 99, { pierce: 99 });
    assert.ok(t.parts.armR.disabled);
    assert.ok(b.log.some(e => e.t === 'disabled'));
    b.dealDamage(t, 'torso', 99, { pierce: 99 });
    assert.ok(t.dead);
    assert.equal(b.outcome?.winner, 'player');
});

test('overwatch fires at a unit that moves through the cone', () => {
    const b = arena({ squad: ['marksman'], enemies: [{ type: 'cultist', pos: { x: 10, y: 6, z: 1 } }] });
    b.unit('p0').weapon = 'handcannon';
    assert.ok(b.apply({ type: 'overwatch', unitId: 'p0', weaponId: 'handcannon', toward: { x: 10, y: 6 } }).ok);
    b.apply({ type: 'endTurn', side: 'player' });
    const e = b.units.find(u => u.side === 'enemy');
    e.alerted = true;
    const r = b.apply({ type: 'move', unitId: e.id, to: { x: 10, y: 9, z: 1 } });
    assert.ok(r.ok);
    assert.ok(b.log.some(x => x.t === 'reaction'), 'reaction shot');
});

test('a powder bomb destroys timber cover and damages units in the blast', () => {
    const b = arena({ squad: ['grenadier'], walls: [[10, 9, 2, 'timber'], [11, 9, 2, 'timber']], enemies: [{ type: 'cultist', pos: { x: 10, y: 8, z: 1 } }] });
    const e = b.units.find(u => u.side === 'enemy');
    const hp = e.hp;
    const r = b.apply({ type: 'throw', unitId: 'p0', itemId: 'powder_bomb', to: { x: 10, y: 9, z: 1 } });
    assert.ok(r.ok, r.reason);
    assert.ok(b.stats.voxelsDestroyed > 0);
    assert.ok(e.hp < hp || e.dead);
});

test('fire flask sets units burning; burning ticks at the start of their turn', () => {
    const b = arena({ squad: ['vanguard'], enemies: [{ type: 'brute', pos: { x: 10, y: 10, z: 1 } }] });
    const e = b.units.find(u => u.side === 'enemy');
    b.apply({ type: 'throw', unitId: 'p0', itemId: 'fire_flask', to: { x: 10, y: 10, z: 1 } });
    assert.ok(e.statuses.some(s => s.id === 'burning'));
    const hp = e.hp;
    b.apply({ type: 'endTurn', side: 'player' });
    assert.ok(e.hp < hp);
});

test('Proving Grounds: breach a bunker room — door opens, room revealed, defenders surprised', () => {
    const mission = buildProvingGrounds({ seed: 1 });
    const b = new Battle({ mission, squad: [{ type: 'vanguard' }, { type: 'warden' }], seed: 2 });
    const bunker = mission.buildings.find(x => x.id === 'bunker');
    const door = bunker.doors.find(d => d.exterior && d.side === 's');
    const outside = { x: door.x, y: door.y + 1, z: door.z };
    const a = b.unit('p0'), c = b.unit('p1');
    Object.assign(a, outside); Object.assign(c, { x: door.x - 1, y: door.y + 1, z: door.z });
    const points = b.breachPoints(a);
    assert.ok(points.length >= 1, 'breach point');
    const r = b.apply({ type: 'breach', unitId: 'p0', unitIds: ['p0', 'p1'], door: points[0], entry: 'door' });
    assert.ok(r.ok, r.reason);
    assert.ok(b.revealedRooms.has(points[0].roomId));
    assert.ok(b.log.some(e => e.t === 'cutin' && e.kind === 'breach'));
});

test('formations: shield line costs mobility, grants front-arc defense, and clustered units take bonus blast damage', () => {
    const b = arena({ squad: ['warden', 'warden', 'vanguard'], player: [{ x: 9, y: 16, z: 1 }, { x: 10, y: 16, z: 1 }, { x: 11, y: 16, z: 1 }] });
    const r = b.apply({ type: 'formation', template: 'shield_line', unitId: 'p1', leaderId: 'p1', memberIds: ['p1', 'p2', 'p0'], facing: 'n' });
    assert.ok(r.ok, r.reason);
    const u = b.unit('p1'), e = b.units.find(x => x.side === 'enemy');
    assert.ok(b.formations.mobilityPenalty(u) < 0);
    assert.ok(b.formations.defenseSpreadMult(u, e) > 1, 'front arc bonus');
    assert.ok(b.formations.isClustered(u));
});

test('AI plays a full Proving Grounds battle to completion or the round cap without errors', () => {
    const mission = buildProvingGrounds({ seed: 1 });
    const b = new Battle({ mission, squad: ['vanguard', 'grenadier', 'marksman', 'warden'].map(type => ({ type })), seed: 5, controllers: { player: 'ai', enemy: 'ai' } });
    for (let i = 0; i < 25 && !b.outcome; i++) { runAiSide(b, 'player', { formations: true }); if (!b.outcome) runAiSide(b, 'enemy'); }
    assert.ok(b.log.some(e => e.t === 'shot'));
    assert.ok(b.round > 1);
});

test('earth cover targets an empty supported tile, costs resources once and changes cover', () => {
    const b = arena({squad:['vanguard']}); const u=b.unit('p0');
    const cast={type:'ability',unitId:u.id,abilityId:'earth_cover',to:{x:10,y:15,z:1}};
    const before=[u.ap,u.will];
    const r=b.apply(cast); assert.ok(r.ok); assert.equal(b.store.get(10,15,2),MAT.drystone);
    assert.equal(u.ap,before[0]-1); assert.equal(u.will,before[1]-2);
    assert.ok(r.events.some(e=>e.t==='voxels'&&e.changes.length===1));
    assert.equal(b.apply(cast).reason,'occupied');
    assert.equal(b.apply({...cast,to:{x:u.x,y:u.y,z:u.z}}).reason,'occupied');
    assert.equal(b.apply({...cast,to:{x:1,y:1,z:1}}).reason,'out_of_range');
    assert.equal(b.apply({...cast,to:{x:NaN,y:15,z:1}}).reason,'bad_intent');
    assert.equal(b.apply({...cast,to:{x:11,y:15,z:3}}).reason,'unreachable');
});

test('water mend heals and extinguishes but cannot revive or repair a disabled limb', () => {
    const b=arena({squad:['grenadier','vanguard'],player:[{x:10,y:16,z:1},{x:11,y:16,z:1}]});
    const u=b.unit('p0'),t=b.unit('p1'); t.hp=25; t.parts.armL.hp=0;t.parts.armL.disabled=true; b.giveStatus(t,'burning',2);
    const cast={type:'ability',unitId:u.id,abilityId:'water_mend',targetId:t.id};
    assert.ok(b.apply(cast).ok);assert.equal(t.hp,30);assert.equal(t.parts.armL.disabled,true);assert.ok(!t.statuses.some(s=>s.id==='burning'));
    assert.equal(b.apply(cast).reason,'no_target');
    t.hp=20;t.down=true;assert.equal(b.apply(cast).reason,'no_target');
    assert.equal(b.apply({...cast,targetId:'e0'}).reason,'no_target');
});

test('overwatch rejects forged weapons and invalid directions, ignores enemies behind the wedge', () => {
    const b=arena({squad:['marksman']});const u=b.unit('p0');
    const intent={type:'overwatch',unitId:u.id,weaponId:'handcannon',toward:{x:10,y:6}};
    for(const toward of [{x:u.x,y:u.y},{x:Infinity,y:1},null]) assert.equal(b.apply({...intent,toward}).reason,'bad_intent');
    assert.equal(b.apply({...intent,weaponId:'repeater'}).reason,'bad_intent');
    assert.ok(b.apply(intent).ok);b.apply({type:'endTurn',side:'player'});
    const e=b.unit('e0');e.x=10;e.y=18;e.alerted=true;b.checkReactions(e,[e]);assert.equal(b.stats.reactions,0);
    e.x=10;e.y=12;b.checkReactions(e,[e]);assert.equal(b.stats.reactions,1);assert.ok(u.overwatch);
    b.checkReactions(e,[e]);assert.equal(b.stats.reactions,2);
});

test('elemental intents replay deterministically and blocked cover casts never spend resources', () => {
    const run=()=>{
        const b=arena({squad:['vanguard','grenadier'],player:[{x:10,y:16,z:1},{x:11,y:16,z:1}]});
        b.unit('p0').hp=18;
        assert.ok(b.apply({type:'ability',unitId:'p1',abilityId:'water_mend',targetId:'p0'}).ok);
        assert.ok(b.apply({type:'ability',unitId:'p0',abilityId:'earth_cover',to:{x:10,y:15,z:1}}).ok);
        return b.hash();
    };
    assert.equal(run(),run());
    const b=arena({squad:['vanguard'],walls:[[10,15,2,'stone'],[10,15,3,'stone']]});
    const u=b.unit('p0'),before=b.hash();
    assert.equal(b.apply({type:'ability',unitId:u.id,abilityId:'earth_cover',to:{x:10,y:14,z:1}}).reason,'no_target');
    assert.equal(b.hash(),before);
});

test('closed rooms require a kick, cost one AP, and remain revealed after closing', () => {
    const mission=buildProvingGrounds({seed:1});
    const b=new Battle({mission,squad:[{type:'vanguard'}],seed:2});
    const d=mission.buildings.find(x=>x.id==='bunker').doors.find(d=>d.exterior&&d.side==='s');
    const u=b.unit('p0');Object.assign(u,{x:d.x,y:d.y+1,z:d.z});
    const room=mission.store.roomAt(d.x,d.y-1,d.z+1);
    assert.ok(room>=0);assert.ok(!b.revealedRooms.has(room));
    assert.ok(!b.reach(u).costs.has(`${d.x},${d.y},${d.z}`),'movement cannot silently open door');
    const defender=b.unitsOf('enemy').find(e=>b.roomOf(e)===room);
    if(defender)assert.equal(b.sees(u,defender),false,'unrevealed room conceals enemies');
    const r=b.apply({type:'door',unitId:u.id,door:d});
    assert.ok(r.ok,r.reason);assert.equal(u.ap,3);assert.ok(b.revealedRooms.has(room));
    assert.ok(r.events.find(e=>e.t==='door').kicked);
    assert.ok(r.events.findIndex(e=>e.t==='reveal')>r.events.findIndex(e=>e.t==='door'));
    assert.ok(b.apply({type:'door',unitId:u.id,door:d}).ok);assert.equal(u.ap,2);
    assert.ok(b.revealedRooms.has(room));
    u.ap=0;assert.equal(b.apply({type:'door',unitId:u.id,door:d}).reason,'no_ap');
});

test('first contact scatters a pod once, deterministically, without spending its turn AP', () => {
    const run=()=>{
        const b=arena({player:[{x:2,y:22,z:1}],enemies:[{type:'cultist',pos:{x:22,y:2,z:1}}]});
        const e=b.unit('e0');assert.ok(!e.scattered);
        Object.assign(b.unit('p0'),{x:12,y:12,z:1});const ap=e.ap;
        b.updateVisibility();
        assert.ok(e.scattered);assert.equal(e.ap,ap);
        assert.equal(b.log.filter(e=>e.t==='discovery').length,1);
        const movement=b.log.find(e=>e.t==='move'&&e.scatter&&e.path.length>1);assert.ok(movement);
        assert.deepEqual(movement.path[0],{x:22,y:2,z:1},'scatter origin remains a snapshot');
        const origin={...movement.path[0]};e.x++;assert.deepEqual(movement.path[0],origin);e.x--;
        b.updateVisibility();assert.equal(b.log.filter(e=>e.t==='discovery').length,1);
        return b.hash();
    };
    assert.equal(run(),run());
});

test('finishing a soldier spends its remaining AP without ending the squad phase',()=>{
    const b=arena({squad:['vanguard','warden'],player:[{x:10,y:16,z:1},{x:11,y:16,z:1}]});
    b.unit('p0').moveOnlyAp=2;
    assert.ok(b.apply({type:'wait',unitId:'p0'}).ok);
    assert.equal(b.unit('p0').ap,0);assert.equal(b.unit('p0').moveOnlyAp,0);
    assert.equal(b.unit('p1').ap,4);assert.equal(b.activeSide,'player');
    assert.equal(b.apply({type:'wait',unitId:'p0'}).reason,'no_ap');
});

test('Earth Cover rejects low ceilings, landings, stairs and door aprons without spending resources',()=>{
 for(const setup of [s=>s.set(10,15,4,MAT.concrete),s=>s.set(10,15,1,MAT.grate),s=>s.set(11,15,1,MAT.steel_stair),s=>s.set(11,15,2,MAT.door_open),s=>s.set(11,15,2,MAT.ladder)]) {
  const b=arena({squad:['vanguard']}),u=b.unit('p0');setup(b.store);const before=b.hash();
  assert.equal(b.apply({type:'ability',unitId:u.id,abilityId:'earth_cover',to:{x:10,y:15,z:1}}).reason,'unreachable');assert.equal(b.hash(),before);
 }
});
test('movement keeps per-step spotting but computes interior vision only once at the end',()=>{
 const b=arena(),u=b.unit('p0');let vision=0,spotting=0;const update=b.updateInteriorVision.bind(b),visible=b.visibleTo.bind(b);
 b.updateInteriorVision=()=>{vision++;update();};b.visibleTo=side=>{spotting++;return visible(side);};
 const r=b.apply({type:'move',unitId:u.id,to:{x:10,y:9,z:1}});assert.ok(r.ok);assert.equal(vision,1);assert.ok(spotting>2);
});
test('Water Mend heals torso by the restored amount instead of resetting existing limb damage',()=>{
 const b=arena({squad:['grenadier']}),u=b.unit('p0');u.hp=20;u.parts.torso.hp=5;
 assert.ok(b.apply({type:'ability',unitId:u.id,abilityId:'water_mend',targetId:u.id}).ok);assert.equal(u.hp,28);assert.equal(u.parts.torso.hp,13);
});

test('Earth Cover cannot seal a real Signal House fire-escape landing or remove upper-floor access',async()=>{
 const {mapById}=await import('../mission/Maps.js'),{reachable,nodeKey}=await import('../world/PathSearch.js'),{AGENT_PROFILES}=await import('../world/TraversalRules.js');
 const mission=mapById('signal-house').build({seed:1}),b=new Battle({mission,squad:[{type:'vanguard'}],seed:1});
 const landing=mission.buildings[0].escapes[1].cells;const [x,y,z]=landing[0],stand=landing[1];Object.assign(b.unit('p0'),{x:stand[0],y:stand[1],z:stand[2]});
 const search=()=>reachable(b.store,b.unit('p0'),Infinity,AGENT_PROFILES.player),before=search();assert.ok(before.nodes.size>83);
 const hash=b.hash();assert.equal(b.apply({type:'ability',unitId:'p0',abilityId:'earth_cover',to:{x,y,z}}).reason,'unreachable');assert.equal(b.hash(),hash);
 assert.deepEqual([...search().costs.keys()].sort(),[...before.costs.keys()].sort());assert.ok(before.costs.has(nodeKey({x,y,z})));
});

test('walking and vaulting shatter traversed glazing without removing sill cover',()=>{
    const walk=arena({walls:[[10,15,2,'glass'],[10,15,3,'glass']]});
    const other=arena({walls:[[10,15,2,'glass'],[10,15,3,'glass']]});
    const intent={type:'move',unitId:'p0',to:{x:10,y:14,z:1}};
    const r=walk.apply(intent);assert.ok(r.ok);assert.ok(r.events.some(e=>e.t==='voxels'));
    assert.equal(walk.store.get(10,15,2),AIR);assert.equal(walk.store.get(10,15,3),AIR);
    assert.equal(walk.stats.voxelsDestroyed,2);assert.ok(other.apply(intent).ok);assert.equal(other.hash(),walk.hash());
    const vault=arena({walls:[[10,15,2,'drystone'],[10,15,3,'glass']]});
    assert.ok(vault.apply(intent).ok);assert.equal(vault.store.get(10,15,2),MAT.drystone);assert.equal(vault.store.get(10,15,3),AIR);
});
