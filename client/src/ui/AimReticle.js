import * as THREE from 'three';
import { WEAPONS } from '../../../shared/content/weapons.js';
import { INNER_RING_RATIO } from '../../../shared/battle/Ballistics.js';
import { weaponBuild, fireMode } from '../../../shared/battle/FireControl.js';

/** On-screen radius: projected spread, kept visible and within a useful screen bound. */
export function reticleRadius(px) { return Math.max(1.5, Math.min(260, px)); }

/** One accuracy circle for every firearm, projected from the same angular spread used by ballistics. */
export function projectedSpreadRadius(camera, height, spread, distance, width = height * (camera.aspect || 1)) {
    const angle = Math.tan(spread * Math.PI / 180);
    const radius = reticleRadius(camera.isPerspectiveCamera
        ? angle / Math.tan(camera.fov * Math.PI / 360) * height / 2
        : distance * angle / (camera.top - camera.bottom) * camera.zoom * height);
    return Math.min(radius, Math.max(1.5, Math.min(width, height) / 2 - 36));
}

export function updateReticle(g) {
    const el = g.hud.el('.aim-reticle'), u = g.selectedUnit();
    const coverEl = g.hud.root?.querySelector?.('.aim-cover-mark') || null;
    if (!u || g.mode.kind !== 'shoot' || !g.freeAim || g.hud.equipment?.open || g.player?.busy || g.cutins?.current) {
        el.classList.add('hidden');
        coverEl?.classList.add('hidden');
        return;
    }
    const p = g.freeAim, camera = g.scene.camera;
    const rect = g.scene.renderer.domElement.getBoundingClientRect();
    // Anchor Phoenix Point dual-ring reticle smoothly on the live aim ray (`freeAim`) so foreground edges never jerk it.
    const point = new THREE.Vector3(p.x, p.h, p.y);
    const ndc = point.clone().project(camera);
    if (ndc.z > 1 || ndc.z < -1) {
        el.classList.add('hidden');
        coverEl?.classList.add('hidden');
        return;
    }
    el.classList.remove('hidden');

    const shooter = g.shooterOf?.(u) || u, rawWeapon = WEAPONS[g.mode.weaponId], w = rawWeapon ? weaponBuild(shooter, rawWeapon) : null;
    const fm = g.mode.fireMode || (w ? fireMode(shooter, w) : 'single');
    const spread = g.battle.spreadFor(shooter, rawWeapon, p, { target: g.aimTargetNear?.(p), fireMode: fm, suppress: !!g.mode.suppress }).spread;
    const m = g.aimStance?.muzzle, muzzleVec = m ? new THREE.Vector3(m.x, m.h, m.y) : new THREE.Vector3(shooter.x + 0.5, shooter.z + 2.35, shooter.y + 0.5);
    const impact = g.aimTrace?.point || p;
    const impactVec = new THREE.Vector3(impact.x, impact.h, impact.y);
    const dist = muzzleVec.distanceTo(impactVec);

    const tel = g.aimTelemetry?.();
    const blocked = tel ? !!tel.blocked : (g.aimTrace?.kind === 'voxel');
    const outOfRange = tel ? !!tel.outOfRange : (!!w?.maxRange && dist > w.maxRange + 0.05);
    el.classList.toggle('blocked', !!blocked);
    el.classList.toggle('out-of-range', outOfRange);

    // Position obstruction X over the voxel blocking the trajectory rather than snapping the reticle.
    if (coverEl) {
        const hitNdc = blocked && g.aimTrace?.kind === 'voxel' && g.aimTrace.point
            ? new THREE.Vector3(g.aimTrace.point.x, g.aimTrace.point.h, g.aimTrace.point.y).project(camera)
            : null;
        if (hitNdc && hitNdc.z >= -1 && hitNdc.z <= 1) {
            coverEl.classList.remove('hidden');
            coverEl.style.setProperty('--cx', `${((hitNdc.x + 1) * rect.width / 2 + rect.left).toFixed(1)}px`);
            coverEl.style.setProperty('--cy', `${((1 - hitNdc.y) * rect.height / 2 + rect.top).toFixed(1)}px`);
        } else {
            coverEl.classList.add('hidden');
        }
    }

    const displaySpread = tel?.recoil?.finalSpread ?? spread;
    const climbDeg = tel?.recoil?.totalClimbDeg ?? 0;
    const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const projectAngle = deg => camera.isPerspectiveCamera
        ? Math.atan(Math.tan(deg * Math.PI / 180) * dist / Math.max(camera.near, depth)) * 180 / Math.PI : deg;
    const R = projectedSpreadRadius(camera, rect.height, projectAngle(displaySpread), dist, rect.width);
    const climbPx = climbDeg > 0.05 ? Math.min(120, projectedSpreadRadius(camera, rect.height, projectAngle(climbDeg), dist, rect.width)) : 0;

    el.style.left = `${(ndc.x + 1) * rect.width / 2 + rect.left}px`;
    el.style.top = `${(1 - ndc.y) * rect.height / 2 + rect.top}px`;
    el.style.setProperty('--aim-radius', `${R}px`);
    el.style.setProperty('--inner-ratio', String(INNER_RING_RATIO));
    el.style.setProperty('--recoil-climb', `${climbPx.toFixed(1)}px`);
    el.classList.toggle('has-climb', climbPx > 2);

    const pick = g.aimPick && g.battle.unit?.(g.aimPick.unitId);
    const friendly = (pick && pick.side === u.side) || (tel?.friendly ?? 0) > 0.1;
    const lockedTarget = (!!pick && pick.side !== u.side && !!g.isVisible?.(pick) && !blocked && !outOfRange)
        || (!!tel?.focusUnit && (tel.hit ?? 0) > 0 && !outOfRange);
    el.classList.toggle('on-target', lockedTarget);
    el.classList.toggle('friendly', !!friendly);

    const heat = u.recoilHeat || 0;
    const heatDeg = heat > 0.05 ? +(heat * (w?.recoil?.bloom ?? 0.35)).toFixed(1) : 0;
    const heatTag = heatDeg > 0 ? ` · HEAT +${heatDeg}°` : '';
    const prefix = outOfRange ? 'OUT OF RANGE · ' : friendly ? 'ALLY · ' : blocked ? '✕ COVER · ' : '';
    const partTag = tel?.focusUnit && (tel.hit ?? 0) > 0 && !tel.focusUnit.drone
        ? ` · ${(g.aimPick?.part || tel.targetPart || 'torso').toUpperCase()}` : '';
    const readDist = tel?.focusUnit && (tel.hit ?? 0) > 0 ? tel.distance : dist;
    el.querySelector('span.read').textContent = `${prefix}${readDist.toFixed(1)} m${partTag}${heatTag}`;
}
