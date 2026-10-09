import { request, DEFAULT_IMAGE_MODEL } from './openai.mjs';
export async function createConcept(program,site,prompt,options={}) {
    const result=await request('images/generations',{model:process.env.MAPGEN_IMAGE_MODEL||DEFAULT_IMAGE_MODEL,prompt:`${prompt}\nReference art direction: ${site.style||site.theme}, ${site.timeOfDay}. Architecture: ${JSON.stringify(site.buildings.find(b=>b.id===program.building))}.\nFloor programme: ${JSON.stringify(program)}`,size:'1024x1024',quality:'medium',output_format:'png',n:1},options);
    if(!result.data?.[0]?.b64_json)throw Error('Concept provider did not return PNG data');
    return Buffer.from(result.data[0].b64_json,'base64');
}
