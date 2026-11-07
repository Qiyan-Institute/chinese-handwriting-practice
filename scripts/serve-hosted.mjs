/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Local HTTP adapter for the exact hosted bundle; used only for preview/QA.
import http from 'node:http';
import {Readable} from 'node:stream';
import app from '../dist/server/index.js';
const port=Number(process.env.PORT||4173);
http.createServer(async(req,res)=>{
  try {
    const result=await app.fetch(new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers:req.headers}));
    res.writeHead(result.status,Object.fromEntries(result.headers));
    if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();
  } catch {res.writeHead(500).end('Hosted preview error');}
}).listen(port,'127.0.0.1',()=>console.log(`Hosted bundle preview: http://localhost:${port}`));
