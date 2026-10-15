import { reserveAmmo, consumeAmmo, inventoryMove, equipCargo, grantTestArsenal, itemCount, consumeItem, syncItems } from '../inventory/Equipment.js';
import { fireModes, roundsFor, weaponBuild, projectileDamage } from './FireControl.js';
import { validateMark, putMark, settleMarks } from './Markers.js';
import { WALKERS, occupiedCells, walkerReach, walkerFits, fitWalkerSpawn } from './Walker.js';
import { validateIntel, executeIntel, intelSpread, refreshDrones } from './IntelOps.js';
import { normalizeInventory } from '../inventory/Inventory.js';
import { watchSector, inWatchSector, watchWeapon } from './WatchSector.js';
import { LightField } from '../lighting/LightField.js';
// The deterministic battle engine (PLAN-01 rev 2 §9–§14).
//
// Pure shared code: no DOM, no THREE, no Math.random, no Date.now. The client previews with it, the
// server (lockstep room) orders intents, every peer applies the same intents in the same order and
// reaches the same state hash. AI, the balance sim and tests drive the same `apply()`.
//
// Phoenix Point: 4 AP, free aim at body parts, ballistic projectiles, part damage and disabling, Will.
// XCOM 2: side phases, cover readout, flanking, overwatch, grenades, concealed pods.
// Chaos Zero Nightmare: Stress and Breakdown, and the "back shot" cut-in event on every committed action.
import { createRng, hashString } from '../util/Rng.js';
import { reachable, pathTo, nodeKey, stepKind, isWindowVault } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { MAT, AIR, materialById } from '../voxel/Materials.js';
import { castRay, fitArc, blocksSight } from '../voxel/Raycast.js';
import { damageVoxel, explodeVoxels, settleUnsupported, groundFloorLevels, scorchBlast } from '../voxel/Destruction.js';
import { coverAgainst, COVER } from '../voxel/Cover.js';
import { ElementField, elementStatusesFor, STATUS_DEFS } from '../elements/Elements.js';
import { WEAPONS, THROWABLES } from '../content/weapons.js';
import { ABILITIES } from '../content/units.js';
import { B } from '../content/balance.js';
import { createUnit, alive, hasStatus, addStatus, removeStatus, accuracyMult, mobilityPerAp, partArmor, facingToward, FACING_VEC, EYE, CHEST } from './Units.js';
import { estimateShot, chooseMuzzle, occupiedBy, sampleCone, traceProjectile, aimPointOf, partCentre } from './Ballistics.js';
import { Formations } from './Formations.js';
import { validateDebug, applyDebug } from './DebugOps.js';
import { createObjective, inZone, extractionOpen } from './Objectives.js';

export const REJECT = Object.freeze(['not_your_turn', 'not_your_unit', 'unit_down', 'no_ap', 'unreachable', 'occupied', 'no_ammo', 'out_of_range',
    'no_item', 'no_target', 'bad_intent', 'no_will', 'battle_over', 'no_door', 'not_adjacent', 'formation_invalid', 'not_in_zone']);

const PROFILE = AGENT_PROFILES.player;

export class Battle {
    /**
     * @param {{ mission, squad: {type, owner?, name?}[], seed, controllers? }} o
     * mission: { store, rooms, buildings, spawns: { player: pos[], enemy: {pos, type, group}[] }, name, id }
     */
    constructor({ mission, squad, seed = 1, controllers = { player: 'human', enemy: 'ai' }, enemies = null, debug = false, intel = false, asyncCoop = false, support = 'carpet_bomb', testArsenal = false }) {
        this.intelMode=intel; this.asyncCoop=asyncCoop; this.personalTurns={}; this.supportReady={}; this.supportChoices={player:support || 'carpet_bomb'}; this.contacts={}; this.markers=[];this.supportUsed=0; this.strikeReadyAt=1; this.drones={}; this.detected=false; this.refreshOwner=null;
        this.mission = mission;
        this.debugEnabled = !!debug;
        this.store = mission.store;
        this.grenadeGroundLevels = groundFloorLevels(mission);
        // Ground can carry fire hazards, but secondary flames must not burn away the protected floor.
        this.field = new ElementField(this.store, { canBurn: (x, y, z) => z > this.grenadeGroundLevels[x + y * this.store.width] });
        this.light=new LightField(this.store,{timeOfDay:mission.meta?.timeOfDay||'day',decor:mission.visual?.decor||[],fires:this.field.fires});
        this.seed = seed;
        this.rng = createRng(hashString(`battle:${seed}:${mission.id || mission.name || ''}`));
        this.controllers = { ...controllers };
        this.units = [];
        this.round = 1;
        this.activeSide = 'player';
        this.seq = 0;
        this.log = [];
        this.outcome = null;
        this.objective = createObjective(mission.objective);
        this.revealedRooms = new Set();
        this.formations = new Formations(this);
        this.stats = { weapons: {}, throwables: {}, voxelsDestroyed: 0, fires: 0, breaches: 0, reactions: 0, formations: {}, undergroundSteps:0,drops:0,flankSteps:0 };
        // Flank cells well off the main line of play (PLAN-04): the sim reports how often squads actually flank.
        const main=(mission.meta?.lineOfPlay?.main||[]);
        this.flankCells=new Set((mission.meta?.flanks||[]).flatMap(f=>f.cells).filter(([x,y])=>!main.some(([a,b])=>Math.max(Math.abs(a-x),Math.abs(b-y))<3)).map(([x,y])=>`${x},${y}`));
        const ps = mission.spawns.player;
        squad.forEach((s, i) => {
            const pos = ps[i % ps.length];
            const u=createUnit(s.type,'player',pos,`p${i}`,{owner:s.owner||'player',name:s.name});
            if(s.inventory){u.inventory=normalizeInventory(s.inventory);syncItems(u);}
            if(testArsenal)grantTestArsenal(u);
            this.units.push(u);
        });
        (enemies || mission.spawns.enemy).forEach((e, i) => {
            this.units.push(createUnit(e.type, 'enemy', e.pos, `e${i}`, { group: e.group ?? 0, facing: e.facing || 's', extra: e.alerted ? { alerted: true, scattered: true } : undefined }));
        });
        for(const u of this.units)if(WALKERS[u.type]){fitWalkerSpawn(this,u);u.footprint=occupiedCells(u,{x:u.x,y:u.y,z:u.z},this.store);}
        this.startSide('player', true);
        for(const u of this.unitsOf('player')) this.revealRoom(this.roomOf(u),u);
        this.updateVisibility({initial:true});
    }

    // ---------------------------------------------------------------- queries
    unit(id) { return this.units.find(u => u.id === id) || null; }
    unitsOf(side) { return this.units.filter(u => u.side === side && alive(u)); }
    enemiesOf(u) { return this.units.filter(o => o.side !== u.side && alive(o)); }
    occupant(x, y, z) { return this.units.find(u => alive(u) && occupiedCells(u).some(c=>c.x===x&&c.y===y&&c.z===z)) || null; }
    eye(u) { return { x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1 + (WALKERS[u.type]?WALKERS[u.type].height+.2:EYE) }; }
    chest(u) { return { x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1 + (WALKERS[u.type]?.height??CHEST) }; }
    roomOf(u) { return this.store.roomAt(u.x, u.y, u.z + 1); }
    distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.8); }

    /** Line of sight for spotting: opaque voxels and smoke block. */
    sightLine(from, to) {
        const r = castRay(this.store, from, to, { blocks: (s, x, y, z) => blocksSight(s, x, y, z) || this.field.isSmoke(x, y, z) });
        return !r.hit;
    }
    sees(a, b) {
        if (this.distance(a, b) > B.sightRange) return false;
        const e = this.eye(a);
        return this.sightLine(e, { x: b.x + 0.5, y: b.y + 0.5, h: b.z + 1 + 1.5 }) || this.sightLine(e, this.chest(b));
    }
    visibleEnemies(u) { return this.enemiesOf(u).filter(o => this.sees(u, o)); }
    /** Enemies of `side` that any unit of `side` can see (fog of war). */
    visibleTo(side) {
        const out = new Set();
        for (const u of this.unitsOf(side)) for (const o of this.enemiesOf(u)) if (!out.has(o.id) && this.sees(u, o)) out.add(o.id);
        return out;
    }

    protectedCoverTile(t) {
        const s=this.store;
        // Grated landings and stair approaches are circulation, never combat cover sites.
        if(s.get(t.x,t.y,t.z)===MAT.grate)return true;
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=2;dz++) {
            const m=s.material(t.x+dx,t.y+dy,t.z+dz);
            if(m.part===4 || m.id===MAT.ladder || m.id===MAT.door || m.id===MAT.door_open)return true;
        }
        return false;
    }

    moveBudget(u) { return this.formations.groupBudget(u)??((u.ap + u.moveOnlyAp) * this.mobility(u)); }
    mobility(u) { return mobilityPerAp(u, this.formations.mobilityPenalty(u)); }
    reach(u, budget = this.moveBudget(u)) {
        if(WALKERS[u.type])return walkerReach(this,u,budget);
        return reachable(this.store, { x: u.x, y: u.y, z: u.z }, budget, PROFILE, {
            blocked: to => { const o = this.occupant(to.x, to.y, to.z); return (o && o.id !== u.id) || (u.side==='player' && (this.store.get(to.x,to.y,to.z+1)===MAT.door)); }
        });
    }
    apForCost(u, cost) { return cost <= 0 ? 0 : Math.ceil(cost / this.mobility(u) - 1e-9); }

    /** Spread in degrees for a shot, with every modifier listed for the HUD. */
    spreadFor(shooter, weapon, aimPoint, { reaction = false, breach = false, target = null } = {}) {
        if(this.intelMode)return intelSpread(shooter,weaponBuild(shooter,weapon),this,target);
        weapon=weaponBuild(shooter,weapon);
        const mods = [];
        let s = weapon.spread / Math.max(0.2, accuracyMult(shooter));
        mods.push(['accuracy', +(1 / Math.max(0.2, accuracyMult(shooter))).toFixed(2)]);
        const dist = Math.hypot(aimPoint.x - (shooter.x + 0.5), aimPoint.y - (shooter.y + 0.5));
        if (dist > weapon.range) { const k = 1 + (dist - weapon.range) / weapon.range * B.rangeFalloff; s *= k; mods.push(['range', +k.toFixed(2)]); }
        if (reaction) { const k = this.formations.reactionSpreadMult(shooter) ?? B.reactionSpreadMult; s *= k; mods.push(['reaction', k]); }
        if (breach) { const k = 1 / (B.breachAccuracyMult * this.formations.breachAccuracyMult(shooter)); s *= k; mods.push(['breach', +k.toFixed(2)]); }
        if (shooter.buffs.deadeye) { s *= 0.5; mods.push(['deadeye', 0.5]); }
        if (target) {
            if (shooter.z - target.z >= 2) { s *= B.heightAccuracyBonus; mods.push(['height', B.heightAccuracyBonus]); }
            const room = this.roomOf(target), rec = this.mission.rooms?.[room];
            if(this.mission.meta?.imageGenerated&&dist>4&&this.light.dark(target.x,target.y,target.z)){s*=B.darkSpreadMult;mods.push(['darkness',B.darkSpreadMult]);}
            if (!this.mission.meta?.imageGenerated && room >= 0 && rec && !rec.lit && this.roomOf(shooter) !== room) { s *= B.dimRoomSpreadMult; mods.push(['dim room', B.dimRoomSpreadMult]); }
            const k = this.formations.defenseSpreadMult(target, shooter);
            if (k !== 1) { s *= k; mods.push(['formation', +k.toFixed(2)]); }
            if (this.field.isSmoke(target.x, target.y, target.z + 1) || this.field.isSmoke(target.x, target.y, target.z + 2)) { s *= B.smokeSpreadMult; mods.push(['smoke', B.smokeSpreadMult]); }
        }
        return { spread: s, mods };
    }

    // ---------------------------------------------------------------- preview (no side effects)
    preview(intent) {
        const u = this.unit(intent.unitId);
        const why = this.validate(intent);
        if (why) return { ok: false, reason: why };
        switch (intent.type) {
            case 'move': {
                const search = this.reach(u);
                const k = nodeKey(intent.to);
                const cost = search.costs.get(k);
                return { ok: true, path: pathTo(search, k), cost, ap: this.apForCost(u, cost), cover: coverAgainstAll(this, intent.to, u) };
            }
            case 'shoot': {
                const w = WEAPONS[intent.weaponId || u.weapon];
                const target = intent.aim.unitId ? this.unit(intent.aim.unitId) : null;
                const aimPoint = aimPointOf(this, intent.aim);
                const { spread, mods } = this.spreadFor(u, w, aimPoint, { target });
                const est = estimateShot(this, u, intent.aim, { weapon: w, spread, samples: B.estimateSamples });
                const cover = target ? coverAgainst(this.store, target.x, target.y, target.z, u.x, u.y, u.z) : null;
                return { ok: true, ap: this.shotAp(u, w), estimate: est, mods, cover, flanked: target ? cover === COVER.NONE : false };
            }
            case 'throw': {
                const t = THROWABLES[intent.itemId];
                const arc = this.throwArc(u, intent.to);
                return { ok: true, ap: t.ap, arc, radius: t.radius };
            }
            default: return { ok: true };
        }
    }
    shotAp(u, w) { return Math.max(1, w.ap - (u.buffs.quickAim ? 1 : 0)); }
    /**
     * PLAN-07 ! alerts. Steps of a planned path that a *known* enemy overwatch would fire on: the watcher is visible to
     * the mover's side, the cell is inside its sector and in its sight. Returns [{ index, x, y, z, watcherId }].
     */
    overwatchThreats(u, path) {
        const out = [];
        const watchers = this.enemiesOf(u).filter(w => alive(w) && w.overwatch && !hasStatus(w, 'surprised') && (u.side !== 'player' || this.visible?.has(w.id)));
        if (!watchers.length) return out;
        (path || []).forEach((c, index) => {
            if (index === 0) return;
            for (const w of watchers) {
                if (!inWatchSector(w, w.overwatch, c)) continue;
                if (!this.sightLine(this.eye(w), { x: c.x + 0.5, y: c.y + 0.5, h: c.z + 1 + 1.05 })) continue;
                out.push({ index, x: c.x, y: c.y, z: c.z, watcherId: w.id }); break;
            }
        });
        return out;
    }
    /** Visible enemies that have this unit flanked (no cover on any face toward them) and within their sight range. */
    flankedBy(u) {
        if (!alive(u)) return [];
        return this.enemiesOf(u).filter(e => alive(e) && (u.side !== 'player' || this.visible?.has(e.id)) && this.distance(e, u) <= B.sightRange
            && coverAgainst(this.store, u.x, u.y, u.z, e.x, e.y, e.z) === COVER.NONE && this.sees(e, u));
    }
    /**
     * AP a soldier must still have after a move for the tile to be blue: enough to fire the equipped gun or to put it
     * on overwatch (PLAN-07 §4.5). A melee weapon in hand counts as itself; with no loaded gun, the cheapest action.
     */
    blueAp(u) {
        const w = WEAPONS[u.weapon], ow = WEAPONS[watchWeapon(u)];
        if (w?.kind === 'melee') return w.ap;
        if (ow && (u.ammo[ow.id] ?? 0) >= (ow.perShot || 1)) return Math.max(this.shotAp(u, ow), ow.ap);
        let best = Infinity;
        for (const id of u.weapons) {
            const x = WEAPONS[id];
            if (x.kind === 'melee') best = Math.min(best, x.ap);
            else if ((u.ammo[id] ?? 0) >= (x.perShot || 1)) best = Math.min(best, this.shotAp(u, x));
            else if (x.ammo && reserveAmmo(u, x) > 0) best = Math.min(best, x.reloadAp);
        }
        for (const [id, n] of Object.entries(u.items || {})) if (n > 0 && THROWABLES[id]) best = Math.min(best, THROWABLES[id].ap);
        return Number.isFinite(best) ? best : 1;
    }

    validate(intent) {
        if (this.outcome) return 'battle_over';
        if (intent.type === 'endTurn') return intent.side === this.activeSide ? null : 'not_your_turn';
        if (intent.type === 'personalEnd') return this.asyncCoop && this.activeSide==='player' && (!intent.by || intent.by==='*' || intent.by===intent.owner) && this.unitsOf('player').some(u=>u.owner===intent.owner) ? null : 'bad_intent';
        if (intent.type === 'owners') return intent.owners && typeof intent.owners === 'object' ? null : 'bad_intent';
        if (intent.type === 'debug') return validateDebug(this, intent);
        const u = this.unit(intent.unitId || (intent.type === 'formation_break' ? this.formations.list.get(intent.formationId)?.leaderId : null));
        if (!u) return 'bad_intent';
        if (!alive(u)) return 'unit_down';
        if (u.side !== this.activeSide) return 'not_your_turn';
        if (intent.by && intent.by !== '*' && u.owner !== intent.by) return 'not_your_unit';
        switch (intent.type) {
            case 'move': {
                const group = intent.group && this.formations.of(u);
                if (group && intent.by && intent.by !== '*' && this.formations.members(group).some(m => m.owner !== intent.by)) return 'not_your_unit';
                const t = intent.to; if (!t) return 'bad_intent';
                const o = this.occupant(t.x, t.y, t.z); if (o && o.id !== u.id) return 'occupied';
                if(WALKERS[u.type] && occupiedCells(u,t,this.store).some(c=>{const v=this.occupant(c.x,c.y,c.z);return v&&v.id!==u.id;}))return 'occupied';
                const cost = this.reach(u).costs.get(nodeKey(t));
                if (cost == null) return this.reach(u, this.moveBudget(u) * 4 + 8).costs.has(nodeKey(t)) ? 'no_ap' : 'unreachable';
                if (this.apForCost(u, cost) > u.ap + u.moveOnlyAp) return 'no_ap';
                return null;
            }
            case 'shoot': {
                const w = WEAPONS[intent.weaponId || u.weapon];
                if (!w || !u.weapons.includes(w.id) || w.kind !== 'ballistic') return 'bad_intent';
                if (u.ap < this.shotAp(u, w)) return 'no_ap';
                if ((u.ammo[w.id] ?? 0) < 1) return 'no_ammo';
                if(intent.fireMode&&!fireModes(w).includes(intent.fireMode))return 'bad_intent';
                if (intent.suppress) return 'bad_intent'; // Suppression is a paid ability, never a shot flag.
                if (!intent.aim || (!intent.aim.point && !this.unit(intent.aim.unitId))) return 'no_target';
                if (intent.aim.unitId) {
                    const target = this.unit(intent.aim.unitId);
                    if (!target || !alive(target) || !this.visibleTo(u.side).has(target.id)) return 'no_target';
                }
                const p = aimPointOf(this, intent.aim);
                if(!p||![p.x,p.y,p.h].every(Number.isFinite))return 'bad_intent';
                if (Math.hypot(p.x - u.x - 0.5, p.y - u.y - 0.5) > weaponBuild(u,w).maxRange) return 'out_of_range';
                return null;
            }
            case 'melee': {
                const w = WEAPONS[intent.weaponId || u.weapons.find(id => WEAPONS[id].kind === 'melee')];
                if (!w || w.kind !== 'melee' || !u.weapons.includes(w.id)) return 'bad_intent';
                if (u.ap < w.ap) return 'no_ap';
                const t = this.unit(intent.targetId); if (!t || !alive(t)) return 'no_target';
                if (Math.min(...occupiedCells(u).flatMap(a=>occupiedCells(t).map(c=>Math.max(Math.abs(a.x-c.x),Math.abs(a.y-c.y))))) > 1 || Math.abs(t.z - u.z) > 1) return 'not_adjacent';
                return null;
            }
            case 'throw': {
                const t = THROWABLES[intent.itemId];
                if (!t || t.kind==='gadget' || !itemCount(u,t.id,intent.cargo)) return 'no_item';
                if (u.ap < t.ap) return 'no_ap';
                const to = intent.to; if (!to) return 'bad_intent';
                if (Math.hypot(to.x - u.x, to.y - u.y) > t.range + 0.01) return 'out_of_range';
                return null;
            }
            case 'overwatch': {
                const w = WEAPONS[intent.weaponId || u.weapon];
                if (!w || w.kind !== 'ballistic' || !u.weapons.includes(w.id) || !watchSector(u, intent.toward, w.id)) return 'bad_intent';
                if (u.ap < w.ap) return 'no_ap';
                if ((u.ammo[w.id] ?? 0) < 1) return 'no_ammo';
                return null;
            }
            case 'setFireMode': {const w=WEAPONS[intent.weaponId||u.weapon];return w&&u.weapons.includes(w.id)&&fireModes(w).includes(intent.mode)?null:'bad_intent';}
            case 'inventoryMove': return inventoryMove(u,intent)?'bad_intent':null;
            case 'equipCargo': return equipCargo(u,intent)?'bad_intent':null;
            case 'mark': return validateMark(this,u,intent);
            case 'reload': { const w = WEAPONS[intent.weaponId || u.weapon]; if (!w?.ammo || w.boltAction || !u.weapons.includes(w.id)||u.ammo[w.id]>=w.ammo) return 'bad_intent'; if(reserveAmmo(u,w)<1)return 'no_ammo';return u.ap < w.reloadAp ? 'no_ap' : null; }
            case 'gadget': {const item=THROWABLES[intent.itemId],target=this.unit(intent.targetId);
                if(item?.kind!=='gadget'||!itemCount(u,item.id,intent.cargo))return 'no_item';
                if(u.ap<item.ap)return 'no_ap';
                if(!target||!alive(target)||target.side!==u.side||target.hp>=target.maxHp)return 'no_target';
                return this.distance(u,target)<=item.range && this.sees(u,target)?null:'out_of_range';}
            case 'wait': return u.ap + u.moveOnlyAp > 0 ? null : 'no_ap';
            case 'switchWeapon': return u.weapons.includes(intent.weaponId) ? null : 'bad_intent';
            case 'ability': {
                const a = ABILITIES[intent.abilityId];
                if (!a || !(u.abilities.includes(a.id)||(a.support && this.intelMode)||(a.commander&&u.side==='player'))) return 'bad_intent';
                if (u.will < a.wp) return 'no_will';
                if (u.ap < a.ap) return 'no_ap';
                if (hasStatus(u, 'panicked')) return 'no_will';
                if(a.commander){const t=intent.to;if(!t||![t.x,t.y,t.z].every(Number.isInteger)||!this.store.inBounds(t.x,t.y,t.z)||this.distance(u,t)>a.range)return 'out_of_range';if(this.round<this.strikeReadyAt)return 'support_cooldown';}
                if(a.intel)return validateIntel(this,u,intent);
                if (a.id === 'earth_cover') {
                    const t = intent.to;
                    if (!t || ![t.x, t.y, t.z].every(Number.isInteger) || !this.store.inBounds(t.x, t.y, t.z + 2)) return 'bad_intent';
                    if (this.distance(u, t) > a.range) return 'out_of_range';
                    if (this.occupant(t.x, t.y, t.z) || this.store.get(t.x,t.y,t.z+1) !== AIR || this.store.get(t.x,t.y,t.z+2) !== AIR) return 'occupied';
                    if (!this.store.surfaces(t.x,t.y).some(c => c.z === t.z && c.headroom >= 2) || this.store.material(t.x,t.y,t.z).liquid) return 'unreachable';
                    // The block is non-walkable: vaulting needs two empty voxels above it.
                    if (this.store.get(t.x,t.y,t.z+3)!==AIR || this.protectedCoverTile(t)) return 'unreachable';
                    if (!this.sightLine(this.eye(u), {x:t.x+.5,y:t.y+.5,h:t.z+1.5})) return 'no_target';
                }
                if (a.id === 'water_mend') {
                    const t = this.unit(intent.targetId);
                    if (!t || !alive(t) || t.side !== u.side || (t.hp >= t.maxHp && !hasStatus(t,'burning'))) return 'no_target';
                    if (this.distance(u,t) > a.range) return 'out_of_range';
                    if (!this.sees(u,t)) return 'no_target';
                }
                if (a.id === 'suppress') {
                    if (!u.weapons.includes('repeater')) return 'bad_intent';
                    const target = this.unit(intent.targetId), w = WEAPONS.repeater;
                    if (!target || !alive(target) || !this.visibleTo(u.side).has(target.id)) return 'no_target';
                    if ((u.ammo[w.id] ?? 0) < 1) return 'no_ammo';
                    if (Math.hypot(target.x - u.x, target.y - u.y) > w.maxRange) return 'out_of_range';
                }
                return null;
            }
            case 'door': {
                const d = intent.door; if (!d) return 'no_door';
                const id = this.store.get(d.x, d.y, d.z + 1);
                if (id !== MAT.door && id !== MAT.door_open) return 'no_door';
                if (Math.max(Math.abs(d.x - u.x), Math.abs(d.y - u.y)) > 1 || Math.abs(d.z - u.z) > 1) return 'not_adjacent';
                if (u.ap < 1) return 'no_ap';
                return null;
            }
            case 'breach': return this.validateBreach(intent);
            case 'formation_plan': return this.formations.validatePlan(intent);
            case 'formation': return this.formations.validate(intent);
            case 'formation_break': {
                const f = this.formations.list.get(intent.formationId);
                if (!f || !f.members.includes(u.id)) return 'formation_invalid';
                if (intent.by && intent.by !== '*' && this.formations.members(f).some(m => m.owner !== intent.by)) return 'not_your_unit';
                return null;
            }
            case 'face': return null;
            case 'extract': {
                if (!extractionOpen(this.objective) || u.side !== 'player') return 'bad_intent';
                if (!inZone(this.objective.zone, u)) return 'not_in_zone';
                return u.ap < 1 ? 'no_ap' : null;
            }
            case 'recover': {
                const it = this.objective.kind === 'recover' && u.side === 'player' ? this.objective.item : null;
                if (!it || it.carrier || it.secured) return 'no_target';
                if (Math.max(Math.abs(it.x - u.x), Math.abs(it.y - u.y)) > 1 || Math.abs(it.z - u.z) > 1) return 'not_adjacent';
                return u.ap < 1 ? 'no_ap' : null;
            }
            default: return 'bad_intent';
        }
    }

    // ---------------------------------------------------------------- apply
    /** Apply one intent. Returns { ok, reason?, events }. */
    apply(intent) {
        const why = this.validate(intent);
        if (why) return { ok: false, reason: why, events: [] };
        const start = this.log.length;
        const u = this.unit(intent.unitId);
        switch (intent.type) {
            case 'personalEnd': this.refreshOwner=intent.owner; this.personalTurns[intent.owner]=(this.personalTurns[intent.owner]||0)+1; this.endTurn('player'); break;
            case 'endTurn': this.endTurn(intent.side); break;
            case 'debug': applyDebug(this, intent); break;
            case 'owners': Object.assign(this.supportChoices,intent.supports||{}); for (const [id, owner] of Object.entries(intent.owners)) { const x = this.unit(id); if (x && x.side === 'player') x.owner = owner; } this.emit({ t: 'owners', owners: intent.owners }); break;
            case 'move': this.doMove(u, intent.to); if (intent.group) this.formations.follow(u); break;
            case 'shoot': this.doShoot(u, intent); break;
            case 'melee': this.doMelee(u, intent); break;
            case 'throw': this.doThrow(u, intent); break;
            case 'overwatch': this.doOverwatch(u, intent); break;
            case 'reload': { const w = WEAPONS[intent.weaponId || u.weapon]; const n=Math.min(w.ammo-u.ammo[w.id],reserveAmmo(u,w));u.ap -= w.reloadAp; u.ammo[w.id] += consumeAmmo(u,w,n); this.emit({ t: 'reload', unitId: u.id, weaponId: w.id,rounds:n }); break; }
            case 'setFireMode': u.fireModes[intent.weaponId||u.weapon]=intent.mode;this.emit({t:'fireMode',unitId:u.id,mode:intent.mode});break;
            case 'inventoryMove': inventoryMove(u,intent,true);this.emit({t:'inventory',unitId:u.id});break;
            case 'equipCargo': equipCargo(u,intent,true);this.emit({t:'inventory',unitId:u.id});break;
            case 'mark': putMark(this,u,intent);break;
            case 'gadget': {const item=THROWABLES[intent.itemId],target=this.unit(intent.targetId),amount=Math.min(item.heal,target.maxHp-target.hp);u.ap-=item.ap;consumeItem(u,item.id,intent.cargo);target.hp+=amount;if(!target.parts.torso.disabled)target.parts.torso.hp=Math.min(target.parts.torso.max,target.parts.torso.hp+amount);this.emit({t:'heal',unitId:target.id,sourceId:u.id,itemId:item.id,amount});break;}
            case 'wait': u.ap=0;u.moveOnlyAp=0;this.emit({t:'wait',unitId:u.id});break;
            case 'switchWeapon': u.weapon = intent.weaponId; this.emit({ t: 'weapon', unitId: u.id, weaponId: u.weapon }); break;
            case 'ability': this.doAbility(u, intent); break;
            case 'door': this.doDoor(u, intent.door); break;
            case 'breach': this.doBreach(intent); break;
            case 'formation_plan': this.formations.plan(intent);break;
            case 'formation': this.formations.declare(intent); break;
            case 'formation_break': this.formations.dissolve(intent.formationId, 'ordered'); break;
            case 'face': u.facing = intent.facing; this.emit({ t: 'face', unitId: u.id, facing: u.facing }); break;
            case 'extract': this.doExtract(u); break;
            case 'recover': this.doRecover(u); break;
        }
        this.afterAction();
        return { ok: true, events: this.log.slice(start) };
    }

    emit(e) { e.seq = ++this.seq; e.round = this.round; this.log.push(e); return e; }

    afterAction() {
        // A bolt-action chambers a newly supplied loose round without a separate reload action.
        for(const u of this.units)for(const id of u.weapons){const w=WEAPONS[id];if(w.boltAction&&!u.ammo[id]&&reserveAmmo(u,w)>0)u.ammo[id]=consumeAmmo(u,w,1);}
        for(const u of this.units)if(WALKERS[u.type])u.footprint=occupiedCells(u,{x:u.x,y:u.y,z:u.z},this.store);
        settleMarks(this);
        this.updateVisibility();
        if(this.intelMode)refreshDrones(this);
        if(this.intelMode && this.unitsOf('enemy').some(e=>e.alerted))this.detected=true;
        this.checkOutcome();
    }

    // ---------------------------------------------------------------- turn flow
    startSide(side, first = false) {
        this.activeSide = side;
        for (const u of this.unitsOf(side)) {
            if(side==='player' && this.refreshOwner && u.owner!==this.refreshOwner)continue;
            // Start-of-turn statuses (burning and bleeding deal damage, durations tick).
            for (const s of [...u.statuses]) {
                const def = STATUS_DEFS[s.id];
                if (def?.dotPerRound) this.dealDamage(u, 'torso', s.id === 'burning' ? B.burningDamage : def.dotPerRound, { pierce: 99, element: s.id === 'burning' ? 'pyro' : null, source: s.id, applyStatuses: false });
            }
            if (!alive(u)) continue;
            let ap = u.maxAp;
            const chill = u.statuses.find(s => s.id === 'chilled');
            if (chill) ap += STATUS_DEFS.chilled.apPerStack * (chill.stacks || 1);
            if (hasStatus(u, 'stunned')) ap += STATUS_DEFS.stunned.apPenalty;
            if (hasStatus(u, 'surprised')) ap += STATUS_DEFS.surprised.apPenalty;
            if (hasStatus(u, 'panicked')) ap = Math.ceil(ap / 2);
            u.ap = first ? u.maxAp : Math.max(0, ap);
            u.moveOnlyAp = 0;
            u.reactionsLeft = 1;
            u.buffs = {};
            if (!first) u.will = Math.min(u.maxWill, u.will + B.willRegen);
            u.movedThisTurn = 0;
            for (const s of u.statuses) s.rounds--;
            // Effects used during this turn survive their final duration tick until the side ends.
            u.statuses = u.statuses.filter(s => s.rounds > 0 || (!STATUS_DEFS[s.id]?.untilOwnTurn && (STATUS_DEFS[s.id]?.noAbilities || STATUS_DEFS[s.id]?.rooted || STATUS_DEFS[s.id]?.accuracyMult)));
        }
        this.formations.onSideStart(side,side==='player'?this.refreshOwner:null);
        if(side==='player')this.refreshOwner=null;
        this.emit({ t: 'turn', side, round: this.round });
    }

    endTurn(side) {
        for (const u of this.unitsOf(side).filter(u=>side!=='player'||!this.refreshOwner||u.owner===this.refreshOwner)) u.statuses = u.statuses.filter(s => s.rounds > 0);
        if (side === 'player') {
            this.formations.onSideEnd('player',this.refreshOwner);
            this.startSide('enemy');
        } else {
            this.formations.onSideEnd('enemy');
            this.roundEnd();
            this.objectiveRoundEnd();
            if (!this.outcome) { this.round++; this.startSide('player'); }
        }
    }

    roundEnd() {
        const before = this.store.version;
        const changes = this.store.record(() => {
            const { changes: ec, burnedOut, explosions } = this.field.tick(this.rng, { spreadChance: B.fireSpreadChance });
            if (ec.length) this.emit({ t: 'elements', changes: ec });
            if (burnedOut.length) this.stats.voxelsDestroyed += burnedOut.length;
            for (const explosion of explosions) this.explode(explosion);
            if (burnedOut.length) this.settle();
        });
        if (changes.length) this.emit({ t: 'voxels', changes });
        // Units standing in fire catch it.
        for (const u of this.units.filter(alive)) {
            if (this.field.surfaceAt(u.x, u.y, u.z) === 'burning' || this.field.isBurning(u.x, u.y, u.z)) this.giveStatus(u, 'burning');
        }
        if (this.store.version !== before) this.checkFalls();
    }

    checkOutcome() {
        if (this.outcome) return;
        const o = this.objective;
        const p = this.unitsOf('player').length, e = this.unitsOf('enemy').length;
        let winner = null, reason = null;
        if (o.failed) { winner = 'enemy'; reason = 'timer'; }
        else if (o.kind === 'recover' && o.item.secured) { winner = 'player'; reason = 'recovered'; }
        else if (o.kind === 'hold' && o.held >= o.rounds) { winner = 'player'; reason = 'held'; }
        else if (!e && o.kind !== 'recover') { winner = 'player'; reason = 'eliminated'; }
        else if (!p) {
            const out = o.extracted.length >= o.needed && o.kind === 'extract';
            winner = out ? 'player' : 'enemy'; reason = out ? 'extracted' : 'squad lost';
        }
        if (winner) { this.outcome = { winner, round: this.round, reason }; this.emit({ t: 'outcome', ...this.outcome }); }
    }

    // ---------------------------------------------------------------- objectives
    doExtract(u) {
        const o = this.objective;
        u.ap = 0; u.moveOnlyAp = 0; u.overwatch = null; u.extracted = true;
        o.extracted.push(u.id);
        const withItem = o.item?.carrier === u.id;
        if (withItem) o.item.secured = true;
        this.formations.onUnitLost(u);
        this.emit({ t: 'extract', unitId: u.id, item: withItem });
    }
    doRecover(u) {
        const it = this.objective.item;
        u.ap -= 1;
        it.carrier = u.id;
        if (!this.objective.zone) it.secured = true;
        this.emit({ t: 'recover', unitId: u.id, label: it.label, secured: it.secured });
        this.noise(u.x, u.y, u.z, 4, u);
    }
    /** End of a full round: hold progress and the deadline. */
    objectiveRoundEnd() {
        const o = this.objective;
        if (o.kind === 'hold') {
            const squad = this.unitsOf('player').some(u => inZone(o.zone, u));
            const hostile = this.unitsOf('enemy').some(u => inZone(o.zone, u));
            if (squad && !hostile) o.held++;
            this.emit({ t: 'objective', kind: 'hold', held: o.held, rounds: o.rounds, contested: squad && hostile });
        }
        if (o.turns && this.round >= o.turns && !this.outcome) o.failed = true;
        this.checkOutcome();
    }

    // ---------------------------------------------------------------- movement
    doMove(u, to) {
        const search = this.reach(u);
        const k = nodeKey(to);
        const cost = search.costs.get(k);
        const path = pathTo(search, k);
        let ap = this.apForCost(u, cost);
        const fromMoveOnly = Math.min(u.moveOnlyAp, ap);
        u.moveOnlyAp -= fromMoveOnly; ap -= fromMoveOnly;
        u.ap -= ap;
        // Moving off the watched spot ends your own overwatch (PLAN-07 §4.5): the cone belonged to the old position.
        if (u.overwatch) { u.overwatch = null; this.emit({ t: 'overwatchCancel', unitId: u.id, reason: 'moved' }); }
        const walked = [path[0]], kinds = [], windowVaults=[], reacted=new Set();
        const movementEvent=this.emit({t:'move',unitId:u.id,path:walked,kinds,windowVaults,ap:ap+fromMoveOnly});
        let jumped = false;
        for (let i = 1; i < path.length; i++) {
            const p = path[i];
            const kind = WALKERS[u.type]&&p.z!==path[i-1].z?'climb':stepKind(this.store, path[i - 1], p);
            kinds.push(kind);
            windowVaults.push(kind==='vault'&&isWindowVault(this.store,path[i-1],p));
            if (kind === 'jump') {jumped = true;this.stats.drops++;this.noise(p.x,p.y,p.z,8,u);}
            if(this.mission.meta?.streetDatum&&p.z<this.mission.meta?.streetDatum)this.stats.undergroundSteps++;
            if(u.side==='player'&&this.flankCells.has(`${p.x},${p.y}`))this.stats.flankSteps++;
            this.openDoorsOnStep(u, path[i - 1], p);
            this.breakGlassOnStep(u,path[i-1],p,kind);
            u.facing = facingToward(p.x - u.x, p.y - u.y);
            u.x = p.x; u.y = p.y; u.z = p.z;
            if(WALKERS[u.type])u.footprint=occupiedCells(u,{x:u.x,y:u.y,z:u.z},this.store);
            walked.push(p);
            u.movedThisTurn = (u.movedThisTurn || 0) + 1;
            this.revealRoomOf(u);
            if(windowVaults.at(-1)&&u.side==='player')this.revealRoom(this.roomOf(u),u);
            // Spotting: a unit that steps into view of an unalerted pod alerts it.
            this.updateVisibility({interior:false});
            const before = alive(u);
            this.checkReactions(u, walked, reacted);
            if (before && !alive(u)) break;
            if (u.statuses.some(s => s.id === 'frozen')) break;
        }
        movementEvent.kinds = kinds.slice(0,walked.length-1);
        if (alive(u) && jumped) this.giveStatus(u, 'staggered', 1);
        if (alive(u)) {
            const surf = this.field.surfaceAt(u.x, u.y, u.z);
            if (surf === 'burning') this.giveStatus(u, 'burning');
            if (surf === 'wet') this.giveStatus(u, 'wet');
        }
        this.formations.onMoved(u);
        this.noise(u.x, u.y, u.z, 3, u);
    }

    /** Sweep the body's actual movement, including the skipped tile in a vault. */
    breakGlassOnStep(u,from,to,kind='walk') {
        const steps=Math.max(1,Math.abs(to.x-from.x),Math.abs(to.y-from.y),Math.abs(to.z-from.z))*4;
        const changes=this.store.record(()=>{
            for(let i=0;i<=steps;i++) {
                const t=i/steps,x=Math.floor(from.x+.5+(to.x-from.x)*t),y=Math.floor(from.y+.5+(to.y-from.y)*t);
                const z=Math.floor(from.z+(to.z-from.z)*t+(kind==='vault'?Math.sin(Math.PI*t):0));
                for(const cell of occupiedCells(u,{x,y,z},this.store))for(let h=1;h<=2;h++) {
                    if(this.store.get(cell.x,cell.y,cell.z+h)!==MAT.glass)continue;
                    this.store.set(cell.x,cell.y,cell.z+h,AIR);this.stats.voxelsDestroyed++;
                }
            }
        });
        if(changes.length)this.emit({t:'voxels',changes});
    }

    openDoorsOnStep(u, from, to) {
        for (let h = 1; h <= 2; h++) {
            if (this.store.get(to.x, to.y, to.z + h) === MAT.door) {
                const changes = this.store.record(() => { for (let k = 1; k <= 2; k++) if (this.store.get(to.x, to.y, to.z + k) === MAT.door) this.store.set(to.x, to.y, to.z + k, MAT.door_open); });
                this.emit({ t: 'door', x: to.x, y: to.y, z: to.z, open: true, unitId: u.id });
                this.emit({ t: 'voxels', changes });
                // The room on the far side is revealed.
                const nx = to.x + Math.sign(to.x - from.x), ny = to.y + Math.sign(to.y - from.y);
                this.revealRoom(this.store.roomAt(nx, ny, to.z + 1), u);
                break;
            }
        }
    }
    doDoor(u, d) {
        const open = this.store.get(d.x, d.y, d.z + 1) === MAT.door;
        u.ap -= 1;
        const changes = this.store.record(() => { for (let k = 1; k <= 2; k++) { const id = this.store.get(d.x, d.y, d.z + k); if (id === MAT.door || id === MAT.door_open) this.store.set(d.x, d.y, d.z + k, open ? MAT.door_open : MAT.door); } });
        this.emit({ t: 'door', ...d, open, kicked:open, unitId: u.id });
        this.emit({ t: 'voxels', changes });
        if (open) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.revealRoom(this.store.roomAt(d.x + dx, d.y + dy, d.z + 1), u);
    }
    /**
     * A collapse must never strand the objective: a loose package drops to the floor that is left in its column (or the
     * nearest one), and a hold/extract zone whose floor is gone moves down to the level that remains in its area.
     */
    settleObjective() {
        const o = this.objective, s = this.store, ok = c => c.headroom >= 2;
        const it = o.item;
        if (it && !it.carrier && !it.secured && !s.surfaces(it.x, it.y).some(c => c.z === it.z && ok(c))) {
            // Rubble can form a sealed ring. Prefer a landing the surviving squad can reach.
            const accessible=new Set();
            for(const u of this.units.filter(u=>u.side==='player'&&alive(u))) {
                const floor=s.surfaces(u.x,u.y).filter(ok).sort((a,b)=>Math.abs(a.z-u.z)-Math.abs(b.z-u.z))[0];
                if(floor)for(const key of reachable(s,floor,Infinity,PROFILE).costs.keys())accessible.add(key);
            }
            let best = null;
            for (let r = 0; r <= 4 && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const list = s.surfaces(it.x + dx, it.y + dy).filter(c => ok(c) && c.z <= it.z + 2 && (!accessible.size||accessible.has(nodeKey(c))));
                const c = list.filter(c => c.z <= it.z).at(-1) || list[0];
                if (c && (!best || Math.abs(c.z - it.z) < Math.abs(best.z - it.z) || (c.z === best.z && r === 0))) best = c;
            }
            if (best) { Object.assign(it, { x: best.x, y: best.y, z: best.z }); this.emit({ t: 'drop', unitId: null, x: best.x, y: best.y, z: best.z, label: it.label, collapse: true }); }
        }
        const z = o.zone;
        if (z && z.z != null) {
            const dz = z.dz ?? 1, levels = new Map();
            let held = false;
            for (let y = z.y0; y <= z.y1 && !held; y++) for (let x = z.x0; x <= z.x1; x++) {
                const list = s.surfaces(x, y).filter(ok);
                if (list.some(c => Math.abs(c.z - z.z) <= dz)) { held = true; break; }
                const c = list.filter(c => c.z < z.z).at(-1);
                if (c) levels.set(c.z, (levels.get(c.z) || 0) + 1);
            }
            if (!held && levels.size) {
                const [lz] = [...levels].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
                z.z = lz;
                this.emit({ t: 'zone', zone: { ...z }, collapse: true });
            }
        }
    }
    revealRoomOf(u) { /* Interior discovery is explicit: kick/breach, not walking or window LOS. */ }
    revealRoom(id, by) {
        if (id == null || id < 0 || !by || by.side !== 'player' || this.revealedRooms.has(id)) return;
        this.revealedRooms.add(id);
        this.emit({ t: 'reveal', roomId: id });
    }

    /** Overwatch: enemies of the mover whose cone contains its new position and who can see it shoot. */
    checkReactions(mover, walked, reacted = new Set()) {
        for (const w of this.enemiesOf(mover)) {
            if (!alive(mover)) return;
            if (!w.overwatch || hasStatus(w, 'surprised')) continue;
            const ow = w.overwatch;
            if (!inWatchSector(w, ow, mover) || !this.sees(w, mover)) continue;
            const weapon = WEAPONS[ow.weaponId];
            if (!w.weapons.includes(ow.weaponId) || (w.ammo[ow.weaponId] ?? 0) < 1) { w.overwatch = null; continue; }
            // One salvo per movement event; the watch remains active for subsequent movers.
            if(reacted.has(w.id))continue;
            reacted.add(w.id);
            this.stats.reactions++;
            this.emit({ t: 'reaction', watcherId: w.id, targetId: mover.id });
            this.fireWeapon(w, WEAPONS[ow.weaponId], { unitId: mover.id, part: 'torso' }, { reaction: true });
            if ((w.ammo[ow.weaponId]||0)===0) w.overwatch = null;
        }
    }

    // ---------------------------------------------------------------- shooting
    doShoot(u, intent) {
        const w = WEAPONS[intent.weaponId || u.weapon];
        u.ap -= this.shotAp(u, w);
        u.buffs.quickAim = false;
        const targetIds = intent.aim.unitId ? [intent.aim.unitId] : [];
        { const aimPoint=aimPointOf(this,intent.aim); this.emit({ t: 'cutin', unitId: u.id, kind: w.cutIn || 'shot', weaponId: w.id, targetIds,aimPoint,muzzle:chooseMuzzle(this.store,u,aimPoint,{occupied:occupiedBy(this,u)}) }); }
        this.fireWeapon(u, w, intent.aim, { fireMode:intent.fireMode });
        u.buffs.deadeye = false;
    }

    /** Fire one shot of `w` at `aim`, resolving every projectile with the battle RNG. */
    fireWeapon(u, w, aim, { reaction = false, breach = false, fireMode = null } = {}) {
        const rounds=roundsFor(u,w,fireMode);if(!rounds)return;
        u.ammo[w.id]-=rounds;
        const count=rounds*(w.pellets||w.projectiles||1);
        const target = aim.unitId ? this.unit(aim.unitId) : null;
        const aimPoint = aimPointOf(this, aim);
        u.facing = facingToward(aimPoint.x - u.x - 0.5, aimPoint.y - u.y - 0.5);
        const { spread } = this.spreadFor(u, w, aimPoint, { reaction, breach, target });
        w=weaponBuild(u,w);
        const muzzle = chooseMuzzle(this.store, u, aimPoint, { occupied: occupiedBy(this, u) });
        const dv = [aimPoint.x - muzzle.x, aimPoint.y - muzzle.y, aimPoint.h - muzzle.h];
        const dist = Math.hypot(...dv);
        const dir = dv.map(c => c / dist);
        const maxDist = Math.min(w.maxRange, Math.max(dist + 10, dist * 1.6));
        const projectiles = [];
        const ws = this.weaponStats(w.id);
        ws.shots++; ws.projectiles += count; ws.ap += reaction ? 0 : this.shotAp(u, w);
        u.stats.shots++;
        let targetHit = false;
        const threatened=new Map();
        const changes = this.store.record(() => {
            for (let i = 0; i < count; i++) {
                const d = sampleCone(dir, spread, this.rng);
                const res = traceProjectile(this, muzzle, d, maxDist, { ignore: u.id, energy: w.energy || 0 });
                for (const [gx, gy, gz] of res.glass) if (this.store.get(gx, gy, gz) === MAT.glass) { this.store.set(gx, gy, gz, AIR); this.stats.voxelsDestroyed++; }
                const p = { to: res.point, kind: res.kind };
                const mult = u.buffs.demolish ? 2 : 1;
                // PLAN-07: every voxel the round went through takes its voxel damage too (and may give way).
                if (res.pierced.length) {
                    p.pierced = res.pierced.map(q => ({ x: q.x, y: q.y, z: q.z, t: q.t }));
                    ws.pierced = (ws.pierced || 0) + 1;
                    for (const q of res.pierced) {
                        if (this.store.get(q.x, q.y, q.z) === AIR) continue;
                        const r = damageVoxel(this.store, q.x, q.y, q.z, (w.voxel || 0) * mult, { element: w.element });
                        if (r.destroyed) { this.stats.voxelsDestroyed++; ws.voxels = (ws.voxels || 0) + 1; }
                        if (r.explosion) this.explode({ ...r.explosion, by: u.id });
                    }
                }
                if (res.kind === 'unit') {
                    if(!reaction&&res.unit.side!==u.side&&!threatened.has(res.unit.id))threatened.set(res.unit.id,{unit:res.unit,visible:this.sees(res.unit,u)});
                    p.unitId = res.unit.id; p.part = res.part;
                    const dealt = this.dealDamage(res.unit, res.part, Math.round(projectileDamage(w,res.t,i) * (res.scale ?? 1)), { pierce: w.pierce, shred: w.shred, element: w.element, source: u.id });
                    if (res.pierced.length) p.through = true;
                    p.damage = dealt;
                    ws.hits++; ws.damage += dealt; u.stats.hits++; u.stats.damage += dealt;
                    if (target && res.unit.id === target.id) targetHit = true;
                    if (w.element) this.elementImpact(w.element, res.point, 0.6);
                } else if (res.kind === 'voxel') {
                    const v = res.voxel;
                    p.voxel = v;
                    const r = damageVoxel(this.store, v.x, v.y, v.z, (w.voxel || 0) * mult, { element: w.element });
                    if (r.destroyed) { this.stats.voxelsDestroyed++; ws.voxels = (ws.voxels || 0) + 1; p.destroyed = true; }
                    if (r.explosion) this.explode({ ...r.explosion, by: u.id });
                    if (w.element) this.elementImpact(w.element, res.point, 0.8);
                }
                projectiles.push(p);
            }
        });
        u.buffs.demolish = false;
        this.emit({ t: 'shot', unitId: u.id, weaponId: w.id, muzzle, aim: aimPoint, projectiles, reaction, breach, rounds });
        if(w.boltAction&&reserveAmmo(u,w)>0)u.ammo[w.id]+=consumeAmmo(u,w,1);
        if (changes.length) this.emit({ t: 'voxels', changes });
        if (target && alive(target) && !targetHit) this.addStress(target, B.stressOnNearMiss, 'near miss');
        this.noise(u.x, u.y, u.z, w.noise ?? 12, u);
        if (changes.some(c => materialById(c[3]).structural)) this.settle();
        this.checkFalls();
        for(const t of threatened.values())if(alive(t.unit))this.formations.onIncomingFire(t.unit,u,t.visible);
    }

    doMelee(u, intent) {
        const w = WEAPONS[intent.weaponId || u.weapons.find(id => WEAPONS[id].kind === 'melee')];
        const t = this.unit(intent.targetId);
        u.ap -= w.ap;
        u.facing = facingToward(t.x - u.x, t.y - u.y);
        this.emit({ t: 'cutin', unitId: u.id, kind: 'melee', weaponId: w.id, targetIds: [t.id] });
        const part = intent.part || 'torso';
        const dealt = this.dealDamage(t, part, w.damage, { pierce: w.pierce, shred: w.shred, source: u.id });
        const ws = this.weaponStats(w.id); ws.shots++; ws.hits++; ws.damage += dealt; ws.ap += w.ap; ws.projectiles++;
        this.emit({ t: 'melee', unitId: u.id, targetId: t.id, part, damage: dealt, weaponId: w.id });
        if (w.knockback && alive(t)) this.knockback(t, t.x - u.x, t.y - u.y, w.knockback);
        this.noise(u.x, u.y, u.z, w.noise ?? 4, u);
    }

    // ---------------------------------------------------------------- damage
    dealDamage(t, part, amount, { pierce = 0, shred = 0, element = null, source = null, applyStatuses = true } = {}) {
        if (!alive(t)) return 0;
        if (t.god) amount = 0;
        const p = t.parts[part] || t.parts.torso;
        const armor = Math.max(0, partArmor(t, part) - pierce);
        let dmg = Math.max(0, Math.round(amount) - armor);
        if (element === 'pyro' && hasStatus(t, 'wet')) dmg = Math.max(0, dmg - 1);
        if (shred) p.armor = Math.max(0, p.armor - shred);
        if (dmg > 0) {
            t.overwatch=null;
            p.hp = Math.max(0, p.hp - dmg);
            t.hp -= dmg;
            if (part === 'torso') t.parts.torso.hp = Math.max(0, t.hp);
            if (p.hp <= 0 && !p.disabled && part !== 'torso') {
                p.disabled = true;
                this.emit({ t: 'disabled', unitId: t.id, part });
                if (part === 'head') { t.maxWill = Math.max(1, t.maxWill - 2); t.will = Math.min(t.will, t.maxWill); }
            }
        }
        this.emit({ t: 'damage', unitId: t.id, part, amount: dmg, element, source, armor: p.armor });
        if (element && applyStatuses) for (const s of elementStatusesFor(element, t)) this.giveStatus(t, s);
        if (dmg > 0) this.addStress(t, B.stressOnWound, 'wounded');
        if (t.hp <= 0) this.kill(t, source);
        return dmg;
    }
    kill(t, source) {
        t.hp = 0; t.dead = true; t.overwatch = null;
        this.emit({ t: 'death', unitId: t.id, source });
        const it = this.objective.item;
        if (it?.carrier === t.id) { Object.assign(it, { carrier: null, x: t.x, y: t.y, z: t.z }); this.emit({ t: 'drop', unitId: t.id, x: t.x, y: t.y, z: t.z, label: it.label }); }
        this.formations.onUnitLost(t);
        const killer = this.unit(source);
        if (killer && killer.side !== t.side) { killer.stats.kills++; this.addStress(killer, -B.stressRelieveOnKill, 'kill'); const ws = this.weaponStats(killer.weapon); ws.kills++; }
        for (const ally of this.unitsOf(t.side)) if (this.distance(ally, t) <= 8 && this.sees(ally, t)) this.addStress(ally, B.stressOnAllyDown, 'ally down');
        this.checkOutcome();
    }
    giveStatus(u, id, rounds) {
        const s = addStatus(u, id, rounds);
        if (s) u.overwatch=null;
        if (s) this.emit({ t: 'status', unitId: u.id, statusId: id, rounds: s.rounds });
    }
    addStress(u, amount, why) {
        if (!alive(u) || !amount) return;
        u.stress = Math.max(0, Math.min(B.breakdownAt, u.stress + amount));
        let breakdown = false;
        if (u.stress >= B.breakdownAt) {
            breakdown = true; u.stress = 60;
            u.statuses = u.statuses.filter(s => s.id !== 'panicked');
            u.statuses.push({ id: 'panicked', rounds: 1, stacks: 1 });
            u.overwatch = null;
            this.formations.onUnitLost(u);
        }
        this.emit({ t: 'stress', unitId: u.id, stress: u.stress, delta: amount, why, breakdown });
    }

    // ---------------------------------------------------------------- explosions, throws, elements
    throwArc(u, to) {
        const hand = { x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1 + 1.6 };
        const surf = this.store.surfaceNear(to.x, to.y, to.z ?? Infinity);
        const land = { x: to.x + 0.5, y: to.y + 0.5, h: (surf ? surf.z + 1 : (to.z ?? 0) + 1) + 0.15 };
        return { hand, land, ...fitArc(this.store, hand, land, 2.8) };
    }
    doThrow(u, intent) {
        const t = THROWABLES[intent.itemId];
        u.ap -= t.ap;
        consumeItem(u,t.id,intent.cargo);
        const ts = this.stats.throwables[t.id] ||= { thrown: 0, unitDamage: 0, voxels: 0 };
        ts.thrown++;
        this.emit({ t: 'cutin', unitId: u.id, kind: t.cutIn || 'throw', itemId: t.id, targetIds: [] });
        let centre;
        if (t.placed) {
            centre = { x: intent.to.x + 0.5, y: intent.to.y + 0.5, h: (intent.to.z ?? u.z) + 1.5 };
            this.emit({ t: 'throw', unitId: u.id, itemId: t.id, points: [this.chest(u), centre] });
        } else {
            // Scatter grows with distance and shrinks with accuracy.
            const dist = Math.hypot(intent.to.x - u.x, intent.to.y - u.y);
            const scatter = dist * Math.tan(3.2 * Math.PI / 180) / Math.max(0.3, accuracyMult(u));
            const a = this.rng.next() * Math.PI * 2, r = Math.sqrt(this.rng.next()) * scatter;
            const tx = Math.round(intent.to.x + Math.cos(a) * r), ty = Math.round(intent.to.y + Math.sin(a) * r);
            const arc = this.throwArc(u, { x: tx, y: ty, z: intent.to.z });
            const pts = arc.blockedAt ? arc.points : arc.points;
            centre = arc.ok ? arc.land : (arc.blockedAt || arc.land);
            this.emit({ t: 'throw', unitId: u.id, itemId: t.id, points: pts, scatter: +r.toFixed(2) });
        }
        this.detonate(t, centre, u);
    }
    detonate(t, centre, by, { excludeUnits = [] } = {}) {
        if (t.smoke) {
            const cells = this.field.addSmoke(centre.x - 0.5, centre.y - 0.5, Math.floor(centre.h - 0.5), t.radius, t.smoke);
            this.emit({ t: 'smoke', x: centre.x, y: centre.y, h: centre.h, radius: t.radius, cells });
            return;
        }
        this.explode({ x: centre.x, y: centre.y, h: centre.h, radius: t.radius, power: (t.power || 0) * (by?.buffs.demolish ? 2 : 1), damage: t.damage, element: t.element, shred: t.shred, knockback: t.knockback, by: by?.id, item: t.id, excludeUnits });
        if (by) by.buffs.demolish = false;
        this.noise(Math.floor(centre.x), Math.floor(centre.y), Math.floor(centre.h), t.noise ?? 14, by);
    }
    explode(b) {
        const item = THROWABLES[b.item];
        const canDamage = item && !item.placed
            ? (x, y, z) => z > this.grenadeGroundLevels[x + y * this.store.width]
            : null;
        const changes = this.store.record(() => {
            const { destroyed, explosions } = b.power > 0 ? explodeVoxels(this.store, b, { canDamage }) : { destroyed: [], explosions: [b] };
            this.stats.voxelsDestroyed += destroyed.length;
            if (b.item && this.stats.throwables[b.item]) this.stats.throwables[b.item].voxels += destroyed.length;
            for (const e of explosions) {
                if ((e.power > 0 || e.element === 'pyro') && e.element !== 'hydro') scorchBlast(this.store, e);
                this.emit({ t: 'explosion', x: e.x, y: e.y, h: e.h, radius: e.radius, element: e.element || null, source: e.source || b.item || null });
                this.blastUnits(e, b.by, b.item);
                if (e.element) this.elementImpact(e.element, e, e.radius);
            }
            if (destroyed.length) this.settle();
        });
        if (changes.length) this.emit({ t: 'voxels', changes });
        this.checkFalls();
    }
    blastUnits(e, by, item = null) {
        for (const u of this.units.filter(alive)) {
            if (e.excludeUnits?.includes(u.id)) continue;
            const c = WALKERS[u.type]?occupiedCells(u).map(p=>({x:p.x+.5,y:p.y+.5,h:p.z+1.3})).concat([this.chest(u)]).sort((a,c)=>Math.hypot(a.x-e.x,a.y-e.y,a.h-e.h)-Math.hypot(c.x-e.x,c.y-e.y,c.h-e.h))[0]:this.chest(u);
            const clustered = this.formations.isClustered(u);
            const r = e.radius + (clustered ? B.clusteredRadiusBonus : 0);
            const d = Math.hypot(c.x - e.x, c.y - e.y, (c.h - e.h) * 0.8);
            if (d > r + 0.5) continue;
            const shielded = castRay(this.store, { x: e.x, y: e.y, h: e.h + 0.2 }, c, { blocks: (s, x, y, z) => materialById(s.get(x, y, z)).projectile !== 'pass' }).hit;
            let dmg = (e.damage || 0) * Math.max(0.25, 1 - d / (r + 0.5)) * (clustered ? B.clusteredDamageMult : 1) * (shielded ? 0.5 : 1);
            dmg = Math.round(dmg);
            if (dmg > 0) {
                const dealt = this.dealDamage(u, 'torso', dmg, { pierce: Math.ceil(partArmor(u, 'torso') / 2), shred: e.shred || 0, element: e.element, source: by });
                if (item && this.stats.throwables[item]) this.stats.throwables[item].unitDamage += dealt;
            } else if (e.element) for (const s of elementStatusesFor(e.element, u)) this.giveStatus(u, s);
            if (e.knockback && alive(u)) this.knockback(u, u.x + 0.5 - e.x, u.y + 0.5 - e.y, e.knockback);
        }
    }
    elementImpact(element, p, radius) {
        const changes = this.store.record(() => {
            const ec = this.field.applyArea(element, p.x, p.y, p.h, radius);
            if (ec.length) {
                if (ec.some(c => c.t === 'ignite')) this.stats.fires += ec.filter(c => c.t === 'ignite').length;
                this.emit({ t: 'elements', element, changes: ec });
            }
        });
        if (changes.length) this.emit({ t: 'voxels', changes });
    }
    knockback(u, dx, dy, tiles) {
        if(WALKERS[u.type])return; // Anchored heavy constructs resist forced displacement.
        const len = Math.hypot(dx, dy) || 1, sx = Math.round(dx / len), sy = Math.round(dy / len);
        const path = [{ x: u.x, y: u.y, z: u.z }];
        for (let i = 0; i < tiles; i++) {
            const nx = u.x + sx, ny = u.y + sy;
            if (this.store.isSolid(nx, ny, u.z + 1) || this.store.isSolid(nx, ny, u.z + 2) || this.occupant(nx, ny, u.z)) { this.dealDamage(u, 'torso', B.impactDamage, { pierce: 99, source: 'impact' }); break; }
            const below = this.store.surfaces(nx, ny).filter(s => s.z <= u.z && s.headroom >= 2).at(-1);
            if (!below) break;
            u.x = nx; u.y = ny;
            const drop = u.z - below.z; u.z = below.z;
            path.push({ x: u.x, y: u.y, z: u.z });
            if (drop > 1) { this.dealDamage(u, 'legs', (drop - 1) * B.fallDamagePerLevel, { pierce: 99, source: 'fall' }); break; }
        }
        if (path.length > 1) this.emit({ t: 'knockback', unitId: u.id, path });
    }

    /** Structural support after destruction; units on vanished floors fall. */
    settle() {
        const { fallen, removed } = settleUnsupported(this.store);
        if (removed) { this.stats.voxelsDestroyed += removed; this.emit({ t: 'collapse', fallen, removed }); }
    }
    checkFalls() {
        this.settleObjective();
        for (const u of this.units.filter(alive)) {
            if(WALKERS[u.type]&&walkerFits(this.store,u))continue;
            const here = this.store.surfaces(u.x, u.y).find(s => s.z === u.z);
            if (here && here.headroom >= 2 && !WALKERS[u.type]) continue;
            if(WALKERS[u.type]){
                const from=u.z;let dest=null;
                for(let z=from-1;z>=0;z--)if(walkerFits(this.store,u,{x:u.x,y:u.y,z},c=>{const o=this.occupant(c.x,c.y,c.z);return o&&o.id!==u.id;})){dest=z;break;}
                if(dest===null){this.dealDamage(u,'torso',u.maxHp+100,{pierce:99,source:'fall'});continue;}
                u.z=dest;u.footprint=occupiedCells(u,{x:u.x,y:u.y,z:u.z},this.store);this.emit({t:'fall',unitId:u.id,from,to:dest});if(from-dest>1)this.dealDamage(u,'legs',(from-dest-1)*B.fallDamagePerLevel,{pierce:99,source:'fall'});continue;
            }
            const below = this.store.surfaces(u.x, u.y).filter(s => s.z < u.z && s.headroom >= 2).at(-1);
            const above = this.store.surfaces(u.x, u.y).filter(s => s.z > u.z && s.z <= u.z + 2 && s.headroom >= 2)[0];
            const from = u.z;
            if (!here && below) {
                u.z = below.z;
                const levels = from - u.z;
                this.emit({ t: 'fall', unitId: u.id, from, to: u.z });
                if (levels > 1) this.dealDamage(u, 'legs', (levels - 1) * B.fallDamagePerLevel, { pierce: 99, source: 'fall' });
                this.addStress(u, 8, 'fell');
            } else if (above) {
                u.z = above.z;                         // rubble piled on them: climb out, bruised
                this.emit({ t: 'fall', unitId: u.id, from, to: u.z });
                this.dealDamage(u, 'torso', B.crushDamage, { pierce: 99, source: 'crushed' });
            } else if (!here) {
                this.emit({ t: 'fall', unitId: u.id, from, to: -1 });
                this.kill(u, 'fall');
            }
        }
    }

    // ---------------------------------------------------------------- overwatch, abilities
    doOverwatch(u, intent) {
        const w = WEAPONS[intent.weaponId || u.weapon];
        u.overwatch = watchSector(u, intent.toward, w.id);
        u.facing = facingToward(u.overwatch.dx, u.overwatch.dy);
        u.ap = 0; u.moveOnlyAp = 0;
        this.emit({ t: 'overwatch', unitId: u.id, ...u.overwatch });
        this.formations.onOverwatch(u);
    }
    doAbility(u, intent) {
        const a = ABILITIES[intent.abilityId];
        u.will -= a.wp; u.ap -= a.ap;
        if (a.id !== 'suppress') this.emit({ t: 'cutin', unitId: u.id, kind: 'skill', abilityId: a.id, targetIds: intent.targetId ? [intent.targetId] : [] });
        this.emit({ t: 'ability', unitId: u.id, abilityId: a.id });
        if(a.intel){executeIntel(this,u,intent);return;}
        switch (a.id) {
            case 'killstreak_strike':this.supportUsed++;this.strikeReadyAt=this.round+10;this.explode({x:intent.to.x+.5,y:intent.to.y+.5,h:intent.to.z+1.5,radius:3,damage:25,power:12,element:'geo',by:u.id});break;
            case 'earth_cover': {
                const t = intent.to;
                const changes = this.store.record(() => this.store.set(t.x,t.y,t.z+1,MAT.drystone));
                this.emit({t:'voxels', changes});
                break;
            }
            case 'water_mend': {
                const t = this.unit(intent.targetId), amount = Math.min(a.heal, t.maxHp-t.hp);
                t.hp += amount;
                if (!t.parts.torso.disabled) t.parts.torso.hp = Math.min(t.parts.torso.max, t.parts.torso.hp + amount);
                removeStatus(t,'burning');
                this.giveStatus(t,'wet',1);
                this.emit({t:'heal',unitId:t.id,sourceId:u.id,amount});
                break;
            }
            case 'dash': u.moveOnlyAp += 1; break;
            case 'quick_aim': u.buffs.quickAim = true; break;
            case 'deadeye': u.buffs.deadeye = true; break;
            case 'demolish': u.buffs.demolish = true; break;
            case 'brace': this.giveStatus(u, 'braced', 1); break;
            case 'rally':
                for (const ally of this.unitsOf(u.side)) if (this.distance(ally, u) <= a.radius) { this.addStress(ally, -25, 'rally'); ally.will = Math.min(ally.maxWill, ally.will + 1); }
                break;
            case 'suppress': {
                const target = this.unit(intent.targetId);
                if (target && alive(target) && u.weapons.includes('repeater')) {
                    this.emit({ t: 'cutin', unitId: u.id, kind: 'burst', weaponId: 'repeater', targetIds: [target.id] });
                    this.fireWeapon(u, WEAPONS.repeater, { unitId: target.id, part: 'torso' }, {});
                    if (alive(target)) this.giveStatus(target, 'suppressed', 2);
                }
                break;
            }
        }
    }

    // ---------------------------------------------------------------- breach (PLAN-01 rev 2 §12.5)
    /** Breach points for a unit: closed doors (and, with a charge, walls) of rooms it is not in. */
    breachPoints(u) {
        const out = [];
        for (const r of this.mission.buildings || []) for (const d of r.doors) {
            const id = this.store.get(d.x, d.y, d.z + 1);
            if (id !== MAT.door) continue;
            if (Math.max(Math.abs(d.x - u.x), Math.abs(d.y - u.y)) > 2 || Math.abs(d.z - u.z) > 1) continue;
            const room = this.roomBeyond(d, u);
            if (room >= 0) out.push({ x: d.x, y: d.y, z: d.z, roomId: room, entry: 'door' });
        }
        if(itemCount(u,'breach_charge')>0)for(const [dx,dy] of [[1,0],[-2,0],[0,1],[0,-2]]) {
            const d={x:u.x+dx,y:u.y+dy,z:u.z,entry:'floor'};
            if(this.validFloorBreach(d))out.push(d);
        }
        return out;
    }
    validFloorBreach(d) {
        if(![d.x,d.y,d.z].every(Number.isInteger)||d.z<3)return false;
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++) {
            const x=d.x+dx,y=d.y+dy,m=this.store.material(x,y,d.z);
            if(!this.store.inBounds(x,y,d.z)||!['oak_floor','concrete','ceramic','grate','stone_floor','plank','carpet','tile_dark'].includes(m.key)||!Number.isFinite(m.hp))return false;
            const room=this.mission.rooms[this.store.roomAt(x,y,d.z-1)];if(room?.gameplay===false)return false;
            if(!this.store.surfaces(x,y).some(s=>s.z>=d.z-4&&s.z<=d.z-2&&s.headroom>=2))return false;
        }
        return true;
    }
    roomBeyond(d, u) {
        const mine = this.roomOf(u);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const r = this.store.roomAt(d.x + dx, d.y + dy, d.z + 1);
            if (r >= 0 && r !== mine && this.mission.rooms[r]?.gameplay !== false) return r;
        }
        return -1;
    }
    validateBreach(intent) {
        const d = intent.door; if (!d) return 'no_door';
        const ids = intent.unitIds?.length ? intent.unitIds : [intent.unitId];
        if (new Set(ids).size !== ids.length || !ids.includes(intent.unitId)) return 'bad_intent';
        const units = ids.map(id => this.unit(id));
        if (intent.by && intent.by !== '*' && units.some(u => u && u.owner !== intent.by)) return 'not_your_unit';
        if (units.some(u => !u || !alive(u) || u.side !== this.activeSide || u.ap < 1)) return 'no_ap';
        if(intent.entry==='floor') {
            if(units.length!==1)return 'bad_intent';
            if(!itemCount(units[0],'breach_charge'))return 'no_item';
            if(Math.max(Math.abs(d.x-units[0].x),Math.abs(d.y-units[0].y))>2||d.z!==units[0].z)return 'not_adjacent';
            return this.validFloorBreach(d)?null:'no_door';
        }
        const doorId = this.store.get(d.x, d.y, d.z + 1);
        if (intent.entry === 'charge') {
            if (!units.some(u => itemCount(u,'breach_charge') > 0)) return 'no_item';
            if (doorId === AIR) return 'no_door';
        } else if (doorId !== MAT.door) return 'no_door';
        if (units.some(u => Math.max(Math.abs(d.x - u.x), Math.abs(d.y - u.y)) > 2 || Math.abs(d.z - u.z) > 1)) return 'not_adjacent';
        if (this.roomBeyond(d, units[0]) < 0) return 'no_door';
        return null;
    }
    doBreach(intent) {
        const d = intent.door;
        const ids = intent.unitIds?.length ? intent.unitIds : [intent.unitId];
        const units = ids.map(id => this.unit(id));
        if(intent.entry==='floor') {
            const u=units[0];u.ap--;consumeItem(u,'breach_charge');this.stats.breaches++;
            const changes=this.store.record(()=>{for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)this.store.set(d.x+dx,d.y+dy,d.z,AIR);this.settle();});
            this.stats.voxelsDestroyed+=4;this.emit({t:'voxels',changes});this.emit({t:'breach',door:d,unitIds:[u.id],entry:'floor'});this.noise(d.x,d.y,d.z,14,u);return;
        }
        const roomId = this.roomBeyond(d, units[0]);
        const room = this.mission.rooms[roomId];
        this.stats.breaches++;
        this.emit({ t: 'cutin', unitId: units[0].id, kind: 'breach', group: units.map(u => u.id), targetIds: [] });
        const formationBonus = this.formations.breachNoiseMult(units[0]);
        if (intent.entry === 'charge') {
            const carrier = units.find(u => itemCount(u,'breach_charge') > 0);
            consumeItem(carrier,'breach_charge');
            this.detonate(THROWABLES.breach_charge, { x: d.x + 0.5, y: d.y + 0.5, h: d.z + 1.5 }, carrier, { excludeUnits: ids });
        } else {
            const changes = this.store.record(() => { for (let k = 1; k <= 2; k++) if (this.store.get(d.x, d.y, d.z + k) === MAT.door) this.store.set(d.x, d.y, d.z + k, MAT.door_open); });
            this.emit({ t: 'door', x: d.x, y: d.y, z: d.z, open: true, unitId: units[0].id });
            this.emit({ t: 'voxels', changes });
            this.noise(d.x, d.y, d.z, 12 * formationBonus, units[0]);
        }
        this.revealRoom(roomId, units[0]);
        // Defenders: unalerted ones are surprised.
        const defenders = this.units.filter(e => alive(e) && e.side !== units[0].side && this.roomOf(e) === roomId);
        for (const e of defenders) {
            if (!e.alerted) { this.giveStatus(e, 'surprised', 1); e.overwatch = null; }
        }
        this.alertGroup(defenders.map(e => e.group), 'breach');
        this.emit({ t: 'breach', door: d, roomId, unitIds: units.map(u => u.id), entry: intent.entry || 'door', defenders: defenders.map(e => e.id) });
        // Entrants move to the nearest free cells inside, then take one breach shot each.
        const cells = (room?.cells || []).map(([x, y]) => ({ x, y, z: room.floorZ }))
            .sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y));
        for (const u of units) {
            if (!alive(u)) continue;
            u.ap -= 1;
            const search = this.reach(u, 12);
            const cell = cells.find(c => search.costs.has(nodeKey(c)) && !this.occupant(c.x, c.y, c.z));
            if (cell) {
                const path = pathTo(search, nodeKey(cell));
                const walked = [path[0]],reacted=new Set();
                for (let i = 1; i < path.length && alive(u); i++) { this.openDoorsOnStep(u, path[i - 1], path[i]); Object.assign(u, path[i]); walked.push(path[i]); this.checkReactions(u, walked, reacted); }
                this.emit({ t: 'move', unitId: u.id, path: walked, ap: 1, breach: true });
            }
            if (!alive(u)) continue;
            const targets = defenders.filter(e => alive(e) && this.sees(u, e)).sort((a, b) => a.hp - b.hp);
            const w = WEAPONS[u.weapon];
            if (targets.length && w.kind === 'ballistic' && (u.ammo[w.id] ?? 0) >= (w.perShot || 1)) {
                this.fireWeapon(u, w, { unitId: targets[0].id, part: 'torso' }, { breach: true });
            }
        }
        this.formations.onBreach(units);
    }

    // ---------------------------------------------------------------- awareness
    noise(x, y, z, radius, by) {
        if (!radius) return;
        const groups = [];
        for (const e of this.units) {
            if (!alive(e) || e.alerted || (by && e.side === by.side)) continue;
            let r = radius;
            const room = this.store.roomAt(e.x, e.y, e.z + 1);
            if (room >= 0 && room !== this.store.roomAt(x, y, z + 1)) r *= 0.6;   // walls muffle
            if (Math.hypot(e.x - x, e.y - y, e.z - z) <= r) groups.push(e.group);
        }
        if (groups.length) this.alertGroup(groups, 'noise');
    }
    alertGroup(groups, why) {
        const set = new Set(groups);
        const woke = [];
        for (const e of this.units) if (alive(e) && !e.alerted && set.has(e.group) && e.side === 'enemy') { e.alerted = true; woke.push(e.id); }
        if (woke.length) this.emit({ t: 'alert', unitIds: woke, why });
    }
    scatterPod(group) {
        const enemies=this.unitsOf('enemy').filter(e=>e.group===group&&!e.scattered);
        if(!enemies.length)return;
        enemies.forEach(e=>{e.scattered=true;e.alerted=true;e.overwatch=null;});
        this.emit({t:'discovery',group,unitIds:enemies.map(e=>e.id)});
        for(const e of enemies) {
            const target=this.unitsOf('player').sort((a,b)=>this.distance(e,a)-this.distance(e,b)||(a.id<b.id?-1:a.id>b.id?1:0))[0];
            if(!target)continue;
            const room=this.roomOf(e);
            const search=reachable(this.store,{x:e.x,y:e.y,z:e.z},6,PROFILE,{vault:false,blocked:c=>{
                const o=this.occupant(c.x,c.y,c.z),r=this.store.roomAt(c.x,c.y,c.z+1);
                return (o&&o.id!==e.id)||this.store.get(c.x,c.y,c.z+1)===MAT.door||(r>=0&&r!==room&&!this.revealedRooms.has(r));
            }});
            const score=c=>coverAgainst(this.store,c.x,c.y,c.z,target.x,target.y,target.z)*10+Math.min(10,this.distance(c,target))-.2*(search.costs.get(nodeKey(c))||0);
            const candidates=[...search.nodes.values()].filter(c=>(c.x!==e.x||c.y!==e.y||c.z!==e.z)&&this.distance(c,target)>2)
                .sort((a,b)=>score(b)-score(a)||a.z-b.z||a.y-b.y||a.x-b.x);
            const dest=candidates[0];if(!dest)continue;
            const path=pathTo(search,nodeKey(dest)),walked=[path[0]],kinds=[];
            const event=this.emit({t:'move',unitId:e.id,path:walked,kinds,ap:0,scatter:true});
            for(let i=1;i<path.length&&alive(e);i++) {
                const kind=stepKind(this.store,path[i-1],path[i]);kinds.push(kind);this.breakGlassOnStep(e,path[i-1],path[i],kind);e.facing=facingToward(path[i].x-e.x,path[i].y-e.y);Object.assign(e,path[i]);walked.push(path[i]);this.checkReactions(e,walked);
            }
            event.kinds=kinds.slice(0,walked.length-1);
        }
    }
    spotsPlayer(e,p) {
        if(!this.sees(e,p))return false;
        if(!this.intelMode || e.alerted || this.distance(e,p)<=2)return true;
        const [fx,fy]=FACING_VEC[e.facing]||[0,1],dx=p.x-e.x,dy=p.y-e.y;
        return dx*fx+dy*fy >= Math.hypot(dx,dy)*Math.hypot(fx,fy)*.5;
    }
    updateVisibility({initial=false,interior=true}={}) {
        const seen=this.visibleTo('player'),groups=[];
        for(const id of seen){const e=this.unit(id);if(e&&!e.alerted&&!this.intelMode)groups.push(e.group);if(initial)e.scattered=true;}
        for(const e of this.unitsOf('enemy'))if(!e.alerted&&this.unitsOf('player').some(p=>this.spotsPlayer(e,p)))groups.push(e.group);
        if(groups.length){this.alertGroup(groups,'spotted');if(this.intelMode)this.detected=true;}
        this.visible=seen;
        if(!initial)for(const group of [...new Set([...seen].map(id=>this.unit(id).group))])if(!this.intelMode||this.unit([...seen].find(id=>this.unit(id).group===group))?.alerted)this.scatterPod(group);
        this.visible=this.visibleTo('player');
        if(interior)this.updateInteriorVision();
    }

    updateInteriorVision() {
        const seen=new Set(),observers=this.unitsOf('player').map(u=>({u,eye:this.eye(u)}));
        for(const room of this.mission.rooms||[])for(const [x,y] of room.cells) {
            const cell={x,y,z:room.floorZ};
            if(observers.some(({u,eye})=>this.distance(u,cell)<=B.sightRange && (this.sightLine(eye,{x:x+.5,y:y+.5,h:cell.z+2.05})||this.sightLine(eye,{x:x+.5,y:y+.5,h:cell.z+1.3}))))seen.add(`${x},${y},${cell.z}`);
        }
        const old=this.visibleInterior||new Set();
        if(old.size!==seen.size||[...seen].some(k=>!old.has(k)))this.emit({t:'vision',cells:[...seen]});
        this.visibleInterior=seen;
    }

    weaponStats(id) { return this.stats.weapons[id] ||= { shots: 0, projectiles: 0, hits: 0, damage: 0, kills: 0, ap: 0, voxels: 0 }; }

    /** Hash of everything that matters for lockstep: map, units, field. */
    hash() {
        let voxelHp = 0x811c9dc5;
        for (const hp of this.store.hp) { voxelHp ^= hp; voxelHp = Math.imul(voxelHp, 0x01000193); }
        const state = { supportUsed:this.supportUsed,strikeReadyAt:this.strikeReadyAt,marks:this.store.marksSnapshot?.(),markers:this.markers,squareCorners:[...this.store.squareCorners].sort(),windowOpenings:[...this.store.windowOpenings].sort(([a],[b])=>a<b?-1:a>b?1:0), intelMode:this.intelMode, asyncCoop:this.asyncCoop, personalTurns:this.personalTurns,supportReady:this.supportReady,supportChoices:this.supportChoices,contacts:this.contacts,drones:this.drones,detected:this.detected,refreshOwner:this.refreshOwner, units: this.units, round: this.round, activeSide: this.activeSide, outcome: this.outcome,
            revealedRooms: [...this.revealedRooms].sort((a, b) => a - b), field: this.field.snapshot(),
            formations: this.formations.snapshot(), nextFormationId: this.formations.nextId,
            objective: this.objective, rng: this.rng.state, debugEnabled: this.debugEnabled, controllers: this.controllers, seq: this.seq };
        return `${this.store.hash()}:${(voxelHp >>> 0).toString(16)}:${hashString(JSON.stringify(state)).toString(16)}`;
    }
}

function coverAgainstAll(battle, to, u) {
    let worst = 2;
    for (const e of battle.enemiesOf(u)) if (battle.visible?.has(e.id) || u.side !== 'player') worst = Math.min(worst, coverAgainst(battle.store, to.x, to.y, to.z, e.x, e.y, e.z));
    return worst;
}
