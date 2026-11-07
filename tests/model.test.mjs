/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characters, createTemplate, createPracticeRow, cellsForRow,
  createProject, validateProject, CELLS_PER_ROW,
} from '../src/model.js';
import { BUILTIN_STROKES } from '../src/builtin-strokes.js';
import {getStages, safeImageUrl} from '../src/stroke-service.js';

test('每行恆為 12 格', () => {
  for (const count of [0,1,3,6,12]) {
    const b=createPracticeRow('李宇晴',count);
    assert.equal(cellsForRow(b).length,CELLS_PER_ROW);
    assert.equal(cellsForRow(b).filter(x => x.ch).length,count);
  }
});

test('第二版前 6 格描紅，後 6 格全空白', () => {
  const blocks=createTemplate('v2','李宇晴');
  const rows=blocks.filter(b => b.type === 'practice');
  assert.equal(rows.length,9);
  for (const row of rows) {
    const cells=cellsForRow(row);
    assert.equal(cells.slice(0,6).map(c => c.ch).join(''), '李宇晴李宇晴');
    assert(cells.slice(6).every(c => c.ch === '' && c.opacity === 0));
  }
});

test('第一版整行描紅，12 格組成四組姓名', () => {
  const rows=createTemplate('v1','李宇晴').filter(b => b.type === 'practice');
  assert(rows.length>0);
  assert.equal(cellsForRow(rows[0]).map(c => c.ch).join(''),'李宇晴'.repeat(4));
});

test('支援非姓名任意文字及 Unicode 字元', () => {
  assert.deepEqual(characters('春眠 不覺曉\n'), ['春','眠','不','覺','曉']);
  const rows=createTemplate('v2','春眠不覺曉').filter(b=>b.type==='practice');
  assert.equal(cellsForRow(rows[0]).slice(0,6).map(c=>c.ch).join(''),'春眠不覺曉春');
  assert.equal(cellsForRow(rows[0]).slice(6).filter(c=>c.ch).length,0);
});

test('沒有逐筆素材時不捏造筆畫資料', () => {
  assert.equal(getStages('學'),null);
  assert.deepEqual(BUILTIN_STROKES,{});
  assert.equal(getStages('李'),null);
  const images=['data:image/svg+xml;base64,PHN2Zy8+'];
  assert.equal(getStages('學',{'學':images}),images);
  assert.equal(safeImageUrl(images[0]),images[0]);
});

test('JSON 專案能往返存取', () => {
  const blocks=createTemplate('v2','海闊天空');
  const saved=createProject('海闊天空',blocks);
  const restored=validateProject(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.blocks.length,blocks.length);
  assert.equal(restored.sourceText,'海闊天空');
});

test('手動字格安全校驗與範圍限制', () => {
  const b=createPracticeRow('李宇晴',6);
  b.manual=Array.from({length:12},()=>({ch:'李',opacity:3}));
  let restored=validateProject(createProject('李宇晴',[b]));
  assert.equal(restored.blocks[0].manual[0].opacity,1);
  assert.throws(()=>validateProject({blocks:[{...b,manual:[{ch:'李'}]}]}));
  assert.throws(()=>validateProject({blocks:[{type:'unknown',text:'x'}]}));
});
