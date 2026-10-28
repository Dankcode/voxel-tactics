import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {ENEMY_ART,characterArtId} from '../../units/CharacterArt.js';
import {portraitSrc} from '../../ui/Portraits.js';
import {ENEMIES,CLASSES} from '../../../../shared/content/units.js';
const root=new URL('../../../public/assets/characters/',import.meta.url);
const json=p=>JSON.parse(readFileSync(new URL(p,root)));

test('enemy roles resolve to six distinct packs and matching portraits; player identity stays ranger',()=>{
 const roles=['cultist','archer','pyromancer','brute','warden_foe','tech'];
 const ids=roles.map(role=>characterArtId(ENEMIES[role].art));assert.equal(new Set(ids).size,6);
 for(const role of roles){const unit=ENEMIES[role];assert.equal(portraitSrc(unit),`/assets/characters/${characterArtId(unit.art)}/portrait.png`)}
 for(const unit of Object.values(CLASSES))assert.equal(characterArtId(unit.art),'ranger-01');
});

test('all enemy directions and poses contain alpha, two distinct run drawings and safe atlas margins',async()=>{
 for(const id of Object.values(ENEMY_ART)){
  const m=json(id+'/field.json'),list=json(id+'/sprite-list.json');assert.equal(list.frames.length,40);
  const {data,info}=await sharp(new URL(id+'/field.png',root).pathname).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,m.columns*m.frameWidth);assert.equal(info.height,m.rows*m.frameHeight);
  for(let row=0;row<8;row++){
   const signatures=[];
   for(let col=0;col<5;col++){
    let opaque=0,minX=256,maxX=0,minY=320,maxY=0,sum=0;
    for(let y=0;y<320;y++)for(let x=0;x<256;x++){const i=((row*320+y)*info.width+col*256+x)*4;if(data[i+3]>128){opaque++;sum+=data[i]+3*data[i+1]+7*data[i+2];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}}
    assert.ok(opaque>1000,`${id}/${row}/${col} has artwork`);assert.ok(minX>=3&&maxX<=252&&minY>=1&&maxY<312,`${id}/${row}/${col} transparent gutters`);signatures.push([sum,opaque]);
   }
   assert.notDeepEqual(signatures[1],signatures[2],`${id}/${row} running drawings differ`);
  }
  for(const c of Object.values(m.clips))assert.ok(c.column+c.frames<=m.columns);
  for(const file of [m.normal,m.lightingMask,'portrait.png','cutin.png'])readFileSync(new URL(id+'/'+file,root));
  const cutin=json(id+'/cutin.json');assert.equal(cutin.bakedWeapon,true);assert.equal(cutin.gun,false);
 }
});
