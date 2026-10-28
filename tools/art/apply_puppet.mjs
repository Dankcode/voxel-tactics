// Apply the workbench's exported keyforms. Default: the close-up shoulder pose (and its mirrored variant).
// --world: the world pose. With an over-the-shoulder close-up (`poses.aim.sideView`) the two are authored separately;
// older formulas without a side view keep deriving the world pose from the close-up.
import fs from 'node:fs';
import {scalePuppet,validatePuppet} from '../../client/src/anim/SpritePuppetRig.js';
const source='tools/art/sprites/ranger-01/formula.json',manifest='client/public/assets/characters/ranger-01/cutin.json';
const formula=JSON.parse(fs.readFileSync(source)),art=JSON.parse(fs.readFileSync(manifest));
const world=process.argv.includes('--world'),file=process.argv.slice(2).find(a=>!a.startsWith('--'));
const input=JSON.parse(fs.readFileSync(file||source));
const selected=input.poses?.aim;
const puppet=validatePuppet(selected?(world?selected.sideView?.puppet||selected.puppet:selected.puppet):input);
const aim=formula.poses.aim,side=aim.sideView,scaled=()=>scalePuppet(puppet,formula.worldAim.scale,formula.worldAim.offset);
if(!world){aim.puppet=puppet;art.puppet=puppet;art.variants.left.puppet=puppet;}
if(world||!side){if(side)side.puppet=puppet;art.worldAim.puppet=scaled();art.variants.left.worldAim.puppet=art.worldAim.puppet;}
fs.writeFileSync(source,JSON.stringify(formula,null,2)+'\n');fs.writeFileSync(manifest,JSON.stringify(art,null,2)+'\n');
console.log(`Applied authored puppet to the Ranger ${world?'world pose':side?'shoulder pose and its mirror':'aiming variants'}.`);
