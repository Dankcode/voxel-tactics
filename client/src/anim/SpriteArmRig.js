// Two-bone IK for flat painted cutouts. No character meshes or 3D bones are used.
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function solveArm(shoulder, restElbow, restWrist, target) {
    const a = distance(shoulder, restElbow), b = distance(restElbow, restWrist);
    const dx = target.x - shoulder.x, dy = target.y - shoulder.y;
    const d = clamp(Math.hypot(dx, dy), Math.abs(a - b) + 1e-4, a + b - 1e-4);
    const angle = Math.atan2(dy, dx);
    const side = Math.sign((restWrist.x - shoulder.x) * (restElbow.y - shoulder.y) - (restWrist.y - shoulder.y) * (restElbow.x - shoulder.x)) || 1;
    const bend = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    return {
        elbow: { x: shoulder.x + Math.cos(angle + side * bend) * a, y: shoulder.y + Math.sin(angle + side * bend) * a },
        wrist: { x: shoulder.x + Math.cos(angle) * d, y: shoulder.y + Math.sin(angle) * d }
    };
}

/** Affine map between two 2D bones, including the translation around the pivot. */
export function boneMatrix(start, end, posedStart, posedEnd) {
    const x = end.x - start.x, y = end.y - start.y, xx = posedEnd.x - posedStart.x, yy = posedEnd.y - posedStart.y;
    const n = Math.max(1e-8, x * x + y * y), a = (x * xx + y * yy) / n, b = (x * yy - y * xx) / n;
    return [a, b, -b, a, posedStart.x - a * start.x + b * start.y, posedStart.y - b * start.x - a * start.y];
}
const css = m => `matrix(${m.map(n => n.toFixed(6)).join(',')})`;

/** Attach wrist/glove cutouts to the current projected 3D grip points. */
export function placeArmRig(figure, rig, targets, width, height) {
    if (!rig || !targets) return;
    const point = p => ({ x: p[0] * width, y: p[1] * height });
    const restLine = { x: (rig.support[0] - rig.grip[0]) * width, y: (rig.support[1] - rig.grip[1]) * height };
    const line = { x: (targets.support[0] - targets.grip[0]) * width, y: (targets.support[1] - targets.grip[1]) * height };
    const rotation = Math.atan2(line.y, line.x) - Math.atan2(restLine.y, restLine.x);
    const co = Math.cos(rotation), si = Math.sin(rotation);
    for (const [side, arm] of Object.entries(rig.arms)) {
        const shoulder = point(arm.shoulder), elbow = point(arm.elbow), wrist = point(arm.wrist), palm = point(arm.palm);
        const target = point(side === 'trigger' ? targets.grip : targets.support);
        const offset = { x: wrist.x - palm.x, y: wrist.y - palm.y };
        const wanted = { x: target.x + offset.x * co - offset.y * si, y: target.y + offset.x * si + offset.y * co };
        const pose = solveArm(shoulder, elbow, wrist, wanted);
        const transforms = {
            upper: boneMatrix(shoulder, elbow, shoulder, pose.elbow),
            forearm: boneMatrix(elbow, wrist, pose.elbow, pose.wrist),
            hand: [co, si, -si, co, target.x - co * palm.x + si * palm.y, target.y - si * palm.x - co * palm.y]
        };
        for (const [part, matrix] of Object.entries(transforms)) {
            const el = figure.querySelector(`[data-bone="${side}-${part}"]`);
            if (el) { el.style.transformOrigin = '0 0'; el.style.transform = css(matrix); }
        }
    }
}
