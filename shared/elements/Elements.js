// The voxel elemental system.
//
// Carries vibe-game's element model (ELEMENTS on every voxel, PLAN 15A §7.5 surface interactions:
// fire lights timber and oil, water douses, cold freezes wet ground) into the tactical layer and
// extends it to voxels: fire burns and spreads through flammable voxels, cold freezes water into
// walkable ice, heat melts ice, wind fans fires and clears smoke, earth (concussion) cracks stone.
//
// State lives in an ElementField next to the VoxelStore. All randomness comes from the battle RNG.
import { MAT, AIR, materialById } from '../voxel/Materials.js';
import { destroyVoxel, damageBand } from '../voxel/Destruction.js';

export const ELEMENT_IDS = Object.freeze(['pyro', 'hydro', 'cryo', 'anemo', 'geo']);
export const ELEMENT_COLORS = Object.freeze({ pyro: '#ff7a3d', hydro: '#4fc3f7', cryo: '#bfefff', anemo: '#b7f5c9', geo: '#e0c28a', physical: '#ffffff' });

/** Surface-effect interactions, ported verbatim from vibe-game shared/combat/Encounter.js. */
export function combineSurface(current, incoming) {
    if (!current) return incoming;
    if (incoming === 'burning' && current === 'wet') return null;
    if (incoming === 'burning' && current === 'frozen') return 'wet';
    if (incoming === 'frozen' && current === 'burning') return 'wet';
    if (incoming === 'wet' && current === 'burning') return null;
    if (incoming === 'frozen' && current !== 'wet') return current;
    return incoming;
}

/** Unit statuses (data, like vibe-game shared/content/statuses.js). */
export const STATUS_DEFS = Object.freeze({
    burning: { rounds: 2, dotPerRound: 3, removes: [], tags: ['fire'] },
    wet: { rounds: 2, removes: ['burning'], tags: ['water'] },
    chilled: { rounds: 2, maxStacks: 2, tags: ['cold'] },             // cryo on a dry unit: slower (B.chillMobility per stack)
    frozen: { rounds: 1, rooted: true, apPenalty: -2, tags: ['cold'] },   // cryo on a WET unit: rooted, -2 AP, easier to hit
    stunned: { rounds: 1, apPenalty: -2, tags: ['concussion'] },
    bleeding: { rounds: 3, dotPerRound: 2, tags: ['wound'] },
    suppressed: { rounds: 1, accuracyMult: 0.6, tags: ['fear'] },
    braced: { rounds: 1, armorBonus: 2, tags: ['buff'] },   // PLAN-15: was 4
    staggered: { rounds: 1, accuracyMult: 0.8, untilOwnTurn: true, tags: ['move'] },          // landed a jump: off balance until the next turn
    surprised: { rounds: 1, apPenalty: -1, noReaction: true, tags: ['breach'] },
    panicked: { rounds: 1, apMult: 0.5, noAbilities: true, tags: ['stress'] }
});

const key = (x, y, z) => `${x},${y},${z}`;
const parse = k => k.split(',').map(Number);
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class ElementField {
    constructor(store, { canBurn = null } = {}) {
        this.store = store;
        this.canBurn = canBurn;
        this.surfaces = new Map();  // surface voxel key → { effect, rounds }
        this.fires = new Map();     // burning voxel key → rounds left
        this.smoke = new Map();     // air voxel key → rounds left (blocks sight)
    }
    surfaceAt(x, y, z) { return this.surfaces.get(key(x, y, z))?.effect || null; }
    isSmoke(x, y, z) { return this.smoke.has(key(x, y, z)); }
    isBurning(x, y, z) { return this.fires.has(key(x, y, z)); }

    setSurface(x, y, z, effect, rounds = 2) {
        const k = key(x, y, z), cur = this.surfaces.get(k)?.effect || null;
        const next = combineSurface(cur, effect);
        if (next) this.surfaces.set(k, { effect: next, rounds }); else this.surfaces.delete(k);
        return next;
    }
    ignite(x, y, z, rounds = 3) {
        const m = materialById(this.store.get(x, y, z));
        if (!m.flammable || (this.canBurn && !this.canBurn(x, y, z))) return false;
        const k = key(x, y, z);
        if (this.surfaces.get(k)?.effect === 'wet') return false;
        this.fires.set(k, Math.max(rounds, this.fires.get(k) || 0));
        return true;
    }
    extinguish(x, y, z) { return this.fires.delete(key(x, y, z)); }
    addSmoke(cx, cy, cz, radius = 2, rounds = 2) {
        const out = [];
        for (let z = cz; z <= cz + 2; z++) for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius + 0.5) continue;
            if (this.store.get(x, y, z) !== AIR) continue;
            this.smoke.set(key(x, y, z), rounds); out.push([x, y, z]);
        }
        return out;
    }

    /**
     * An element arriving in a sphere (a flask, a blast, an elemental round's impact).
     * Returns a list of world changes for the event log.
     */
    applyArea(element, cx, cy, ch, radius) {
        const store = this.store, changes = [];
        const r2 = radius * radius;
        for (let z = Math.floor(ch - radius) - 1; z <= Math.ceil(ch + radius); z++)
            for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
                for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
                    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - ch) ** 2 > r2 + 0.75) continue;
                    if (!store.inBounds(x, y, z)) continue;
                    const id = store.get(x, y, z);
                    if (id === AIR) {
                        if (element === 'anemo' && this.smoke.delete(key(x, y, z))) changes.push({ t: 'smoke-cleared', x, y, z });
                        continue;
                    }
                    const m = materialById(id);
                    const isSurface = (m.walkable || m.liquid) && !store.isSolid(x, y, z + 1);
                    switch (element) {
                        case 'pyro':
                            if (m.family === 'ice' && m.meltTo) { store.set(x, y, z, MAT[m.meltTo]); changes.push({ t: 'melt', x, y, z }); break; }
                            if (m.flammable && this.ignite(x, y, z)) changes.push({ t: 'ignite', x, y, z });
                            if (isSurface) { const s = this.setSurface(x, y, z, 'burning'); changes.push({ t: 'surface', x, y, z, effect: s }); }
                            break;
                        case 'hydro':
                            if (this.extinguish(x, y, z)) changes.push({ t: 'extinguish', x, y, z });
                            if (id === MAT.lava) { store.set(x, y, z, MAT.stone_floor); changes.push({ t: 'cool', x, y, z }); break; }   // cooled lava is ground, not a wall module
                            if (isSurface && !m.liquid) { const s = this.setSurface(x, y, z, 'wet', 3); changes.push({ t: 'surface', x, y, z, effect: s }); }
                            break;
                        case 'cryo':
                            if (m.freezeTo && !store.isSolid(x, y, z + 1) && materialById(store.get(x, y, z + 1)).id === AIR) {
                                store.set(x, y, z, MAT[m.freezeTo]); changes.push({ t: 'freeze', x, y, z });
                                break;
                            }
                            if (this.extinguish(x, y, z)) changes.push({ t: 'extinguish', x, y, z });
                            if (isSurface && this.surfaceAt(x, y, z) === 'wet') { this.setSurface(x, y, z, 'frozen', 3); changes.push({ t: 'surface', x, y, z, effect: 'frozen' }); }
                            break;
                        case 'anemo':
                            // Wind fans flames into neighbouring flammable voxels.
                            if (this.fires.has(key(x, y, z))) for (const [dx, dy, dz] of NEIGHBOURS) {
                                if (this.ignite(x + dx, y + dy, z + dz)) changes.push({ t: 'ignite', x: x + dx, y: y + dy, z: z + dz });
                            }
                            break;
                        case 'geo':
                            break;   // concussion is handled by voxel damage multipliers
                    }
                }
        return changes;
    }

    /**
     * Round tick: fires burn their voxel (1 hp per round), may spread, and burn out; surfaces and smoke
     * fade. `rng` is the battle RNG. Returns change events and voxels destroyed by fire.
     */
    tick(rng, { spreadChance = 0.3, maxFires = 220 } = {}) {
        const store = this.store, changes = [], burnedOut = [], explosions = [];
        const keys = [...this.fires.keys()].sort();
        for (const k of keys) {
            const [x, y, z] = parse(k);
            const id = store.get(x, y, z), m = materialById(id);
            if (!m.flammable) { this.fires.delete(k); continue; }
            const hp = store.hpAt(x, y, z) - 1;
            if (hp <= 0) {
                this.fires.delete(k);
                if (m.burnTo && m.burnTo !== 'ash') store.set(x, y, z, MAT[m.burnTo]); else destroyVoxel(store, x, y, z);
                // Burn marks: the floor under it and the cells around it are blackened (PLAN-07).
                store.addScorch?.(x, y, z - 1, 2);
                for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]) store.addScorch?.(x + dx, y + dy, z + dz, 1);
                burnedOut.push([x, y, z, m.key]);
                if (m.explosive) explosions.push({ x: x + 0.5, y: y + 0.5, h: z + 0.5, ...m.explosive, source: m.key });
                changes.push({ t: 'burned', x, y, z });
            } else {
                store.hp[store.index(x, y, z)] = hp;
                if (damageBand(m, hp + 1) !== damageBand(m, hp)) store.markDirty(x, y, z);
                const left = this.fires.get(k) - 1;
                if (left <= 0) { this.fires.delete(k); changes.push({ t: 'burnout', x, y, z }); }
                else this.fires.set(k, left);
            }
            if (this.fires.size < maxFires && rng.next() < spreadChance) {
                const [dx, dy, dz] = NEIGHBOURS[Math.floor(rng.next() * NEIGHBOURS.length)];
                if (this.ignite(x + dx, y + dy, z + dz)) changes.push({ t: 'ignite', x: x + dx, y: y + dy, z: z + dz });
            }
        }
        for (const [k, s] of [...this.surfaces]) { if (--s.rounds <= 0) { this.surfaces.delete(k); const [x, y, z] = parse(k); if (s.effect === 'burning') store.addScorch?.(x, y, z, 2); changes.push({ t: 'surface', x, y, z, effect: null }); } }
        for (const [k, r] of [...this.smoke]) { if (r - 1 <= 0) this.smoke.delete(k); else this.smoke.set(k, r - 1); }
        return { changes, burnedOut, explosions };
    }

    snapshot() {
        return { surfaces: [...this.surfaces], fires: [...this.fires], smoke: [...this.smoke] };
    }
}

/** What an element does to a unit it hits (statuses only; damage is resolved by the battle). */
export function elementStatusesFor(element, unit) {
    const has = id => unit.statuses?.some(s => s.id === id);
    switch (element) {
        case 'pyro': return has('wet') ? [] : ['burning'];
        case 'hydro': return ['wet'];
        case 'cryo': return has('wet') ? ['frozen'] : ['chilled'];
        case 'geo': return ['stunned'];
        default: return [];
    }
}
