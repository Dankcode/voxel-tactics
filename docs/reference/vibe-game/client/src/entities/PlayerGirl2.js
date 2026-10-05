import * as THREE from 'three';

export class PlayerGirl2 {
    constructor(threeManager, inputManager, worldGenerator, gridX, gridY) {
        this.threeManager = threeManager;
        this.inputManager = inputManager;
        this.worldGenerator = worldGenerator;
        this.gridX = gridX;
        this.gridY = gridY;
        this.gridZ = this.worldGenerator.getElevation(gridX, gridY);
        this.visualZ = this.gridZ; // For streamlined mathematical interpolation
        this.speed = 3.2;
        this.currentDir = 's';
        this.flipX = false;
        this.currentPath = [];

        this.loader = new THREE.TextureLoader();
        this.bodyTexture = this.loader.load('assets/sprites/body-2-walk.png');
        this.headTexture = this.loader.load('assets/sprites/head-2-walk.png');

        // Body Sprite
        this.bodyMaterial = new THREE.SpriteMaterial({ 
            map: this.bodyTexture,
            transparent: true
        });
        this.bodySprite = new THREE.Sprite(this.bodyMaterial);
        this.bodySprite.scale.set(1, 2, 1); // Aspect ratio ~1:2
        
        // Head Sprite
        this.headMaterial = new THREE.SpriteMaterial({ 
            map: this.headTexture,
            transparent: true
        });
        this.headSprite = new THREE.Sprite(this.headMaterial);
        this.headSprite.scale.set(1, 1, 1);

        this.group = new THREE.Group();
        this.group.add(this.bodySprite);
        this.group.add(this.headSprite);
        
        // Offset head
        this.headSprite.position.set(0, 0.8, 0.01);

        this.threeManager.addToEntities(this.group);
        this.syncSprites();
    }

    setPath(path) {
        console.log('[PlayerGirl2] setPath called with length:', path ? path.length : 0);
        this.currentPath = [...path];
        // If the path starts with the node we are already roughly on, skip it
        if (this.currentPath.length > 0) {
            const first = this.currentPath[0];
            if (Math.abs(first.x - this.gridX) < 0.1 && Math.abs(first.y - this.gridY) < 0.1) {
                this.currentPath.shift();
            }
        }
        console.log('[PlayerGirl2] Final currentPath length:', this.currentPath.length);
    }

    update(deltaSeconds = 1 / 60) {
        const stepSize = this.speed * Math.min(deltaSeconds, 0.05);

        // Streamlined Character Movement Function implementation
        if (this.currentPath.length > 0) {
            const target = this.currentPath[0];
            const dx = target.x - this.gridX;
            const dy = target.y - this.gridY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Execute traversal mathematically:
            if (dist <= stepSize) {
                // When we cross the bounds fully into the actual node, snap exactly.
                this.gridX = target.x;
                this.gridY = target.y;
                this.gridZ = this.worldGenerator.getElevation(target.x, target.y);
                this.currentPath.shift(); 
            } else {
                // We calculate precise streamline vector move
                const moveX = (dx / dist) * stepSize;
                const moveY = (dy / dist) * stepSize;
                this.gridX += moveX;
                this.gridY += moveY;
                
                // Precisely evaluate when the middle collision body crosses tile representations
                const currentRepresentationX = Math.round(this.gridX);
                const currentRepresentationY = Math.round(this.gridY);
                this.gridZ = this.worldGenerator.getElevation(currentRepresentationX, currentRepresentationY);
            }

            // Sprite visual facing logic
            if (dx < -0.01) this.flipX = true;
            if (dx > 0.01) this.flipX = false;
        } else {
            // Manual input fallback smoothly integrated
            let mx = 0; let my = 0;
            if (this.inputManager.isKeyDown('KeyW')) { mx -= 1; my -= 1; }
            if (this.inputManager.isKeyDown('KeyS')) { mx += 1; my += 1; }
            if (this.inputManager.isKeyDown('KeyA')) { mx -= 1; my += 1; }
            if (this.inputManager.isKeyDown('KeyD')) { mx += 1; my -= 1; }
            
            if (mx !== 0 || my !== 0) {
                const len = Math.sqrt(mx * mx + my * my);
                mx /= len; my /= len;
                const nextX = this.gridX + (mx * stepSize);
                const nextY = this.gridY + (my * stepSize);
                
                const repX = Math.round(nextX);
                const repY = Math.round(nextY);
                const nextElevation = this.worldGenerator.getMovementElevation(repX, repY, this.gridZ);
                
                if (this.worldGenerator.canMoveFootprintBetween(this.gridX, this.gridY, nextX, nextY, 0.32, this.gridZ)) {
                    this.gridX = nextX;
                    this.gridY = nextY;
                    this.gridZ = nextElevation;
                }
                
                if (mx < -0.01) this.flipX = true;
                if (mx > 0.01) this.flipX = false;
            }
        }

        this.syncSprites();
    }

    syncSprites() {
        // Streamlined mathematics: smooth lerp between elevation changes
        this.visualZ += (this.gridZ - this.visualZ) * 0.2;
        
        // Mapping: (gridX, elevation, gridY) -> (x, y, z)
        const yPos = this.visualZ + 1.0; 
        this.group.position.set(this.gridX, yPos, this.gridY);
        
        // Handle flipping
        this.bodySprite.scale.x = this.flipX ? -1 : 1;
        this.headSprite.scale.x = this.flipX ? -1 : 1;
    }

    destroy() {
        this.threeManager.removeFromEntities(this.group);
        this.bodyMaterial.dispose();
        this.headMaterial.dispose();
        this.bodyTexture.dispose();
        this.headTexture.dispose();
    }
}
