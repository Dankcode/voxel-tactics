import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {lintCorners,lintGeometry,lintPixels,samplePuppet} from '../../anim/PuppetLint.js';
import {lintManifest,formatIssues} from '../../../../tools/art/lint_puppet.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const art=read('../../../../tools/art/archive/ranger-puppet/cutin.json');
const kit=read('../../../public/assets/weapons/ranger-preview/gun-kit.json');
const rules=(issues,severity='error')=>new Set(issues.filter(i=>i.severity===severity).map(i=>i.rule));
const sample=(a=art,family='rifle',input={})=>({...samplePuppet(a,kit,family,input),name:'neutral'});
const clone=s=>{if(!s.camera)return structuredClone(s);const {camera,matrix,...data}=s;return {...structuredClone(data),camera:camera.clone(),matrix:matrix.clone()};};

test('corner sampler covers neutral, every parameter extreme and the yaw/pitch diagonals',()=>{
 const c=lintCorners(art.puppet.range);assert.equal(c.length,10);assert.deepEqual(c[0].input,{});
 assert.ok(c.some(x=>x.input.yaw===-art.puppet.range.yaw&&x.input.pitch===art.puppet.range.pitch));
});
test('contact, flip and trigger-elbow side rules fire on broken samples',()=>{
 const n=sample(),bad=clone(n);
 bad.pose.joints.trigger.palm.x+=3;assert.ok(rules(lintGeometry(art,'rifle',bad,n)).has('contact'));
 const j=n.pose.joints.trigger,flip=clone(n),fj=flip.pose.joints.trigger;
 // Reflect the elbow across the shoulder→wrist line.
 const dx=j.wrist.x-j.shoulder.x,dy=j.wrist.y-j.shoulder.y,t=((j.elbow.x-j.shoulder.x)*dx+(j.elbow.y-j.shoulder.y)*dy)/(dx*dx+dy*dy);
 const fx=j.shoulder.x+dx*t,fy=j.shoulder.y+dy*t;fj.elbow={x:2*fx-j.elbow.x,y:2*fy-j.elbow.y};
 const r=rules(lintGeometry(art,'rifle',flip,n));assert.ok(r.has('elbow-flip'));
 assert.notEqual(rules(lintGeometry(art,'rifle',n,n)).has('elbow-side'),rules(lintGeometry(art,'rifle',flip,flip)).has('elbow-side'));
});
test('stretch rule respects art swaps, and the support arm must be clipped or behind the torso',()=>{
 const plain={...art,puppet:{...art.puppet,layers:{}}},n=sample(plain),s=clone(n);s.pose.deformers['trigger-forearm'].foreshorten=.6;
 assert.ok(rules(lintGeometry(plain,'rifle',s,n)).has('stretch'));
 const swapped={...art,puppet:{...art.puppet,version:2,layers:{'trigger-forearm':{swaps:[{image:'x.png',foreshorten:[0,.75],blend:.1}]},'support-upper':{clip:{by:['body'],mode:'outside'}}}}};
 const r=rules(lintGeometry(swapped,'rifle',s,n));assert.ok(!r.has('stretch'));assert.ok(!r.has('shoulder-anchor'));
 assert.ok(rules(lintGeometry(plain,'rifle',n,n)).has('shoulder-anchor'));
});
test('overlapping sleeves at the same depth are reported as z-fighting',()=>{
 const p=clone(art.puppet);p.version=2;for(const f of Object.values(p.keyforms))for(const k of Object.values(f))k.depth={shoulder:.7,elbow:.7};
 const a={...art,puppet:p},n=sample(a),s=clone(n),d=s.pose.deformers;
 d['support-forearm']={...d['support-forearm'],start:d['trigger-forearm'].start,end:d['trigger-forearm'].end,depthStart:d['trigger-forearm'].depthStart,depthEnd:d['trigger-forearm'].depthEnd};
 assert.ok(lintGeometry(a,'rifle',s,n).some(i=>i.rule==='depth-order'&&i.severity==='error'));
});
test('pixel rules catch a shoulder anchor outside the torso painting',()=>{
 const W=art.width,H=art.height,empty={width:W,height:H,data:new Uint8Array(W*H)},full={width:W,height:H,data:new Uint8Array(W*H).fill(255)};
 const alpha=Object.fromEntries(art.layers.filter(l=>l.image).map(l=>[l.id,full]));alpha.body=empty;
 const n=sample();assert.ok(lintPixels(art,kit,'rifle',[n],{alpha}).some(i=>i.rule==='shoulder-anchor'));
});
test('retired puppet fixture retains the diagnostic that motivated its replacement',async()=>{
 const result=await lintManifest(art,kit,{base:'tools/art/archive/ranger-puppet/'});
 assert.ok(result.world.some(i=>i.rule==='elbow-bend'&&i.severity==='error'));
});
