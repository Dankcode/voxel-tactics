import { mkdir, writeFile, readFile, readdir, cp, rename, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
export const jsonWrite=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
export const jsonRead=async path=>JSON.parse(await readFile(path,'utf8'));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function updateCatalog(root) {
    const dirs=(await readdir(root,{withFileTypes:true})).filter(d=>d.isDirectory()&&/^[a-z0-9-]+$/.test(d.name)).map(d=>d.name).sort();
    const imports=[],packages=[];
    for(const [i,id] of dirs.entries()) {
        try {await readFile(resolve(root,id,'manifest.json'));}catch{continue;}
        for(const file of ['manifest','site','design','layout'])imports.push(`import ${file}${i} from '../../../client/public/maps/${id}/${file}.json' with { type: 'json' };`);
        packages.push(`{manifest:manifest${i},site:site${i},design:design${i},layout:layout${i}}`);
    }
    const catalog=resolve(root,'../../../shared/mission/generated/PackageCatalog.js');
    await writeFile(catalog,`// Generated package index only; map data lives in client/public/maps/<id>/.\n${imports.join('\n')}\nexport const MAP_PACKAGES=[${packages.join(',\n')}];\n`);
}
export async function installPackage(source,root,id) {
    if(!/^[a-z0-9-]+$/.test(id)||basename(source)!==id)throw Error('package.install: invalid id or source directory');
    await mkdir(root,{recursive:true});
    const target=resolve(root,id),staging=resolve(root,`.${id}-staging`),backup=resolve(root,`.${id}-backup`);
    await rm(staging,{recursive:true,force:true});await cp(source,staging,{recursive:true});
    let replaced=false;
    try {await rename(target,backup);replaced=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    try {await rename(staging,target);await updateCatalog(root);}
    catch(e){await rm(target,{recursive:true,force:true});if(replaced)await rename(backup,target);throw e;}
    if(replaced)await rm(backup,{recursive:true,force:true});
    return target;
}
