// Global tunables. Every value has a range the tuner (tools/sim) may move it within; change by hand,
// then run `npm run sim` and read the report.
export const BALANCE = {
    apPerTurn: { value: 4, min: 3, max: 6 },
    willRegen: { value: 1, min: 0, max: 2 },
    reactionSpreadMult: { value: 1.3, min: 1, max: 2 },           // overwatch shots are less accurate
    breachAccuracyMult: { value: 1.15, min: 1, max: 1.5 },
    rangeFalloff: { value: 1.0, min: 0.5, max: 2 },               // spread growth per effective range past `range`
    estimateSamples: { value: 96, min: 32, max: 256 },
    sightRange: { value: 24, min: 12, max: 40 },
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
    // XCOM 2-style hit chance (overwatch both sides, every NPC shot): percent points. shared/battle/HitChance.js
    aimScale: { value: 80, min: 50, max: 110 },                    // unit accuracy 1.0 -> 80 aim
    armWoundAim: { value: 15, min: 0, max: 30 },                   // per disabled arm
    headWoundAim: { value: 10, min: 0, max: 30 },
    suppressedAim: { value: 30, min: 0, max: 50 },
    staggeredAim: { value: 15, min: 0, max: 40 },
    burningAim: { value: 15, min: 0, max: 40 },
    panickedAim: { value: 25, min: 0, max: 50 },
    stressedAim: { value: 10, min: 0, max: 30 },
    deadeyeAim: { value: 25, min: 0, max: 40 },
    breachAim: { value: 10, min: 0, max: 30 },
    scopeAim: { value: 10, min: 0, max: 25 },
    closeRangeAim: { value: 10, min: 0, max: 30 },                 // within 3 tiles (a penalty for snipers)
    rangeAimPenalty: { value: 40, min: 10, max: 80 },              // per effective range past `range` (capped at 60)
    highGroundAim: { value: 20, min: 0, max: 30 },
    targetAboveAim: { value: 10, min: 0, max: 30 },
    softCoverFactor: { value: 0.5, min: 0, max: 1 },               // cover the round goes through counts this much
    fullCoverDefense: { value: 40, min: 20, max: 60 },
    halfCoverDefense: { value: 20, min: 10, max: 40 },
    smokeDefense: { value: 20, min: 0, max: 40 },
    darkDefense: { value: 15, min: 0, max: 40 },
    frozenTargetAim: { value: 20, min: 0, max: 50 },
    stunnedTargetAim: { value: 10, min: 0, max: 30 },
    bracedDefense: { value: 10, min: 0, max: 30 },
    formationDefense: { value: 10, min: 0, max: 30 },
    overwatchAimMult: { value: 0.7, min: 0.4, max: 1 },            // reaction shots: chance x this
    hitChanceMin: { value: 1, min: 0, max: 10 },
    hitChanceMax: { value: 100, min: 90, max: 100 },
    flankCrit: { value: 40, min: 0, max: 60 },                     // crit chance on a flanked target
    sniperCrit: { value: 10, min: 0, max: 30 },
    critDamageMult: { value: 1.5, min: 1, max: 2.5 },
    // Chilled (cryo on a dry unit): fraction of movement per AP lost per stack (frozen needs the unit wet).
    chillMobility: { value: 0.3, min: 0.1, max: 0.6 },
    // Walker monsters
    smashVoxelDamage: { value: 40, min: 10, max: 80 }
};
export const B = new Proxy({}, { get: (_, k) => BALANCE[k]?.value });
