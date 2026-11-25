// Context beyond the playable grid: low-contrast contemporary blocks, verges and street lights.
// Visual only; nothing here participates in cover, navigation or the voxel matrix.
import * as THREE from 'three';
import { createRng, hashString } from '../../../shared/util/Rng.js';
const BACKDROP_PALETTE = {
    harbor: { ground: 0x244a5e, block: 0x526470, roof: 0x2f3b44, window: 0x9fc2d0, road: 0x454d52 },
    winter_outpost: { ground: 0xc8d9e6, block: 0x5a6b78, roof: 0xdce8f2, window: 0xffe29a, road: 0x49535c },
    old_quarter: { ground: 0x6f675b, block: 0x8a7560, roof: 0x984e3c, window: 0xead4a6, road: 0x7b746a },
    metro_hub: { ground: 0x3b444b, block: 0x4c5864, roof: 0x2f3840, window: 0x9cd2ea, road: 0x343c42 },
    arid_compound: { ground: 0xb99864, block: 0x998061, roof: 0x786248, window: 0x3c342b, road: 0x917a56 },
    suburb: { ground: 0x4e6746, block: 0x746b63, roof: 0x7e4234, window: 0xeadfb8, road: 0x3f474c },
    canal_district: { ground: 0x375563, block: 0x6f7572, roof: 0x4c3f39, window: 0xd9c79b, road: 0x575b5c },
    hillside_ridge: { ground: 0x566b43, block: 0x756c5d, roof: 0x4d5444, window: 0xe6d6a8, road: 0x615d52 },
    sunken_basin: { ground: 0x3c4850, block: 0x5e6469, roof: 0x323940, window: 0x9cd0e6, road: 0x474f55 }
};

export function missionBackdrop(w,d,id,backdrop=null) {
    const group=new THREE.Group(),rng=createRng(hashString(id)), materials=new Map();
    const fam = backdrop?.family || ({
        Waterfront: 'harbor', Alpine: 'winter_outpost', Historic: 'old_quarter', Transit: 'metro_hub',
        Desert: 'arid_compound', Suburbs: 'suburb', Canal: 'canal_district', Highland: 'hillside_ridge', Basin: 'sunken_basin'
    }[backdrop?.theme]) || null;
    const pal = BACKDROP_PALETTE[fam] || { ground: 0x414b49, block: 0x657076, roof: 0x38424a, window: 0x8c9798, road: 0x3b4449 };
    const material=(key,color)=>{if(!materials.has(key)) materials.set(key,new THREE.MeshStandardMaterial({color,roughness:1}));return materials.get(key);};
    const box=(x,z,width,depth,height,key,color,y=1)=>{
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material(key,color));
        mesh.position.set(x,y+height/2,z); group.add(mesh); return mesh;
    };
    // Edge apron meets a continuous biome horizon ground.
    box(w/2,d/2,w+150,d+150,0.2,'ground',pal.ground,0.6);
    const scaleH = fam === 'metro_hub' ? 1.55 : fam === 'winter_outpost' || fam === 'arid_compound' ? 0.85 : 1;
    for(let i=-2;i<=Math.ceil(w/11)+2;i++) for(const side of [-1,1]) {
        const x=i*11+5, z=side<0 ? -17 : d+17;
        const h=(3+rng.next()*6)*scaleH;
        box(x,z,7+rng.next()*2,8,h,'facade',pal.block);
        box(x,z,9,10,0.3,'roof',pal.roof,1+h);
        for(let floor=0;floor<h-1;floor+=2.5) for(let j=-2;j<=2;j+=2) box(x+j,z+(side<0?4.05:-4.05),1.2,0.04,1,'window',pal.window,2+floor);
    }
    for(let i=0;i<Math.ceil(d/12);i++) for(const side of [-1,1]) {
        const x=side<0?-18:w+18,z=i*12+5,h=(4+rng.next()*4)*scaleH;
        box(x,z,8,9,h,'facade',pal.block); box(x,z,9,10,0.3,'roof',pal.roof,1+h);
    }
    // PLAN-04 world edges: every road that leaves a generated map keeps going past its barricade.
    for(const exit of backdrop?.roadExits||[]) {
        const [x0,y0]=exit.from,[x1,y1]=exit.to,len=40;
        const across=exit.side==='n'||exit.side==='s'?Math.abs(x1-x0)+1:Math.abs(y1-y0)+1;
        const cx=(Math.min(x0,x1)+Math.max(x0,x1)+1)/2,cy=(Math.min(y0,y1)+Math.max(y0,y1)+1)/2;
        const [ox,oz,bw,bd]=exit.side==='n'?[cx,-len/2,across,len]:exit.side==='s'?[cx,d+len/2,across,len]:exit.side==='w'?[-len/2,cy,len,across]:[w+len/2,cy,len,across];
        box(ox,oz,bw,bd,0.06,'asphalt',pal.road,0.72);
        for(let i=2;i<len;i+=5){const along=exit.side==='n'||exit.side==='s';box(along?cx:(exit.side==='w'?-i:w+i),along?(exit.side==='n'?-i:d+i):cy,along?0.25:2,along?2:0.25,0.02,'mark',0xd9d6c4,0.79);}
    }
    group.userData.noAO=true;
    group.userData.dispose=()=>{group.traverse(o=>o.geometry?.dispose()); for(const m of materials.values())m.dispose();};
    return group;
}
