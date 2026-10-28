// Pack reviewed source rectangles; retain editable source sheets outside the game bundle.
import fs from 'node:fs/promises';
import sharp from 'sharp';
const root='tools/art/sprites/syndicate',config=JSON.parse(await fs.readFile(root+'/layout.json'));
const FW=256,FH=320,poses=['idle','runA','runB','aim','down'];
const catalogue=[];
const rgba={r:0,g:0,b:0,alpha:0};
async function crop(path,rect){const buf=await sharp(path).extract(rect).png().toBuffer();return sharp(buf).trim({threshold:1}).png().toBuffer();}
for(const [id,role]of Object.entries(config.roles)){
 const source=root+'/source/'+role.source,meta=await sharp(source).metadata(),cells=[],records=[];
 for(let facing=0;facing<8;facing++)for(const pose of poses){
  const stride=pose==='runB'&&role.strideRow!=null,path=stride?root+'/source/opposite-stride.png':source;
  const m=stride?await sharp(path).metadata():meta;
  const row=stride?role.strideRow:role.rows[pose];
  const cuts=stride?config.strideCuts:role.cuts;
  if(!cuts)throw Error('Missing reviewed stride row boundaries');
  const left=Math.round(facing*m.width/8),right=Math.round((facing+1)*m.width/8);
  const rect={left,top:cuts[row],width:right-left,height:cuts[row+1]-cuts[row]};
  const input=await crop(path,rect),size=await sharp(input).metadata();
  cells.push({facing,pose,input,size});records.push({facing:config.facings[facing],pose,source:path,rect});
 }
 const standing=cells.filter(c=>c.pose==='idle').map(c=>c.size.height).sort((a,b)=>a-b),scale=290/standing[4];
 const layers=[];
 for(const c of cells){
  const k=Math.min(scale,(FW-8)/c.size.width,(FH-12)/c.size.height),w=Math.round(c.size.width*k),h=Math.round(c.size.height*k);
  c.packed=await sharp(c.input).resize(w,h).png().toBuffer();
  layers.push({input:c.packed,left:poses.indexOf(c.pose)*FW+Math.round((FW-w)/2),top:c.facing*FH+FH-10-h});
 }
 const out=`client/public/assets/characters/${role.art}`;await fs.mkdir(out,{recursive:true});
 const atlas=await sharp({create:{width:FW*5,height:FH*8,channels:4,background:rgba}}).composite(layers).png().toBuffer();await fs.writeFile(out+'/field.png',atlas);
 const {data,info}=await sharp(atlas).raw().toBuffer({resolveWithObject:true}),normal=Buffer.alloc(data.length),light=Buffer.alloc(data.length);
 for(let i=0;i<data.length;i+=4){normal[i]=128;normal[i+1]=128;normal[i+2]=255;normal[i+3]=data[i+3];light[i+1]=255;light[i+3]=data[i+3];}
 for(const [name,pixels]of [['field-normal',normal],['field-lighting',light]])await sharp(pixels,{raw:info}).png().toFile(`${out}/${name}.png`);
 const clips={idle:{column:0,frames:1,fps:1,loop:true},run:{column:1,frames:2,fps:6,loop:true},aim:{column:3,frames:1,fps:1,loop:true},fire:{column:3,frames:1,fps:8,loop:false},down:{column:4,frames:1,fps:1,loop:false}};
 // Secondary actions use explicit held artwork until dedicated animation drawings are authored.
 for(const name of ['throw','hit','stacked','hunker','vault','climb'])clips[name]={column:name==='hit'?3:0,frames:1,fps:5,loop:['stacked','hunker','climb'].includes(name)};
 const field={version:1,character:role.art,placeholder:false,image:'field.png',normal:'field-normal.png',lightingMask:'field-lighting.png',frameWidth:FW,frameHeight:FH,columns:5,rows:8,facings:config.facings,anchor:[.5,10/FH],worldHeight:2.4,clips,notes:'Eight directions; illustrated idle, two run poses, aim and settled down. Secondary actions use held poses; no invented animation frames.'};
 await fs.writeFile(out+'/field.json',JSON.stringify(field,null,2));
 const front=cells.find(c=>c.facing===0&&c.pose==='idle'),frontM=front.size;
 const face=await sharp(front.input).extract({left:Math.round(frontM.width*.15),top:0,width:Math.round(frontM.width*.7),height:Math.min(frontM.height,Math.round(frontM.height*.34))}).resize(256,256,{fit:'contain',background:rgba}).png().toBuffer();await fs.writeFile(out+'/portrait.png',face);
 const back=cells.find(c=>c.facing===5&&c.pose==='aim');
 const cut=await sharp(back.input).extract({left:0,top:0,width:back.size.width,height:Math.round(back.size.height*.66)}).resize(512,640,{fit:'contain',position:'south',background:rgba}).png().toBuffer();await fs.writeFile(out+'/cutin.png',cut);
 const cutin={version:1,character:role.art,placeholder:false,width:512,height:640,screenHeight:.62,muzzle:[.92,.48],gun:false,bakedWeapon:true,layers:[{id:'body',image:'cutin.png',stage:'front',zIndex:20}],variants:{left:{mirror:true,muzzle:[.08,.48]}}};await fs.writeFile(out+'/cutin.json',JSON.stringify(cutin,null,2));
 await fs.writeFile(out+'/sprite-list.json',JSON.stringify({scale,frames:records},null,2));
 const review=await sharp(front.input).resize(200,280,{fit:'contain',background:rgba}).png().toBuffer();
 catalogue.push({id,name:role.name,art:role.art,base:`/assets/characters/${role.art}/`,field,thumbnail:`data:image/png;base64,${review.toString('base64')}`});
 console.log(id,records.length,'frames');
}
await fs.writeFile('client/public/art-review/enemies.json',JSON.stringify(catalogue,null,2));
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="410"><rect width="1440" height="410" fill="#172128"/><text x="24" y="38" font-family="Arial" font-size="24" fill="#edf1e8">SYNDICATE / ENEMY REDESIGN</text>${catalogue.map((r,i)=>`<g id="${r.id}"><rect x="${i*240+8}" y="64" width="224" height="330" rx="10" fill="#293942"/><image href="${r.thumbnail}" x="${i*240+20}" y="76" width="200" height="280"/><text x="${i*240+20}" y="382" font-family="Arial" font-size="18" fill="#edf1e8">${r.name}</text></g>`).join('')}</svg>`;
await fs.writeFile('client/public/art-review/enemy-lineup.svg',svg);await sharp(Buffer.from(svg)).png().toFile('client/public/art-review/enemy-lineup.png');
