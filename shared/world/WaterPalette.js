// Water is deliberately palette-independent. Body type drives movement and bed detail,
// never a second hue: rivers, coasts and marshes must read as the same water.
export const WATER_COLOR = 0x4fc2d1;
export const WATER_ABSORPTION = 0.52;
export const WATER_MIN_TRANSMITTANCE = 0.12;
export function waterTransmittance(depth = 0) {
    return Math.max(WATER_MIN_TRANSMITTANCE, Math.exp(-WATER_ABSORPTION * Math.max(0, Number(depth) || 0)));
}
export const WATER = Object.freeze({ color: WATER_COLOR, bedTint: 0x587e73, foam: 0xd7f7f4,
    causticLo: 0x64cbd4, causticHi: 0xb8f0e7 });
// Water is a layer over the world, never an opaque blue floor. Even the deepest
// bodies retain enough transmission for bridge piers, terrain steps and beds to read.
export const WATER_ALPHA = Object.freeze({ shallow: 0.42, deep: 0.58, side: 0.46 });
