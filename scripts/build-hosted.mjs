/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {readFile,readdir,mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets={};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8'};
const add=async relative=>{assets['/'+relative]={body:await readFile(path.join(root,relative),'utf8'),type:types[path.extname(relative)]||'text/plain; charset=utf-8'};};
for(const name of ['index.html','LICENSE','NOTICE.md'])await add(name);
for(const folder of ['src','assets','examples'])for(const entry of (await readdir(path.join(root,folder),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
  if(entry.isFile()&&['.js','.css','.json','.md'].includes(path.extname(entry.name)))await add(folder+'/'+entry.name);
}
const phonetic=await readFile(path.join(root,'src/phonetic.js'),'utf8');
const decoder=await readFile(path.join(root,'worker/stroke-archive.js'),'utf8');
const handler=(await readFile(path.join(root,'worker/index.js'),'utf8')).replace("import {parseHostedStrokeArchive,readBounded} from './stroke-archive.js';",'')
  .replace("import {PHONETIC_SYMBOLS} from '../src/phonetic.js';",'');
const bundle=phonetic+'\n'+decoder+'\n'+handler+'\nexport default createHostedApp('+JSON.stringify(assets)+');\n';
await mkdir(path.join(root,'dist/server'),{recursive:true});
await mkdir(path.join(root,'dist/.openai'),{recursive:true});
await writeFile(path.join(root,'dist/server/index.js'),bundle);
await copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
console.log(`Hosted Worker built: ${Object.keys(assets).length} assets, ${Buffer.byteLength(bundle)} bytes; no runtime dependencies.`);
