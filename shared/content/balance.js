// Global tunables. Every value has a range the tuner (tools/sim) may move it within; change by hand,
// then run `npm run sim` and read the report.
export const BALANCE = {
    apPerTurn: { value: 4, min: 3, max: 6 },
    moveScale: { value: 1.5, min: 1, max: 2.5 },                  // PLAN-14: tiles per AP × this (both sides); gear adds or takes off on top
    willRegen: { value: 1, min: 0, max: 2 },
    reactionSpreadMult: { value: 1.45, min: 1, max: 2 },           // overwatch shots are less accurate
    breachAccuracyMult: { value: 1.15, min: 1, max: 1.5 },
    rangeFalloff: { value: 0.72, min: 0.5, max: 2 },               // spread growth per effective range past `range`
    estimateSamples: { value: 96, min: 32, max: 256 },
    sightRange: { value: 24, min: 12, max: 40 },
    // PLAN-10 enemy pursuit (shared/battle/EnemyAi.js). Hand-tuned; the sim only reports them.
    aiDashIfOffenseBelow: { value: 0.35, min: 0, max: 1 },        // best reachable hit chance under this → dash (all AP) toward the target
    aiPursuitPerTile: { value: 1.6, min: 0.5, max: 3 },           // score lost per tile still between a pursuer and its target
    aiHideWhenOutnumbered: { value: 0, min: 0, max: 1 },          // 1 = the old PLAN-09 habit of hiding whenever outnumbered
    aiPatrolRadius: { value: 6, min: 0, max: 12 },                // tiles an unalerted pod wanders from its post (0 = stand still)
    // PLAN-15. Hand-tuned; the sim only reports them.
    peekRange: { value: 1, min: 0, max: 2 },                      // tiles a soldier may lean out of cover while aiming (0 = off)
    armorMinDamage: { value: 0.25, min: 0, max: 1 },              // every projectile deals at least this share of its damage through armour
    headshotMult: { value: 1.35, min: 1, max: 2 },                // precision free-aim headshots deal bonus damage
    bleedDamage: { value: 2, min: 1, max: 5 },                    // damage per round from a disabled-limb bleed
    bleedRounds: { value: 3, min: 1, max: 5 },
    concealSightMult: { value: 0.6, min: 0.3, max: 0.9 },         // enemy open-ground detection radius while squad is concealed
    concealCoverRadius: { value: 10, min: 6, max: 16 },           // enemy detection radius against a concealed soldier in cover
    podSpacing: { value: 12, min: 0, max: 24 },                   // tiles between enemy pods on generated maps (0 = old placement)
    darkSpreadMult: { value:1.25,min:1,max:2 },
    dimRoomSpreadMult: { value: 1.25, min: 1, max: 2 },
    smokeSpreadMult: { value: 1.6, min: 1, max: 3 },
    heightAccuracyBonus: { value: 0.85, min: 0.6, max: 1 },       // spread × this when 2+ voxels above the target
    stressOnWound: { value: 12, min: 0, max: 30 },
    stressOnAllyDown: { value: 22, min: 0, max: 40 },
    stressOnNearMiss: { value: 4, min: 0, max: 10 },
    stressRelieveOnKill: { value: 10, min: 0, max: 30 },
    breakdownAt: { value: 100, min: 60, max: 150 },
    fallDamagePerLevel: { value: 5, min: 0, max: 12 },
    fireSpreadChance: { value: 0.3, min: 0, max: 0.8 },
    burningDamage: { value: 3, min: 0, max: 8 },
    crushDamage: { value: 5, min: 0, max: 12 },                   // rubble lands on a unit
    impactDamage: { value: 2, min: 0, max: 6 },                   // knocked back into a wall or a unit
    clusteredRadiusBonus: { value: 1, min: 0, max: 2 },
    clusteredDamageMult: { value: 1.25, min: 1, max: 2 },
    // Physical recoil & bullet trajectory ballistics (used uniformly by player shots, NPCs, and overwatch)
    ballisticDropG: { value: 0.11, min: 0.04, max: 0.4 },          // gravity drop coefficient past zeroed range
    recoilClimbMult: { value: 1.0, min: 0.4, max: 2.0 },           // vertical muzzle rise multiplier per round
    recoilDriftMult: { value: 1.0, min: 0.4, max: 2.0 },           // lateral recoil wander multiplier
    recoilBloomMult: { value: 1.0, min: 0.4, max: 2.0 },           // cone expansion per consecutive round
    flankExposureMult: { value: 1.15, min: 1.0, max: 1.4 },        // deterministic bonus on unobstructed flanked hits
    // Chilled (cryo on a dry unit): fraction of movement per AP lost per stack (frozen needs the unit wet).
    chillMobility: { value: 0.3, min: 0.1, max: 0.6 },
    // Walker monsters
    smashVoxelDamage: { value: 40, min: 10, max: 80 }
};
export const B = new Proxy({}, { get: (_, k) => BALANCE[k]?.value });
