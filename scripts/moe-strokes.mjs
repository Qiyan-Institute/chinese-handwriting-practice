/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {inflateRawSync} from 'node:zlib';
import https from 'node:https';

function downloadCard(url,options) {
  // The MOE host intermittently times out with Node's dual-stack fetch.
  // Use verified TLS over IPv4, as with the working official curl download.
  return new Promise((resolve,reject)=>{
    https.get(url,{family:4,signal:options.signal,headers:{Accept:'application/zip'}},response=>{
      resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,body:response});
    }).on('error',reject);
  });
}

export function strokeCardUrl(ch) {
  return `https://stroke-order.learningweb.moe.edu.tw/stroke_card.jsp?WORD=${encodeURIComponent(ch)}&TYPE=svg`;
}

const crcTable=Array.from({length:256},(_,i)=>{
  let n=i;for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;
});
function crc32(bytes) {
  let value=0xffffffff;
  for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);
  return (value^0xffffffff)>>>0;
}

// The official SVG download is a ZIP of already cumulative, numbered SVGs.
// Decode that container only: every returned SVG retains its original bytes.
export function parseStrokeArchive(bytes,ch) {
  if(bytes.length>8*1024*1024||bytes.length<22)throw new Error('官方字卡壓縮檔大小異常');
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--) {
    if(bytes.readUInt32LE(at)===0x06054b50){end=at;break;}
  }
  if(end<0)throw new Error('官方字卡不是完整 ZIP');
  const count=bytes.readUInt16LE(end+10);
  const centralSize=bytes.readUInt32LE(end+12);
  let offset=bytes.readUInt32LE(end+16);
  if(bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0||count<1||count>64||offset+centralSize>end)throw new Error('官方字卡 ZIP 索引異常');
  const prefix=ch.codePointAt(0).toString(16).padStart(4,'0');
  const stages=[];
  let total=0;
  for(let index=0;index<count;index++) {
    if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw new Error('字卡 ZIP 目錄錯誤');
    const flags=bytes.readUInt16LE(offset+8), method=bytes.readUInt16LE(offset+10);
    const crc=bytes.readUInt32LE(offset+16), compressed=bytes.readUInt32LE(offset+20), size=bytes.readUInt32LE(offset+24);
    const nameLength=bytes.readUInt16LE(offset+28), extraLength=bytes.readUInt16LE(offset+30), commentLength=bytes.readUInt16LE(offset+32);
    const local=bytes.readUInt32LE(offset+42);
    const name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');
    const match=name.toLowerCase().match(new RegExp(`^${prefix}_(\\d{2})\\.svg$`));
    if(!match||(flags&1)||![0,8].includes(method)||size>512*1024||local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)throw new Error('字卡檔名或格式異常');
    total+=size;
    if(total>12*1024*1024)throw new Error('字卡解壓縮大小超限');
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if(start+compressed>bytes.length)throw new Error('字卡資料不完整');
    const packed=bytes.subarray(start,start+compressed);
    const svg=method===8?inflateRawSync(packed,{maxOutputLength:512*1024}):packed;
    if(svg.length!==size||crc32(svg)!==crc)throw new Error('字卡資料校驗失敗');
    const text=svg.toString('utf8');
    if(!/^\s*<svg\b/.test(text)||!/<\/svg>\s*$/.test(text)||
      /<!|<\s*(?:script|foreignObject|image|use|style)\b|\bon\w+\s*=|\b(?:href|src)\s*=|url\s*\(/i.test(text))throw new Error('字卡不是獨立靜態 SVG');
    const step=Number(match[1]);
    if(step<1||step>count||stages[step-1])throw new Error('字卡筆畫編號異常');
    stages[step-1]=`data:image/svg+xml;base64,${svg.toString('base64')}`;
    offset+=46+nameLength+extraLength+commentLength;
  }
  if(stages.filter(Boolean).length!==count)throw new Error('官方字卡缺少筆畫');
  return stages;
}

export function createStrokeRepository(supported,fetcher=downloadCard) {
  const cache=new Map(),pending=new Map();
  return async ch=>{
    if(Array.from(ch||'').length!==1||!supported.has(ch))throw Object.assign(new Error('官方清單未收錄這個字'),{status:404});
    if(cache.has(ch))return cache.get(ch);
    if(pending.has(ch))return pending.get(ch);
    if(pending.size>=4)throw Object.assign(new Error('筆順下載中，請稍後重試'),{status:429});
    const request=(async()=>{
      const sourceUrl=strokeCardUrl(ch);
      let stages;
      for(let attempt=0;attempt<3;attempt++) {
        try {
          const response=await fetcher(sourceUrl,{signal:AbortSignal.timeout(15000),redirect:'error'});
          if(!response.ok)throw new Error(`教育部字卡下載失敗（HTTP ${response.status}）`);
          const chunks=[];let length=0;
          for await(const chunk of response.body){
            length+=chunk.length;if(length>8*1024*1024)throw new Error('官方字卡壓縮檔超過 8 MB');chunks.push(chunk);
          }
          stages=parseStrokeArchive(Buffer.concat(chunks),ch);
          break;
        } catch(error) {
          if(attempt===2)throw error;
        }
      }
      const result={character:ch,stages,metadata:{sourceName:'中華民國教育部',sourceUrl,
        license:'CC BY-NC-ND 3.0 臺灣版',attribution:'中華民國教育部 · https://stroke-order.learningweb.moe.edu.tw/',
        acquiredAt:new Date().toISOString(),changes:'官方下載包內的累積逐筆 SVG，保留原始檔案內容'}};
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(ch,result);return result;
    })();
    pending.set(ch,request);
    try{return await request;}finally{pending.delete(ch);}
  };
}
