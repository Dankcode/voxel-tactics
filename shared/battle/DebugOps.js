import { packItems, inventoryCounts } from '../inventory/Inventory.js';
// Debug intents: `{ type: 'debug', op, ... }`. They go through Battle.apply like every other intent, so the
// event player animates them and lockstep peers stay in sync, but Battle only accepts them when it was
// created with `debug: true` (local sessions with ?debug=1, or an online room created in debug mode).
//
// ops: ap, heal, kill, god, stress, status, refill, teleport, spawn, destroy, place, explode, element, smoke,
//      reveal, alert, endSide, controlSide
import { MAT, AIR, materialByKey } from '../voxel/Materials.js';
import { destroyVoxel } from '../voxel/Destruction.js';
import { createUnit, alive, addStatus } from './Units.js';
import { CLASSES, ENEMIES } from '../content/units.js';
import { WEAPONS } from '../content/weapons.js';
import { STATUS_DEFS } from '../elements/Elements.js';

export const DEBUG_OPS = ['ap', 'heal', 'kill', 'god', 'stress', 'status', 'refill', 'teleport', 'spawn', 'destroy', 'place', 'explode', 'element', 'smoke', 'reveal', 'alert', 'endSide', 'controlSide'];
const ELEMENTS = ['pyro', 'cryo', 'hydro', 'anemo', 'geo'];

/** Nearest free standing spot to a requested tile (debug spawns/teleports shouldn't need pixel-perfect clicks). */
export function freeSpotNear(b, to, ignoreId = null, radius = 3) {
    let best = null, bd = Infinity;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        for (const s of b.store.surfaces(to.x + dx, to.y + dy)) {
            if (s.headroom < 2) continue;
            const o = b.occupant(s.x, s.y, s.z); if (o && o.id !== ignoreId) continue;
            const d = Math.hypot(dx, dy) + Math.abs(s.z - (to.z ?? s.z)) * 1.5;
            if (d < bd) { bd = d; best = { x: s.x, y: s.y, z: s.z }; }
        }
    }
    return best;
}

export function validateDebug(b, i) {
    if (!b.debugEnabled) return 'debug_disabled';
    if ((i.op === 'teleport' || i.op === 'spawn') && i.to) { const spot = freeSpotNear(b, i.to, i.unitId); if (spot) i.to = spot; }
    if (!DEBUG_OPS.includes(i.op)) return 'bad_intent';
    const needsUnit = ['ap', 'heal', 'kill', 'god', 'stress', 'status', 'refill', 'teleport'];
    if (needsUnit.includes(i.op) && !b.unit(i.unitId)) return 'no_unit';
    const at = i.at || i.to;
    if (['teleport', 'spawn', 'destroy', 'place', 'explode', 'element', 'smoke'].includes(i.op)) {
        if (!at || !b.store.inBounds(Math.floor(at.x), Math.floor(at.y), Math.max(0, Math.floor(at.z ?? at.h ?? 0)))) return 'out_of_bounds';
    }
    if (i.op === 'teleport' || i.op === 'spawn') {
        const s = b.store.surfaces(i.to.x, i.to.y).find(s => s.z === i.to.z);
        if (!s || s.headroom < 2) return 'no_footing';
        const o = b.occupant(i.to.x, i.to.y, i.to.z); if (o && o.id !== i.unitId) return 'occupied';
    }
    if (i.op === 'spawn' && !(CLASSES[i.unitType] || ENEMIES[i.unitType])) return 'bad_unit_type';
    if (i.op === 'place' && !(i.material in MAT)) return 'bad_material';
    if (i.op === 'element' && !ELEMENTS.includes(i.element)) return 'bad_element';
    if (i.op === 'status' && !STATUS_DEFS[i.status]) return 'bad_status';
    return null;
}

export function applyDebug(b, i) {
    const u = i.unitId ? b.unit(i.unitId) : null;
    const note = extra => b.emit({ t: 'debug', op: i.op, unitId: u?.id, ...extra });
    switch (i.op) {
        case 'ap': u.ap = Math.max(0, u.ap + (i.amount ?? 4)); note({ ap: u.ap }); break;
        case 'heal':
            if (u.dead || u.down) { u.dead = false; u.down = false; }
            u.hp = u.maxHp;
            for (const p of Object.values(u.parts)) { p.hp = p.max; p.disabled = false; }
            u.statuses = []; u.stress = 0;
            note({ hp: u.hp }); break;
        case 'kill': if (alive(u)) b.kill(u, 'debug'); break;
        case 'god': u.god = i.on ?? !u.god; note({ god: u.god }); break;
        case 'stress': b.addStress(u, i.amount ?? 25, 'debug'); break;
        case 'status': b.giveStatus(u, i.status, i.rounds ?? 2); break;
        case 'refill':
            for (const w of u.weapons) if (WEAPONS[w]?.ammo) u.ammo[w] = WEAPONS[w].ammo;
            for (const k of Object.keys(u.items)) while((u.items[k]||0)<2){const counts={...u.items,[k]:(u.items[k]||0)+1};try{const slots=packItems(counts);u.inventory=slots;u.items=inventoryCounts(slots);}catch{break;}}
            u.will = u.maxWill; note({}); break;
        case 'teleport': {
            const from = { x: u.x, y: u.y, z: u.z };
            u.x = i.to.x; u.y = i.to.y; u.z = i.to.z;
            b.emit({ t: 'debug', op: 'teleport', unitId: u.id, from, to: { ...i.to } });
            if (u.side === 'player') b.revealRoomOf(u);
            break;
        }
        case 'spawn': {
            const side = i.side || (ENEMIES[i.unitType] ? 'enemy' : 'player');
            const id = `${side === 'player' ? 'p' : 'e'}${b.units.length}d`;
            const groups = b.units.filter(x => x.side === 'enemy').map(x => x.group ?? 0);
            const nu = createUnit(i.unitType, side, i.to, id, { group: side === 'enemy' ? (i.group ?? Math.max(-1, ...groups) + 1) : null,
                owner: side === 'player' ? 'player' : 'enemy', name: side === 'player' ? `${CLASSES[i.unitType]?.name || i.unitType} ${b.units.length + 1}` : undefined });
            if (side === 'enemy' && i.alerted) nu.alerted = true;
            if (side !== b.activeSide) nu.ap = 0;
            b.units.push(nu);
            b.emit({ t: 'spawn', unitId: id, side, unitType: i.unitType });
            break;
        }
        case 'destroy': {
            const r = i.radius ?? 0;
            const changes = b.store.record(() => {
                for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                    if (Math.hypot(dx, dy, dz) > r + 0.01) continue;
                    const x = i.at.x + dx, y = i.at.y + dy, z = i.at.z + dz;
                    if (z <= 0 || !b.store.inBounds(x, y, z) || b.store.get(x, y, z) === AIR) continue;
                    if (i.rubble) destroyVoxel(b.store, x, y, z); else b.store.set(x, y, z, AIR);
                    b.stats.voxelsDestroyed++;
                }
                b.settle();
            });
            if (changes.length) b.emit({ t: 'voxels', changes });
            b.checkFalls();
            break;
        }
        case 'place': {
            const m = materialByKey(i.material), r = i.radius ?? 0, h = i.height ?? 1;
            const changes = b.store.record(() => {
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let k = 0; k < h; k++) {
                    const x = i.at.x + dx, y = i.at.y + dy, z = i.at.z + k;
                    if (!b.store.inBounds(x, y, z) || b.occupant(x, y, z - 1) || b.occupant(x, y, z - 2)) continue;
                    b.store.set(x, y, z, m.id);
                }
            });
            if (changes.length) b.emit({ t: 'voxels', changes });
            break;
        }
        case 'explode':
            b.explode({ x: i.at.x, y: i.at.y, h: i.at.h ?? i.at.z, radius: i.radius ?? 2.5, power: i.power ?? 10, damage: i.damage ?? 6, element: i.element || 'pyro', by: null, item: null });
            break;
        case 'element': b.elementImpact(i.element, { x: i.at.x, y: i.at.y, h: i.at.h ?? i.at.z }, i.radius ?? 2); break;
        case 'smoke': {
            const cells = b.field.addSmoke(i.at.x - 0.5, i.at.y - 0.5, Math.floor((i.at.h ?? i.at.z) - 0.5), i.radius ?? 2.5, i.rounds ?? 3);
            b.emit({ t: 'smoke', x: i.at.x, y: i.at.y, h: i.at.h ?? i.at.z, radius: i.radius ?? 2.5, cells });
            break;
        }
        case 'reveal': for (const r of b.mission.rooms) if (!b.revealedRooms.has(r.id)) { b.revealedRooms.add(r.id); b.emit({ t: 'reveal', roomId: r.id }); } break;
        case 'alert': b.alertGroup([...new Set(b.units.filter(x => x.side === 'enemy').map(x => x.group))], 'debug'); break;
        case 'endSide': b.endTurn(b.activeSide); break;
        case 'controlSide': b.controllers[i.side] = i.controller; note({ side: i.side, controller: i.controller }); break;
    }
}
export { addStatus };
