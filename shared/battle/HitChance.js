// XCOM 2-style percent chance to hit, used for overwatch reactions (both sides) and for every NPC shot. Player shots
// keep Phoenix Point free aim (the cone + tracer); this is the readout and roll for the shots nobody aims by hand.
//
// chance = shooter aim (accuracy x aimScale) + range + height - target defence (cover, smoke, darkness ...) + statuses,
// then x overwatchAimMult for reactions, clamped. Every term is listed in `mods` for the HUD and the log. A flanked
// target (no cover toward the shooter) can be critically hit. Tunables live in shared/content/balance.js.
import { B } from '../content/balance.js';
import { WEAPONS } from '../content/weapons.js';
import { hardCoverAgainst, COVER } from '../voxel/Cover.js';
import { hasStatus } from './Units.js';
import { weaponBuild } from './FireControl.js';

const tiles = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * @param b Battle (or anything with store, field, light, mission, formations, roomOf)
 * @param shooter unit firing; `from` overrides where it stands (AI tile scoring asks "what if I stood there")
 * @param target unit fired at; `at` overrides where it stands
 * @returns {{ chance: number, crit: number, mods: [string, number][], cover: number, flanked: boolean }}
 */
export function hitChance(b, shooter, target, weapon, { reaction = false, breach = false, from = shooter, at = target } = {}) {
    const w = weaponBuild(shooter, typeof weapon === 'string' ? WEAPONS[weapon] : weapon);
    const mods = [];
    const add = (label, v) => { if (v) mods.push([label, Math.round(v)]); return v; };
    let aim = add('aim', shooter.accuracy * B.aimScale);
    // Shooter condition.
    const arms = ['armL', 'armR'].filter(p => shooter.parts?.[p]?.disabled).length;
    aim += add('arm wound', -arms * B.armWoundAim);
    if (shooter.parts?.head?.disabled) aim += add('head wound', -B.headWoundAim);
    if (hasStatus(shooter, 'suppressed')) aim += add('suppressed', -B.suppressedAim);
    if (hasStatus(shooter, 'staggered')) aim += add('staggered', -B.staggeredAim);
    if (hasStatus(shooter, 'burning')) aim += add('on fire', -B.burningAim);
    if (hasStatus(shooter, 'panicked')) aim += add('panicked', -B.panickedAim);
    if ((shooter.stress ?? 0) >= 75) aim += add('stressed', -B.stressedAim);
    if (shooter.buffs?.deadeye) aim += add('deadeye', B.deadeyeAim);
    if (breach) aim += add('breach', B.breachAim);
    if (w.scoped) aim += add('scope', B.scopeAim);
    // Range: close shots are easier, past the weapon's effective range they fall off.
    const d = tiles(from, at);
    if (d <= 3) aim += add('close range', B.closeRangeAim * (w.ammoType === 'high' ? -1 : 1));
    else if (d > w.range) aim += add('range', -Math.min(60, (d - w.range) / w.range * B.rangeAimPenalty));
    // Height.
    if (from.z - at.z >= 2) aim += add('high ground', B.highGroundAim);
    else if (at.z - from.z >= 2) aim += add('target above', -B.targetAboveAim);
    // Target defence: cover toward the shooter (cover the round would go through counts for less).
    const hc = hardCoverAgainst(b.store, at.x, at.y, at.z, from.x, from.y, from.z, w.energy || 6);
    const coverK = hc.soft ? B.softCoverFactor : 1;
    if (hc.level === COVER.FULL) aim += add(hc.soft ? 'soft full cover' : 'full cover', -B.fullCoverDefense * coverK);
    else if (hc.level === COVER.HALF) aim += add(hc.soft ? 'soft half cover' : 'half cover', -B.halfCoverDefense * coverK);
    const smoky = b.field?.isSmoke?.(at.x, at.y, at.z + 1) || b.field?.isSmoke?.(at.x, at.y, at.z + 2);
    if (smoky) aim += add('smoke', -B.smokeDefense);
    if (b.mission?.meta?.imageGenerated && d > 4 && b.light?.dark?.(at.x, at.y, at.z)) aim += add('darkness', -B.darkDefense);
    if (hasStatus(target, 'frozen')) aim += add('frozen target', B.frozenTargetAim);
    if (hasStatus(target, 'stunned')) aim += add('stunned target', B.stunnedTargetAim);
    if (hasStatus(target, 'braced')) aim += add('braced', -B.bracedDefense);
    const fk = b.formations?.defenseSpreadMult?.(target, shooter) ?? 1;
    if (fk > 1.001) aim += add('formation', -B.formationDefense);
    let chance = aim;
    if (reaction) { const k = B.overwatchAimMult; mods.push(['overwatch', -Math.round(chance * (1 - k))]); chance *= k; }
    chance = Math.round(Math.max(B.hitChanceMin, Math.min(B.hitChanceMax, chance)));
    const flanked = hc.level === COVER.NONE;
    const crit = Math.max(0, Math.min(100, Math.round((flanked ? B.flankCrit : 0) + (w.ammoType === 'high' ? B.sniperCrit : 0))));
    return { chance, crit, mods, cover: hc.level, flanked };
}
