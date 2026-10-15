import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { footprint } from './IntelOps.js';
import { WEAPONS } from '../content/weapons.js';
function arena(type='vanguard',enemyType='cultist') {
    const store=new VoxelStore(32,32,8);
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){store.set(x,y,0,MAT.bedrock);store.set(x,y,1,MAT.grass);}
    return new Battle({mission:{id:'intel',store,rooms:[],buildings:[],spawns:{player:[{x:8,y:16,z:1},{x:6,y:16,z:1}],enemy:[{type:enemyType,pos:{x:8,y:8,z:1},facing:'n'}]}},squad:[{type,owner:'P1'},{type:'marksman',owner:'P2'}],intel:true,asyncCoop:true});
}
test('personal turn refresh preserves teammates AP, buffs and status duration',()=>{
    const b=arena(),p=b.unit('p1');b.unit('p0').ap=0;p.ap=1;p.buffs.quickAim=true;p.statuses=[{id:'suppressed',rounds:2}];
    assert.ok(b.apply({type:'personalEnd',owner:'P1'}).ok);
    assert.ok(b.apply({type:'endTurn',side:'enemy'}).ok);
    assert.equal(b.unit('p0').ap,4);assert.equal(p.ap,1);assert.equal(p.buffs.quickAim,true);assert.equal(p.statuses[0].rounds,2);assert.equal(b.personalTurns.P1,1);
});
test('seismic contact through walls is shared intel but cannot target an unseen enemy',()=>{
    const b=arena();for(let x=0;x<32;x++)for(let z=2;z<6;z++)b.store.set(x,12,z,MAT.stone);
    const before=b.unit('e0').alerted;
    assert.ok(b.apply({type:'ability',unitId:'p0',abilityId:'seismic_sense',by:'P1'}).ok);
    assert.equal(b.contacts.e0.source,'seismic_sense');assert.equal(b.unit('e0').alerted,before);
    assert.equal(b.apply({type:'shoot',unitId:'p0',aim:{unitId:'e0'}}).reason,'no_target');
});
test('water sense selects only enemies adjacent to water',()=>{
    const b=arena('grenadier');b.store.set(9,8,1,MAT.water);
    assert.ok(b.apply({type:'ability',unitId:'p0',abilityId:'water_sense'}).ok);assert.ok(b.contacts.e0);
    const dry=arena('grenadier');assert.ok(dry.apply({type:'ability',unitId:'p0',abilityId:'water_sense'}).ok);assert.equal(dry.contacts.e0,undefined);
});
test('drone scouts without detection at ordinary distance; hunters detect from farther away',()=>{
    for(const [type,detected] of [['cultist',false],['archer',true]]){
        const b=arena('marksman',type);assert.ok(b.apply({type:'ability',unitId:'p0',abilityId:'scout_drone',to:{x:8,y:12,z:1}}).ok);
        assert.equal(b.drones.P1.active,!detected);assert.equal(b.detected,detected);if(!detected)assert.ok(b.contacts.e0);
    }
});
test('quiet cut opens wall without alerting a guard facing away',()=>{
    const b=arena('warden');for(let z=2;z<=3;z++)b.store.set(8,14,z,MAT.stone);
    assert.ok(b.apply({type:'ability',unitId:'p0',abilityId:'quiet_cut',to:{x:8,y:14,z:1}}).ok);
    assert.equal(b.store.get(8,14,2),AIR);assert.equal(b.unit('e0').alerted,false);assert.equal(b.detected,false);
});
test('support validates choice (no detection gate), carves deterministic terrain and recharges on personal turns',()=>{
    const a=arena(),b=arena();const intent={type:'ability',unitId:'p0',abilityId:'orbital_laser',to:{x:22,y:20,z:1}};
    for(const battle of [a,b]){
        battle.supportChoices.P1='orbital_laser';assert.equal(battle.detected,false,'ready before detection (PLAN-07)');
        assert.ok(battle.apply(intent).ok);assert.equal(battle.store.get(22,20,1),AIR);assert.equal(battle.store.get(22,20,0),MAT.bedrock);
        assert.equal(battle.apply(intent).reason,'support_cooldown');
        battle.personalTurns.P1=9;assert.equal(battle.apply(intent).reason,'support_cooldown');battle.personalTurns.P1=10;assert.ok(battle.apply(intent).ok);
    }
    assert.equal(a.hash(),b.hash());assert.equal(a.apply({...intent,abilityId:'carpet_bomb'}).reason,'bad_intent');
    assert.ok(footprint(a,'carpet_bomb',{x:16,y:16,z:1}).some(c=>c.x===20&&c.y===19));
});
test('high precision only receives explicit debuffs',()=>{
    const b=arena(),u=b.unit('p0'),w=WEAPONS.blunderbuss,point={x:8,y:8,h:3};
    const clean=b.spreadFor(u,w,point);u.stress=100;u.accuracy=.1;assert.equal(b.spreadFor(u,w,point).spread,clean.spread);
    u.statuses.push({id:'suppressed',rounds:2});assert.equal(b.spreadFor(u,w,point).spread,clean.spread*2);
});

test('support has friendly fire, and deployed drones can be detected later',()=>{
    const strike=arena();strike.supportChoices.P1='carpet_bomb';strike.detected=true;
    assert.ok(strike.apply({type:'ability',unitId:'p0',abilityId:'carpet_bomb',to:{x:6,y:16,z:1}}).ok);
    assert.ok(strike.unit('p1').dead||strike.unit('p1').down,'friendly inside footprint is hit');
    const drone=arena('marksman');assert.ok(drone.apply({type:'ability',unitId:'p0',abilityId:'scout_drone',to:{x:8,y:12,z:1}}).ok);
    drone.unit('e0').y=11;drone.afterAction();assert.equal(drone.drones.P1.active,false);assert.equal(drone.detected,true);
});
