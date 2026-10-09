#!/usr/bin/env node
// Author-time vision only. A recorded --site allows reproducible screenshot tests without credentials/network.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, extname } from 'node:path';
import { slateSvg } from '../../shared/mapgen/DesignSlate.js';
import { buildImageMap, validateSite } from '../../shared/mapgen/PackageBuilder.js';
import { GENERATED_SITES } from '../../shared/mission/generated/GeneratedSites.js';
import { CEDAR_IMAGE_SITE } from '../../shared/mission/generated/CedarImage.js';
const args=process.argv.slice(2), get=k=>{const v=args[args.indexOf(k)+1];if(!v || v.startsWith('--'))throw new Error(`Missing value for ${k}`);return v;};
if (!args.includes('--image')) throw new Error('Usage: npm run mapgen -- --image image.png [--site site.json|cedar] [--out output.json]');
const bytes=await readFile(resolve(get('--image')));
const digest=createHash('sha256').update(bytes).digest('hex');
let site;
if (args.includes('--site')) site=get('--site')==='cedar' ? structuredClone(CEDAR_IMAGE_SITE) : JSON.parse(await readFile(resolve(get('--site')),'utf8'));
else {
    if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY for new screenshot analysis, or use --site cedar for the recorded regression.');
    const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(get('--image')).toLowerCase()];
    if (!mime) throw new Error('Use PNG, JPEG or WebP');
    const prompt=`Analyze this screenshot into JSON only using this schema (the example values are placeholders, never copy the neighborhood): ${JSON.stringify({version:1,id:'reference-map',name:'Reference Mission',theme:'Downtown',timeOfDay:'overcast',buildings:[{id:'objective-building',bounds:[0.2,0.2,0.5,0.5],program:'office',front:'s'}],surfaces:[{bounds:[0,0.7,1,0.85],material:'asphalt'}],insertion:[0.1,0.94],flow:[[0.6,0.7],[0.6,0.4],[0.6,0.1]]})}. Use normalized TOP-DOWN coordinates, not image perspective coordinates. Adapt proportions to a 48x40 combat map. Keep building footprints >= 0.26 wide and 0.28 deep, inside the map with a perimeter route; no overlaps. Buildings programs house/shop/office/warehouse/diner/garage, front n/s/e/w. Surfaces materials lawn/concrete/paving/asphalt/deck. Design insertion near the edge with space for six soldiers. Flow contains 2–6 outdoor waypoints connecting insertion, cover approach, alternate flank and objective approach, never inside building footprints. Exclude bathrooms/service rooms from gameplay. Time day/dusk/night/dawn/overcast. Set version 1 and a unique lowercase hyphenated id. Use the reference setting (Suburbs/Downtown/Industrial/Roadside) and appropriate building programs and cover; do not default to houses. Preserve the screenshot's architecture; prioritize connected gameplay over literal unused rooms.`;
    const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.MAPGEN_MODEL || 'gpt-4.1',response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:${mime};base64,${bytes.toString('base64')}`,detail:'high'}}]}]}),signal:AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error(`Vision request failed (${response.status})`);
    const result=await response.json(); site=JSON.parse(result.choices?.[0]?.message?.content || '{}');
}
site = site.site || site;
// Preserve a fresh analysis even when geometric or combat validation rejects it, so authors can repair it offline.
if (!args.includes('--site')) {
    const analysisOut=resolve(args.includes('--out') ? get('--out')+'.analysis.json' : '/tmp/mapgen-analysis.json');
    await mkdir(dirname(analysisOut),{recursive:true});
    await writeFile(analysisOut,JSON.stringify({site:{...site,imageSha256:digest,source:get('--image')},sourceAnalysis:'vision'},null,2)+'\n');
}
validateSite(site);
if (site.imageSha256 && site.imageSha256 !== digest) throw new Error('Recorded analysis belongs to a different image; analyze this reference again.');
site.source=get('--image'); site.imageSha256=digest;
const seed=args.includes('--seed') ? Number(get('--seed')) : 1;
if (!Number.isSafeInteger(seed)) throw new Error('Seed must be an integer');
const mission=buildImageMap(site,{seed});
if (args.includes('--install')) {
    if (!mission.metrics.pass) throw new Error('Map fails combat design gates; revise layout/flow before installing.');
    if (['cedar-image','cedar-close','main-street','harbor-yard','route-9','proving-grounds'].includes(site.id)) throw new Error('Use a unique map id before installing.');
    const sites=[...GENERATED_SITES.filter(s=>s.id!==site.id),site];
    await writeFile(new URL('../../shared/mission/generated/GeneratedSites.js',import.meta.url),'// Installed reference analyses; no AI is needed at runtime.\nexport const GENERATED_SITES = '+JSON.stringify(sites,null,2)+';\n');
}
const report={site,slate:mission.visual.slate,seed,metrics:mission.metrics,rooms:mission.rooms.map(({id,kind,gameplay})=>({id,kind,gameplay})),sourceAnalysis:args.includes('--site')?'recorded':'vision'};
const out=resolve(args.includes('--out')?get('--out'):`/tmp/${site.id}.json`);
await mkdir(dirname(out),{recursive:true}); await writeFile(out,JSON.stringify(report,null,2)+'\n');
await writeFile(out.replace(/\.json$/, '')+'.svg',slateSvg(mission.visual.slate));
console.log(`Validated ${site.id}: ${mission.rooms.filter(r=>r.gameplay).length} combat rooms, ${mission.rooms.filter(r=>!r.gameplay).length} closed rooms. Package: ${out}`);
