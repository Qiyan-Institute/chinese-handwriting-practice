/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PHONETIC_SYMBOLS,PHONETIC_TEXT,isPhoneticSymbol} from '../src/phonetic.js';
import {createTemplate,cellsForRow,cellCounts} from '../src/model.js';
import {officialEmbedUrl} from '../src/moe.js';
import {officialLookupUrl} from '../src/stroke-service.js';
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
