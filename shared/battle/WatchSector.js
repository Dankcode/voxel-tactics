import { WEAPONS } from '../content/weapons.js';
import { CLASSES, ENEMIES } from '../content/units.js';
import { B } from '../content/balance.js';

// Spotting stays panoramic; the equipment-dependent reaction sector is a planar wedge.
export function visionProfile(unit, weaponId = unit.weapon) {
    const weapon = WEAPONS[weaponId];
    const armor = unit.armorId || (CLASSES[unit.type] || ENEMIES[unit.type])?.armor || 'light';
    const penalty = armor === 'plate' ? 10 : armor === 'heavy' ? 5 : 0;
    const halfAngleDeg = Math.max(15, (weapon?.range >= 25 ? 25 : weapon?.spread > 4 ? 55 : 40) - penalty);
    return { armor, sightRange: B.sightRange, halfAngleDeg, range: Math.min(B.sightRange, (weapon?.range || 0) * 1.25) };
}
export function watchWeapon(unit) {
    return WEAPONS[unit.weapon]?.kind === 'ballistic' ? unit.weapon : unit.weapons.find(id => WEAPONS[id]?.kind === 'ballistic');
}
export function watchSector(unit, toward, weaponId = watchWeapon(unit)) {
    if (!toward || !Number.isFinite(toward.x) || !Number.isFinite(toward.y)) return null;
    const dx = toward.x - unit.x, dy = toward.y - unit.y, d = Math.hypot(dx, dy);
    if (d < 0.001) return null;
    const p = visionProfile(unit, weaponId);
    return { weaponId, dx: dx / d, dy: dy / d, halfAngle: p.halfAngleDeg * Math.PI / 180, range: p.range };
}
export function inWatchSector(unit, sector, tile) {
    const dx = tile.x - unit.x, dy = tile.y - unit.y, d = Math.hypot(dx, dy);
    return !!sector && d >= 0.5 && d <= sector.range + 1e-6 && (dx * sector.dx + dy * sector.dy) / d >= Math.cos(sector.halfAngle) - 1e-6;
}
