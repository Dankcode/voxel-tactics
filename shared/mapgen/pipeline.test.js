import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../../tools/mapgen/Pipeline.mjs';
import { jsonResponse, DEFAULT_VISION_MODEL } from '../../tools/mapgen/providers/openai.mjs';
import { createConcept } from '../../tools/mapgen/providers/image.mjs';
import { validateSchema } from './Contracts.js';
import { MAP_PACKAGES } from '../mission/generated/PackageCatalog.js';
const golden=MAP_PACKAGES.find(p=>p.manifest.id==='signal-house');

test('live-provider contract runs site → design → per-floor image/read-back; cache and one-floor redo work',async()=> {
    const out=await mkdtemp(join(tmpdir(),'mapgen-contract-')),counts={site:0,design:0,image:0,floor:0};
    const source='docs/design/mapgen/signal-house-reference.png';
    const png=await readFile('client/public/maps/signal-house/concept/command-0.png');
    const providers={
        readSite:async(image)=>{assert.match(image,/^data:image\/png;base64,/);counts.site++;return structuredClone(golden.site);},
        readDesign:async()=>{counts.design++;return structuredClone(golden.design);},
        createConcept:async()=>{counts.image++;return png;},
        readFloor:async(image,p)=>{assert.match(image,/^data:image\/png;base64,/);counts.floor++;return JSON.parse(await readFile(`client/public/maps/signal-house/floorspec/command-${p.floor}.json`));}
    };
    try {
        const options={image:source,id:'signal-house',out,providers,buildBudgetMs:10000};
        const first=await runPipeline(options);assert.deepEqual(counts,{site:1,design:1,image:4,floor:4});
        const second=await runPipeline(options);assert.deepEqual(counts,{site:1,design:1,image:4,floor:4});assert.deepEqual(first.layout,second.layout);
        await runPipeline({...options,redo:'command/floor-3'});assert.deepEqual(counts,{site:1,design:1,image:5,floor:5});
        const manifest=JSON.parse(await readFile(join(first.directory,'manifest.json')));assert.equal(manifest.conceptSource,'image-provider');assert.equal(manifest.validation.length,4);
        assert.ok(manifest.validation.every(v=>v.metrics.pass));
        providers.readFloor=async(_image,p)=>({building:p.building,floor:p.floor,rooms:[{kind:'unknown-room',center:[0.5,0.5]}]});
        await assert.rejects(runPipeline({...options,redo:'command/floor-3'}),/floorspec.room/);
        await assert.rejects(readFile(join(first.directory,'manifest.json')),/ENOENT/,'failed authoring cannot publish an old manifest');
    }finally{await rm(out,{recursive:true,force:true});}
});

test('OpenAI adapter uses current configurable models and the Responses/image endpoint contracts',async()=> {
    let call;
    const fetchImpl=async(url,options)=>{call={url,body:JSON.parse(options.body)};return{ok:true,json:async()=>url.endsWith('/responses')?{output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]}:{data:[{b64_json:'aGVsbG8='}]}};};
    const result=await jsonResponse('Read this picture',{type:'object'},{images:['data:image/png;base64,AA=='],fetchImpl,apiKey:'test-placeholder',model:DEFAULT_VISION_MODEL});
    assert.deepEqual(result,{ok:true});assert.ok(call.url.endsWith('/responses'));assert.equal(call.body.model,'gpt-6.1-sol');assert.equal(call.body.input[0].content[1].type,'input_image');
    const png=await createConcept(golden.design.programs[0],golden.site,'Top down',{fetchImpl,apiKey:'test-placeholder'});assert.equal(png.toString(),'hello');assert.ok(call.url.endsWith('/images/generations'));assert.ok(!call.body.model.includes('4.1'));
    await assert.rejects(jsonResponse('test',{}, {apiKey:''}),/OPENAI_API_KEY/);
});

test('all installed packages satisfy stage schemas and checksum contracts',async()=> {
    const {digest}=await import('../../tools/mapgen/PackageIO.mjs');
    for(const pkg of MAP_PACKAGES) {
        const root=`client/public/maps/${pkg.manifest.id}`;
        for(const name of ['manifest','site','design','layout']) {
            const schema=JSON.parse(await readFile(`tools/mapgen/schemas/${name}.json`));assert.doesNotThrow(()=>validateSchema(pkg[name],schema));
            if(name!=='manifest')assert.equal(digest(await readFile(`${root}/${name}.json`)),pkg.manifest.checksums[name]);
        }
        for(const p of pkg.design.programs) {
            const spec=JSON.parse(await readFile(`${root}/floorspec/${p.building}-${p.floor}.json`));const schema=JSON.parse(await readFile('tools/mapgen/schemas/floorspec.json'));assert.doesNotThrow(()=>validateSchema(spec,schema));
        }
    }
});
