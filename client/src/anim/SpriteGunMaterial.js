import * as THREE from 'three';

const PALETTE = {
    stock: 0x414a43, grip: 0x353c3e, foregrip: 0x48534b,
    magazine: 0x465153, barrel: 0x424b50, sight: 0x353e43,
    scope: 0x384249, receiver: 0x586367, body: 0x505c58,
};

/** Shared by each assembly's parts; nearest sampling keeps the three cel bands distinct. */
export function gunCelRamp() {
    const ramp = new THREE.DataTexture(new Uint8Array([72, 160, 255]), 3, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
    return ramp;
}

export function gunCelMaterial(partName, gradientMap) {
    const role = partName.split('_').at(-1);
    return new THREE.MeshToonMaterial({
        name: `${partName} cel`, color: PALETTE[role] ?? PALETTE.body,
        gradientMap, dithering: false,
    });
}

/** One thin back-face shell follows the same mesh and sockets; no separately scaled gun parts. */
export function gunInkMaterial() {
    const material = new THREE.MeshBasicMaterial({ color: 0x171e1c, side: THREE.BackSide, depthWrite: false });
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\ntransformed += normal * 0.0008;');
    };
    material.customProgramCacheKey = () => 'ranger-gun-ink-0.8mm';
    return material;
}
