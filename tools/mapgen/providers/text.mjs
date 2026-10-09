import { jsonResponse, DEFAULT_VISION_MODEL } from './openai.mjs';
export const readDesign=(site,layout,prompt,schema,options={})=>jsonResponse(`${prompt}\nSite: ${JSON.stringify(site)}\nParcels: ${JSON.stringify(layout.buildings)}`,schema,{model:process.env.MAPGEN_TEXT_MODEL||DEFAULT_VISION_MODEL,...options});
