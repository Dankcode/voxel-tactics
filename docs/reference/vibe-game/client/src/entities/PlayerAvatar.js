import * as THREE from 'three';
import { CharacterSpriteBaker } from '../rendering/CharacterSpriteBaker.js';
import { normalizeAppearance } from '../data/CharacterAppearance.js';
import { CHARACTER_HEIGHT as PLAYER_HEIGHT, CHARACTER_WIDTH as PLAYER_WIDTH, CHARACTER_FOOT_RADIUS as FOOT_RADIUS } from './CharacterScale.js';

const FRAME_COLUMNS = 8;
const FRAME_ROWS = 4;
const FRAME_DURATION = 0.11;
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 128;
const SURFACE_EPSILON = 0.025;
const DIRECTION_ROWS = {
    south: 0,
    west: 1,
    east: 2,
    north: 3
};
const CAMERA_FORWARD = new THREE.Vector3();
const CAMERA_RIGHT = new THREE.Vector3();
const MOVE_VECTOR = new THREE.Vector2();

export class PlayerAvatar {
    static texturePromise = null;
    static geometry = new THREE.PlaneGeometry(PLAYER_WIDTH, PLAYER_HEIGHT);
    static shadowGeometry = new THREE.CircleGeometry(0.42, 28);
    static collisionGeometry = new THREE.RingGeometry(FOOT_RADIUS * 0.9, FOOT_RADIUS * 1.08, 36);
    static collisionFillGeometry = new THREE.CircleGeometry(FOOT_RADIUS, 36);
    static occlusionShadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x98fff1,
        transparent: true,
        opacity: 0.34,
        depthTest: true,
        depthWrite: false,
        depthFunc: THREE.GreaterDepth,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    static shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x041009,
        transparent: true,
        opacity: 0.36,
        depthTest: true,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth
    });
    static collisionMaterial = new THREE.MeshBasicMaterial({
        color: 0x32ff8f,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    static collisionFillMaterial = new THREE.MeshBasicMaterial({
        color: 0x32ff8f,
        transparent: true,
        opacity: 0.18,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    constructor(threeManager, inputManager, worldGenerator, gridX, gridY, options = {}) {
        this.threeManager = threeManager;
        this.inputManager = inputManager;
        this.worldGenerator = worldGenerator;
        this.isLocal = options.isLocal ?? true;
        this.userId = options.userId || 'player';
        this.gridX = gridX;
        this.gridY = gridY;
        this.gridZ = this.worldGenerator.getElevation(gridX, gridY);
        this.visualX = this.gridX;
        this.visualY = this.gridY;
        this.visualZ = this.gridZ;
        this.targetX = this.gridX;
        this.targetY = this.gridY;
        this.targetZ = this.gridZ;
        this.speed = 4.8;
        this.currentPath = [];
        this.direction = 'south';
        this.frame = 0;
        this.frameTimer = 0;
        this.isMoving = false;
        this.footRadius = FOOT_RADIUS;

        this.group = new THREE.Group();
        this.shadow = new THREE.Mesh(PlayerAvatar.shadowGeometry, PlayerAvatar.shadowMaterial);
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.y = 0.018;
        this.shadow.renderOrder = 18;
        this.group.add(this.shadow);

        this.occlusionShadow = new THREE.Mesh(PlayerAvatar.shadowGeometry, PlayerAvatar.occlusionShadowMaterial);
        this.occlusionShadow.rotation.x = -Math.PI / 2;
        this.occlusionShadow.position.y = 0.022;
        this.occlusionShadow.renderOrder = 25;
        this.group.add(this.occlusionShadow);

        this.collisionDisc = new THREE.Mesh(PlayerAvatar.collisionFillGeometry, PlayerAvatar.collisionFillMaterial);
        this.collisionDisc.rotation.x = -Math.PI / 2;
        this.collisionDisc.position.y = 0.03;
        this.collisionDisc.renderOrder = 29;
        this.collisionDisc.visible = false;
        this.group.add(this.collisionDisc);

        this.collisionRing = new THREE.Mesh(PlayerAvatar.collisionGeometry, PlayerAvatar.collisionMaterial);
        this.collisionRing.rotation.x = -Math.PI / 2;
        this.collisionRing.position.y = 0.035;
        this.collisionRing.renderOrder = 30;
        this.collisionRing.visible = false;
        this.group.add(this.collisionRing);

        this.material = new THREE.MeshBasicMaterial({
            transparent: true,
            alphaTest: 0.08,
            depthTest: true,
            depthWrite: false,
            depthFunc: THREE.LessEqualDepth
        });
        this.mesh = new THREE.Mesh(PlayerAvatar.geometry, this.material);
        this.mesh.position.y = PLAYER_HEIGHT / 2 + 0.07;
        this.mesh.renderOrder = 24;
        this.group.add(this.mesh);

        this.occlusionMaterial = new THREE.MeshBasicMaterial({
            color: 0x98fff1,
            transparent: true,
            opacity: 0.18,
            alphaTest: 0.08,
            depthTest: true,
            depthWrite: false,
            depthFunc: THREE.GreaterDepth,
            blending: THREE.AdditiveBlending
        });
        this.occlusionMesh = new THREE.Mesh(PlayerAvatar.geometry, this.occlusionMaterial);
        this.occlusionMesh.position.copy(this.mesh.position);
        this.occlusionMesh.scale.set(1.08, 1.08, 1);
        this.occlusionMesh.renderOrder = 26;
        this.group.add(this.occlusionMesh);

        this.group.visibleByRange = this.isLocal;
        this.group.visible = this.isLocal;
        this.threeManager.addToEntities(this.group);
        this.setTileOcclusionEnabled(true);
        this.appearance = normalizeAppearance(options.appearance);
        this.loadTexture();
        this.syncModel();
    }

    async loadTexture() {
        const requestId = (this.textureRequestId || 0) + 1;
        this.textureRequestId = requestId;
        const sourceTexture = await CharacterSpriteBaker.getTexture(this.threeManager.renderer, this.appearance);
        if (this.destroyed || requestId !== this.textureRequestId) return;
        this.texture?.dispose();
        this.texture = sourceTexture.clone();
        this.texture.needsUpdate = true;
        this.texture.repeat.set(1 / FRAME_COLUMNS, 1 / FRAME_ROWS);
        this.material.map = this.texture;
        this.material.needsUpdate = true;
        this.occlusionMaterial.map = this.texture;
        this.occlusionMaterial.needsUpdate = true;
        this.updateFrame(0);
    }

    async setAppearance(appearance) {
        this.appearance = normalizeAppearance(appearance);
        await this.loadTexture();
        return this.appearance;
    }

    static getSourceTexture() {
        if (!PlayerAvatar.texturePromise) {
            const canvas = PlayerAvatar.createAnimeSpriteSheet();
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearFilter;
            texture.needsUpdate = true;
            PlayerAvatar.texturePromise = Promise.resolve(texture);
        }
        return PlayerAvatar.texturePromise;
    }

    static createAnimeSpriteSheet() {
        const canvas = document.createElement('canvas');
        canvas.width = FRAME_WIDTH * FRAME_COLUMNS;
        canvas.height = FRAME_HEIGHT * FRAME_ROWS;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const [direction, row] of Object.entries(DIRECTION_ROWS)) {
            for (let frame = 0; frame < FRAME_COLUMNS; frame++) {
                PlayerAvatar.drawAnimeFrame(ctx, frame * FRAME_WIDTH, row * FRAME_HEIGHT, frame, direction);
            }
        }
        return canvas;
    }

    static drawAnimeFrame(ctx, originX, originY, frame, direction) {
        const bob = Math.sin((frame / FRAME_COLUMNS) * Math.PI * 2) * 2;
        const step = Math.sin((frame / FRAME_COLUMNS) * Math.PI * 2);
        const facingSide = direction === 'west' ? -1 : direction === 'east' ? 1 : 0;
        const skin = '#ffe2cf';
        const blush = '#ff9eb4';
        const hair = '#8c532f';
        const hairShade = '#51301f';
        const coat = '#e7edf5';
        const coatShade = '#8394aa';
        const tabard = '#3978b9';
        const gold = '#e4b84f';
        const boots = '#563c31';
        const outline = 'rgba(33, 35, 48, 0.82)';

        ctx.save();
        ctx.translate(originX, originY);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.fillStyle = 'rgba(42, 32, 48, 0.18)';
        ctx.beginPath();
        ctx.ellipse(48, 116, 18, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        const bodyY = 66 + bob;
        const headY = 34 + bob;
        const faceShift = facingSide * 4;

        // Reference-inspired knight silhouette. Every part shares bodyY so
        // equipment stays registered through the complete walk cycle.
        if (direction !== 'north') {
            ctx.strokeStyle = outline;
            ctx.lineWidth = 5;
            ctx.fillStyle = '#537fc0';
            ctx.beginPath();
            ctx.arc(26 - facingSide * 2, bodyY + 22, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#edf4ff';
            ctx.beginPath();
            ctx.arc(26 - facingSide * 2, bodyY + 22, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.strokeStyle = outline;
        ctx.lineWidth = 5;
        ctx.fillStyle = coatShade;
        PlayerAvatar.roundRect(ctx, 31, bodyY, 34, 39, 13);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = coat;
        PlayerAvatar.roundRect(ctx, 35, bodyY + 2, 26, 32, 11);
        ctx.fill();
        ctx.fillStyle = tabard;
        PlayerAvatar.roundRect(ctx, 42, bodyY + 5, 12, 30, 4);
        ctx.fill();
        ctx.fillStyle = gold;
        ctx.fillRect(46, bodyY + 13, 4, 12);

        ctx.strokeStyle = outline;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(35, bodyY + 13);
        ctx.lineTo(25 + step * 2, bodyY + 31);
        ctx.moveTo(61, bodyY + 13);
        ctx.lineTo(71 - step * 2, bodyY + 31);
        ctx.stroke();

        if (direction !== 'north') {
            const swordX = direction === 'west' ? 72 : 74;
            ctx.strokeStyle = '#e9f3ff';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(swordX, bodyY + 30 - step * 2);
            ctx.lineTo(swordX + facingSide * 3, bodyY - 14 - step * 2);
            ctx.stroke();
            ctx.strokeStyle = gold;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(swordX - 6, bodyY + 22 - step * 2);
            ctx.lineTo(swordX + 6, bodyY + 22 - step * 2);
            ctx.stroke();
        }

        ctx.strokeStyle = boots;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(39, bodyY + 37);
        ctx.lineTo(35 + step * 3, 113);
        ctx.moveTo(57, bodyY + 37);
        ctx.lineTo(61 - step * 3, 113);
        ctx.stroke();

        ctx.strokeStyle = outline;
        ctx.lineWidth = 5;
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.ellipse(48, headY + 15, 22, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = hair;
        ctx.beginPath();
        ctx.ellipse(47, headY + 6, 24, 18, -0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = coatShade;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(48, headY + 13, 23, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
        ctx.fillStyle = hairShade;
        ctx.beginPath();
        ctx.ellipse(33 - faceShift * 0.2, headY + 22, 8, 17, 0.18, 0, Math.PI * 2);
        ctx.ellipse(63 + faceShift * 0.2, headY + 20, 8, 15, -0.18, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#2d2540';
        if (direction !== 'north') {
            ctx.beginPath();
            ctx.ellipse(40 + faceShift, headY + 16, 3, 5, 0, 0, Math.PI * 2);
            ctx.ellipse(55 + faceShift, headY + 16, 3, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(41 + faceShift, headY + 14, 1.2, 0, Math.PI * 2);
            ctx.arc(56 + faceShift, headY + 14, 1.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = blush;
            ctx.globalAlpha = 0.42;
            ctx.beginPath();
            ctx.ellipse(32 + faceShift, headY + 25, 4, 2, 0, 0, Math.PI * 2);
            ctx.ellipse(64 + faceShift, headY + 25, 4, 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        ctx.restore();
    }

    static roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
    }

    setPath(path) {
        this.currentPath = [...path];
        if (this.currentPath.length > 0) {
            const first = this.currentPath[0];
            if (Math.abs(first.x - this.gridX) < 0.1 && Math.abs(first.y - this.gridY) < 0.1) {
                this.currentPath.shift();
            }
        }
    }

    setRemoteTarget(centerX, centerY, centerZ) {
        this.targetX = centerX;
        this.targetY = centerY;
        this.targetZ = centerZ;
    }

    update(deltaSeconds = 1 / 60) {
        if (this.isLocal) {
            this.updateLocal(deltaSeconds);
        } else {
            this.updateRemote(deltaSeconds);
        }
        this.accumulateStride();
        this.updateAnimation(deltaSeconds);
        this.syncModel();
    }

    /** PLAN 15D P1.1 — a stride accumulator: every 0.55 m a foot lands (left/right alternate). */
    accumulateStride() {
        const x = this.isLocal ? this.gridX : this.visualX, y = this.isLocal ? this.gridY : this.visualY;
        if (this.prevStrideX == null) { this.prevStrideX = x; this.prevStrideY = y; this.strideDistance = 0; this.footSide = 1; return; }
        const moved = Math.hypot(x - this.prevStrideX, y - this.prevStrideY);
        this.prevStrideX = x; this.prevStrideY = y;
        if (moved > 0 && moved < 1) {                         // ignore teleports
            this.strideDistance += moved;
            if (this.strideDistance >= 0.55) {
                this.strideDistance -= 0.55;
                this.footSide = -this.footSide;
                this.onFootfall?.(this, this.footSide);
            }
        }
    }
    /** PLAN 15D P2.1 — wading: speed / √moveCost (shallow water 1.6 → ×0.79). The server's clamp is unaffected. */
    terrainSpeedFactor() {
        const cost = this.worldGenerator.getReachableSurfaceAtGrid?.(Math.round(this.gridX), Math.round(this.gridY), this.gridZ)?.definition?.moveCost || 1;
        return 1 / Math.sqrt(Math.max(1, cost));
    }

    updateLocal(deltaSeconds) {
        const stepSize = this.speed * this.terrainSpeedFactor() * Math.min(deltaSeconds, 0.05);
        this.isMoving = false;
        // In an encounter the server owns movement (PLAN 15A §5.4); the EventPlayer animates us.
        if (this.inputLocked) { this.currentPath = []; return; }

        if (this.currentPath.length > 0) {
            const target = this.currentPath[0];
            this.moveToward(target.x, target.y, stepSize);
            if (Math.abs(target.x - this.gridX) < 0.001 && Math.abs(target.y - this.gridY) < 0.001) {
                this.currentPath.shift();
            }
            return;
        }

        const sideInput = (this.inputManager.isKeyDown('KeyD') ? 1 : 0) -
            (this.inputManager.isKeyDown('KeyA') ? 1 : 0);
        const forwardInput = (this.inputManager.isKeyDown('KeyW') ? 1 : 0) -
            (this.inputManager.isKeyDown('KeyS') ? 1 : 0);

        if (sideInput !== 0 || forwardInput !== 0) {
            const { mx, my } = this.getCameraRelativeMovement(sideInput, forwardInput);
            const nextX = this.gridX + mx * stepSize;
            const nextY = this.gridY + my * stepSize;
            const movedX = this.tryMove(nextX, this.gridY, mx, 0);
            const movedY = this.tryMove(this.gridX, nextY, 0, my);
            if (!movedX && !movedY) {
                this.tryMove(nextX, nextY, mx, my);
            }
        }
    }

    getCameraRelativeMovement(sideInput, forwardInput) {
        CAMERA_FORWARD.set(0, 0, -1).applyQuaternion(this.threeManager.camera.quaternion);
        CAMERA_FORWARD.y = 0;
        CAMERA_FORWARD.normalize();

        CAMERA_RIGHT.set(1, 0, 0).applyQuaternion(this.threeManager.camera.quaternion);
        CAMERA_RIGHT.y = 0;
        CAMERA_RIGHT.normalize();

        MOVE_VECTOR.set(
            CAMERA_RIGHT.x * sideInput + CAMERA_FORWARD.x * forwardInput,
            CAMERA_RIGHT.z * sideInput + CAMERA_FORWARD.z * forwardInput
        );

        if (MOVE_VECTOR.lengthSq() > 1) MOVE_VECTOR.normalize();
        return { mx: MOVE_VECTOR.x, my: MOVE_VECTOR.y };
    }

    moveToward(targetX, targetY, stepSize) {
        const dx = targetX - this.gridX;
        const dy = targetY - this.gridY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= stepSize) {
            this.tryMove(targetX, targetY, dx, dy);
        } else {
            this.tryMove(
                this.gridX + (dx / distance) * stepSize,
                this.gridY + (dy / distance) * stepSize,
                dx,
                dy
            );
        }
    }

    tryMove(nextX, nextY, dx, dy) {
        const fromX = Math.round(this.gridX);
        const fromY = Math.round(this.gridY);
        const repX = Math.round(nextX);
        const repY = Math.round(nextY);
        const nextElevation = this.worldGenerator.getMovementElevation(repX, repY, this.gridZ);

        if (this.worldGenerator.canMoveFootprintBetween(this.gridX, this.gridY, nextX, nextY, this.footRadius, this.gridZ)) {
            this.gridX = nextX;
            this.gridY = nextY;
            this.gridZ = nextElevation;
            this.targetX = nextX;
            this.targetY = nextY;
            this.targetZ = nextElevation;
            this.setDirection(dx, dy);
            this.isMoving = true;
            return true;
        }
        return false;
    }

    setCollisionDebugVisible(isVisible) {
        this.collisionDisc.visible = isVisible;
        this.collisionRing.visible = isVisible;
    }

    setTileOcclusionEnabled(isEnabled = true) {
        this.material.depthTest = isEnabled;
        this.material.depthFunc = THREE.LessEqualDepth;
        this.material.needsUpdate = true;

        PlayerAvatar.shadowMaterial.depthTest = isEnabled;
        PlayerAvatar.shadowMaterial.depthFunc = THREE.LessEqualDepth;
        PlayerAvatar.shadowMaterial.needsUpdate = true;

        this.occlusionMesh.visible = isEnabled;
        this.occlusionShadow.visible = isEnabled;
    }

    updateRemote(deltaSeconds) {
        const smoothing = Math.min(1, deltaSeconds * 12);
        const dx = this.targetX - this.gridX;
        const dy = this.targetY - this.gridY;
        this.gridX += dx * smoothing;
        this.gridY += dy * smoothing;
        this.gridZ += (this.targetZ - this.gridZ) * smoothing;
        this.isMoving = Math.sqrt(dx * dx + dy * dy) > 0.01;
        if (this.isMoving) this.setDirection(dx, dy);
    }

    setDirection(dx, dy) {
        if (Math.abs(dx) > Math.abs(dy)) {
            this.direction = dx > 0 ? 'east' : 'west';
        } else {
            this.direction = dy > 0 ? 'south' : 'north';
        }
    }

    updateAnimation(deltaSeconds) {
        if (this.isMoving) {
            this.frameTimer += deltaSeconds;
            if (this.frameTimer >= FRAME_DURATION) {
                this.frameTimer = 0;
                this.frame = (this.frame + 1) % FRAME_COLUMNS;
            }
        } else {
            this.frame = 0;
            this.frameTimer = 0;
        }
        this.updateFrame(this.frame);
    }

    updateFrame(frame) {
        if (!this.texture) return;
        const row = DIRECTION_ROWS[this.direction] ?? DIRECTION_ROWS.south;
        this.texture.offset.x = frame / FRAME_COLUMNS;
        this.texture.offset.y = 1 - ((row + 1) / FRAME_ROWS);
    }

    syncModel() {
        this.visualX += (this.gridX - this.visualX) * 0.45;
        this.visualY += (this.gridY - this.visualY) * 0.45;
        this.visualZ += (this.gridZ - this.visualZ) * 0.2;
        const surfaceY = this.visualZ + this.worldGenerator.getTopSurfaceOffset();
        this.group.position.set(this.visualX, surfaceY + SURFACE_EPSILON, this.visualY);
        this.mesh.quaternion.copy(this.threeManager.camera.quaternion);
        this.occlusionMesh.quaternion.copy(this.mesh.quaternion);
    }

    getCenterPayload() {
        return {
            centerX: this.gridX,
            centerY: this.gridY,
            centerZ: this.gridZ
        };
    }

    setLODVisible(isVisible) {
        const visible = this.isLocal || isVisible;
        this.group.visibleByRange = visible;
        this.group.visible = visible;
    }

    applyAuthoritativeCenter(centerX, centerY, centerZ, tileX, tileY, tileZ) {
        const snapDistance = Math.sqrt((centerX - this.gridX) ** 2 + (centerY - this.gridY) ** 2);
        this.gridX = centerX;
        this.gridY = centerY;
        this.gridZ = centerZ ?? tileZ;
        this.targetX = centerX;
        this.targetY = centerY;
        this.targetZ = centerZ ?? tileZ;
        if (!Number.isFinite(centerZ) && Number.isFinite(tileZ)) {
            this.gridZ = tileZ;
        }
        if (snapDistance > 0.75 || Math.abs(this.visualZ - this.gridZ) > 0.75) {
            this.visualX = this.gridX;
            this.visualY = this.gridY;
            this.visualZ = this.gridZ;
        }
    }

    destroy() {
        this.destroyed = true;
        this.threeManager.removeFromEntities(this.group);
        if (this.texture) this.texture.dispose();
        this.material.dispose();
        this.occlusionMaterial.dispose();
    }
}
