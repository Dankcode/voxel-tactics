import * as THREE from 'three';
import { CHARACTER_CLASSES, ARMOR_STYLES, normalizeAppearance, appearanceKey } from '../data/CharacterAppearance.js';

export const CHARACTER_ATLAS = Object.freeze({ columns: 8, rows: 4, width: 96, height: 128, directions: ['south', 'west', 'east', 'north'] });

/** A modular 3D wardrobe baked once into a shared, foot-anchored billboard atlas.
 * Geometry exists only during baking; a crowd still renders as one quad per actor.
 * New equipment attaches to named sockets, never to movement/simulation state.
 */
export class CharacterSpriteBaker {
    static cache = new Map();
    static getTexture(renderer, appearance) {
        const key = appearanceKey(appearance);
        if (!this.cache.has(key)) this.cache.set(key, this.bake(renderer, normalizeAppearance(appearance)));
        return this.cache.get(key);
    }

    static createRig(appearance) {
        const outfit = CHARACTER_CLASSES[appearance.classId];
        const armor = ARMOR_STYLES[appearance.armorId];
        const root = new THREE.Group();
        const materials = new Map();
        const material = (color, metalness = 0) => {
            const key = `${color}:${metalness}`;
            if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.76, metalness }));
            return materials.get(key);
        };
        const part = (parent, geometry, color, x, y, z, scale = null, metalness = 0) => {
            const mesh = new THREE.Mesh(geometry, material(color, metalness));
            mesh.position.set(x, y, z);
            if (scale) mesh.scale.set(...scale);
            parent.add(mesh);
            return mesh;
        };
        const box = (parent, size, color, x, y, z, metalness = 0) => part(parent, new THREE.BoxGeometry(...size), color, x, y, z, null, metalness);
        const ball = (parent, color, x, y, z, scale) => part(parent, new THREE.SphereGeometry(1, 16, 12), color, x, y, z, scale);
        const socket = (name, x, y, z) => { const group = new THREE.Group(); group.name = name; group.position.set(x, y, z); root.add(group); return group; };
        const leftLeg = socket('left-leg', -0.15, 0.46, 0);
        const rightLeg = socket('right-leg', 0.15, 0.46, 0);
        for (const leg of [leftLeg, rightLeg]) {
            box(leg, [0.2, 0.29, 0.22], '#665745', 0, -0.12, 0);
            box(leg, [0.22, 0.16, 0.32], '#3e342b', 0, -0.34, 0.04);
        }
        const torso = socket('chest', 0, 0.68, 0);
        ball(torso, outfit.color, 0, 0, 0, [0.31, 0.36, 0.22]);
        box(torso, [0.28, 0.36, 0.05], armor.cloth, 0, 0.01, 0.205);
        box(torso, [0.53, 0.065, 0.44], '#594330', 0, -0.16, 0);
        box(torso, [0.075, 0.075, 0.045], '#d1ae66', 0, -0.16, 0.24, 0.5);
        const head = socket('head', 0, 1.33, 0);
        ball(head, '#f1c59e', 0, 0, 0, [0.43, 0.43, 0.35]);
        ball(head, '#493426', 0, 0.16, -0.07, [0.455, 0.35, 0.34]);
        for (let i = 0; i < 5; i++) {
            const lock = ball(head, i % 2 ? '#68462c' : '#563924', (i - 2) * 0.145, 0.24 - (i % 2) * 0.065, 0.265, [0.115, 0.19, 0.105]);
            lock.rotation.z = -0.4 + i * 0.2;
        }
        for (const x of [-0.16, 0.16]) {
            ball(head, '#fff5e4', x, -0.035, 0.317, [0.082, 0.112, 0.035]);
            ball(head, '#30271f', x, -0.043, 0.347, [0.047, 0.081, 0.022]);
            ball(head, '#ffffff', x - 0.014, -0.01, 0.368, [0.018, 0.025, 0.009]);
            ball(head, '#db9f85', x * 1.55, -0.16, 0.277, [0.065, 0.033, 0.018]);
        }
        ball(head, '#d79e78', 0, -0.15, 0.335, [0.041, 0.045, 0.033]);
        const leftArm = socket('off-hand', -0.36, 0.88, 0);
        const rightArm = socket('weapon', 0.36, 0.88, 0);
        for (const arm of [leftArm, rightArm]) {
            ball(arm, appearance.armorId === 'traveler' ? outfit.color : armor.metal, 0, -0.02, 0, [0.16, 0.17, 0.17]);
            box(arm, [0.17, 0.27, 0.19], outfit.color, 0, -0.18, 0);
            ball(arm, '#f1c59e', 0, -0.33, 0.02, [0.1, 0.115, 0.105]);
        }
        if (outfit.weapon === 'sword') {
            box(rightArm, [0.065, 0.65, 0.055], '#d9e0d9', 0.06, 0.05, 0.15, 0.6);
            box(rightArm, [0.25, 0.055, 0.075], '#c7a460', 0.06, -0.23, 0.15, 0.5);
            const shield = part(leftArm, new THREE.CylinderGeometry(0.255, 0.255, 0.075, 8), armor.metal, -0.045, -0.22, 0.19, null, 0.4);
            shield.rotation.x = Math.PI / 2;
            ball(leftArm, outfit.color, -0.045, -0.22, 0.24, [0.2, 0.2, 0.028]);
            ball(leftArm, '#d4b06b', -0.045, -0.22, 0.274, [0.055, 0.055, 0.026]);
        } else if (outfit.weapon === 'bow') {
            const bow = part(rightArm, new THREE.TorusGeometry(0.32, 0.029, 6, 16, Math.PI), '#946536', 0, -0.13, 0.18);
            bow.rotation.z = -Math.PI / 2;
            box(rightArm, [0.011, 0.64, 0.012], '#e6d7af', 0, -0.13, 0.18);
            part(torso, new THREE.CylinderGeometry(0.09, 0.08, 0.55, 8), '#5d4230', 0.24, 0.12, -0.25);
        } else {
            box(rightArm, [0.065, 1.18, 0.065], '#755133', 0.1, -0.02, 0.16);
            part(rightArm, new THREE.OctahedronGeometry(0.14), '#edbd65', 0.1, 0.61, 0.16);
            const brim = part(head, new THREE.CylinderGeometry(0.49, 0.49, 0.05, 16), outfit.color, 0, 0.31, 0);
            part(head, new THREE.ConeGeometry(0.35, 0.43, 12), outfit.color, 0, brim.position.y + 0.2, 0);
        }
        if (appearance.armorId !== 'traveler') box(head, [0.77, 0.07, 0.62], armor.metal, 0, 0.19, 0.06, 0.4);
        return { root, leftArm, rightArm, leftLeg, rightLeg };
    }

    static bake(renderer, appearance) {
        const { width, height, columns, rows } = CHARACTER_ATLAS;
        const canvas = document.createElement('canvas');
        canvas.width = width * columns; canvas.height = height * rows;
        const context = canvas.getContext('2d');
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xfff6e4, 0x526052, 2.6));
        const key = new THREE.DirectionalLight(0xffe6bb, 3.2); key.position.set(-3, 5, 5); scene.add(key);
        const rim = new THREE.DirectionalLight(0xadcbd9, 1.4); rim.position.set(2, 3, -3); scene.add(rim);
        const rig = this.createRig(appearance); scene.add(rig.root);
        const camera = new THREE.OrthographicCamera(-0.825, 0.825, 2.15, -0.05, 0.1, 20);
        camera.position.set(0, 0, 8); camera.lookAt(0, 0, 0);
        const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
        target.texture.colorSpace = THREE.SRGBColorSpace;
        const previous = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure };
        const pixels = new Uint8Array(width * height * 4);
        const frameImage = context.createImageData(width, height);
        const geometries = new Set(), materials = new Set();
        try {
            renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
            renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.autoClear = true;
            for (let row = 0; row < rows; row++) {
                rig.root.rotation.y = [0, -Math.PI / 2, Math.PI / 2, Math.PI][row];
                for (let frame = 0; frame < columns; frame++) {
                    const step = Math.sin(frame / columns * Math.PI * 2);
                    rig.leftLeg.rotation.x = step * 0.48; rig.rightLeg.rotation.x = -step * 0.48;
                    rig.leftArm.rotation.x = -step * 0.24; rig.rightArm.rotation.x = step * 0.24;
                    rig.root.position.y = Math.abs(step) * 0.025;
                    renderer.render(scene, camera);
                    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
                    for (let y = 0; y < height; y++) frameImage.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
                    context.putImageData(frameImage, frame * width, row * height);
                }
            }
        } finally {
            renderer.setRenderTarget(previous.target); renderer.setClearColor(previous.clear, previous.alpha); renderer.autoClear = previous.autoClear;
            renderer.toneMapping = previous.toneMapping; renderer.toneMappingExposure = previous.exposure;
            target.dispose();
            rig.root.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.material) materials.add(node.material); });
            geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
        return texture;
    }
}
