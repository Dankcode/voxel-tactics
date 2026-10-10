// Context beyond the playable grid: low-contrast contemporary blocks, verges and street lights.
// Visual only; nothing here participates in cover, navigation or the voxel matrix.
import * as THREE from 'three';
import { createRng, hashString } from '../../../shared/util/Rng.js';
export function missionBackdrop(w,d,id,backdrop=null) {
    const group=new THREE.Group(),rng=createRng(hashString(id)), materials=new Map();
    const material=(key,color)=>{if(!materials.has(key)) materials.set(key,new THREE.MeshStandardMaterial({color,roughness:1}));return materials.get(key);};
    const box=(x,z,width,depth,height,key,color,y=1)=>{
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material(key,color));
        mesh.position.set(x,y+height/2,z); group.add(mesh); return mesh;
    };
    // Edge apron meets a broad continuous city ground, giving the low action camera an actual horizon.
    box(w/2,d/2,w+150,d+150,0.2,'ground',0x414b49,0.6);
    for(let i=-2;i<=Math.ceil(w/11)+2;i++) for(const side of [-1,1]) {
        const x=i*11+5, z=side<0 ? -17 : d+17;
        const h=3+rng.next()*6;
        box(x,z,7+rng.next()*2,8,h,'facade',0x657076);
        box(x,z,9,10,0.3,'roof',0x38424a,1+h);
        for(let floor=0;floor<h-1;floor+=2.5) for(let j=-2;j<=2;j+=2) box(x+j,z+(side<0?4.05:-4.05),1.2,0.04,1,'window',0x8c9798,2+floor);
    }
    for(let i=0;i<Math.ceil(d/12);i++) for(const side of [-1,1]) {
        const x=side<0?-18:w+18,z=i*12+5,h=4+rng.next()*4;
        box(x,z,8,9,h,'facade',0x657076); box(x,z,9,10,0.3,'roof',0x38424a,1+h);
    }
    // PLAN-04 world edges: every road that leaves a generated map keeps going past its barricade, so the plot reads
    // as part of a larger city (the facades above continue the district).
    for(const exit of backdrop?.roadExits||[]) {
        const [x0,y0]=exit.from,[x1,y1]=exit.to,len=40;
        const across=exit.side==='n'||exit.side==='s'?Math.abs(x1-x0)+1:Math.abs(y1-y0)+1;
        const cx=(Math.min(x0,x1)+Math.max(x0,x1)+1)/2,cy=(Math.min(y0,y1)+Math.max(y0,y1)+1)/2;
        const [ox,oz,bw,bd]=exit.side==='n'?[cx,-len/2,across,len]:exit.side==='s'?[cx,d+len/2,across,len]:exit.side==='w'?[-len/2,cy,len,across]:[w+len/2,cy,len,across];
        box(ox,oz,bw,bd,0.06,'asphalt',0x3b4449,0.72);
        for(let i=2;i<len;i+=5){const along=exit.side==='n'||exit.side==='s';box(along?cx:(exit.side==='w'?-i:w+i),along?(exit.side==='n'?-i:d+i):cy,along?0.25:2,along?2:0.25,0.02,'mark',0xd9d6c4,0.79);}
    }
    group.userData.noAO=true;
    group.userData.dispose=()=>{group.traverse(o=>o.geometry?.dispose()); for(const m of materials.values())m.dispose();};
    return group;
}
