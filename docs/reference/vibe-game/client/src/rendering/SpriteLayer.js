import * as THREE from 'three';
import { VIEW_DIRECTION } from '../../../shared/world/CameraView.js';

const spritePlaneNormal = new THREE.Vector3(VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z);
const spriteRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), spritePlaneNormal).normalize();
const spriteUp = new THREE.Vector3().crossVectors(spritePlaneNormal, spriteRight).normalize();
const spriteRotation = new THREE.Matrix4().makeBasis(spriteRight, spriteUp, spritePlaneNormal);

export function decodeSpriteDepth(blue, alpha, min, max) {
    return min + (max - min) * ((blue * 256 + alpha) / 65535);
}

/** Convert an orthographic view-space distance to the WebGL depth buffer. */
export function spriteDepthToBuffer(viewDepth, near, far) {
    return Math.max(0, Math.min(1, (viewDepth - near) / (far - near)));
}

/**
 * Runtime half of a baked depth sprite. The colour image is sufficient for a
 * rollout preview; production entries provide `nddFile`, whose B/A channels
 * encode the signed view-depth offset defined by depthMin/depthMax.
 */
export class SpriteLayer {
    constructor(manager) {
        this.manager = manager;
        this.group = new THREE.Group();
        this.group.name = 'depth-sprites';
        this.manager.scene.add(this.group);
        this.textureLoader = new THREE.TextureLoader();
        this.entries = new Map();
        this.playerSamples = [
            new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
            new THREE.Vector3(), new THREE.Vector3()
        ];
        this.playerView = new THREE.Vector3();
        this.spriteView = new THREE.Vector3();
        this.spriteLocal = new THREE.Vector3();
    }

    add({
        id, file, nddFile = null, x, y, z = 0, width = 4, height = 4,
        anchor = [0.5, 0.08], depthMin = 0, depthMax = 0, clusterId = id,
        roofWalk = false
    }) {
        if (this.entries.has(id)) return this.entries.get(id);
        const texture = this.textureLoader.load(file);
        texture.colorSpace = THREE.SRGBColorSpace;
        const nddTexture = nddFile ? this.textureLoader.load(nddFile) : texture;
        if (nddFile) nddTexture.colorSpace = THREE.NoColorSpace;
        const geometry = new THREE.PlaneGeometry(width, height);
        geometry.translate(width * (0.5 - anchor[0]), height * (0.5 - anchor[1]), 0);
        const material = this.createMaterial(texture, nddTexture, Boolean(nddFile), depthMin, depthMax);
        const mesh = new THREE.Mesh(geometry, material);
        // The source's anchor pixel lands at the collision/footprint centre.
        mesh.position.set(x, z, y);
        mesh.quaternion.setFromRotationMatrix(spriteRotation);
        mesh.userData = {
            spriteId: id, clusterId, fade: 1, lodAnchor: { x, y }, spriteDepth: z,
            roofWalk, anchor, depthMin, depthMax, spriteRuntime: 'depth-v1'
        };
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.group.add(mesh);
        this.entries.set(id, mesh);
        return mesh;
    }

    createMaterial(map, nddMap, hasDepth, depthMin, depthMax) {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: true,
            // The authored view is fixed, but DoubleSide keeps the bake visible
            // if the camera/view vector is inverted by a host scene.
            side: THREE.DoubleSide,
            extensions: { fragDepth: true },
            uniforms: {
                map: { value: map },
                nddMap: { value: nddMap },
                hasDepth: { value: hasDepth },
                depthRange: { value: new THREE.Vector2(depthMin, depthMax) },
                fade: { value: 1 },
                cameraNear: { value: this.manager.camera.near },
                cameraFar: { value: this.manager.camera.far }
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vAnchorDepth;
                void main() {
                    vUv = uv;
                    vec4 anchorView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    vAnchorDepth = -anchorView.z;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                #include <tonemapping_pars_fragment>
                #include <colorspace_pars_fragment>
                uniform sampler2D map, nddMap;
                uniform bool hasDepth;
                uniform vec2 depthRange;
                uniform float fade, cameraNear, cameraFar;
                varying vec2 vUv;
                varying float vAnchorDepth;
                void main() {
                    vec4 albedo = texture2D(map, vUv);
                    if (albedo.a < 0.5) discard;
                    // Screen-door fading avoids a transparent-sort seam with terrain.
                    float dither = fract(dot(floor(gl_FragCoord.xy), vec2(0.75487766, 0.56984029)));
                    if (dither > fade) discard;
                    float offset = 0.0;
                    if (hasDepth) {
                        vec4 ndd = texture2D(nddMap, vUv);
                        offset = mix(depthRange.x, depthRange.y, (ndd.b * 255.0 * 256.0 + ndd.a * 255.0) / 65535.0);
                    }
                    float viewDepth = vAnchorDepth + offset;
                    gl_FragDepthEXT = clamp((viewDepth - cameraNear) / (cameraFar - cameraNear), 0.0, 1.0);
                    // SRGBColorSpace selects the GPU's sRGB texture format;
                    // texture2D already returns linear RGB. Decode exactly once.
                    gl_FragColor = vec4(albedo.rgb, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `
        });
    }

    updateCameraDepthRange() {
        for (const mesh of this.entries.values()) {
            mesh.material.uniforms.cameraNear.value = this.manager.camera.near;
            mesh.material.uniforms.cameraFar.value = this.manager.camera.far;
        }
    }

    /**
     * Fade only a sprite that actually covers the projected player and is closer
     * to the camera. Bake entries can later replace this conservative quad test
     * with their 1/8 coverage/depth hit mask without changing the public rule.
     */
    updateObstruction(playerX, playerY, playerZ = 0) {
        const camera = this.manager.camera;
        const samples = [
            [0, 0, 0], [0, 0.42, 0], [0, 1.05, 0], [-0.23, 0.75, 0.12], [0.23, 0.75, -0.12]
        ];
        for (let index = 0; index < samples.length; index++) {
            const [x, y, z] = samples[index];
            this.playerSamples[index].set(playerX + x, playerZ + y, playerY + z);
        }
        const hiddenClusters = new Set();
        for (const mesh of this.entries.values()) {
            mesh.updateWorldMatrix(true, false);
            this.spriteView.setFromMatrixPosition(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
            const spriteDepth = -this.spriteView.z;
            if (mesh.userData.roofWalk && playerZ >= mesh.userData.spriteDepth + 1) continue;
            const isFront = this.playerSamples.some((sample) => {
                this.playerView.copy(sample).applyMatrix4(camera.matrixWorldInverse);
                if (spriteDepth >= -this.playerView.z - 0.25) return false;
                this.spriteLocal.copy(sample);
                mesh.worldToLocal(this.spriteLocal);
                const { width, height } = mesh.geometry.parameters;
                const [ax, ay] = mesh.userData.anchor;
                return this.spriteLocal.x >= -width * ax && this.spriteLocal.x <= width * (1 - ax) &&
                    this.spriteLocal.y >= -height * ay && this.spriteLocal.y <= height * (1 - ay);
            });
            if (isFront) hiddenClusters.add(mesh.userData.clusterId);
        }
        for (const [id, mesh] of this.entries) {
            this.setFade(id, hiddenClusters.has(mesh.userData.clusterId) ? 0.2 : 1);
        }
    }

    setFade(id, fade = 1) {
        const mesh = this.entries.get(id);
        if (!mesh) return;
        const clamped = Math.max(0.2, Math.min(1, fade));
        mesh.userData.fade = clamped;
        mesh.material.uniforms.fade.value = clamped;
        mesh.material.depthWrite = clamped > 0.21;
    }

    clear() {
        const textures = new Set();
        for (const mesh of this.entries.values()) {
            mesh.geometry.dispose();
            if (mesh.material.uniforms.map.value) textures.add(mesh.material.uniforms.map.value);
            if (mesh.material.uniforms.nddMap.value) textures.add(mesh.material.uniforms.nddMap.value);
            mesh.material.dispose();
            this.group.remove(mesh);
        }
        for (const texture of textures) texture.dispose();
        this.entries.clear();
    }

    dispose() {
        this.clear();
        this.manager.scene.remove(this.group);
    }
}
