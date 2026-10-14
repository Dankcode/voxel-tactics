import { initializeEquipment, loadPenalty } from '../inventory/Equipment.js';
import { packItems } from '../inventory/Inventory.js';
// Units: Phoenix Point body parts on an XCOM-style squad member, plus Will and Stress.
import { CLASSES, ENEMIES, PARTS, BODY } from '../content/units.js';
import { ARMOR, WEAPONS, THROWABLES } from '../content/weapons.js';
import { STATUS_DEFS } from '../elements/Elements.js';
import { B } from '../content/balance.js';

export const FACINGS = Object.freeze(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
export const FACING_VEC = Object.freeze({ n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] });

export function facingToward(dx, dy) {
    if (!dx && !dy) return 's';
    const a = Math.atan2(dy, dx);                      // 0 = east, +π/2 = south
    const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'][i];
}

export function createUnit(typeId, side, pos, id, overrides = {}) {
    const def = CLASSES[typeId] || ENEMIES[typeId];
    if (!def) throw new Error(`unknown unit type ${typeId}`);
    const armor = ARMOR[def.armor] || ARMOR.light;
    const parts = {};
    for (const p of PARTS) {
        const max = Math.max(1, Math.round(def.hp * BODY[p].share));
        parts[p] = { hp: max, max, armor: armor[p] || 0, disabled: false };
    }
    const ammo = {};
    for (const w of def.weapons) if (WEAPONS[w]?.ammo) ammo[w] = WEAPONS[w].ammo;
    const unit = {
        id, type: typeId, name: overrides.name || def.name, art: def.art, side, owner: overrides.owner || side,
        x: pos.x, y: pos.y, z: pos.z, facing: overrides.facing || (side === 'player' ? 'n' : 's'),
        hp: def.hp, maxHp: def.hp, parts, accuracy: def.accuracy, mobility: def.mobility + (armor.mobility || 0),
        ap: B.apPerTurn, maxAp: B.apPerTurn, moveOnlyAp: 0, will: def.will, maxWill: def.will, stress: 0,
        weapons: def.weapons.slice(), weapon: def.weapons[0], ammo, items: { ...def.items }, inventory:packItems(def.items), abilities: def.abilities.slice(),
        statuses: [], overwatch: null, reactionsLeft: 1, alerted: side === 'player', group: overrides.group ?? null,
        down: false, dead: false, formationId: null, buffs: {}, stats: { shots: 0, hits: 0, damage: 0, kills: 0 },
        ...overrides.extra
    };
    initializeEquipment(unit,def);
    return unit;
}

/** On the map and able to act (not dead, downed or extracted). */
export const alive = u => !u.dead && !u.down && !u.extracted;
export const hasStatus = (u, id) => u.statuses.some(s => s.id === id);
export function addStatus(u, id, rounds) {
    const def = STATUS_DEFS[id]; if (!def) return null;
    for (const r of def.removes || []) u.statuses = u.statuses.filter(s => s.id !== r);
    if (id === 'burning' && hasStatus(u, 'wet')) return null;
    const cur = u.statuses.find(s => s.id === id);
    if (cur) { cur.rounds = Math.max(cur.rounds, rounds ?? def.rounds); cur.stacks = Math.min(def.maxStacks || 1, (cur.stacks || 1) + 1); return cur; }
    const s = { id, rounds: rounds ?? def.rounds, stacks: 1 };
    u.statuses.push(s);
    return s;
}
export function removeStatus(u, id) { u.statuses = u.statuses.filter(s => s.id !== id); }

/** Accuracy multiplier from wounds, stress and statuses (1 = as trained). */
export function accuracyMult(u) {
    let m = u.accuracy;
    const arms = ['armL', 'armR'].filter(p => u.parts[p].disabled).length;
    if (arms === 1) m *= 0.75; else if (arms === 2) m *= 0.5;
    if (u.parts.head.disabled) m *= 0.8;
    if (hasStatus(u, 'suppressed')) m *= STATUS_DEFS.suppressed.accuracyMult;
    if (hasStatus(u, 'staggered')) m *= STATUS_DEFS.staggered.accuracyMult;
    if (u.stress >= 75) m *= 0.9;
    return m;
}
export function mobilityPerAp(u, formationPenalty = 0) {
    let m = (u.mobility + formationPenalty)*(1-loadPenalty(u));
    if (u.parts.legs.disabled) m *= 0.5;
    if (hasStatus(u, 'frozen')) return 0;
    return Math.max(0.5, m);
}
export function partArmor(u, part) { return u.parts[part].armor + (hasStatus(u, 'braced') ? STATUS_DEFS.braced.armorBonus : 0); }
export function weaponOf(u, id = u.weapon) { return WEAPONS[id]; }
export function throwableOf(id) { return THROWABLES[id]; }
/** World-space feet position (centre of the tile, top of the surface voxel). */
export const feet = u => ({ x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1 });
export const EYE = 1.55, SHOULDER = 1.35, CHEST = 1.05;
