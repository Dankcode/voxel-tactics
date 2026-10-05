// Soldier classes and enemy types. `art` names the placeholder sprite set in client/public/assets/characters.
export const BODY = Object.freeze({
    // Part hit points as a fraction of the unit's hp pool (Phoenix Point: parts share the pool).
    head: { share: 0.4, label: 'Head' }, torso: { share: 1.0, label: 'Torso' },
    armL: { share: 0.4, label: 'Left arm' }, armR: { share: 0.4, label: 'Right arm' }, legs: { share: 0.55, label: 'Legs' }
});
export const PARTS = Object.freeze(['head', 'torso', 'armL', 'armR', 'legs']);

export const CLASSES = Object.freeze({
    vanguard: { id: 'vanguard', name: 'Vanguard', art: 'vanguard', hp: 22, accuracy: 0.85, mobility: 3.4, will: 6, armor: 'medium',
        weapons: ['blunderbuss', 'handcannon', 'sword'], items: { fire_flask: 2 }, abilities: ['dash', 'rally'] },
    grenadier: { id: 'grenadier', name: 'Grenadier', art: 'grenadier', hp: 24, accuracy: 0.8, mobility: 2.9, will: 6, armor: 'heavy',
        weapons: ['repeater'], items: { powder_bomb: 2, breach_charge: 2, gale_flask: 1 }, abilities: ['demolish', 'suppress'] },
    marksman: { id: 'marksman', name: 'Marksman', art: 'marksman', hp: 18, accuracy: 1.0, mobility: 3.1, will: 7, armor: 'light',
        weapons: ['longrifle', 'handcannon'], items: { smoke_pot: 1, frost_flask: 1 }, abilities: ['quick_aim', 'deadeye'] },
    warden: { id: 'warden', name: 'Warden', art: 'warden', hp: 26, accuracy: 0.82, mobility: 2.9, will: 7, armor: 'plate',
        weapons: ['crossbow', 'sword'], items: { water_flask: 1, frost_flask: 1 }, abilities: ['brace', 'rally'] }
});

export const ENEMIES = Object.freeze({
    cultist: { id: 'cultist', name: 'Ash Cultist', art: 'cultist', hp: 14, accuracy: 0.7, mobility: 3, will: 4, armor: 'light',
        weapons: ['musket', 'sword'], items: { fire_flask: 1 }, abilities: [] },
    archer: { id: 'archer', name: 'Cult Archer', art: 'archer', hp: 12, accuracy: 0.85, mobility: 3.2, will: 4, armor: 'hide',
        weapons: ['shortbow'], items: {}, abilities: [] },
    pyromancer: { id: 'pyromancer', name: 'Pyromancer', art: 'pyromancer', hp: 16, accuracy: 0.75, mobility: 2.8, will: 6, armor: 'light',
        weapons: ['firelance'], items: { fire_flask: 2 }, abilities: [] },
    brute: { id: 'brute', name: 'Brute', art: 'brute', hp: 30, accuracy: 0.6, mobility: 3.2, will: 6, armor: 'heavy',
        weapons: ['maul'], items: {}, abilities: [] },
    warden_foe: { id: 'warden_foe', name: 'Oath Guard', art: 'guard', hp: 22, accuracy: 0.75, mobility: 2.8, will: 6, armor: 'plate',
        weapons: ['musket', 'sword'], items: {}, abilities: ['brace'] }
});

export const ABILITIES = Object.freeze({
    dash: { id: 'dash', name: 'Dash', wp: 2, ap: 0, text: '+1 AP that can only be spent moving.' },
    rally: { id: 'rally', name: 'Rally', wp: 2, ap: 1, radius: 6, text: 'Allies within 6 lose 25 stress and gain 1 WP.' },
    demolish: { id: 'demolish', name: 'Demolish', wp: 1, ap: 0, text: 'Next shot or blast deals double damage to voxels.' },
    suppress: { id: 'suppress', name: 'Suppressive Fire', wp: 2, ap: 2, text: 'Burst at a target; it is Suppressed (spread ×1.6) until its next turn.' },
    quick_aim: { id: 'quick_aim', name: 'Quick Aim', wp: 2, ap: 0, text: 'Next shot costs 1 AP less.' },
    deadeye: { id: 'deadeye', name: 'Deadeye', wp: 3, ap: 0, text: 'Next shot has half the spread.' },
    brace: { id: 'brace', name: 'Brace', wp: 1, ap: 1, text: '+4 armour on every part until your next turn.' }
});

export const SQUADS = Object.freeze({
    standard: ['vanguard', 'grenadier', 'marksman', 'warden'],
    assault: ['vanguard', 'vanguard', 'grenadier', 'warden'],
    ranged: ['marksman', 'marksman', 'grenadier', 'warden']
});
export const ENEMY_PODS = Object.freeze({
    patrol: ['cultist', 'cultist', 'archer'],
    fire: ['pyromancer', 'cultist'],
    guard: ['warden_foe', 'warden_foe', 'archer'],
    brute: ['brute', 'cultist']
});
