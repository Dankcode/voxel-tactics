// Editable SVG master + PNG contact sheet + browser catalogue, all from the actual game layers.
import fs from 'node:fs/promises';
import sharp from 'sharp';
const root='client/public/assets/characters/ranger-01/';
const art=JSON.parse(await fs.readFile(root+'cutin.json'));
const out='client/public/art-review';await fs.mkdir(out,{recursive:true});
const parts=[];
for(const [pose,spec] of [['aim',art],['world-aim',art.worldAim]]){
 for(const l of spec.layers.filter(l=>l.image))for(const [family,v] of [['rifle',l],...Object.entries(l.variants||{})]){
  const id=`${pose}/${l.id}/${family}`,filename=v.image;
  const input=await sharp(root+filename).trim({threshold:1}).png().toBuffer();
  const thumb=await sharp(input).resize(230,230,{fit:'inside'}).png().toBuffer();
  const meta=await sharp(thumb).metadata();
  parts.push({id,label:`${l.anatomicalSide||'Body'} · ${l.id} · ${family}`,pose,family,bone:l.bone||null,layer:l.zIndex,image:`/assets/characters/ranger-01/${filename}`,normal:`/assets/characters/ranger-01/${v.normal}`,lighting:`/assets/characters/ranger-01/${v.lightingMask}`,thumb:`data:image/png;base64,${thumb.toString('base64')}`,width:meta.width,height:meta.height});
 }
}
const cols=5,cw=290,ch=300,header=100;
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${cols*cw}" height="${Math.ceil(parts.length/cols)*ch+header}"><rect width="100%" height="100%" fill="#151d22"/><g font-family="Arial" fill="#e9eee8"><text x="24" y="40" font-size="28">RANGER / AIMING PARTS</text><text x="24" y="72" font-size="15">Editable image objects and labels · R = trigger arm · L = support arm · 768 px registration canvas</text></g>${parts.map((p,i)=>{const x=i%cols*cw,y=header+Math.floor(i/cols)*ch;return `<g id="${esc(p.id)}"><rect x="${x+8}" y="${y+8}" width="274" height="284" rx="8" fill="#28343b"/><image x="${x+(cw-p.width)/2}" y="${y+14+(230-p.height)/2}" width="${p.width}" height="${p.height}" xlink:href="${p.thumb}"/><text x="${x+16}" y="${y+263}" fill="#eff1e9" font-family="Arial" font-size="12">${String(i+1).padStart(2,'0')}  ${esc(p.label)}</text><text x="${x+16}" y="${y+281}" fill="#9cb2bd" font-family="Arial" font-size="11">${p.pose} · layer ${p.layer}</text></g>`;}).join('')}</svg>`;
await fs.writeFile(out+'/aim-parts.svg',svg);
await sharp(Buffer.from(svg)).png().toFile(out+'/aim-parts.png');
await fs.writeFile(out+'/parts.json',JSON.stringify({version:1,parts},null,2));
console.log(`Wrote ${parts.length} editable parts to ${out}`);
