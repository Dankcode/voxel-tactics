// Apply the workbench's exported keyforms to close-up, left-facing and world manifests.
import fs from 'node:fs';
import {scalePuppet,validatePuppet} from '../../client/src/anim/SpritePuppetRig.js';
const source='tools/art/sprites/ranger-01/formula.json',manifest='client/public/assets/characters/ranger-01/cutin.json';
const formula=JSON.parse(fs.readFileSync(source)),art=JSON.parse(fs.readFileSync(manifest));
const input=JSON.parse(fs.readFileSync(process.argv[2]||source));
const puppet=validatePuppet(input.poses?.aim?.puppet||input);
formula.poses.aim.puppet=puppet;art.puppet=puppet;
art.worldAim.puppet=scalePuppet(puppet,formula.worldAim.scale,formula.worldAim.offset);
art.variants.left.puppet=puppet;art.variants.left.worldAim.puppet=art.worldAim.puppet;
fs.writeFileSync(source,JSON.stringify(formula,null,2)+'\n');fs.writeFileSync(manifest,JSON.stringify(art,null,2)+'\n');
console.log('Applied authored puppet to all Ranger aiming variants.');
