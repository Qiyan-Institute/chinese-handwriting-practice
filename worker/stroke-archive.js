/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Web-platform equivalent of the local Node ZIP decoder. Original SVG bytes are
// retained; no Node, filesystem, native sockets, or third-party runtime needed.
export async function readBounded(stream,maxBytes) {
  const chunks=[];let size=0;
  const reader=stream.getReader();
  try {
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new Error('字卡資料超過大小限制');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}

const hostedCrcTable=Array.from({length:256},(_,i)=>{
  let n=i;for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;
});
function hostedCrc(bytes) {
  let value=0xffffffff;
  for(const byte of bytes)value=hostedCrcTable[(value^byte)&255]^(value>>>8);
  return (value^0xffffffff)>>>0;
}
function encodeSvg(bytes) {
  let binary='';
  for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export async function parseHostedStrokeArchive(bytes,ch) {
  if(bytes.length<22||bytes.length>8*1024*1024)throw new Error('官方字卡壓縮檔大小異常');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=at=>view.getUint16(at,true),u32=at=>view.getUint32(at,true);
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(u32(at)===0x06054b50){end=at;break;}
  if(end<0)throw new Error('官方字卡不是完整 ZIP');
  const count=u16(end+10),centralSize=u32(end+12);let offset=u32(end+16);
  if(u16(end+4)!==0||u16(end+6)!==0||count<1||count>64||offset+centralSize>end)throw new Error('官方字卡 ZIP 索引異常');
  const prefix=ch.codePointAt(0).toString(16).padStart(4,'0');
  const decoder=new TextDecoder('utf-8',{fatal:true}),stages=[];let total=0;
  for(let index=0;index<count;index++) {
    if(offset+46>bytes.length||u32(offset)!==0x02014b50)throw new Error('字卡 ZIP 目錄錯誤');
    const flags=u16(offset+8),method=u16(offset+10),crc=u32(offset+16),compressed=u32(offset+20),size=u32(offset+24);
    const nameLength=u16(offset+28),extraLength=u16(offset+30),commentLength=u16(offset+32),local=u32(offset+42);
    const name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength));
    const match=name.toLowerCase().match(new RegExp(`^${prefix}_(\\d{2})\\.svg$`));
    if(!match||(flags&1)||![0,8].includes(method)||size>512*1024||local+30>bytes.length||u32(local)!==0x04034b50)throw new Error('字卡檔名或格式異常');
    total+=size;if(total>12*1024*1024)throw new Error('字卡解壓縮大小超限');
    const start=local+30+u16(local+26)+u16(local+28);
    if(start+compressed>bytes.length)throw new Error('字卡資料不完整');
    const packed=bytes.subarray(start,start+compressed);
    const svg=method===8?await readBounded(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),512*1024):packed;
    if(svg.length!==size||hostedCrc(svg)!==crc)throw new Error('字卡資料校驗失敗');
    const text=decoder.decode(svg);
    if(!/^\s*<svg\b/.test(text)||!/<\/svg>\s*$/.test(text)||/<!|<\s*(?:script|foreignObject|image|use|style)\b|\bon\w+\s*=|\b(?:href|src)\s*=|url\s*\(/i.test(text))throw new Error('字卡不是獨立靜態 SVG');
    const step=Number(match[1]);
    if(step<1||step>count||stages[step-1])throw new Error('字卡筆畫編號異常');
    stages[step-1]=encodeSvg(svg);offset+=46+nameLength+extraLength+commentLength;
  }
  if(stages.filter(Boolean).length!==count)throw new Error('官方字卡缺少筆畫');
  return stages;
}
