import fs from 'node:fs/promises';

const out='client/public/assets/audio',rate=22050;
let seed=0x93a71c5;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
const clamp=x=>Math.max(-1,Math.min(1,x));
function render(seconds,fn){
    const data=Buffer.alloc(44+Math.ceil(seconds*rate)*2),n=(data.length-44)/2;
    data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(n*2,40);
    let low=0;
    for(let i=0;i<n;i++){
        const t=i/rate,noise=random();low=low*.86+noise*.14;
        data.writeInt16LE(Math.round(clamp(fn(t,noise,low,i/n))*32767),44+i*2);
    }
    return data;
}
const tone=(t,f,d)=>Math.sin(2*Math.PI*f*t)*Math.exp(-t*d);
const click=(t,at=0,f=1400)=>t<at?0:tone(t-at,f,45)*Math.exp(-(t-at)*25);
const thump=(t,f=90,d=14)=>tone(t,f,d);
const noiseHit=(t,d=22)=>random()*Math.exp(-t*d);
const clips={
    rifleShot:[.34,(t,n,l)=>n*Math.exp(-t*35)*.7+thump(t,105,19)*.48+l*Math.exp(-t*10)*.35+click(t,.055)*.12],
    sniperShot:[.7,(t,n,l)=>n*Math.exp(-t*22)*.85+thump(t,72,10)*.65+l*Math.exp(-t*5)*.5+click(t,.12,900)*.15],
    shotgunShot:[.58,(t,n,l)=>n*Math.exp(-t*20)*.82+thump(t,62,11)*.72+l*Math.exp(-t*7)*.45],
    sidearmShot:[.28,(t,n)=>n*Math.exp(-t*44)*.58+thump(t,145,24)*.4+click(t,.035)*.15],
    suppressedShot:[.22,(t,n,l)=>l*Math.exp(-t*25)*.75+n*Math.exp(-t*55)*.24+thump(t,110,28)*.28],
    flameShot:[.7,(t,n,l)=>l*Math.sin(Math.min(1,t*7)*Math.PI/2)*Math.exp(-t*3)*.8+tone(t,85,5)*.12],
    rifleReload:[.72,(t,n)=>click(t,0,1050)*.55+click(t,.2,750)*.65+click(t,.48,1500)*.5+n*Math.exp(-Math.abs(t-.2)*150)*.2],
    sniperReload:[.9,(t,n)=>click(t,0,1500)*.45+click(t,.2,700)*.65+click(t,.56,500)*.7+click(t,.72,1700)*.4+n*.025*Math.exp(-t*4)],
    impactUnit:[.2,(t,n,l)=>l*Math.exp(-t*28)*.8+thump(t,130,25)*.35],
    impactStone:[.3,(t,n,l)=>n*Math.exp(-t*35)*.45+l*Math.exp(-t*15)*.5+click(t,.025,350)*.25],
    impactMetal:[.4,(t,n)=>n*Math.exp(-t*50)*.3+tone(t,820,13)*.3+tone(t,1370,18)*.18],
    impactGlass:[.48,(t,n)=>n*Math.exp(-t*24)*.34+tone(t,2100,15)*.25+tone(t+.013,3100,20)*.2+click(t,.1,1800)*.2],
    impactWood:[.25,(t,n,l)=>l*Math.exp(-t*24)*.65+thump(t,180,28)*.32+n*Math.exp(-t*55)*.2],
    doorOpen:[.58,(t,n,l)=>tone(t,310+Math.sin(t*8)*45,4)*.12+l*Math.exp(-t*5)*.3+click(t,.34,540)*.5],
    doorKick:[.42,(t,n,l)=>thump(t,68,14)*.85+l*Math.exp(-t*18)*.75+n*Math.exp(-t*45)*.3],
    throwWhoosh:[.34,(t,n,l)=>l*Math.sin(Math.PI*t/.34)**2*.55],
    meleeHit:[.32,(t,n,l)=>l*Math.exp(-t*22)*.7+thump(t,105,22)*.45+click(t,.02,1600)*.2],
    heal:[.72,t=>tone(t,520,5)*.2+tone(Math.max(0,t-.14),780,6)*(t>.14?1:0)*.18],
    recover:[.65,t=>tone(t,660,7)*.2+tone(Math.max(0,t-.16),990,7)*(t>.16?1:0)*.22],
    extract:[1,t=>tone(t,440,3.8)*.16+tone(Math.max(0,t-.2),660,4)*(t>.2?1:0)*.16+tone(Math.max(0,t-.4),880,4)*(t>.4?1:0)*.16],
    overwatch:[.38,t=>click(t,0,900)*.35+tone(t,410,12)*.18+click(t,.12,1300)*.2],
    uiSelect:[.1,t=>tone(t,690,35)*.22],
    uiConfirm:[.18,t=>tone(t,540,24)*.18+tone(Math.max(0,t-.055),810,28)*(t>.055?1:0)*.16],
    collapse:[1.15,(t,n,l)=>l*Math.exp(-t*3.5)*.85+n*Math.exp(-t*8)*.3+thump(t,48,5)*.4],
    hydroBurst:[.8,(t,n,l)=>l*Math.exp(-t*5)*.75+n*Math.exp(-t*18)*.2],
    cryoBurst:[.85,(t,n)=>n*Math.exp(-t*24)*.2+tone(t,1450,7)*.22+tone(t+.02,2150,8)*.18],
    anemoBurst:[.62,(t,n,l)=>l*Math.sin(Math.PI*t/.62)**2*.8+tone(t,95,7)*.2],
    contactAlert:[.5,t=>tone(t,330,10)*.2+tone(Math.max(0,t-.16),440,10)*(t>.16?1:0)*.2]
};
await fs.mkdir(out,{recursive:true});
for(const [name,[seconds,fn]] of Object.entries(clips)){
    const data=render(seconds,fn);await fs.writeFile(`${out}/${name}.wav`,data);
    console.log(`${name}.wav ${(data.length/1024).toFixed(1)} KiB`);
}
