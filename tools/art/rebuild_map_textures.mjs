import fs from 'node:fs/promises';
import sharp from 'sharp';

const out='client/public/assets/textures/pbr',size=512,total=size*size;
const fract=x=>x-Math.floor(x);
const hash=(x,y,seed=0)=>fract(Math.sin(x*127.1+y*311.7+seed*74.7)*43758.5453);
const smooth=t=>t*t*(3-2*t);
function noise(x,y,seed=0){
    const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(fract(x)),fy=smooth(fract(y));
    return (hash(ix,iy,seed)*(1-fx)+hash(ix+1,iy,seed)*fx)*(1-fy)+(hash(ix,iy+1,seed)*(1-fx)+hash(ix+1,iy+1,seed)*fx)*fy;
}
function surface(name){
    const height=new Float32Array(total),rgb=Buffer.alloc(total*3);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const i=y*size+x,grain=noise(x/3,y/3,3),macro=noise(x/95,y/95,7);
        let h=.5,c=[150,150,150];
        if(name==='brick'){
            const row=Math.floor(y/64),shift=(row&1)*64,bx=x+shift,col=Math.floor(bx/128),u=bx%128,v=y%64;
            const mortar=u<5||v<5,tone=hash(col,row,11),weather=noise(x/45,y/45,13);
            c=mortar?[116,109,99]:[126+tone*45+weather*16,67+tone*25+weather*12,51+tone*20+weather*10];
            h=mortar?.16:.57+grain*.13;
        }else if(name==='siding'){
            const v=y%64,seam=v<4,grain=noise(x/65,y/5,17),tone=hash(0,Math.floor(y/64),19);
            c=[126+grain*24+tone*8,139+grain*22+tone*8,143+grain*21+tone*8];
            h=seam?.12:.45+grain*.1+(v<10?(10-v)*.012:0);
        }else if(name==='metal'){
            const brushed=noise(x/90,y/2,23),scratch=hash(Math.floor(x/2),Math.floor(y/40),29)>.985?18:0;
            c=[125+brushed*32+macro*12+scratch,132+brushed*31+macro*12+scratch,135+brushed*30+macro*12+scratch];
            h=.45+brushed*.12-scratch*.002;
        }else if(name==='crate'){
            const plank=Math.floor(x/102),u=x%102,v=y%512,wood=noise(x/5,y/75,31),seam=u<5;
            c=seam?[63,43,27]:[127+wood*48+hash(plank,0,37)*14,86+wood*34,49+wood*23];
            const nail=(u-51)**2+((y%128)-18)**2<16;c=nail?[55,56,52]:c;
            h=seam?.16:.46+wood*.17-(nail?.2:0);
        }else if(name==='roof'||name==='roof_metal'){
            const tileW=name==='roof'?128:96,tileH=name==='roof'?64:256,col=Math.floor(x/tileW),u=x%tileW,v=y%tileH;
            const seam=u<4||v<3,tone=hash(col,Math.floor(y/tileH),41),weather=noise(x/50,y/50,43);
            c=name==='roof'?[91+tone*30+weather*13,96+tone*27+weather*13,96+tone*25+weather*13]:[104+tone*24+weather*15,119+tone*22+weather*15,124+tone*22+weather*15];
            h=seam?.18:.48+grain*.08;
        }else if(name==='container'){
            const wave=Math.sin(x/512*Math.PI*32),rust=smooth(noise(x/48,y/48,47));
            c=[105+wave*17+rust*24,119+wave*16+rust*8,119+wave*15-rust*7];
            h=.45+wave*.18-rust*.04;
        }
        const variation=.9+grain*.16;
        for(let k=0;k<3;k++)rgb[i*3+k]=Math.max(0,Math.min(255,Math.round(c[k]*variation)));
        height[i]=h;
    }
    const normals=Buffer.alloc(total*3);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const i=y*size+x,at=(xx,yy)=>height[((yy+size)%size)*size+(xx+size)%size];
        const dx=(at(x+1,y)-at(x-1,y))*2.2,dy=(at(x,y+1)-at(x,y-1))*2.2,len=Math.hypot(dx,dy,1);
        normals[i*3]=Math.round((-dx/len*.5+.5)*255);normals[i*3+1]=Math.round((dy/len*.5+.5)*255);normals[i*3+2]=Math.round((1/len*.5+.5)*255);
    }
    return {rgb,normals};
}
await fs.mkdir(out,{recursive:true});
for(const name of ['brick','siding','metal','crate','roof','roof_metal','container']){
    const {rgb,normals}=surface(name);
    await Promise.all([
        sharp(rgb,{raw:{width:size,height:size,channels:3}}).jpeg({quality:91,chromaSubsampling:'4:4:4'}).toFile(`${out}/${name}.jpg`),
        sharp(normals,{raw:{width:size,height:size,channels:3}}).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toFile(`${out}/${name}_n.jpg`)
    ]);
    console.log(`Rebuilt ${name} albedo + normal`);
}
const manifest=JSON.parse(await fs.readFile(`${out}/manifest.json`,'utf8'));
manifest.rebuilt={source:'tools/art/rebuild_map_textures.mjs',textures:['brick','siding','metal','crate','roof','roof_metal','container']};
await fs.writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
