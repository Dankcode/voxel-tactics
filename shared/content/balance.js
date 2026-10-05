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
    dimRoomSpreadMult: { value: 1.25, min: 1, max: 2 },
    smokeSpreadMult: { value: 1.6, min: 1, max: 3 },
    heightAccuracyBonus: { value: 0.85, min: 0.6, max: 1 },       // spread × this when 2+ voxels above the target
    stressOnWound: { value: 12, min: 0, max: 30 },
    stressOnAllyDown: { value: 22, min: 0, max: 40 },
    stressOnNearMiss: { value: 4, min: 0, max: 10 },
    stressRelieveOnKill: { value: 10, min: 0, max: 30 },
    breakdownAt: { value: 100, min: 60, max: 150 },
    fallDamagePerLevel: { value: 3, min: 0, max: 8 },
    fireSpreadChance: { value: 0.3, min: 0, max: 0.8 },
    burningDamage: { value: 2, min: 0, max: 5 },
    clusteredRadiusBonus: { value: 1, min: 0, max: 2 },
    clusteredDamageMult: { value: 1.25, min: 1, max: 2 }
};
export const B = new Proxy({}, { get: (_, k) => BALANCE[k]?.value });
