// Authored overhead regression: deliberately wider than 6:5; this is a schematic reference, not a photograph.
import { mkdir, writeFile } from 'node:fs/promises';
import { rasterPng } from './Schematic.mjs';
import { jsonWrite, digest } from './PackageIO.mjs';
const site={version:2,id:'signal-house',name:'Signal House',theme:'Downtown',timeOfDay:'overcast',frame:{width:52,height:36},style:'Modern urban surveillance office, muted concrete and teal signage. Authored overhead design reference.',buildings:[{id:'command',bounds:[0.18,0.15,0.64,0.55],program:'office',front:'e',storeys:4}],surfaces:[{bounds:[0,0,1,1],material:'concrete'},{bounds:[0,0.72,1,0.84],material:'asphalt'}],insertion:[0.1,0.92],flow:[[0.78,0.66],[0.78,0.4],[0.78,0.1]],storyHooks:['The fourth-floor surveillance room controls the Syndicate roadblock. Recover its command records.']};
const png=rasterPng(832,576,[{x:0,y:0,w:832,h:576,color:[166,176,175]},{x:0,y:414,w:832,h:70,color:[52,64,76]},{x:150,y:86,w:383,h:230,color:[71,92,110]},{x:158,y:94,w:367,h:214,color:[187,197,185]},{x:770,y:0,w:42,h:576,color:[119,138,139]},{x:550,y:180,w:46,h:270,color:[109,203,205]}]);
site.imageSha256=digest(png);await mkdir('docs/design/mapgen',{recursive:true});await writeFile('docs/design/mapgen/signal-house-reference.png',png);await jsonWrite('docs/design/mapgen/signal-house-site.json',site);
