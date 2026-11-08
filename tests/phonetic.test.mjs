/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PHONETIC_SYMBOLS,PHONETIC_TEXT,isPhoneticSymbol} from '../src/phonetic.js';
import {createTemplate,cellsForRow,cellCounts,createProject,validateProject,gridForBlock} from '../src/model.js';
import {officialEmbedUrl} from '../src/moe.js';
import {officialLookupUrl} from '../src/stroke-service.js';
import {updateWorksheetText} from '../src/text-update.js';
import {paginate} from '../src/pagination.js';

test('注音全套依官網順序包含 37 個符號，無遺漏、重複或聲調',()=>{
  assert.equal(PHONETIC_TEXT,'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ');
  assert.equal(new Set(PHONETIC_SYMBOLS).size,37);
  assert.equal(isPhoneticSymbol('ˊ'),false);
  assert.equal(isPhoneticSymbol('ㄅㄆ'),false);
});

test('注音版型忽略輸入草稿，一次建立 37 組，三種字格都有半組空白',()=>{
  for(const grid of ['standard','medium','large']) {
    const blocks=createTemplate('phonetic','與注音無關的輸入'.repeat(50),grid);
    const symbols=blocks.filter(block=>block.type==='character');
    assert.deepEqual(symbols.map(block=>block.text),PHONETIC_SYMBOLS);
    assert.equal(blocks.length,38);
    for(const block of symbols) {
      const cells=cellsForRow(block,grid),half=cells.length/2;
      assert.deepEqual(cellCounts(block,grid),{filled:half,blank:half});
      assert.equal(cells[0].opacity,1);
      assert(cells.slice(half).every(cell=>!cell.ch&&cell.opacity===0));
    }
  }
});

test('37 音在 A4／Letter 三種字格均完整分頁，標題與首音同頁',()=>{
  for(const paper of ['a4','letter'])for(const grid of ['standard','medium','large']) {
    const blocks=createTemplate('phonetic','',grid);
    const pages=paginate(blocks,()=>4,71,paper,grid);
    assert(pages.length>1);
    assert.deepEqual(pages.flatMap(page=>page.entries.filter(entry=>entry.block.type==='character').map(entry=>entry.block.text)),PHONETIC_SYMBOLS);
    assert(pages.every(page=>page.used<=(paper==='letter'?907:974)));
    assert.equal(pages[0].entries[1].block.text,'ㄅ');
  }
});

test('注音動畫指向已驗證的官方完整頁，不產生無效 dictFrame 嵌入',()=>{
  const supported=new Set(PHONETIC_SYMBOLS);
  assert.equal(officialLookupUrl('ㄅ'),'https://stroke-order.learningweb.moe.edu.tw/dictView.jsp?ID=12549');
  assert.equal(officialLookupUrl('ㄩ'),'https://stroke-order.learningweb.moe.edu.tw/dictView.jsp?ID=12585');
  for(const ch of PHONETIC_SYMBOLS)assert.equal(officialEmbedUrl(ch,supported),null);
});


test('注音全描紅各音只出現一次，全是淡字，三種大小末行完整補格',()=>{
  const [block]=createTemplate('phonetic-tracing','無關草稿');
  assert.equal(block.type,'symbol-grid');
  for(const [size,capacity,rows] of [['standard',48,4],['medium',40,5],['large',42,7]]) {
    const cells=cellsForRow(block,size),grid=gridForBlock(block,size);
    assert.equal(cells.length,capacity);assert.equal(grid.rows,rows);
    assert.deepEqual(cells.filter(cell=>cell.ch).map(cell=>cell.ch),PHONETIC_SYMBOLS);
    assert(cells.slice(0,37).every(cell=>cell.opacity===.32));
    assert(cells.slice(37).every(cell=>cell.ch===''&&cell.opacity===0));
  }
  assert.equal(block.manual,null);
});

test('注音全描紅在 A4／Letter 六種組合均為一張練習頁',()=>{
  const blocks=createTemplate('phonetic-tracing');
  for(const paper of ['a4','letter'])for(const grid of ['standard','medium','large']) {
    assert.equal(paginate(blocks,()=>0,98,paper,grid).length,1);
  }
});

test('全描紅手動字格與 JSON 保存完整，切換大小後仍保留末尾編輯',()=>{
  const [block]=createTemplate('phonetic-tracing');
  const manual=cellsForRow(block,'medium',{includeHidden:true});
  assert.equal(manual.length,48);
  manual[47]={ch:'ㄅ',opacity:.4};block.manual=manual;
  const restored=validateProject(JSON.parse(JSON.stringify({...createProject(PHONETIC_TEXT,[block]),gridSize:'medium'})));
  assert.equal(restored.blocks[0].manual.length,48);
  assert.equal(cellsForRow(restored.blocks[0],'medium').length,40);
  const edited=cellsForRow(restored.blocks[0],'medium',{includeHidden:true});edited[0]={ch:'',opacity:0};
  restored.blocks[0].manual=edited;
  assert.deepEqual(cellsForRow(restored.blocks[0],'standard')[47],manual[47]);
  assert.throws(()=>validateProject({...restored,blocks:[{...block,manual:Array(40).fill({ch:'',opacity:0})}]}));
});

test('全描紅符號表限制 48 字，文字更新不會悄悄遺漏內容',()=>{
  const blocks=createTemplate('phonetic-tracing');
  const updated=updateWorksheetText(blocks,PHONETIC_TEXT,'ㄅㄆㄇ');
  assert.deepEqual(cellsForRow(updated.blocks[0]).filter(cell=>cell.ch).map(cell=>cell.ch),['ㄅ','ㄆ','ㄇ']);
  assert.throws(()=>updateWorksheetText(blocks,PHONETIC_TEXT,'ㄅ'.repeat(49)),/48/);
  const restored=validateProject({...createProject(PHONETIC_TEXT,blocks),blocks:[{...blocks[0],text:'ㄅ'.repeat(70),count:70}]});
  assert.equal(restored.blocks[0].text.length,48);
  assert.equal(cellsForRow(restored.blocks[0]).filter(cell=>cell.ch).length,48);
});
