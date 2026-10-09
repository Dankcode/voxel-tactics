#!/usr/bin/env node
import { resolve } from 'node:path';
import { runPipeline } from './Pipeline.mjs';
import { installPackage, jsonRead } from './PackageIO.mjs';
import { CEDAR_IMAGE_SITE } from '../../shared/mission/generated/CedarImage.js';
const args=process.argv.slice(2),get=(k,fallback)=>{if(!args.includes(k))return fallback;const v=args[args.indexOf(k)+1];if(!v||v.startsWith('--'))throw Error(`Missing value for ${k}`);return v;};
if(!args.includes('--image'))throw Error('Usage: npm run mapgen -- --image reference.png --id map-id [--site site.json|cedar --offline] [--out cache-directory] [--redo site|design|concepts|floorspec|building/floor-3] [--install]');
if(!args.includes('--site')&&!args.includes('--id'))throw Error('Fresh authoring requires --id to name its package folder');
const raw=get('--site')==='cedar'?CEDAR_IMAGE_SITE:get('--site')?await jsonRead(resolve(get('--site'))):null;
const recorded=raw?.site||raw;
if(args.includes('--offline')&&!recorded)throw Error('--offline requires --site; an unanalysed screenshot needs a vision provider');
const result=await runPipeline({image:resolve(get('--image')),id:get('--id',recorded?.id),site:recorded,out:resolve(get('--out','/tmp/mapgen')),seed:Number(get('--seed',1)),offline:args.includes('--offline'),redo:get('--redo',''),onStage:stage=>console.log(`mapgen: ${stage}`)});
if(args.includes('--install')) {
    if(['cedar-close','main-street','harbor-yard','route-9','proving-grounds'].includes(result.manifest.id))throw Error('Use a unique map id; hand-built maps retain their identities');
    const root=resolve(new URL('../../client/public/maps/',import.meta.url).pathname);
    console.log(`Installed ${await installPackage(result.directory,root,result.manifest.id)}`);
}
console.log(`Validated ${result.manifest.id}: ${result.layout.width}×${result.layout.depth}, storeys ${result.layout.buildings.map(b=>b.storeys).join('/')}, ${result.manifest.validation.length} seeds. Package: ${result.directory}`);
