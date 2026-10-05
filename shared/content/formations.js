// Formations (PLAN-01 rev 2 §14). Slots are [right, forward] offsets from the leader, in tiles, in the
// leader's facing frame. A member is "in slot" within ±1 tile and ±1 voxel. Numbers are tunables.
export const FORMATIONS = Object.freeze({
    shield_line: {
        id: 'shield_line', name: 'Shield Line', min: 2, max: 4,
        slots: [[0, 0], [1, 0], [-1, 0], [2, 0]],
        bonus: { frontSpreadMult: 1.3 },                // attackers from the front arc get +30 % spread
        cost: { mobilityPerAp: -0.5 },
        decayPerStaticPhase: 0.34,                       // bonus fraction lost per enemy phase without moving
        text: 'Side by side behind cover, facing a front. Attacks from the front 90° get +30 % spread. −0.5 tiles per AP.'
    },
    breach_stack: {
        id: 'breach_stack', name: 'Breach Stack', min: 2, max: 4,
        slots: [[0, 0], [0, -1], [0, -2], [0, -3]],
        bonus: { breachAccuracyMult: 1.1, doorNoiseMult: 0.5 },
        requiresDoor: true,
        text: 'In a file at a door. Breach shots +10 % accuracy; door entries are half as loud. Ends after a breach.'
    },
    crossfire: {
        id: 'crossfire', name: 'Crossfire', min: 2, max: 2,
        slots: null,                                     // any positions ≥ 4 tiles apart with overlapping cones
        minSpacing: 4,
        bonus: { reactionSpreadMult: 1.0, extraReactions: 1 },
        text: 'Two overwatchers ≥ 4 apart with overlapping cones: reaction shots have no penalty and both may react.'
    }
});
export const FORMATION_RULES = Object.freeze({
    cohesionLossPerStray: 35, cohesionRegain: 50, fullAt: 80, halfAt: 50,
    maxAccuracyBonus: 1.15, maxDefenseBonus: 1.3, perSoldiers: 4
});
