// Read only INI definitions from an explicitly supplied mod archive. Never execute or import Unreal binaries.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,basename} from 'node:path';
import {parseXcomMapDefinitions} from '../../shared/mapgen/ParcelFormula.js';
const [archive,out]=process.argv.slice(2);if(!archive||!out)throw Error('Usage: node tools/xcom/import-parcels.mjs archive.zip output.json');
const names=execFileSync('unzip',['-Z1',resolve(archive)],{encoding:'utf8'}).split('\n').filter(n=>/\/Config\/.*\.ini$/i.test(n));
const files=Object.fromEntries(names.map(n=>[n,execFileSync('unzip',['-p',resolve(archive),n],{encoding:'utf8'})]));
const data={...parseXcomMapDefinitions(files),archive:basename(archive),sha256:createHash('sha256').update(await readFile(archive)).digest('hex'),note:'Active configuration only; commented/cancelled definitions excluded. Unreal map geometry and the engine generator are not included.'};
await mkdir(dirname(resolve(out)),{recursive:true});await writeFile(out,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({parcels:data.parcels.length,plots:data.plots.length,coverPieces:data.coverPieces.length,output:resolve(out)}));
