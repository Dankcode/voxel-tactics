// Deterministic, code-authored landmark catalog. These are compact blueprint specifications,
// not FMG town/building payloads: the runtime combines them with burg-derived district,
// terrain, wall and occupancy constraints before the contextual WFC completes each settlement.

const SILHOUETTES = Object.freeze({
    compact: Object.freeze({
        layout: Object.freeze([
            '##D#',
            '#..#',
            '#..#',
            '#..#',
            '####'
        ]),
        stories: 1,
        archetype: 'cottage',
        architectureStyle: 'gabled'
    }),
    square: Object.freeze({
        layout: Object.freeze([
            '######',
            '#....#',
            '#....#',
            '#....#',
            '#....#',
            '###D##'
        ]),
        stories: 2,
        archetype: 'house',
        architectureStyle: 'townhouse'
    }),
    tower: Object.freeze({
        layout: Object.freeze([
            '##D##',
            '#...#',
            '#...#',
            '#...#',
            '#...#',
            '#...#',
            '#####'
        ]),
        stories: 3,
        archetype: 'tower',
        architectureStyle: 'tower'
    }),
    longhall: Object.freeze({
        layout: Object.freeze([
            '####D###',
            '#......#',
            '#......#',
            '#......#',
            '#......#',
            '#......#',
            '########'
        ]),
        stories: 2,
        archetype: 'hall',
        architectureStyle: 'market'
    }),
    deepHall: Object.freeze({
        layout: Object.freeze([
            '##D###',
            '#....#',
            '#....#',
            '#....#',
            '#....#',
            '#....#',
            '#....#',
            '######'
        ]),
        stories: 2,
        archetype: 'manor',
        architectureStyle: 'gabled'
    }),
    bay: Object.freeze({
        layout: Object.freeze([
            '###D###',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#######'
        ]),
        stories: 2,
        archetype: 'bayfront',
        architectureStyle: 'bayfront'
    }),
    courtyard: Object.freeze({
        layout: Object.freeze([
            '###D###',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#######'
        ]),
        stories: 2,
        archetype: 'hall',
        architectureStyle: 'courtyard'
    }),
    grand: Object.freeze({
        layout: Object.freeze([
            '####D####',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#########'
        ]),
        stories: 3,
        archetype: 'manor',
        architectureStyle: 'keep'
    })
});

const DISTRICT_FAMILIES = Object.freeze([
    Object.freeze({
        district: 'castle',
        districts: Object.freeze(['castle', 'civic']),
        style: 'stone',
        terrain: 'settlement',
        roofStyles: Object.freeze(['tower', 'slate', 'copper', 'tower', 'slate', 'copper', 'slate', 'gabled']),
        entries: Object.freeze([
            entry('castle-keep', 'Crownward Keep', 'grand', 12, [['foyer', 'great-hall', 'armory'], ['solar', 'library', 'guard-room'], ['royal-chamber', 'war-room']]),
            entry('castle-gatehouse', 'Liongate House', 'longhall', 10.9, [['guard-room', 'armory', 'checkpoint'], ['barracks', 'watch-room']]),
            entry('castle-courtyard-hall', 'Rosecourt Hall', 'courtyard', 10.5, [['foyer', 'great-hall', 'kitchen'], ['solar', 'guest-room', 'study']]),
            entry('castle-watchtower', 'High Banner Tower', 'tower', 10.7, [['guard-room', 'storage'], ['watch-room', 'armory'], ['signal-room', 'study']]),
            entry('castle-barracks', 'Shieldward Barracks', 'bay', 9.8, [['armory', 'common'], ['barracks', 'barracks']]),
            entry('castle-chapel', 'Crown Chapel', 'deepHall', 9.7, [['nave', 'vestry', 'foyer'], ['choir', 'reliquary']]),
            entry('castle-royal-manor', 'Regent Manor', 'square', 9.5, [['foyer', 'hall', 'kitchen'], ['bedroom', 'study', 'guest-room']]),
            entry('castle-river-fort', 'Fordwatch Fort', 'compact', 8.8, [['guard-room', 'storage']])
        ])
    }),
    Object.freeze({
        district: 'civic',
        districts: Object.freeze(['civic', 'market', 'garden']),
        style: 'stone',
        terrain: 'settlement',
        roofStyles: Object.freeze(['tower', 'copper', 'slate', 'copper', 'gabled', 'slate', 'copper', 'tower']),
        entries: Object.freeze([
            entry('clocktower', 'Sunclock Civic Tower', 'tower', 9.1, [['foyer', 'archive'], ['council-room', 'study'], ['clockworks', 'watch-room']]),
            entry('civic-hall', 'Storybook Civic Hall', 'courtyard', 8.7, [['foyer', 'hall', 'records'], ['council-room', 'study']]),
            entry('civic-courthouse', 'Brightscale Courthouse', 'longhall', 8.9, [['foyer', 'courtroom', 'records'], ['judges-room', 'archive']]),
            entry('civic-library', 'Lanternleaf Library', 'deepHall', 8.6, [['foyer', 'reading-room', 'archive'], ['study', 'stacks']]),
            entry('civic-healers-house', 'Dawnwell Healers House', 'compact', 7.8, [['clinic', 'storage']]),
            entry('civic-guild-archive', 'Copperseal Archive', 'bay', 8.2, [['records', 'reading-room'], ['archive', 'study']]),
            entry('civic-assembly-house', 'Manyvoices Assembly', 'square', 8.4, [['foyer', 'assembly-room'], ['council-room', 'office']]),
            entry('civic-bell-hall', 'Skylark Bell Hall', 'grand', 9.4, [['foyer', 'great-hall', 'records'], ['gallery', 'council-room'], ['bell-loft', 'watch-room']])
        ])
    }),
    Object.freeze({
        district: 'market',
        districts: Object.freeze(['market', 'civic', 'residential']),
        style: 'timber',
        terrain: 'settlement',
        roofStyles: Object.freeze(['market', 'clay', 'copper', 'tower', 'gabled', 'market', 'slate', 'clay']),
        entries: Object.freeze([
            entry('market-hall', 'Festival Market Hall', 'longhall', 9.4, [['foyer', 'trading-floor', 'storage'], ['guild-room', 'office']]),
            entry('market-bazaar', 'Ribbonroof Bazaar', 'compact', 8.1, [['shop', 'storage']]),
            entry('market-bakery', 'Honeycrust Bakery', 'square', 7.9, [['shop', 'kitchen'], ['bedroom', 'storage']]),
            entry('market-apothecary', 'Moonmint Apothecary', 'tower', 8.2, [['shop', 'workshop'], ['storage', 'study'], ['herb-loft', 'bedroom']]),
            entry('market-clothier', 'Velvet Finch Clothier', 'deepHall', 8, [['shop', 'workshop', 'storage'], ['showroom', 'bedroom']]),
            entry('market-caravanserai', 'Golden Wheel Caravanserai', 'grand', 9, [['foyer', 'common', 'stable-office'], ['guest-room', 'guest-room', 'kitchen'], ['guild-room', 'storage']]),
            entry('market-auction-house', 'Bellflower Auction House', 'courtyard', 8.6, [['foyer', 'auction-hall', 'storage'], ['office', 'records']]),
            entry('market-brewhouse', 'Copper Kettle Brewhouse', 'bay', 8.3, [['taproom', 'kitchen', 'brewery'], ['bedroom', 'storage']])
        ])
    }),
    Object.freeze({
        district: 'residential',
        districts: Object.freeze(['residential', 'market', 'garden']),
        style: 'timber',
        terrain: 'settlement',
        roofStyles: Object.freeze(['gabled', 'thatch', 'slate', 'clay', 'copper', 'gabled', 'slate', 'clay']),
        entries: Object.freeze([
            entry('inn', 'Wayfarer Inn', 'bay', 8.5, [['common', 'kitchen', 'storage'], ['bedroom', 'bedroom', 'linen-room']]),
            entry('cabin', 'Explorer Cabin', 'compact', 6.4, [['common', 'storage']]),
            entry('residential-rowhouse', 'Painted Rowhouse', 'tower', 7.5, [['foyer', 'kitchen'], ['common', 'study'], ['bedroom', 'bedroom']]),
            entry('residential-family-house', 'Sunbeam Family House', 'square', 7.2, [['common', 'kitchen'], ['bedroom', 'nursery']]),
            entry('residential-courtyard-home', 'Ivy Court Home', 'courtyard', 7.8, [['foyer', 'common', 'kitchen'], ['bedroom', 'study']]),
            entry('residential-boarding-house', 'Bluebird Boarding House', 'longhall', 7.9, [['common', 'kitchen', 'storage'], ['bedroom', 'bedroom', 'bedroom']]),
            entry('residential-town-villa', 'Marigold Town Villa', 'grand', 8.4, [['foyer', 'parlor', 'kitchen'], ['bedroom', 'bedroom', 'study'], ['attic', 'storage']]),
            entry('residential-elder-house', 'Old Oak Elder House', 'deepHall', 7.6, [['foyer', 'common', 'kitchen'], ['bedroom', 'study']])
        ])
    }),
    Object.freeze({
        district: 'artisan',
        districts: Object.freeze(['artisan', 'market', 'residential']),
        style: 'timber',
        terrain: 'settlement',
        roofStyles: Object.freeze(['thatch', 'slate', 'tower', 'timber', 'clay', 'gabled', 'copper', 'slate']),
        entries: Object.freeze([
            entry('artisan-smithy', 'Emberbell Smithy', 'compact', 8.2, [['workshop', 'storage']]),
            entry('artisan-carpenter', 'Oakwheel Carpenter', 'square', 7.8, [['workshop', 'lumber-store'], ['office', 'bedroom']]),
            entry('artisan-pottery', 'Redclay Pottery', 'tower', 7.7, [['shop', 'workshop'], ['kiln-room', 'storage'], ['bedroom', 'study']]),
            entry('artisan-weavery', 'Silverthread Weavery', 'longhall', 7.9, [['shop', 'workshop', 'storage'], ['loom-room', 'bedroom']]),
            entry('artisan-foundry', 'Brassfinch Foundry', 'deepHall', 8.4, [['workshop', 'furnace-room', 'storage'], ['drafting-room', 'office']]),
            entry('artisan-glassworks', 'Prism Glassworks', 'bay', 8.1, [['shop', 'workshop', 'furnace-room'], ['studio', 'storage']]),
            entry('artisan-mill-house', 'Turning Gear Mill House', 'courtyard', 8, [['workshop', 'gear-room', 'storage'], ['office', 'bedroom']]),
            entry('artisan-makers-hall', 'Seven Hammers Makers Hall', 'grand', 8.8, [['foyer', 'workshop', 'workshop'], ['guild-room', 'drafting-room'], ['archive', 'storage']])
        ])
    }),
    Object.freeze({
        district: 'garden',
        districts: Object.freeze(['garden', 'residential', 'civic']),
        style: 'timber',
        terrain: 'highland',
        roofStyles: Object.freeze(['copper', 'thatch', 'gabled', 'tower', 'clay', 'gabled', 'copper', 'slate']),
        entries: Object.freeze([
            entry('chapel', 'Sunpetal Chapel', 'deepHall', 8.3, [['nave', 'vestry', 'foyer'], ['choir', 'reliquary']]),
            entry('garden-farmhouse', 'Pumpkin Patch Farmhouse', 'compact', 7.2, [['common', 'kitchen']]),
            entry('garden-greenhouse', 'Glassleaf Greenhouse', 'square', 7.5, [['greenhouse', 'potting-room'], ['seed-room', 'study']]),
            entry('garden-orchard-house', 'Appleblossom Orchard House', 'tower', 7.4, [['common', 'fruit-store'], ['kitchen', 'bedroom'], ['attic', 'storage']]),
            entry('garden-herbalist', 'Sagebrush Herbalist', 'longhall', 7.8, [['shop', 'drying-room', 'storage'], ['bedroom', 'study']]),
            entry('garden-beekeeper', 'Golden Hive House', 'bay', 7.3, [['honey-room', 'common'], ['bedroom', 'storage']]),
            entry('garden-watermill', 'Fernbrook Watermill', 'courtyard', 8.1, [['mill-room', 'workshop', 'storage'], ['common', 'bedroom']]),
            entry('garden-estate', 'Moonflower Garden Estate', 'grand', 8.7, [['foyer', 'parlor', 'conservatory'], ['bedroom', 'study', 'guest-room'], ['attic', 'seed-room']])
        ])
    }),
    Object.freeze({
        district: 'harbor',
        districts: Object.freeze(['harbor', 'market', 'artisan']),
        style: 'stone',
        terrain: 'coast',
        roofStyles: Object.freeze(['copper', 'thatch', 'slate', 'clay', 'gabled', 'copper', 'slate', 'tower']),
        entries: Object.freeze([
            entry('lighthouse', 'Starwater Lighthouse', 'tower', 10.5, [['foyer', 'stores'], ['keeper-room', 'workshop'], ['lantern-room', 'watch-room']]),
            entry('harbor-fishery', 'Silver Net Fishery', 'compact', 7.6, [['shop', 'cold-store']]),
            entry('harbor-warehouse', 'Tidecrate Warehouse', 'square', 8.1, [['warehouse', 'records'], ['storage', 'office']]),
            entry('harbor-shipwright', 'Bluewake Shipwright', 'longhall', 8.5, [['workshop', 'timber-store', 'office'], ['drafting-room', 'guild-room']]),
            entry('harbor-tavern', 'Laughing Gull Tavern', 'deepHall', 8.3, [['taproom', 'kitchen', 'storage'], ['bedroom', 'bedroom']]),
            entry('harbor-customs-house', 'Pearlseal Customs House', 'bay', 8.4, [['foyer', 'records', 'inspection-room'], ['office', 'strong-room']]),
            entry('harbor-pilot-house', 'Windrose Pilot House', 'courtyard', 8.2, [['chart-room', 'common', 'stores'], ['bedroom', 'watch-room']]),
            entry('harbor-guildhall', 'Deepwater Guildhall', 'grand', 9.1, [['foyer', 'great-hall', 'records'], ['council-room', 'chart-room'], ['watch-room', 'archive']])
        ])
    })
]);

function entry(id, name, silhouette, priority, floorPlans) {
    return Object.freeze({ id, name, silhouette, priority, floorPlans: freezeFloorPlans(floorPlans) });
}

function freezeFloorPlans(floorPlans) {
    return Object.freeze(floorPlans.map((floor) => Object.freeze([...floor])));
}

function createCatalogSpec(family, variant, index) {
    const silhouette = SILHOUETTES[variant.silhouette];
    const floorPlans = variant.floorPlans.slice(0, silhouette.stories);
    const primaryRoom = floorPlans[0]?.[0] || 'common';
    const isCoastal = family.terrain === 'coast';
    return Object.freeze({
        id: variant.id,
        visualProfile: 'rustic-diorama-v2',
        name: variant.name,
        layout: silhouette.layout,
        districts: Object.freeze([family.district, ...family.districts.filter((value) => value !== family.district)]),
        style: family.style,
        stories: silhouette.stories,
        archetype: silhouette.archetype,
        architectureStyle: silhouette.architectureStyle,
        roofStyle: family.roofStyles[index],
        roomType: primaryRoom,
        floorPlans: freezeFloorPlans(floorPlans),
        priority: variant.priority,
        roadRange: isCoastal ? 9 : family.terrain === 'highland' ? 8 : 7,
        ...(isCoastal ? { waterRange: variant.id === 'lighthouse' ? 7 : 9 } : {}),
        terrain: family.terrain
    });
}

export const BAKED_BUILDING_CATALOG_SPECS = Object.freeze(
    DISTRICT_FAMILIES.flatMap((family) => family.entries.map((variant, index) =>
        createCatalogSpec(family, variant, index)
    ))
);

if (BAKED_BUILDING_CATALOG_SPECS.length !== 56) {
    throw new Error(`Baked building catalog must contain exactly 56 specs; received ${BAKED_BUILDING_CATALOG_SPECS.length}.`);
}
