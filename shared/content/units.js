// Squad classes and hostile types (modern setting, human factions only). Ids are stable (saves, art folders, tests);
// names are what the player sees. `art` names the placeholder sprite set in client/public/assets/characters.
/** Every character has the same small pool; classes differ by armour, mobility, accuracy and kit. Gun damage comes
 *  from the round (shared/content/calibers.js), so a rifle hit is a third of anyone's health. */
export const UNIT_HP = 30;
export const BODY = Object.freeze({
    // Part hit points as a fraction of the unit's hp pool (Phoenix Point: parts share the pool).
    head: { share: 0.4, label: 'Head' }, torso: { share: 1.0, label: 'Torso' },
    armL: { share: 0.4, label: 'Left arm' }, armR: { share: 0.4, label: 'Right arm' }, legs: { share: 0.55, label: 'Legs' }
});
export const PARTS = Object.freeze(['head', 'torso', 'armL', 'armR', 'legs']);

export const CLASSES = Object.freeze({
    vanguard: { id: 'vanguard', name: 'Assault', role: 'Close quarters: shotgun, sidearm, knife', art: 'vanguard', hp: UNIT_HP, accuracy: 0.9, mobility: 3.4, will: 6, armor: 'medium',
        weapons: ['blunderbuss', 'handcannon', 'sword'], items: { fire_flask: 1, smoke_pot: 1 }, abilities: ['dash', 'rally'] },
    grenadier: { id: 'grenadier', name: 'Grenadier', role: 'Assault rifle, frag grenades, demolition', art: 'grenadier', hp: UNIT_HP, accuracy: 0.85, mobility: 2.9, will: 6, armor: 'heavy',
        weapons: ['repeater'], items: { powder_bomb: 2, gale_flask: 1 }, abilities: ['demolish', 'suppress'] },
    marksman: { id: 'marksman', name: 'Sharpshooter', role: 'Sniper rifle and sidearm; overwatch from height', art: 'marksman', hp: UNIT_HP, accuracy: 1.0, mobility: 3.1, will: 7, armor: 'light',
        weapons: ['longrifle', 'handcannon'], items: { smoke_pot: 1, frost_flask: 1 }, abilities: ['quick_aim', 'deadeye'] },
    warden: { id: 'warden', name: 'Breacher', role: 'Ballistic shield, suppressed carbine, breaching charges', art: 'warden', hp: UNIT_HP, accuracy: 0.88, mobility: 2.9, will: 7, armor: 'plate',
        weapons: ['crossbow', 'sword'], items: { breach_charge: 2, water_flask: 1 }, abilities: ['brace', 'rally'] }
});

export const ENEMIES = Object.freeze({
    cultist: { id: 'cultist', name: 'Gunman', faction: 'syndicate', art: 'cultist', hp: UNIT_HP, accuracy: 0.55, mobility: 3, will: 4, armor: 'light',
        weapons: ['musket', 'sword'], items: { fire_flask: 1 }, abilities: [] },
    archer: { id: 'archer', name: 'Lookout', faction: 'syndicate', art: 'archer', hp: UNIT_HP, accuracy: 0.64, mobility: 3.2, will: 4, armor: 'hide',
        weapons: ['shortbow'], items: {}, abilities: [] },
    pyromancer: { id: 'pyromancer', name: 'Arsonist', faction: 'syndicate', art: 'pyromancer', hp: UNIT_HP, accuracy: 0.68, mobility: 2.8, will: 6, armor: 'light',
        weapons: ['firelance'], items: { fire_flask: 2 }, abilities: [] },
    brute: { id: 'brute', name: 'Enforcer', faction: 'syndicate', art: 'brute', hp: UNIT_HP, accuracy: 0.6, mobility: 3.2, will: 6, armor: 'heavy',
        weapons: ['maul'], items: {}, abilities: [] },
    warden_foe: { id: 'warden_foe', name: 'Riot Guard', faction: 'syndicate', art: 'guard', hp: UNIT_HP, accuracy: 0.62, mobility: 2.8, will: 6, armor: 'plate',
        weapons: ['musket', 'sword'], items: {}, abilities: ['brace'] }
});

export const ABILITIES = Object.freeze({
    dash: { id: 'dash', name: 'Sprint', wp: 2, ap: 0, text: '+1 AP that can only be spent moving.' },
    rally: { id: 'rally', name: 'Rally', wp: 2, ap: 1, radius: 6, text: 'Allies within 6 lose 25 stress and gain 1 WP.' },
    demolish: { id: 'demolish', name: 'Demolition', wp: 1, ap: 0, text: 'Next shot or blast deals double damage to walls and cover.' },
    suppress: { id: 'suppress', name: 'Suppressive Fire', wp: 2, ap: 2, text: 'Burst at a target; it is Suppressed (spread ×1.6) until its next turn.' },
    quick_aim: { id: 'quick_aim', name: 'Snap Shot', wp: 2, ap: 0, text: 'Next shot costs 1 AP less.' },
    deadeye: { id: 'deadeye', name: 'Deadeye', wp: 3, ap: 0, text: 'Next shot has half the spread.' },
    brace: { id: 'brace', name: 'Shield Wall', wp: 1, ap: 1, text: '+4 armour on every part until your next turn.' }
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

/** Factions (human only for now). Themes pick a faction and flavour the hostile names. */
export const FACTIONS = Object.freeze({
    syndicate: { id: 'syndicate', name: 'The Syndicate', text: 'Organised crime crews holding homes, shops and warehouses.' }
});
/** Squad callsigns, dealt in order. */
export const CALLSIGNS = Object.freeze(['Reyes', 'Kowalski', 'Okafor', 'Tanaka', 'Moreau', 'Lindqvist', 'Haddad', 'Novak']);
