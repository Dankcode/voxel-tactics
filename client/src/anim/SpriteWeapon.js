// Flat painted character cards + a 3D gun. There is no character volume or character model.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { constrainGunPose } from './SpriteArmRig.js';
import { puppetPose, deformPuppetMesh } from './SpritePuppetRig.js';
import { gunCelRamp, gunCelMaterial, gunInkMaterial } from './SpriteGunMaterial.js';

export function spriteGunParts(weaponId) {
    if (weaponId === 'blunderbuss') return { family: 'shotgun' };
    if (weaponId === 'longrifle') return { family: 'sniper' };
    if (['repeater','crossbow','shortbow','musket'].includes(weaponId)) return { family: 'rifle' };
    return null;
}
export const gunPoint = p => new THREE.Vector3(p[0], p[2], -p[1]);
/** Shared global paint order for the flat fallback and the character/gun compositor. */
export const spriteLayerOrder = l => l.zIndex ?? ((l.stage === 'back' ? 0 : 100) + (l.order ?? (l.id === 'body' ? 5 : l.id === 'support-hand' ? 10 : l.id.endsWith('upper') ? 1 : l.id.endsWith('forearm') ? 2 : 3)));
export const sortedSpriteLayers = layers => [...layers].sort((a,b) => spriteLayerOrder(a) - spriteLayerOrder(b));

/** Seat the stock at the painted armpit and fit the actual foregrip to the support palm. */
export function fitSpriteGunCamera(camera, spec, stock, support, aspect) {
    camera.position.fromArray(spec.cameraPosition || [.32, .14, 5]);
    camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const s = stock.clone().applyMatrix4(camera.matrixWorldInverse);
    const g = support.clone().applyMatrix4(camera.matrixWorldInverse);
    const dx = (spec.support[0] - spec.stock[0]) * aspect, dy = spec.stock[1] - spec.support[1];
    const height = Math.hypot(g.x - s.x, g.y - s.y) / Math.max(.005, Math.hypot(dx, dy));
    camera.rotateZ(Math.atan2(g.y - s.y, g.x - s.x) - Math.atan2(dy, dx));
    camera.updateMatrixWorld(true);
    s.copy(stock).applyMatrix4(camera.matrixWorldInverse);
    camera.left = s.x - spec.stock[0] * height * aspect; camera.right = camera.left + height * aspect;
    camera.top = s.y + spec.stock[1] * height; camera.bottom = camera.top - height;
    camera.near = .01; camera.far = 50; camera.updateProjectionMatrix();
    return camera;
}

/** The aim pose's gun camera. `gunView.projection: 'perspective'` is the over-the-shoulder view: a camera behind the
 * shoulder in gun space (metres, glTF axes) looking down the bore, cropped to the card. `card` is the card's square in
 * the full frame's pixels, so the bore converges on the frame centre (`crosshair` in the manifest). Without it the pose
 * keeps the legacy orthographic side fit. */
export function aimGunCamera(rig, stock, aspect) {
    const view = rig.gunView;
    if (view?.projection !== 'perspective') return fitGunPose(new THREE.OrthographicCamera(), rig, stock, aspect);
    const [fw, fh] = view.frame, [x, y, w, h] = view.card;
    const camera = new THREE.PerspectiveCamera(view.verticalFovDeg, fw / fh, view.near ?? .02, view.far ?? 60);
    // Every gun's butt sits in the same shoulder pocket: shift the view by this stock's offset from the seat.
    const seat = view.seat ? stock.clone().sub(new THREE.Vector3().fromArray(view.seat)) : new THREE.Vector3();
    camera.position.fromArray(view.position).add(seat); camera.up.set(0, 1, 0);
    camera.lookAt(new THREE.Vector3().fromArray(view.lookAt).add(seat));
    camera.setViewOffset(fw, fh, x, y, w, h);
    camera.updateMatrixWorld(true);
    return camera;
}

/** One camera scale per pose, shared by all guns. A 1.18m rifle stays longer than a .705m carbine. */
export function fitGunPose(camera, rig, stock, aspect) {
    const view = rig.gunView;
    const axis = stock.clone().add(new THREE.Vector3(0, 0, -view.referenceLengthMetres));
    return fitSpriteGunCamera(camera, { stock: rig.stock, support: view.referenceMuzzle, cameraPosition: view.cameraPosition }, stock, axis, aspect);
}

/** A stock-fixed transform shared by the live renderer and the rig audit. Recoil kicks about the shoulder. */
export function gunPivotMatrix(stock, {yaw=0,pitch=0,recoil=0}={}) {
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch-recoil*1.8,yaw+recoil*.4,0,'YXZ'));
    const p=stock.clone().sub(stock.clone().applyQuaternion(q));
    return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));
}

/** Authoring rotation about point 4. Raise the butt without translating the muzzle or scaling any part. */
export function barrelButtMatrix(camera, assembly, degrees = 8) {
    const muzzle=gunPoint(assembly.muzzle),stock=gunPoint(assembly.stock);
    const s=stock.clone().project(camera),m=muzzle.clone().project(camera);
    const axis=camera.getWorldDirection(new THREE.Vector3());
    const q=new THREE.Quaternion().setFromAxisAngle(axis,Math.sign(m.x-s.x)*THREE.MathUtils.degToRad(degrees));
    const p=muzzle.clone().sub(muzzle.clone().applyQuaternion(q));
    return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));
}

export function gunPoseSample(art, assembly, camera, input={}, degrees=art.rig.buttRaiseDegrees??8) {
    const rest=barrelButtMatrix(camera,assembly,degrees);
    const seatedStock=gunPoint(assembly.stock).applyMatrix4(rest);
    const matrix=gunPivotMatrix(seatedStock,input).multiply(rest);
    const uv=p=>{const q=gunPoint(p).applyMatrix4(matrix).project(camera);return[(q.x+1)/2,(1-q.y)/2];};
    return {matrix,targets:{stock:uv(assembly.stock),grip:uv(assembly.grip),support:uv(assembly.support),muzzle:uv(assembly.muzzle)}};
}

let kit;
function loadKit() {
    return kit ||= Promise.all([
        new GLTFLoader().loadAsync('/assets/weapons/ranger-preview/gun-kit.glb'),
        fetch('/assets/weapons/ranger-preview/gun-kit.json').then(r => { if (!r.ok) throw Error('Gun anchors unavailable'); return r.json(); })
    ]).catch(error => { kit = null; throw error; });
}
const textureLoader = new THREE.TextureLoader(), textures = new Map();
function loadTexture(url, colour = false) {
    if (!textures.has(url)) textures.set(url, textureLoader.loadAsync(url).then(t => {
        if (colour) t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; return t;
    }));
    return textures.get(url);
}
function paintedMaterial(map, normal, mask) {
    return new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
        uniforms: { map: { value: map }, normalMap: { value: normal }, response: { value: mask },
            sun: { value: new THREE.Vector3(.3, .8, .6) }, sunColour: { value: new THREE.Color() },
            sky: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
            fill: { value: new THREE.Color() }, fillDir: { value: new THREE.Vector3() },
            localLight: { value: new THREE.Color(0) }, localDir: { value: new THREE.Vector3(0, 0, 1) },
            boneRotation: { value: new THREE.Vector2(1, 0) } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform sampler2D map,normalMap,response; uniform vec3 sun,sunColour,sky,ground,fill,fillDir,localLight,localDir;
            uniform vec2 boneRotation; varying vec2 vUv;
            void main(){ vec4 albedo=texture2D(map,vUv); if(albedo.a<.005)discard;
                vec3 n=normalize(texture2D(normalMap,vUv).xyz*2.-1.);
                n.xy=mat2(boneRotation.x,boneRotation.y,-boneRotation.y,boneRotation.x)*n.xy;
                vec3 m=texture2D(response,vUv).rgb;
                vec3 ambient=mix(ground,sky,clamp(n.y*.5+.5,0.,1.));
                vec3 direct=sunColour*max(0.,dot(n,sun))+fill*max(0.,dot(n,fillDir))+localLight*max(0.,dot(n,localDir));
                gl_FragColor=vec4(albedo.rgb*(ambient*m.b+direct*m.r)+albedo.rgb*m.g,albedo.a);
                // Keep the painted interior independent of scene exposure; only the mask's rim responds.
                #include <colorspace_fragment>
            }` });
}

export class SpriteWeapon {
    constructor(slot, art, unit, weaponId = unit.weapon, world = null, base = '/assets/characters/ranger-01/') {
        this.slot = slot; this.art = art; this.unit = unit; this.world = world; this.base = base;
        this.config = spriteGunParts(weaponId);
        this.gunVisible = !!this.config; this.config ||= { family: 'rifle', parts: [] };
        this.ready = false; this.disposed = false; this.last = {}; this.cards = []; this.resources = [];
        this.loaded = this.load().catch(error => {
            this.error = error; this.ready = false; this.slot.classList.remove('sprite-composite-ready');
            this.renderer?.domElement.remove(); this.renderer?.dispose();
            console.warn('Sprite composition unavailable', error);
        });
    }
    async load() {
        const [gltf, anchors] = await loadKit();
        // Gloves come per gun family (pistol grip, pump-gun stock wrist, sniper forend): use the variant for this gun.
        const pick = l => ({ ...l, ...(l.variants?.[this.config.family] || {}) });
        const layers = await Promise.all(sortedSpriteLayers(this.art.layers.filter(l => l.image).map(pick)).map(async l => ({ ...l,
            maps: await Promise.all([loadTexture(this.base + l.image, true), loadTexture(this.base + l.normal), loadTexture(this.base + l.lightingMask)]) })));
        if (this.disposed) return;
        this.anchors = anchors;
        this.assembly = anchors.assemblies[this.config.family];
        this.config.parts = this.gunVisible ? this.assembly.parts : [];
        this.support = gunPoint(this.assembly.support);
        this.scene = new THREE.Scene(); this.backScene = new THREE.Scene(); this.frontScene = new THREE.Scene();
        this.model = gltf.scene.clone(true); this.model.visible = this.gunVisible; this.scene.add(this.model);
        this.pivot = this.model.getObjectByName('Gun') || this.model;
        const known = new Set(Object.values(anchors.assemblies).flatMap(a => a.parts));
        const ramp = gunCelRamp(), ink = gunInkMaterial(); this.resources.push(ramp, ink);
        const gunMeshes = [];
        this.model.traverse(ob => {
            if (!known.has(ob.name)) return;
            ob.visible = this.config.parts.includes(ob.name);
            if (ob.isMesh) {
                // Per-instance materials; the cached GLTF and its metre-space geometry stay immutable.
                ob.material = gunCelMaterial(ob.name, ramp); this.resources.push(ob.material);
                gunMeshes.push(ob);
            }
        });
        for (const ob of gunMeshes) {
            const outline = new THREE.Mesh(ob.geometry, ink); outline.name = `${ob.name} ink`;
            outline.renderOrder = -1; ob.add(outline);
        }
        this.stock = gunPoint(this.assembly.stock);
        // Trigger finger contact (top of the trigger guard), gun space; the glove's index fingertip is registered on it.
        const contact = this.art.rig.triggerContact?.[this.config.family];
        this.triggerContact = contact ? gunPoint(contact) : null;
        this.camera = aimGunCamera(this.art.rig, this.stock, this.art.width / this.art.height);
        this.buttRaise=this.art.rig.buttRaiseDegrees??8;
        this.flatCamera = new THREE.OrthographicCamera(0, this.art.width, 0, -this.art.height, .01, 20);
        this.flatCamera.position.z = 10;
        const gunZ=this.art.layers.find(l=>l.gun)?.zIndex ?? 100;
        for (const layer of layers) {
            const deformable=this.art.puppet&&layer.bone&&!layer.bone.endsWith('hand');
            const divisions=deformable?(this.art.puppet.meshDivisions||32):1;
            const [x0,y0,x1,y1]=deformable&&layer.bounds?layer.bounds:[0,0,this.art.width,this.art.height];
            const geometry = new THREE.PlaneGeometry(x1-x0, y1-y0,divisions,divisions);
            geometry.translate((x0+x1)/2, -(y0+y1)/2, 0);
            const uv=geometry.attributes.uv;
            for(let i=0;i<uv.count;i++)uv.setXY(i,(x0+uv.getX(i)*(x1-x0))/this.art.width,1-(y1-uv.getY(i)*(y1-y0))/this.art.height);
            const material = paintedMaterial(...layer.maps), mesh = new THREE.Mesh(geometry, material);
            mesh.matrixAutoUpdate = false; mesh.renderOrder = spriteLayerOrder(layer);
            (spriteLayerOrder(layer) < gunZ ? this.backScene : this.frontScene).add(mesh);
            mesh.frustumCulled=false;
            this.cards.push({ mesh, layer, source:deformable?geometry.attributes.position.array.slice():null }); this.resources.push(geometry, material);
        }
        this.hemi = new THREE.HemisphereLight(); this.sun = new THREE.DirectionalLight(); this.fill = new THREE.DirectionalLight();
        this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        this.renderer.setClearColor(0, 0); this.renderer.setPixelRatio(1); this.renderer.autoClear = false;
        this.renderer.setSize(this.art.width, this.art.height, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.domElement.className = 'sprite-weapon-canvas';
        this.slot.appendChild(this.renderer.domElement);
        this.ready = true; this.slot.classList.add('sprite-composite-ready'); this.update(this.last);
    }
    project(point) {
        const p = point.clone().applyMatrix4(this.pivot.matrixWorld).project(this.camera);
        return [(p.x + 1) / 2, (1 - p.y) / 2];
    }
    updateLights() {
        const w = this.world;
        const direction = light => light.position.clone().sub(light.target.position).normalize();
        const view = v => w?.camera ? v.applyQuaternion(w.camera.quaternion.clone().invert()) : v;
        const sunDir = view(w?.sun ? direction(w.sun) : new THREE.Vector3(-.4, 1, .6).normalize());
        const fillDir = view(w?.back ? direction(w.back) : new THREE.Vector3(.5, .3, 1).normalize());
        // Match the world's actual light colours/intensities. Reflection is corrected when the art is mirrored.
        const mirror = this.art.mirror ? -1 : 1; sunDir.x *= mirror; fillDir.x *= mirror;
        const sky = (w?.hemi?.color || new THREE.Color(0xc9dcf2)).clone().multiplyScalar((w?.hemi?.intensity ?? .45) * 1.4);
        const ground = (w?.hemi?.groundColor || new THREE.Color(0x5a4c3a)).clone().multiplyScalar((w?.hemi?.intensity ?? .45) * 1.4);
        const sunColour = (w?.sun?.color || new THREE.Color(0xfff0d8)).clone().multiplyScalar((w?.sun?.intensity ?? 2.6) * .6);
        const fill = (w?.back?.color || new THREE.Color(0x9fb8ff)).clone().multiplyScalar((w?.back?.intensity ?? .55) * .6);
        const local = new THREE.Color(0), localDir = new THREE.Vector3(0, 0, 1);
        if (w?.scene && this.unit.x != null) w.scene.traverse(l => {
            if (!l.isPointLight || !l.visible || !l.intensity) return;
            const d = l.getWorldPosition(new THREE.Vector3()).sub(new THREE.Vector3(this.unit.x + .5, (this.unit.z || 0) + 2, this.unit.y + .5));
            const distance = d.length();
            if (distance > (l.distance || 12)) return;
            const strength = Math.min(2, l.intensity / Math.max(1, distance * distance));
            local.add(l.color.clone().multiplyScalar(strength)); localDir.copy(view(d.normalize())); localDir.x *= mirror;
        });
        for (const { mesh } of this.cards) {
            const u = mesh.material.uniforms;
            u.sun.value.copy(sunDir); u.sunColour.value.copy(sunColour); u.sky.value.copy(sky); u.ground.value.copy(ground);
            u.fill.value.copy(fill); u.fillDir.value.copy(fillDir); u.localLight.value.copy(local); u.localDir.value.copy(localDir);
        }
        this.hemi.color.copy(sky); this.hemi.groundColor.copy(ground); this.hemi.intensity = 1;
        this.sun.color.copy(sunColour); this.sun.intensity = 2; this.sun.position.copy(sunDir).applyQuaternion(this.camera.quaternion).multiplyScalar(5);
        this.fill.color.copy(fill); this.fill.intensity = 2; this.fill.position.copy(fillDir).applyQuaternion(this.camera.quaternion).multiplyScalar(5);
        this.renderer.toneMappingExposure = w?.renderer?.toneMappingExposure ?? 1;
    }
    update({yaw=0,pitch=0,recoil=0} = {}) {
        this.last = { yaw, pitch, recoil };
        if (!this.ready || this.disposed) return null;
        const sample = ({yaw: y, pitch: p, recoil: r}) => {
            const pose=gunPoseSample(this.art,this.assembly,this.camera,{yaw:y,pitch:p,recoil:r},this.buttRaise);
            this.pivot.matrixAutoUpdate=false;this.pivot.matrix.copy(pose.matrix);
            this.model.updateMatrixWorld(true);
            return this.gunVisible ? {stock:this.project(this.stock),grip:this.project(new THREE.Vector3()),support:this.project(this.support),muzzle:this.project(gunPoint(this.assembly.muzzle)),
                ...(this.triggerContact?{trigger:this.project(this.triggerContact)}:{})}
                : {stock:this.art.rig.stock,grip:this.art.rig.grip,support:this.art.rig.support,muzzle:this.art.muzzle};
        };
        const puppet=this.art.puppet;
        // Clamp only the authored parameter domain. No automatic anatomy, reach solve or elbow flipping.
        const input=puppet?{yaw:THREE.MathUtils.clamp(yaw,-puppet.range.yaw,puppet.range.yaw),pitch:THREE.MathUtils.clamp(pitch,-puppet.range.pitch,puppet.range.pitch),recoil:THREE.MathUtils.clamp(recoil,0,puppet.range.recoil)}:{yaw,pitch,recoil};
        const solved=puppet?{input,targets:sample(input)}:constrainGunPose(sample,input,this.art.rig,this.art.width,this.art.height);
        if(puppet)solved.arms=puppetPose(this.art,solved.targets,this.config.family,input);
        const targets=solved.targets,transforms=puppet?solved.arms.handTransforms:solved.arms.transforms;
        this.rigPose=solved;
        for (const { mesh, layer, source } of this.cards) {
            if(source){deformPuppetMesh(mesh.geometry,source,solved.arms.deformers[layer.bone]);mesh.matrix.identity();mesh.material.uniforms.boneRotation.value.set(1,0);continue;}
            const m = transforms[layer.bone] || [1, 0, 0, 1, 0, 0], [a, b, c, d, x, y] = m;
            mesh.matrix.set(a, -c, 0, x, -b, d, 0, -y, 0, 0, 1, 0, 0, 0, 0, 1);
            const n = Math.max(.00001, Math.hypot(a, b)); mesh.material.uniforms.boneRotation.value.set(a / n, -b / n);
        }
        this.updateLights();
        this.renderer.clear(); this.renderer.render(this.backScene, this.flatCamera);
        this.renderer.clearDepth(); this.renderer.render(this.scene, this.camera);
        this.renderer.clearDepth(); this.renderer.render(this.frontScene, this.flatCamera);
        this.targets = targets; return targets;
    }
    setPuppetWireframe(enabled){
        for(const card of this.cards.filter(c=>c.source)){
            if(enabled&&!card.wire){
                const material=new THREE.MeshBasicMaterial({color:card.layer.bone.startsWith('trigger')?0xffc26a:0x77dfd2,wireframe:true,transparent:true,opacity:.3,depthTest:false,depthWrite:false});
                const wire=new THREE.Mesh(card.mesh.geometry,material);wire.renderOrder=card.mesh.renderOrder+.1;wire.frustumCulled=false;card.mesh.parent.add(wire);card.wire=wire;this.resources.push(material);
            }
            if(card.wire)card.wire.visible=enabled;
        }
        this.update(this.last);
    }
    dispose() {
        this.disposed = true;
        if (this.renderer) { this.renderer.domElement.remove(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
        this.resources.forEach(r => r.dispose()); this.slot.classList.remove('sprite-composite-ready');
        // Textures and kit geometry belong to their shared immutable caches.
    }
}
