export const DEFAULT_VISION_MODEL='gpt-6.1-sol';
export const DEFAULT_IMAGE_MODEL='gpt-image-2.5-flare';
export async function request(endpoint,body,{fetchImpl=fetch,apiKey=process.env.OPENAI_API_KEY,timeout=180000}={}) {
    if(!apiKey)throw Error('Set OPENAI_API_KEY for live authoring, or use --offline with a recorded site. No key is needed to play packages.');
    const response=await fetchImpl(`https://api.openai.com/v1/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    if(!response.ok)throw Error(`OpenAI ${endpoint} failed (${response.status}); cached stages remain available`);
    return response.json();
}
export async function jsonResponse(prompt,schema,{images=[],model=process.env.MAPGEN_VISION_MODEL||process.env.MAPGEN_MODEL||DEFAULT_VISION_MODEL,...options}={}) {
    const result=await request('responses',{model,input:[{role:'user',content:[{type:'input_text',text:`${prompt}\nReturn JSON conforming to this contract:\n${JSON.stringify(schema)}`},...images.map(url=>({type:'input_image',image_url:url,detail:'high'}))]}],text:{format:{type:'json_object'}},max_output_tokens:16000},options);
    const text=result.output_text||result.output?.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
    if(!text)throw Error('OpenAI response has no JSON output');
    return JSON.parse(text);
}
