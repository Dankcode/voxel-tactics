import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { validateSchema, validateFloorSpec } from '../../shared/mapgen/Contracts.js';
import { validateSite, buildPackagedMap } from '../../shared/mapgen/PackageBuilder.js';
import { solveSite } from '../../shared/mapgen/SiteSolver.js';
import { designLevel } from '../../shared/mapgen/LevelDesigner.js';
import { solveLayout } from '../../shared/mapgen/LayoutSolver.js';
import { slateSvg } from '../../shared/mapgen/DesignSlate.js';
import { readSite, readFloor } from './providers/vision.mjs';
import { readDesign } from './providers/text.mjs';
import { createConcept } from './providers/image.mjs';
import { DEFAULT_VISION_MODEL, DEFAULT_IMAGE_MODEL } from './providers/openai.mjs';
import { jsonRead, jsonWrite, digest } from './PackageIO.mjs';
import { schematicFloor } from './Schematic.mjs';
const schema=async name=>jsonRead(new URL(`schemas/${name}.json`,import.meta.url));
const prompt=async name=>readFile(new URL(`prompts/${name}.md`,import.meta.url),'utf8');
const exists=async path=>{try{await readFile(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const mime=path=>({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[extname(path).toLowerCase()];
export async function runPipeline({image,id,site:recorded=null,out='/tmp/mapgen',seed=1,offline=false,redo='',providers={},buildBudgetMs=1500,onStage=()=>{}}) {
    if(!Number.isSafeInteger(seed))throw Error('Seed must be an integer');
    if(id&&!/^[a-z0-9-]+$/.test(id))throw Error('Use a lowercase hyphenated map id');
    const bytes=await readFile(image),sourceHash=digest(bytes);
    if(!mime(image))throw Error('Use PNG, JPEG or WebP');
    const original=`data:${mime(image)};base64,${bytes.toString('base64')}`;
    const directory=resolve(out,id||recorded?.id||'reference-map');
    await mkdir(resolve(directory,'concept'),{recursive:true});await mkdir(resolve(directory,'floorspec'),{recursive:true});
    // Failed authoring attempts keep their stages but cannot masquerade as installable packages.
    await rm(resolve(directory,'manifest.json'),{force:true});
    let cache=await exists(resolve(directory,'cache.json'))?await jsonRead(resolve(directory,'cache.json')):{};
    const stage=async(name,inputs,make,force=false)=>{
        const signature=digest(Buffer.from(JSON.stringify(inputs))),path=resolve(directory,`${name}.json`);
        if(!force&&cache[name]===signature&&await exists(path))return jsonRead(path);
        onStage(name);const value=await make();await jsonWrite(path,value);cache[name]=signature;await jsonWrite(resolve(directory,'cache.json'),cache);return value;
    };
    const visionModel=process.env.MAPGEN_VISION_MODEL||process.env.MAPGEN_MODEL||DEFAULT_VISION_MODEL,textModel=process.env.MAPGEN_TEXT_MODEL||DEFAULT_VISION_MODEL,imageModel=process.env.MAPGEN_IMAGE_MODEL||DEFAULT_IMAGE_MODEL;
    const sitePrompt=await prompt('site');
    let site=await stage('site',{recorded,sourceHash,id,sitePrompt,visionModel},async()=>recorded?structuredClone(recorded):(providers.readSite||readSite)(original,sitePrompt,await schema('site')),redo==='site');
    if(site.imageSha256&&site.imageSha256!==sourceHash)throw Error('Recorded analysis belongs to another image');
    site.id=id||site.id;site.source='concept/reference'+extname(image).toLowerCase();site.imageSha256=sourceHash;
    // Old recorded reads can be upgraded, but fresh reads must provide their own source frame.
    if(recorded&&site.version===1){site.version=2;site.frame||={width:48,height:40};for(const b of site.buildings)b.storeys=Math.max(1,Math.min(4,b.storeys||1));}
    validateSchema(site,await schema('site'));validateSite(site);await jsonWrite(resolve(directory,'site.json'),site);await writeFile(resolve(directory,site.source),bytes);
    const siteLayout=solveSite(site,seed),designPrompt=await prompt('design');
    const design=await stage('design',{site,designPrompt,textModel,offline},async()=>offline?designLevel(site,siteLayout):(providers.readDesign||readDesign)(site,siteLayout,designPrompt,await schema('design')),['site','design'].includes(redo));
    validateSchema(design,await schema('design'));designLevel(site,siteLayout,design);
    const conceptPrompt=await prompt('concept'),floorPrompt=await prompt('floor'),floorSpecs=[],concepts=[];
    const sketch=offline?solveLayout(site,{seed,design}).layout:null;
    for(const p of design.programs) {
        const name=`${p.building}-${p.floor}`,path=resolve(directory,`concept/${name}.png`),redoFloor=redo===`${p.building}/${p.floor}`||redo===`${p.building}/floor-${p.floor+1}`;
        const signature=digest(Buffer.from(JSON.stringify({p,style:site.style,site,conceptPrompt,imageModel,offline,seed})));
        let regenerated=false;
        if(cache[`concept/${name}`]!==signature||!await exists(path)||['site','design','concepts'].includes(redo)||redoFloor) {
            onStage(`concept/${name}`);
            const b=sketch?.buildings.find(b=>b.id===p.building);
            const png=offline?schematicFloor(b,b.floors[p.floor]):await(providers.createConcept||createConcept)(p,site,conceptPrompt);
            if(!Buffer.isBuffer(png)||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error(`concept.png: ${name} is not a PNG`);
            await writeFile(path,png);cache[`concept/${name}`]=signature;regenerated=true;await jsonWrite(resolve(directory,'cache.json'),cache);
        }
        const png=await readFile(path),b=sketch?.buildings.find(b=>b.id===p.building);
        const fs=await stage(`floorspec/${name}`,{hash:digest(png),p,floorPrompt,visionModel,offline},async()=>offline?{
            building:p.building,floor:p.floor,source:'offline-schematic',rooms:b.floors[p.floor].rooms.filter(r=>r.kind!=='hall').map(r=>({kind:r.kind,center:[(r.x0+r.x1)/2/b.w,(r.y0+r.y1)/2/b.d]})),doors:[],windows:[],stairs:[],furniture:[]
        }:await(providers.readFloor||readFloor)(`data:image/png;base64,${png.toString('base64')}`,p,floorPrompt,await schema('floorspec')),regenerated||redoFloor||redo==='floorspec');
        validateSchema(fs,await schema('floorspec'));validateFloorSpec(fs,p);floorSpecs.push(fs);concepts.push(`concept/${name}.png`);
    }
    let solved,validation,lastError;
    for(let attempt=0;attempt<8;attempt++) {
        try {
            solved=solveLayout(site,{seed:seed+attempt,design,floorSpecs});validateSchema(solved.layout,await schema('layout'));
            validation=[...new Set([seed,1,2,3,4])].map(s=> {
                const started=performance.now(),m=buildPackagedMap({site,...solved},{seed:s}),buildMs=performance.now()-started;
                const failures=Object.entries(m.metrics.gates).filter(([,pass])=>!pass).map(([gate])=>gate);
                if(failures.length)throw Error(`seed ${s}: ${failures.join(', ')}`);
                if(buildMs>buildBudgetMs)throw Error(`performance.build: ${buildMs.toFixed(0)} ms exceeds ${buildBudgetMs} ms`);
                return {seed:s,metrics:m.metrics,buildMs};
            });
            if(attempt)solved.layout.repairs.push({kind:'reseed-layout',from:seed,to:seed+attempt});
            break;
        }catch(e){if(e.message.startsWith('performance.build:'))throw e;lastError=e;solved=null;onStage(`repair/${attempt+1}: ${e.message}`);}
    }
    if(!solved)throw Error(`package.validation: repairs exhausted: ${lastError.message}`);
    await jsonWrite(resolve(directory,'layout.json'),solved.layout);
    const m=buildPackagedMap({site,...solved},{seed});await writeFile(resolve(directory,'slate.svg'),slateSvg(m.visual.slate));
    const manifest={version:1,id:site.id,name:design.mission.title,theme:site.theme,seed,generatorVersion:'3.0.0',sourceAnalysis:recorded?'recorded':'vision',conceptSource:offline?'offline-schematic':'image-provider',models:offline?{}:{vision:visionModel,text:textModel,image:imageModel},files:{site:'site.json',design:'design.json',layout:'layout.json'},concepts,reference:site.source,size:[solved.layout.width,solved.layout.depth,solved.layout.height],storeys:site.buildings.map(b=>({id:b.id,storeys:b.storeys})),validation,repairs:[...solved.layout.repairs,...solved.layout.buildings.flatMap(b=>b.floors.flatMap(f=>f.repairs))],credits:'Reference supplied by author; generated interiors are art direction.',checksums:{site:digest(await readFile(resolve(directory,'site.json'))),design:digest(await readFile(resolve(directory,'design.json'))),layout:digest(await readFile(resolve(directory,'layout.json')))}};
    validateSchema(manifest,await schema('manifest'));await jsonWrite(resolve(directory,'manifest.json'),manifest);
    return {directory,manifest,site,design,layout:solved.layout};
}
