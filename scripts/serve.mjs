/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
/** Minimal static HTTP server. No npm dependencies. */
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStrokeRepository} from './moe-strokes.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const index=JSON.parse(await readFile(path.join(projectRoot,'assets/moe-index.json'),'utf8'));
const officialStrokes=createStrokeRepository(new Set(index.characters));
const types = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.pdf':'application/pdf',
};

http.createServer(async (req,res) => {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const requested = requestUrl.pathname;
    if(requested==='/api/moe/strokes') {
      try {
        const result=await officialStrokes(requestUrl.searchParams.get('character'));
        const body=JSON.stringify(result);
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(req.method==='HEAD'?undefined:body);
      } catch(error) {
        res.writeHead(error.status||502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        res.end(JSON.stringify({error:error.status?error.message:'教育部字卡連線或下載失敗，請按「重試缺字筆順」再試一次。'}));
      }
      return;
    }
    const decoded = decodeURIComponent(requested);
    const absolute = path.resolve(projectRoot, '.' + (decoded === '/' ? '/index.html' : decoded));
    if (absolute !== projectRoot && !absolute.startsWith(projectRoot + path.sep)) {
      res.writeHead(403).end('Forbidden');return;
    }
    const metadata = await stat(absolute);
    if(!metadata.isFile()) {res.writeHead(404).end('Not found');return;}
    const contents = await readFile(absolute);
    res.writeHead(200,{
      'Content-Type':types[path.extname(absolute)] || 'application/octet-stream',
      'Content-Length':contents.length,
      'Cache-Control':'no-cache',
      'X-Content-Type-Options':'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch {res.writeHead(404).end('Not found');}
}).listen(port,'127.0.0.1',() => {
  console.log(`正體字帖工坊已啟動：http://localhost:${port}`);
  console.log('按 Ctrl+C 停止；僅向教育部查詢缺字字卡，不上傳專案或圖片。');
});
