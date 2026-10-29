// Apply the workbench's exported keyforms. Default: the close-up shoulder pose (and its mirrored variant).
// --world: the world pose. With an over-the-shoulder close-up (`poses.aim.sideView`) the two are authored separately;
// older formulas without a side view keep deriving the world pose from the close-up.
// The result is linted first (tools/art/lint_puppet.mjs); a rig with lint errors is refused unless --force.
import fs from 'node:fs';
import {scalePuppet,validatePuppet} from '../../client/src/anim/SpritePuppetRig.js';
import {lintManifest,formatIssues} from './lint_puppet.mjs';
const source='tools/art/sprites/ranger-01/formula.json',manifest='client/public/assets/characters/ranger-01/cutin.json';
const formula=JSON.parse(fs.readFileSync(source)),art=JSON.parse(fs.readFileSync(manifest));
if(art.staticPose)throw Error('The Ranger backshot is now a static painting. Rebuild with tools/art/build_static_backshot.mjs.');
const world=process.argv.includes('--world'),file=process.argv.slice(2).find(a=>!a.startsWith('--'));
const input=JSON.parse(fs.readFileSync(file||source));
const selected=input.poses?.aim;
const puppet=validatePuppet(selected?(world?selected.sideView?.puppet||selected.puppet:selected.puppet):input);
const aim=formula.poses.aim,side=aim.sideView,scaled=()=>scalePuppet(puppet,formula.worldAim.scale,formula.worldAim.offset);
if(!world){aim.puppet=puppet;art.puppet=puppet;art.variants.left.puppet=puppet;}
if(world||!side){if(side)side.puppet=puppet;art.worldAim.puppet=scaled();art.variants.left.worldAim.puppet=art.worldAim.puppet;}
const kit=JSON.parse(fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.json'));
const report=formatIssues(await lintManifest(art,kit,{pose:world?'world':'close'}));
console.log(report.text);
if(report.errors&&!process.argv.includes('--force')){console.error(`Not applied: ${report.errors} lint error(s). Fix them in the workbench or pass --force.`);process.exit(1);}
fs.writeFileSync(source,JSON.stringify(formula,null,2)+'\n');fs.writeFileSync(manifest,JSON.stringify(art,null,2)+'\n');
console.log(`Applied authored puppet to the Ranger ${world?'world pose':side?'shoulder pose and its mirror':'aiming variants'}.`);
