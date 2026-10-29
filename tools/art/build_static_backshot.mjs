// Package the newly painted reference pose; no legacy body/limb pixels are read or composited.
import fs from 'node:fs/promises';
import sharp from 'sharp';
const dir='tools/art/sprites/ranger-01/',out='client/public/assets/characters/ranger-01/';
const config=JSON.parse(await fs.readFile(dir+'static-backshot.json'));
const input=dir+'source/'+config.source,meta=await sharp(input).metadata();
await sharp(input).png().toFile(out+'backshot-static.png');
for(const [name,colour]of [['normal',{r:128,g:128,b:255,alpha:1}],['lighting',{r:0,g:255,b:0,alpha:1}]])await sharp({create:{width:1,height:1,channels:4,background:colour}}).png().toFile(out+`backshot-static-${name}.png`);
const art={version:4,character:'ranger-01',staticPose:true,width:meta.width,height:meta.height,screenHeight:.98,placeholder:false,gun:true,muzzle:config.muzzle,cropEdges:['left','bottom'],rig:config.rig,layers:[{id:'gun',gun:true,zIndex:10},{id:'soldier',image:'backshot-static.png',normal:'backshot-static-normal.png',lightingMask:'backshot-static-lighting.png',zIndex:20,stage:'front',order:1}],source:'New painting from user-supplied static-backshot-pose-reference.png',technique:'static-painting-separate-gun'};
await fs.writeFile(out+'cutin.json',JSON.stringify(art,null,2)+'\n');
await fs.copyFile(dir+'source/static-backshot-pose-reference.png','client/public/art-review/static-backshot-pose-reference.png');
console.log(`Static backshot: ${meta.width} x ${meta.height}, one body image, no puppet.`);
