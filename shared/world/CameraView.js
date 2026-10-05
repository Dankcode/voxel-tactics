// Canonical MapleStory-2-style view shared by the runtime camera and the 2D building
// placeholders/bakes. Changing these values deliberately invalidates baked sprite fingerprints.
//
// MS2 reads as isometric but is a narrow-FOV perspective camera looking down the grid
// diagonal: tile tops are near-2:1 diamonds, block sides stay readable, and the scroll wheel
// dollies the camera along its view ray (pitch and azimuth never change).
export const CAMERA_VIEW_VERSION = 'ms2-diagonal-v3';

/** Degrees clockwise from +Z toward +X. 45° puts the camera on the grid diagonal. */
export const CAMERA_AZIMUTH_DEG = 45;
/** Camera elevation above the ground plane; reveals more tile tops like the town concept. */
export const CAMERA_PITCH_DEG = 38;
/** Vertical field of view: narrow, so it reads as isometric while keeping MS2's slight depth. */
export const CAMERA_FOV_DEG = 24;

/** World units visible vertically through the follow target, by zoom. */
export const DEFAULT_VIEW_HEIGHT = 11;
export const MIN_VIEW_HEIGHT = 8;
export const MAX_VIEW_HEIGHT = 22;
/** One wheel notch scales the visible height by this factor. */
export const ZOOM_STEP = 1.12;

const toRad = Math.PI / 180;
const cosPitch = Math.cos(CAMERA_PITCH_DEG * toRad);

/** Unit vector from the follow target toward the camera. */
export const VIEW_DIRECTION = Object.freeze({
    x: cosPitch * Math.sin(CAMERA_AZIMUTH_DEG * toRad),
    y: Math.sin(CAMERA_PITCH_DEG * toRad),
    z: cosPitch * Math.cos(CAMERA_AZIMUTH_DEG * toRad)
});
export const CAMERA_UP = Object.freeze({ x: 0, y: 1, z: 0 });

export function clampViewHeight(height) {
    const value = Number(height);
    return Math.max(MIN_VIEW_HEIGHT, Math.min(MAX_VIEW_HEIGHT, Number.isFinite(value) ? value : DEFAULT_VIEW_HEIGHT));
}

/** Distance from the follow target at which `viewHeight` world units fill the screen height. */
export function cameraDistanceForViewHeight(viewHeight = DEFAULT_VIEW_HEIGHT) {
    return clampViewHeight(viewHeight) / 2 / Math.tan(CAMERA_FOV_DEG * toRad / 2);
}

/** Offset from the follow target to the camera for a given visible height. */
export function cameraOffsetForViewHeight(viewHeight = DEFAULT_VIEW_HEIGHT) {
    const distance = cameraDistanceForViewHeight(viewHeight);
    return Object.freeze({ x: VIEW_DIRECTION.x * distance, y: VIEW_DIRECTION.y * distance, z: VIEW_DIRECTION.z * distance });
}

/** Next visible height after `notches` wheel steps (positive = zoom out). */
export function stepViewHeight(current, notches) {
    return clampViewHeight(clampViewHeight(current) * Math.pow(ZOOM_STEP, Number(notches) || 0));
}

/** 0 when fully zoomed out, 1 when fully zoomed in. */
export function zoomInAmount(viewHeight) {
    const h = clampViewHeight(viewHeight);
    return (MAX_VIEW_HEIGHT - h) / (MAX_VIEW_HEIGHT - MIN_VIEW_HEIGHT);
}

/**
 * Orthonormal basis of the canonical image plane (used to bake/draw 2D building art):
 * `right` and `up` span the image, `forward` points from the camera into the scene.
 */
export function canonicalImageBasis() {
    const f = { x: -VIEW_DIRECTION.x, y: -VIEW_DIRECTION.y, z: -VIEW_DIRECTION.z };
    // right = normalize(forward × worldUp)
    let rx = f.y * 0 - f.z * 1, ry = f.z * 0 - f.x * 0, rz = f.x * 1 - f.y * 0;
    const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
    // up = right × forward
    const ux = ry * f.z - rz * f.y, uy = rz * f.x - rx * f.z, uz = rx * f.y - ry * f.x;
    return Object.freeze({
        right: Object.freeze({ x: rx, y: ry, z: rz }),
        up: Object.freeze({ x: ux, y: uy, z: uz }),
        forward: Object.freeze(f)
    });
}
