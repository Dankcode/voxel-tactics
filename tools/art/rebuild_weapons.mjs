import fs from 'node:fs';
import * as THREE from 'three';
import { box, softBox, merge, profileX, clean } from '../../client/src/render/kit/Geo.js';

const OUT = 'client/public/assets/weapons/ranger-preview';
const side = (points, depth) => profileX(points, depth, .004).rotateY(Math.PI / 2);
const tube = (r, length, y, z, segments = 12) => new THREE.CylinderGeometry(r, r, length, segments).rotateX(-Math.PI / 2).translate(0, y, z);
const part = (role, geometry) => ({ role, geometry: clean(geometry) });
const parts = {
    rifle_receiver: part('Receiver', merge([
        softBox(.078,.09,.29,.008,1).translate(0,.07,-.045),
        box(.058,.018,.32,0,.116,-.06), box(.018,.025,.055,.045,.075,.045),
        box(.008,.032,.1,.043,.055,-.045), tube(.009,.1,.132,-.06,8)
    ])),
    rifle_stock: part('Buttstock', merge([
        side([[-.184,.035],[-.179,.12],[-.14,.125],[-.04,.095],[.015,.085],[.015,.045],[-.055,.02]],.054),
        box(.062,.115,.018,0,.07,.1793), box(.064,.018,.15,0,.09,.105)
    ])),
    rifle_grip: part('Trigger grip', side([[-.045,.035],[.035,.035],[.018,-.072],[-.025,-.083],[-.048,-.02]],.04)),
    rifle_foregrip: part('Handguard / foregrip', merge([
        softBox(.064,.072,.265,.009,1).translate(0,.079,-.327),
        ...Array.from({length:6},(_,i)=>box(.069,.008,.012,0,.063,-.22-i*.038)),
        box(.04,.012,.27,0,.119,-.327)
    ])),
    rifle_magazine: part('Magazine', side([[-.055,.02],[.045,.02],[.052,-.12],[.025,-.17],[-.035,-.165],[-.052,-.09]],.044)),
    rifle_barrel: part('Barrel + muzzle', merge([
        tube(.012,.12,.104,-.455), tube(.019,.035,.104,-.499),
        ...[0,1,2].map(i=>box(.008,.008,.018,0,.104,-.491-i*.006).rotateZ(i*Math.PI/3))
    ])),
    rifle_sight: part('Iron sights', merge([
        box(.025,.035,.016,0,.142,.105), box(.035,.008,.02,0,.164,.105),
        box(.025,.035,.016,0,.142,-.44), box(.035,.008,.02,0,.164,-.44)
    ])),
    sniper_body: part('Stock / receiver / barrel assembly', merge([
        side([[-.296,-.035],[-.296,.06],[-.22,.09],[-.09,.085],[.02,.115],[.3,.105],[.34,.055],[.2,.015],[.04,.015],[-.02,-.07],[-.09,-.075],[-.12,.01],[-.22,-.01]],.066),
        side([[-.24,.02],[-.15,.04],[-.12,-.005],[-.21,-.02]],.07),
        tube(.015,.57,.0964,-.585), tube(.023,.065,.0964,-.8475),
        box(.05,.018,.4,0,.127,-.12), box(.04,.02,.08,0,.02,-.04).rotateX(-.15)
    ])),
    sniper_scope: part('Scope', merge([
        tube(.025,.29,.185,-.02,16), tube(.036,.055,.185,-.155,16), tube(.033,.05,.185,.105,16),
        box(.018,.055,.025,-.02,.13,-.1), box(.018,.055,.025,.02,.13,.06),
        tube(.009,.035,.22,-.015,8)
    ])),
    shotgun_body: part('Stock / receiver / barrel / pump assembly', merge([
        side([[-.2693,-.06],[-.2673,.025],[-.19,.07],[-.08,.09],[.13,.095],[.2,.06],[.18,.015],[-.02,.005],[-.07,-.065],[-.12,-.06],[-.15,.005],[-.22,-.025]],.068),
        tube(.014,.57,.068,-.462), tube(.011,.54,.026,-.45),
        softBox(.07,.07,.17,.01,1).translate(0,.027,-.36),
        ...Array.from({length:7},(_,i)=>box(.074,.055,.008,0,0,-.30-i*.02)),
        tube(.021,.035,.068,-.73)
    ]))
};

function writeGlb(parts) {
    const chunks = [], views = [], accessors = [], meshes = [], nodes = [{ name: 'Gun', children: [] }], materials = [], materialIds = new Map();
    let offset = 0;
    const push = (typed, target) => {
        const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - bytes.length % 4) % 4;
        chunks.push(bytes, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
        offset += bytes.length + pad; return views.length - 1;
    };
    for (const [name, { role, geometry: source }] of Object.entries(parts)) {
        const g = source.index ? source : source.toNonIndexed();
        const pos = new Float32Array(g.attributes.position.array), nor = new Float32Array(g.attributes.normal.array);
        const uv = g.attributes.uv ? new Float32Array(g.attributes.uv.array) : new Float32Array(pos.length / 3 * 2);
        const idx = g.index ? new Uint32Array(g.index.array) : new Uint32Array(pos.length / 3);
        if (!g.index) for (let i = 0; i < idx.length; i++) idx[i] = i;
        const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
        for (let i=0;i<pos.length;i+=3) for(let k=0;k<3;k++){min[k]=Math.min(min[k],pos[i+k]);max[k]=Math.max(max[k],pos[i+k]);}
        const accessor = data => accessors.push(data)-1;
        const pa=accessor({bufferView:push(pos,34962),componentType:5126,count:pos.length/3,type:'VEC3',min,max});
        const na=accessor({bufferView:push(nor,34962),componentType:5126,count:nor.length/3,type:'VEC3'});
        const ua=accessor({bufferView:push(uv,34962),componentType:5126,count:uv.length/2,type:'VEC2'});
        const ia=accessor({bufferView:push(idx,34963),componentType:5125,count:idx.length,type:'SCALAR'});
        if(!materialIds.has(role)){materialIds.set(role,materials.length);materials.push({name:role,pbrMetallicRoughness:{baseColorFactor:[.5,.55,.52,1],metallicFactor:.35,roughnessFactor:.55}});}
        meshes.push({name,primitives:[{attributes:{POSITION:pa,NORMAL:na,TEXCOORD_0:ua},indices:ia,material:materialIds.get(role)}]});
        nodes.push({name,mesh:meshes.length-1,extras:{reference_role:role}});nodes[0].children.push(nodes.length-1);
    }
    const bin=Buffer.concat(chunks),json={asset:{version:'2.0',generator:'voxel-tactics original procedural weapons'},scene:0,scenes:[{nodes:[0]}],nodes,meshes,materials,accessors,bufferViews:views,buffers:[{byteLength:bin.length}]};
    let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,0x20)]);
    const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+bin.length,8);
    const jh=Buffer.alloc(8);jh.writeUInt32LE(text.length,0);jh.writeUInt32LE(0x4e4f534a,4);
    const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
    return Buffer.concat([header,jh,text,bh,bin]);
}

const definitions = {
    rifle: { names:['rifle_receiver','rifle_stock','rifle_grip','rifle_foregrip','rifle_magazine','rifle_barrel','rifle_sight'], stock:[0,-.188,.072], support:[0,.3301,.0765], muzzle:[0,.5167,.104], grip:[0,0,0], referenceLengthMetres:.705 },
    sniper: { names:['sniper_body','sniper_scope'], stock:[0,-.300,.0196], support:[0,.3873,.0482], muzzle:[0,.8801,.0964], grip:[0,0,0], referenceLengthMetres:1.18 },
    shotgun: { names:['shotgun_body'], stock:[0,-.272,-.0254], support:[0,.4436,.0268], muzzle:[0,.748,.068], grip:[0,0,0], referenceLengthMetres:1.02 }
};
const metadata = { units:'metres', axes:'glTF x right, y up, -z muzzle; anchor arrays use x, -z, y', assemblies:{}, parts:{}, source:'tools/art/rebuild_weapons.mjs', shading:'Three.js MeshToonMaterial with three discrete bands' };
let total=0;
for(const [name,p] of Object.entries(parts)){
    p.geometry.computeBoundingBox();const b=p.geometry.boundingBox;
    const triangles=(p.geometry.index?p.geometry.index.count:p.geometry.attributes.position.count)/3;total+=triangles;
    metadata.parts[name]={role:p.role,source:'original procedural mesh',bounds:[[b.min.x,-b.max.z,b.min.y],[b.max.x,-b.min.z,b.max.y]],scale:[1,1,1],triangles};
}
for(const [family,d] of Object.entries(definitions)){
    const bounds=d.names.map(n=>metadata.parts[n].bounds),min=Math.min(...bounds.map(b=>b[0][1])),max=Math.max(...bounds.map(b=>b[1][1]));
    metadata.assemblies[family]={parts:d.names,stock:d.stock,support:d.support,muzzle:d.muzzle,grip:d.grip,source:'original procedural mesh',referenceLengthMetres:d.referenceLengthMetres,measuredLengthMetres:max-min,triangles:d.names.reduce((s,n)=>s+metadata.parts[n].triangles,0)};
}
metadata.optimization={method:'Authored at game resolution; no imported source meshes',triangles:total};
fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(`${OUT}/gun-kit.glb`,writeGlb(parts));fs.writeFileSync(`${OUT}/gun-kit.json`,JSON.stringify(metadata,null,2)+'\n');
console.log(`Original weapon kit: ${Object.keys(parts).length} parts, ${total} triangles`);
