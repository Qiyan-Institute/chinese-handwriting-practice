/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist/pages');
const service=new URL(process.env.STROKE_API_BASE||'https://qiyan-chinese-handwriting.bountifulhome1.chatgpt.site');
if(service.protocol!=='https:'||service.username||service.password||service.search||service.hash||service.pathname!=='/')throw new Error('STROKE_API_BASE 必須是無認證資訊的 HTTPS origin');
await mkdir(out,{recursive:true});
const copy=async name=>{
  const dst=path.join(out,name);await mkdir(path.dirname(dst),{recursive:true});
  await writeFile(dst,await readFile(path.join(root,name)));
};
for(const file of ['index.html','LICENSE','NOTICE.md'])await copy(file);
for(const folder of ['src','assets','examples'])for(const entry of await readdir(path.join(root,folder),{withFileTypes:true})) {
  if(entry.isFile()&&['.js','.css','.json','.md'].includes(path.extname(entry.name)))await copy(folder+'/'+entry.name);
}
await writeFile(path.join(out,'src/runtime-config.js'),`// GitHub Pages uses the dedicated stroke API; no project data is uploaded.\nexport const STROKE_API_BASE = ${JSON.stringify(service.origin)};\n`);
await writeFile(path.join(out,'.nojekyll'),'');
console.log(`GitHub Pages built at ${out}; stroke service: ${service.origin}`);
