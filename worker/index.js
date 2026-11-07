/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {parseHostedStrokeArchive,readBounded} from './stroke-archive.js';

export function createHostedApp(assets,{fetcher=fetch,now=()=>Date.now()}={}) {
  const index=JSON.parse(assets['/assets/moe-index.json'].body);
  const supported=new Set(index.characters),pending=new Map(),cache=new Map(),visitors=new Map();
  const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
  const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
  async function loadCard(ch) {
    if(cache.has(ch)&&cache.get(ch).expires>now())return cache.get(ch).value;
    if(pending.has(ch))return pending.get(ch);
    if(pending.size>=4)throw Object.assign(new Error('筆順下載中，請稍後重試'),{status:429});
    const request=(async()=>{
      const sourceUrl=`https://stroke-order.learningweb.moe.edu.tw/stroke_card.jsp?WORD=${encodeURIComponent(ch)}&TYPE=svg`;
      let stages;
      for(let attempt=0;attempt<2;attempt++) {
        try {
          const response=await fetcher(sourceUrl,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{Accept:'application/zip'}});
          if(!response.ok||!response.body)throw new Error('官方下載暫時無法連線');
          stages=await parseHostedStrokeArchive(await readBounded(response.body,8*1024*1024),ch);break;
        } catch(error) {if(attempt===1)throw error;}
      }
      const value={character:ch,stages,metadata:{sourceName:'中華民國教育部',sourceUrl,
        license:'CC BY-NC-ND 3.0 臺灣版',attribution:'中華民國教育部 · https://stroke-order.learningweb.moe.edu.tw/',
        acquiredAt:new Date(now()).toISOString(),changes:'官方下載包內的累積逐筆 SVG，保留原始檔案內容'}};
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(ch,{value,expires:now()+60*60*1000});return value;
    })();
    pending.set(ch,request);
    try{return await request;}finally{pending.delete(ch);}
  }
  return {async fetch(request) {
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET, HEAD'}});
    const url=new URL(request.url);
    if(url.pathname==='/api/health')return json({ok:true,service:'chinese-handwriting-practice',version:'0.5.0'});
    if(url.pathname==='/api/moe/strokes') {
      // Only a single character from the official index can reach the fixed
      // upstream. This is not an arbitrary URL proxy or a document upload API.
      const ch=url.searchParams.get('character');
      if(Array.from(ch||'').length!==1||!supported.has(ch))return json({error:'官方清單未收錄這個字'},404);
      if(request.method==='HEAD')return new Response(null,{status:200,headers});
      const origin=request.headers.get('Origin');
      if(origin&&origin!==url.origin)return json({error:'請從字帖頁面載入筆順'},403);
      // Ephemeral per-instance admission control; no visitor address is logged
      // or stored in a database. Upstream concurrency has its own global cap.
      const key=request.headers.get('CF-Connecting-IP')||'anonymous';
      const current=now(),visitor=visitors.get(key);
      if(visitor&&visitor.until>current) {
        if(visitor.count>=120)return json({error:'請求較多，請稍候再試'},429,{'Retry-After':'60'});
        visitor.count++;
      } else {
        if(visitors.size>=1000)visitors.delete(visitors.keys().next().value);
        visitors.set(key,{count:1,until:current+60000});
      }
      try{return json(await loadCard(ch));}
      catch(error){return json({error:error.status?error.message:'官方字卡暫時無法載入，請按「重試缺字筆順」。'},error.status||502);}
    }
    let pathname;
    try{pathname=decodeURIComponent(url.pathname);}catch{return new Response('Bad path',{status:400,headers});}
    const asset=assets[pathname==='/'?'/index.html':pathname];
    if(!asset)return new Response('Not found',{status:404,headers});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{...headers,'Content-Type':asset.type,'Cache-Control':'no-cache'}});
  }};
}
