import * as THREE from 'three';
import { SpriteWeapon } from './SpriteWeapon.js';
import { installBillboardDepth, billboardDepthSlope } from '../units/BillboardDepth.js';

/** A complete, foot-anchored character card. Mirroring happens around the feet, not the canvas centre. */
export function worldAimGeometry(art) {
    const h=art.worldHeight, w=h*art.width/art.height, [x,y]=art.anchor;
    return new THREE.PlaneGeometry(w,h).translate((.5-x)*w,(y-.5)*h,0);
}

/** Keep the gun facing the reticle; retain the last side in a narrow centre deadband. */
export function worldAimSide(camera,position,target,previous='right') {
    if(!target)return previous;
    const origin=position.clone().add(new THREE.Vector3(0,1.4,0)).project(camera);
    const aim=target.clone().project(camera),dx=aim.x-origin.x;
    return Math.abs(dx)<.025?previous:dx<0?'left':'right';
}

export class WorldAimSprite {
    constructor(view, art, weaponId, base) {
        this.view=view;this.art={...art};this.disposed=false;
        // Detached host: the compositor is a texture source, never a HUD overlay.
        this.slot=document.createElement('div');
        this.weapon=new SpriteWeapon(this.slot,this.art,view.unit,weaponId,view.scene,base);
        this.loaded=this.weapon.loaded.then(()=>{
            if(this.disposed||!this.weapon.ready)return;
            this.texture=new THREE.CanvasTexture(this.weapon.renderer.domElement);
            this.texture.colorSpace=THREE.SRGBColorSpace;this.texture.generateMipmaps=false;
            this.texture.minFilter=THREE.LinearFilter;
            this.material=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,alphaTest:.35,
                side:THREE.DoubleSide,toneMapped:false,depthTest:true,depthWrite:true});
            this.depthSlope=installBillboardDepth(this.material);
            this.mesh=new THREE.Mesh(worldAimGeometry(this.art),this.material);
            this.mesh.name='World aiming character';this.mesh.userData.unitId=view.id;
            this.mesh.visible=false;view.group.add(this.mesh);
        });
    }
    get ready(){return !!this.mesh&&!this.disposed;}
    update(camera,side='right') {
        if(!this.ready)return;
        this.art.mirror=side==='left';
        this.mesh.scale.x=this.art.mirror?-1:1;
        this.mesh.quaternion.copy(camera.quaternion);
        this.depthSlope.value=billboardDepthSlope(camera);
        // Static grip pose: the crosshair turns independently, with no sprite inertia.
        this.weapon.update();this.texture.needsUpdate=true;this.mesh.visible=true;
    }
    dispose(){
        this.disposed=true;this.mesh?.removeFromParent();this.mesh?.geometry.dispose();
        this.material?.dispose();this.texture?.dispose();this.weapon.dispose();
    }
}
