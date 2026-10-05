// Weapons and throwables. Every number here is a balance tunable; the sim (tools/sim) reports them.
//
// Phoenix Point model: a shot fires `projectiles` rays inside an accuracy cone (half-angle `spread`
// degrees at 100 % accuracy). Each ray is traced through voxels and body-part hitboxes; whatever it
// meets first takes the damage. Armour per body part subtracts from each projectile, reduced by
// `pierce`; `shred` permanently strips armour. `voxel` is the damage dealt to a voxel the ray hits.
//
// Setting: gunpowder fantasy (vibe-game's world) — repeaters, blunderbusses, long rifles, flasks.

export const WEAPONS = Object.freeze({
    repeater: { id: 'repeater', name: 'Repeater Rifle', kind: 'ballistic', ap: 2, projectiles: 3, damage: 5, pierce: 1, shred: 0,
        spread: 1.6, range: 18, maxRange: 34, ammo: 9, perShot: 3, reloadAp: 1, voxel: 1, noise: 14, element: null, cutIn: 'burst' },
    blunderbuss: { id: 'blunderbuss', name: 'Blunderbuss', kind: 'ballistic', ap: 2, projectiles: 8, damage: 3, pierce: 0, shred: 0,
        spread: 6.5, range: 7, maxRange: 14, ammo: 4, perShot: 1, reloadAp: 1, voxel: 1, noise: 14, element: null, cutIn: 'shot' },
    longrifle: { id: 'longrifle', name: 'Long Rifle', kind: 'ballistic', ap: 3, projectiles: 1, damage: 12, pierce: 3, shred: 0,
        spread: 0.6, range: 30, maxRange: 48, ammo: 3, perShot: 1, reloadAp: 1, voxel: 3, noise: 18, element: null, cutIn: 'heavy' },
    handcannon: { id: 'handcannon', name: 'Hand Cannon', kind: 'ballistic', ap: 1, projectiles: 1, damage: 6, pierce: 1, shred: 0,
        spread: 1.8, range: 12, maxRange: 22, ammo: 6, perShot: 1, reloadAp: 1, voxel: 1, noise: 12, element: null, cutIn: 'shot' },
    crossbow: { id: 'crossbow', name: 'Crossbow', kind: 'ballistic', ap: 2, projectiles: 1, damage: 7, pierce: 2, shred: 0,
        spread: 0.9, range: 20, maxRange: 32, ammo: 4, perShot: 1, reloadAp: 1, voxel: 1, noise: 2, element: null, cutIn: 'shot' },
    shortbow: { id: 'shortbow', name: 'Shortbow', kind: 'ballistic', ap: 2, projectiles: 1, damage: 6, pierce: 2, shred: 0,
        spread: 1.2, range: 16, maxRange: 26, ammo: 8, perShot: 1, reloadAp: 1, voxel: 0, noise: 2, element: null, cutIn: 'shot' },
    musket: { id: 'musket', name: 'Cult Musket', kind: 'ballistic', ap: 2, projectiles: 1, damage: 7, pierce: 1, shred: 0,
        spread: 1.6, range: 16, maxRange: 28, ammo: 3, perShot: 1, reloadAp: 1, voxel: 2, noise: 14, element: null, cutIn: 'shot' },
    firelance: { id: 'firelance', name: 'Fire Lance', kind: 'ballistic', ap: 2, projectiles: 5, damage: 3, pierce: 0, shred: 0,
        spread: 4.2, range: 8, maxRange: 12, ammo: 3, perShot: 1, reloadAp: 1, voxel: 1, noise: 10, element: 'pyro', cutIn: 'heavy' },
    sword: { id: 'sword', name: 'Sabre', kind: 'melee', ap: 1, damage: 6, pierce: 2, shred: 0, reach: 1.5, voxel: 1, noise: 4, cutIn: 'melee' },
    maul: { id: 'maul', name: 'Siege Maul', kind: 'melee', ap: 2, damage: 9, pierce: 3, shred: 1, reach: 1.5, voxel: 4, knockback: 2, noise: 8, cutIn: 'melee' }
});

export const THROWABLES = Object.freeze({
    fire_flask: { id: 'fire_flask', name: 'Fire Flask', ap: 2, range: 12, radius: 2.2, damage: 4, power: 2, element: 'pyro', noise: 10, cutIn: 'throw' },
    frost_flask: { id: 'frost_flask', name: 'Frost Flask', ap: 2, range: 12, radius: 2.5, damage: 3, power: 1, element: 'cryo', noise: 8, cutIn: 'throw' },
    water_flask: { id: 'water_flask', name: 'Water Flask', ap: 1, range: 12, radius: 2.6, damage: 0, power: 0, element: 'hydro', noise: 4, cutIn: 'throw' },
    gale_flask: { id: 'gale_flask', name: 'Gale Flask', ap: 2, range: 12, radius: 2.5, damage: 2, power: 2, element: 'anemo', knockback: 2, noise: 8, cutIn: 'throw' },
    powder_bomb: { id: 'powder_bomb', name: 'Powder Bomb', ap: 2, range: 11, radius: 2.6, damage: 8, power: 8, element: 'geo', shred: 1, noise: 18, cutIn: 'throw' },
    smoke_pot: { id: 'smoke_pot', name: 'Smoke Pot', ap: 1, range: 12, radius: 3, damage: 0, power: 0, element: null, smoke: 3, noise: 4, cutIn: 'throw' },
    breach_charge: { id: 'breach_charge', name: 'Breach Charge', ap: 2, range: 1.6, radius: 1.7, damage: 4, power: 16, element: 'geo', placed: true, noise: 16, cutIn: 'breach' }
});

export const ARMOR = Object.freeze({
    light: { head: 0, torso: 1, armL: 0, armR: 0, legs: 0, mobility: 0 },
    medium: { head: 0, torso: 2, armL: 1, armR: 1, legs: 1, mobility: -0.2 },
    heavy: { head: 1, torso: 3, armL: 2, armR: 2, legs: 2, mobility: -0.4 },
    hide: { head: 0, torso: 1, armL: 0, armR: 0, legs: 0, mobility: 0 },
    plate: { head: 2, torso: 4, armL: 3, armR: 3, legs: 3, mobility: -0.4 }
});
