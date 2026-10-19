// Squad classes and hostile types (modern setting with experimental climbing constructs). Ids are stable (saves, art folders, tests);
// names are what the player sees. `art` names the placeholder sprite set in client/public/assets/characters.
/** Human characters have the same small pool; constructs have larger pools; classes differ by armour, mobility, accuracy and kit. Gun damage comes
 *  from the round (shared/content/calibers.js), so a rifle hit is a third of anyone's health. */
export const UNIT_HP = 30;
export const BODY = Object.freeze({
    // Part hit points as a fraction of the unit's hp pool (Phoenix Point: parts share the pool).
    head: { share: 0.4, label: 'Head' }, torso: { share: 1.0, label: 'Torso' },
    armL: { share: 0.4, label: 'Left arm' }, armR: { share: 0.4, label: 'Right arm' }, legs: { share: 0.55, label: 'Legs' }
});
export const PARTS = Object.freeze(['head', 'torso', 'armL', 'armR', 'legs']);

// `name` is the classic (default) role. Intel co-op rules (experimental, opt-in) add sensing abilities and show
// `intelName` / `intelRole` instead; see displayName().
export const CLASSES = Object.freeze({
    vanguard: { id: 'vanguard', name: 'Assault', role: 'Close quarters: shotgun, sidearm, knife', intelName: 'Faultfinder', intelRole: 'Seismic sensing through grounded terrain; terrain shaping', art: 'vanguard', hp: UNIT_HP, accuracy: 0.9, mobility: 3.4, will: 6, armor: 'medium',
        weapons: ['blunderbuss', 'handcannon', 'sword'], items: { fire_flask: 1, smoke_pot: 1 }, abilities: ['seismic_sense', 'earth_cover', 'dash'] },
    grenadier: { id: 'grenadier', name: 'Grenadier', role: 'Assault rifle, frag grenades, demolition', intelName: 'Tidekeeper', intelRole: 'Water-linked enemy sensing; healing and suppression', art: 'grenadier', hp: UNIT_HP, accuracy: 0.85, mobility: 2.9, will: 6, armor: 'heavy',
        weapons: ['repeater'], items: { powder_bomb: 2, gale_flask: 1 }, abilities: ['water_sense', 'water_mend', 'demolish', 'suppress'] },
    marksman: { id: 'marksman', name: 'Sharpshooter', role: 'Sniper rifle and sidearm; overwatch from height', intelName: 'Skywatch', intelRole: 'Scout drone reconnaissance; precision engagement', art: 'marksman', hp: UNIT_HP, accuracy: 1.0, mobility: 3.1, will: 7, armor: 'light',
        weapons: ['longrifle', 'handcannon'], items: { smoke_pot: 1, frost_flask: 1 }, abilities: ['scout_drone', 'quick_aim', 'deadeye'] },
    warden: { id: 'warden', name: 'Breacher', role: 'Ballistic shield, suppressed carbine, breaching charges', intelName: 'Ghostwright', intelRole: 'Quiet wall cutting; protected infiltration', art: 'warden', hp: UNIT_HP, accuracy: 0.88, mobility: 2.9, will: 7, armor: 'plate',
        weapons: ['crossbow', 'sword'], items: { breach_charge: 2, water_flask: 1 }, abilities: ['quiet_cut', 'brace', 'rally'] }
});

export const ENEMIES = Object.freeze({
    wall_strider: {id:'wall_strider',name:'Wall Strider',faction:'construct',art:'wall_strider',hp:60,accuracy:.7,mobility:2.6,will:6,armor:'medium',weapons:['strider_claws'],items:{},abilities:['smash'],role:'Four-legged melee monster; five occupied tiles. Climbs facades, smashes through walls and claws whatever it reaches.'},
    siege_weaver: {id:'siege_weaver',name:'Siege Weaver',faction:'construct',art:'siege_weaver',hp:90,accuracy:.65,mobility:1.8,will:8,armor:'heavy',weapons:['repeater'],items:{},abilities:[],role:'Six articulated legs; seven occupied tiles across a five-tile span. Armoured climbing gun platform.'},
    cultist: { id: 'cultist', name: 'Gunman', faction: 'syndicate', art: 'cultist', hp: UNIT_HP, accuracy: 0.55, mobility: 3, will: 4, armor: 'light',
        weapons: ['musket', 'sword'], items: { fire_flask: 1, water_flask: 1 }, abilities: [] },
    archer: { id: 'archer', name: 'Lookout', intelName: 'Drone Hunter', droneDetector: true, faction: 'syndicate', art: 'archer', hp: UNIT_HP, accuracy: 0.64, mobility: 3.2, will: 4, armor: 'hide',
        weapons: ['shortbow'], items: { frost_flask: 1, smoke_pot: 1 }, abilities: [] },
    pyromancer: { id: 'pyromancer', name: 'Arsonist', faction: 'syndicate', art: 'pyromancer', hp: UNIT_HP, accuracy: 0.68, mobility: 2.8, will: 6, armor: 'light',
        weapons: ['firelance'], items: { fire_flask: 2 }, abilities: [] },
    brute: { id: 'brute', name: 'Enforcer', faction: 'syndicate', art: 'brute', hp: UNIT_HP, accuracy: 0.6, mobility: 3.2, will: 6, armor: 'heavy',
        weapons: ['maul'], items: { smoke_pot: 1 }, abilities: [] },
    warden_foe: { id: 'warden_foe', name: 'Riot Guard', faction: 'syndicate', art: 'guard', hp: UNIT_HP, accuracy: 0.62, mobility: 2.8, will: 6, armor: 'plate',
        weapons: ['musket', 'sword'], items: {}, abilities: ['brace', 'earth_cover'] }
});

export const ABILITIES = Object.freeze({
    killstreak_strike:{id:'killstreak_strike',name:'Airstrike',commander:true,targeting:'tile',wp:0,ap:0,range:40,text:'Ready at the start of the mission and again 10 rounds after each use. Three bombs fall together somewhere inside the marked 15 x 9 rectangle (long side along your facing; each blast stays inside it). Craters stay one level deep on open ground; buildings lose up to two storeys. Damages allies too.'},
    seismic_sense: {id:'seismic_sense',name:'Seismic Sense',intel:true,wp:1,ap:1,text:'Share grounded enemy contacts within 14 tiles and two levels, through walls. Contacts are snapshots.'},
    water_sense: {id:'water_sense',name:'Water Sense',intel:true,wp:1,ap:1,text:'Share contacts within 14 tiles near water, through walls. Contacts are snapshots.'},
    scout_drone: {id:'scout_drone',name:'Scout Drone',intel:true,targeting:'tile',range:18,wp:1,ap:1,text:'Scout from a tile within 18. Drone sees 10 tiles through clear sight. Enemies detect within 2; Drone Hunters within 8. Recast to reposition.'},
    quiet_cut: {id:'quiet_cut',name:'Quiet Cut',intel:true,targeting:'tile',range:3,wp:1,ap:1,text:'Remove two wall voxels within 3 without noise. Enemy sight can still expose you.'},
    carpet_bomb: {id:'carpet_bomb',name:'Airstrike',intel:true,support:true,targeting:'tile',wp:0,ap:1,text:'Three heavy bombs fall together somewhere inside the marked 15 x 9 rectangle (long side along your facing; each blast stays inside it). Craters stay one level deep on open ground; buildings lose up to two storeys. Damages allies too. Recharges after 10 of your turns.'},
    orbital_laser: {id:'orbital_laser',name:'Orbital Laser',intel:true,support:true,targeting:'tile',wp:0,ap:1,text:'Cut a 33-tile line, 5 wide, along your facing: everything standing in it is destroyed down to the ground floor. Damages allies too. Recharges after 10 of your turns.'},
    earth_cover: { id: 'earth_cover', name: 'Earth Cover', element: 'geo', targeting: 'tile', wp: 2, ap: 1, range: 6, text: 'Raise destructible half cover on an empty visible tile within 6. Persists until destroyed.' },
    smash: { id: 'smash', name: 'Wall Smash', monster: true, targeting: 'tile', wp: 0, ap: 1, range: 3, text: 'Walker monsters: tear through walls and cover within 3 tiles of the body, two storeys high, battering anyone behind.' },
    water_mend: { id: 'water_mend', name: 'Water Mend', element: 'hydro', targeting: 'ally', wp: 2, ap: 1, range: 6, heal: 8, text: 'Restore 8 HP to a visible living ally within 6 and extinguish burning. Disabled limbs stay disabled.' },
    dash: { id: 'dash', name: 'Sprint', wp: 2, ap: 0, text: '+1 AP that can only be spent moving.' },
    rally: { id: 'rally', name: 'Rally', wp: 2, ap: 1, radius: 6, text: 'Allies within 6 lose 25 stress and gain 1 WP.' },
    demolish: { id: 'demolish', name: 'Demolition', wp: 1, ap: 0, text: 'Next shot or blast deals double damage to walls and cover.' },
    suppress: { id: 'suppress', name: 'Suppressive Fire', wp: 2, ap: 2, text: 'Burst at a visible target; it is Suppressed (accuracy ×0.6) for two own turns.' },
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

/** The name a unit type shows: its intel role name under the opt-in intel co-op rules, else the classic name. */
export function displayName(type, intelMode = false) {
    const def = CLASSES[type] || ENEMIES[type];
    return (intelMode && def?.intelName) || def?.name || type;
}
