/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {createHostedApp} from '../worker/index.js';
import {parseHostedStrokeArchive,readBounded} from '../worker/stroke-archive.js';
import {parseStrokeArchive} from '../scripts/moe-strokes.mjs';

const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');
const crc=0x5dec1f0f; // independent Python zlib.crc32 result
function fixture(method=8) {
  const name=Buffer.from('5b78_01.svg'),data=method===8?deflateRawSync(svg):svg;
  const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(svg.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(svg.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
const assets={'/index.html':{body:'<title>孫中山 · 正體字帖工坊</title>',type:'text/html; charset=utf-8'},
  '/assets/moe-index.json':{body:JSON.stringify({characters:['學']}),type:'application/json'}};
const request=(path,options)=>new Request('https://worksheet.test'+path,options);

test('雲端 ZIP 解碼與本機版本結果逐 bytes 相同，stored 與 deflate 均可',async()=>{
  for(const method of [0,8]) {
    const bytes=fixture(method);
    assert.deepEqual(await parseHostedStrokeArchive(bytes,'學'),parseStrokeArchive(bytes,'學'));
    assert.deepEqual(Buffer.from((await parseHostedStrokeArchive(bytes,'學'))[0].split(',')[1],'base64'),svg);
  }
  await assert.rejects(parseHostedStrokeArchive(fixture(),'習'));
  const corrupt=fixture(0);corrupt[45]^=1;
  await assert.rejects(parseHostedStrokeArchive(corrupt,'學'),/校驗/);
  await assert.rejects(parseHostedStrokeArchive(new Uint8Array(22),'學'));
});

test('雲端僅提供打包資產及 GET／HEAD，不暴露 Git、環境檔或專案上傳',async()=>{
  let calls=0;const app=createHostedApp(assets,{fetcher:async()=>{calls++;throw new Error();}});
  assert.match(await (await app.fetch(request('/'))).text(),/孫中山/);
  assert.equal((await app.fetch(request('/.git/config'))).status,404);
  assert.equal((await app.fetch(request('/.env'))).status,404);
  assert.equal((await app.fetch(request('/',{method:'POST',body:'private project'}))).status,405);
  assert.equal(await (await app.fetch(request('/',{method:'HEAD'}))).text(),'');
  assert.equal((await app.fetch(request('/api/moe/strokes?character=學',{method:'HEAD'}))).status,200);
  assert.equal(calls,0);
  assert.equal((await (await app.fetch(request('/api/health'))).json()).ok,true);
});

test('雲端按需下載原始 SVG、去重與快取，來源與官方網域固定',async()=>{
  let calls=0;
  const app=createHostedApp(assets,{fetcher:async(url,options)=>{
    calls++;assert.equal(new URL(url).hostname,'stroke-order.learningweb.moe.edu.tw');
    assert.equal(options.redirect,'manual');
    assert.equal(new URL(url).searchParams.get('WORD'),'學');
    return new Response(fixture());
  }});
  const responses=await Promise.all([app.fetch(request('/api/moe/strokes?character=學')),app.fetch(request('/api/moe/strokes?character=學'))]);
  const [one,two]=await Promise.all(responses.map(response=>response.json()));
  assert.equal(calls,1);assert.deepEqual(one,two);
  assert.equal(one.stages.length,1);assert.equal(one.metadata.sourceName,'中華民國教育部');
  await app.fetch(request('/api/moe/strokes?character=學'));assert.equal(calls,1);
});

test('雲端拒絕未知字、多字、跨站代理；下載失敗可恢復',async()=>{
  let fail=true,calls=0;
  const app=createHostedApp(assets,{fetcher:async()=>{calls++;if(fail)throw new Error('offline');return new Response(fixture());}});
  for(const ch of ['學習','🙂','https://example.com'])assert.equal((await app.fetch(request('/api/moe/strokes?character='+encodeURIComponent(ch)))).status,404);
  assert.equal((await app.fetch(request('/api/moe/strokes?character=學',{headers:{Origin:'https://unrelated.test'}}))).status,403);
  assert.equal(calls,0);
  assert.equal((await app.fetch(request('/api/moe/strokes?character=學'))).status,502);
  fail=false;assert.equal((await app.fetch(request('/api/moe/strokes?character=學'))).status,200);
});

test('預設 Fetch 保留雲端 Web API 所需的 globalThis 接收者',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async function(){assert.equal(this,globalThis);return new Response(fixture());};
    const app=createHostedApp(assets);
    assert.equal((await app.fetch(request('/api/moe/strokes?character=學'))).status,200);
  } finally {globalThis.fetch=original;}
});

test('公開接口有暫存節流，解壓縮有串流大小界線',async()=>{
  let time=0;
  const app=createHostedApp(assets,{now:()=>time,fetcher:async()=>new Response(fixture())});
  for(let i=0;i<120;i++)assert.equal((await app.fetch(request('/api/moe/strokes?character=學'))).status,200);
  assert.equal((await app.fetch(request('/api/moe/strokes?character=學'))).status,429);
  time=61000;assert.equal((await app.fetch(request('/api/moe/strokes?character=學'))).status,200);
  await assert.rejects(readBounded(new Blob([new Uint8Array(1024)]).stream(),100),/大小限制/);
});

test('GitHub Pages 僅獲指定 origin 的 CORS，成功、缺字及預檢皆可辨識',async()=>{
  const origin='https://qiyan-institute.github.io';
  const app=createHostedApp(assets,{fetcher:async()=>new Response(fixture())});
  const options={headers:{Origin:origin}};
  const success=await app.fetch(request('/api/moe/strokes?character=學',options));
  assert.equal(success.status,200);assert.equal(success.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(success.headers.get('Vary'),'Origin');
  const missing=await app.fetch(request('/api/moe/strokes?character=🙂',options));
  assert.equal(missing.status,404);assert.equal(missing.headers.get('Access-Control-Allow-Origin'),origin);
  const preflight=await app.fetch(request('/api/moe/strokes',{...options,method:'OPTIONS'}));
  assert.equal(preflight.status,204);assert.match(preflight.headers.get('Access-Control-Allow-Methods'),/GET/);
  const denied=await app.fetch(request('/api/moe/strokes',{method:'OPTIONS',headers:{Origin:'https://example.com'}}));
  assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
});
