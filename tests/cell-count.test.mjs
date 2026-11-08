/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PHONETIC_TEXT,PHONETIC_SYMBOLS} from '../src/phonetic.js';
import {createPracticeGrid,createCharacterBlock,createHeading,createTemplate,createProject,validateProject,withCellCount,cellsForRow,gridForBlock} from '../src/model.js';
import {paginate,moveBlockToPage} from '../src/pagination.js';

test('新增 37 格描紅為完整一套，74 格為兩套，空白新增不填字',()=>{
  for(const [count,sets] of [[37,1],[74,2]]) {
    const block=createPracticeGrid(PHONETIC_TEXT,count);
    assert.equal(block.cellCount,count);
    assert.equal(cellsForRow(block,'medium').filter(cell=>cell.ch).map(cell=>cell.ch).join(''),PHONETIC_TEXT.repeat(sets));
  }
  assert(cellsForRow(createPracticeGrid(PHONETIC_TEXT,37,0),'medium').every(cell=>!cell.ch&&cell.opacity===0));
  for(const invalid of [0,-1,241,3.5,''])assert.throws(()=>createPracticeGrid('字',invalid),/240/);
});

test('既有注音表追加 37 格保持原有 37 音，新格保持空白',()=>{
  const [block]=createTemplate('phonetic-tracing');
  const extended=withCellCount(block,74);
  for(const grid of ['standard','medium','large']) {
    const cells=cellsForRow(extended,grid);
    assert.deepEqual(cells.slice(0,37).map(cell=>cell.ch),PHONETIC_SYMBOLS);
    assert(cells.slice(37).every(cell=>!cell.ch&&cell.opacity===0));
  }
});

test('縮小後編輯再擴大，原有自動／手動字格及 JSON 均完整保留',()=>{
  const original=createPracticeGrid(PHONETIC_TEXT,120);
  const all=cellsForRow(original,'medium');
  const smaller=withCellCount(original,37);
  const stored=cellsForRow(smaller,'medium',{includeHidden:true});
  assert.equal(stored.length,120);assert.deepEqual(stored,all);
  stored[0]={ch:'',opacity:0};smaller.manual=stored;
  const saved=validateProject(JSON.parse(JSON.stringify(createProject(PHONETIC_TEXT,[smaller]))));
  const restored=withCellCount(saved.blocks[0],120);
  assert.deepEqual(cellsForRow(restored,'medium').slice(1),all.slice(1));
  assert.equal(cellsForRow(restored,'medium')[0].ch,'');
  assert.equal(restored.cellCount,120);
});

test('長格組在六種紙張／字格組合按完整行分頁，索引不缺漏或重複',()=>{
  for(const paper of ['a4','letter'])for(const size of ['standard','medium','large'])for(const count of [37,74,120,240]) {
    const block=createPracticeGrid(PHONETIC_TEXT,count),grid=gridForBlock(block,size);
    const pages=paginate([block],()=>0,95,paper,size);
    assert(pages.every(page=>page.used<=(paper==='letter'?883:950)));
    const indices=pages.flatMap(page=>page.entries.flatMap(entry=>Array.from({length:(entry.cellEnd??grid.capacity)-(entry.cellStart??0)},(_,i)=>(entry.cellStart??0)+i)));
    assert.deepEqual(indices,Array.from({length:grid.capacity},(_,i)=>i));
    for(const entry of pages.flatMap(page=>page.entries))if(entry.cellStart!=null) {
      assert.equal(entry.cellStart%grid.columns,0);assert.equal(entry.cellEnd%grid.columns,0);
    }
  }
});

test('64 畫單字長格組只在首段顯示逐筆，標題與首段同頁',()=>{
  const block=withCellCount(createCharacterBlock('學'),240);
  const pages=paginate([createHeading('下一組'),block],()=>64,95,'letter','large');
  const entries=pages.flatMap(page=>page.entries).filter(entry=>entry.block.id===block.id);
  assert.equal(pages[0].entries[0].block.type,'heading');
  assert.equal(pages[0].entries[1].block.id,block.id);
  assert.equal(entries[0].continuation,false);
  assert(entries.slice(1).every(entry=>entry.continuation));
  assert.equal(entries.at(-1).cellEnd,240);
  assert(pages.every(page=>page.used<=883));
});


test('跨頁格組的續頁不能當作獨立區塊移入目標，原編排保持完整',()=>{
  const large=createPracticeGrid(PHONETIC_TEXT,240),spare=createPracticeGrid('學',12);
  const blocks=[large,spare],pages=paginate(blocks,()=>0,95,'letter','large');
  assert.equal(pages[1].entries[0].continuation,true);
  const before=structuredClone(blocks);
  assert.equal(moveBlockToPage(blocks,spare.id,pages,1),blocks);
  assert.deepEqual(blocks,before);
});
