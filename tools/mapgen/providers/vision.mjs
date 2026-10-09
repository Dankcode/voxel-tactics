import { jsonResponse } from './openai.mjs';
export const readSite=(image,prompt,schema,options={})=>jsonResponse(prompt,schema,{...options,images:[image]});
export const readFloor=(image,program,prompt,schema,options={})=>jsonResponse(`${prompt}\nExact programme: ${JSON.stringify(program)}`,schema,{...options,images:[image]});
