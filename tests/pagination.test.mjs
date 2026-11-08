/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {paginate, blockHeight, CONTENT_HEIGHT, moveBlockToPage} from '../src/pagination.js';
import {createTemplate, createPracticeRow, createHeading, createCharacterBlock, createProject, validateProject} from '../src/model.js';

test('長文件逐頁保持順序、沒有溢位、沒有遺失區塊', () => {
  const blocks = Array.from({length:250}, () => createPracticeRow('學習', 6));
  const pages = paginate(blocks);
  assert(pages.length > 1);
  assert(pages.every(page => page.used <= CONTENT_HEIGHT));
  assert.deepEqual(pages.flatMap(page => page.entries.map(entry => entry.block.id)), blocks.map(block => block.id));
});

test('分組標題與下一區塊一起換頁', () => {
  const blocks = Array.from({length:17}, () => createPracticeRow());
  blocks.push(createHeading('下一組'), createPracticeRow());
  const pages = paginate(blocks);
  assert.equal(pages[1].entries[0].block.type, 'heading');
  assert.equal(pages[1].entries[1].block.type, 'practice');
});

test('手動分頁可往返 JSON，第一區塊分頁不產生空白頁', () => {
  const blocks = [createPracticeRow(), createPracticeRow()];
  for (const block of blocks) block.pageBreakBefore = true;
  const restored = validateProject(createProject('李宇晴', blocks));
  assert.equal(paginate(restored.blocks).length, 2);
  assert.equal(paginate([]).length, 1);
});

test('64 畫以多行呈現並佔用對應高度', () => {
  const block = createCharacterBlock('龘');
  assert.equal(blockHeight(block, 64), 278);
  const pages = paginate(Array.from({length:8}, () => createCharacterBlock('龘')), () => 64);
  assert.equal(pages.length, 3);
  assert(pages.every(page => page.used <= CONTENT_HEIGHT));
});

test('跨頁移動至頁首保留目標分頁界線', () => {
  const blocks = Array.from({length:4}, () => createPracticeRow());
  blocks[2].pageBreakBefore = true;
  const originalIds = blocks.map(block => block.id).sort();
  const moved = moveBlockToPage(blocks, blocks[0].id, paginate(blocks), 1);
  const pages = paginate(moved);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].entries[0].block.id, blocks[0].id);
  assert.deepEqual(moved.map(block => block.id).sort(), originalIds);
  assert.equal(moved[2].pageBreakBefore, false);
});

test('生字範本不再悄悄截斷輸入，超額時明確拒絕', () => {
  const text = '春眠不覺曉處處聞啼鳥夜來風雨聲花落知多少';
  assert.equal(createTemplate('word',text).filter(block => block.type === 'character').length, Array.from(text).length);
  assert.throws(() => createTemplate('v2', '學'.repeat(241)), /240/);
});

test('Letter 頁面較矮，17 行會由一張 A4 分成兩頁且保留全部字格',()=>{
  const rows=Array.from({length:17},()=>createPracticeRow('學習',6));
  assert.equal(paginate(rows).length,1);
  const letter=paginate(rows,()=>0,98,'letter');
  assert.equal(letter.length,2);
  assert.equal(letter[0].entries.length,16);
  assert.deepEqual(letter.flatMap(page=>page.entries.map(entry=>entry.block)),rows);
});

test('Letter 長文件與 64 畫單字遵守高度、手動分頁和標題連同下行',()=>{
  const blocks=Array.from({length:50},()=>createCharacterBlock('龘'));
  blocks[2].pageBreakBefore=true;
  const heading=createHeading('下一組');
  blocks.splice(10,0,heading);
  const pages=paginate(blocks,()=>64,98,'letter');
  assert(pages.every(page=>page.used<=880));
  assert.deepEqual(pages.flatMap(page=>page.entries.map(entry=>entry.block.id)),blocks.map(block=>block.id));
  assert.equal(pages[1].entries[0].block.id,blocks[2].id);
  const group=pages.find(page=>page.entries.some(entry=>entry.block.id===heading.id));
  const at=group.entries.findIndex(entry=>entry.block.id===heading.id);
  assert.equal(group.entries[at+1].block.id,blocks[11].id);
});

test('大格重排 A4 及 Letter，64 畫、標題和練習組均完整且不溢位',()=>{
  const blocks=[createCharacterBlock('龘'),createHeading('大格練習'),...Array.from({length:20},()=>createPracticeRow('孫中山',6))];
  blocks[7].pageBreakBefore=true;
  for(const paper of ['a4','letter']) {
    const large=paginate(blocks,()=>64,98,paper,'large');
    const standard=paginate(blocks,()=>64,98,paper);
    assert(large.length>standard.length);
    assert(large.every(page=>page.used<=(paper==='letter'?880:947)));
    assert.deepEqual(large.flatMap(page=>page.entries.map(entry=>entry.block.id)),blocks.map(block=>block.id));
    assert(large.some(page=>page.entries[0].block.id===blocks[7].id));
    const group=large.find(page=>page.entries.some(entry=>entry.block.type==='heading'));
    const at=group.entries.findIndex(entry=>entry.block.type==='heading');
    assert.equal(group.entries[at+1].block.id,blocks[2].id);
  }
});
