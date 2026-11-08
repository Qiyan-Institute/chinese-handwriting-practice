/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {parseStrokeArchive,createStrokeRepository} from '../scripts/moe-strokes.mjs';
import {PHONETIC_SYMBOLS} from '../src/phonetic.js';
import {fetchOfficialStages} from '../src/stroke-service.js';

const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');
// Independently generated CRC-32, checked against Python's zlib.crc32.
const crc=0x5dec1f0f;
function archive(names=['5b78_01.svg'],method=8) {
  const parts=[],directory=[];let offset=0;
  for(const name of names) {
    const filename=Buffer.from(name),packed=method===8?deflateRawSync(svg):svg;
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(svg.length,22);local.writeUInt16LE(filename.length,26);
    parts.push(local,filename,packed);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(svg.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    directory.push(central,filename);offset+=local.length+filename.length+packed.length;
  }
  const entries=Buffer.concat(directory),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(entries.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,entries,end]);
}

test('官方累積 SVG 依筆畫編號排序，原始 bytes 不改動（stored／deflate）',()=>{
  for(const method of [0,8]) {
    const stages=parseStrokeArchive(archive(['5b78_02.svg','5b78_01.svg'],method),'學');
    assert.equal(stages.length,2);
    assert.deepEqual(Buffer.from(stages[0].split(',')[1],'base64'),svg);
    assert.deepEqual(Buffer.from(stages[1].split(',')[1],'base64'),svg);
  }
});

test('拒絕錯字字卡、缺筆、路徑及壓縮檔損壞',()=>{
  assert.throws(()=>parseStrokeArchive(archive(),'習'));
  assert.throws(()=>parseStrokeArchive(archive(['5b78_02.svg']),'學'));
  assert.throws(()=>parseStrokeArchive(archive(['../5b78_01.svg']),'學'));
  const corrupt=archive(['5b78_01.svg'],0);corrupt[45]^=1;
  assert.throws(()=>parseStrokeArchive(corrupt,'學'),/校驗/);
  assert.throws(()=>parseStrokeArchive(Buffer.from('<html>upstream error</html>'),'學'));
});

test('官方字卡請求會去重與快取，附加來源與授權',async()=>{
  let calls=0;
  const repository=createStrokeRepository(new Set(['學']),async url=>{
    calls++;assert.match(url,/WORD=%E5%AD%B8&TYPE=svg$/);
    return new Response(archive());
  });
  const [one,two]=await Promise.all([repository('學'),repository('學')]);
  assert.equal(calls,1);assert.deepEqual(one,two);
  assert.equal((await repository('學')).metadata.sourceName,'中華民國教育部');
  assert.equal(calls,1);
  await assert.rejects(repository('🙂'),/未收錄/);
});

test('下載失敗可重試；前端拒絕字卡不符並驗證真實 SVG 資料',async()=>{
  let calls=0;
  const repository=createStrokeRepository(new Set(['學']),async()=>{
    if(++calls<=3)throw new Error('offline');return new Response(archive());
  });
  await assert.rejects(repository('學'),/offline/);
  const card=await repository('學');
  const result=await fetchOfficialStages('學',async()=>new Response(JSON.stringify(card)));
  assert.equal(result.stages.length,1);
  assert.match(result.metadata.license,/BY-NC-ND/);
  await assert.rejects(fetchOfficialStages('習',async()=>new Response(JSON.stringify(card))),/單字不符/);
});


test('本機支援官方 37 音字卡，保留每個 SVG 原始內容與來源',async()=>{
  const seen=[];
  const repo=createStrokeRepository(new Set(['學']),async url=>{
    const source=new URL(url),ch=source.searchParams.get('WORD');seen.push(ch);
    assert.equal(source.origin,'https://stroke-order.learningweb.moe.edu.tw');
    return new Response(archive([`${ch.codePointAt(0).toString(16)}_01.svg`]));
  });
  for(const ch of PHONETIC_SYMBOLS) {
    const result=await repo(ch);
    assert.equal(result.character,ch);
    assert.deepEqual(Buffer.from(result.stages[0].split(',')[1],'base64'),svg);
    assert.match(result.metadata.license,/BY-NC-ND/);
  }
  assert.deepEqual(seen,PHONETIC_SYMBOLS);
  await assert.rejects(repo('ˊ'),/未收錄/);
});
