/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentHistory} from '../src/history.js';
import {createPracticeRow,createCharacterBlock,createTemplate,validateProject,createProject} from '../src/model.js';
import {updateWorksheetText} from '../src/text-update.js';

const state=()=>({sourceText:'李宇晴',appliedText:'李宇晴',blocks:[createPracticeRow()],settings:{pageTitle:'練習'},customAssets:{},assetMetadata:{},selectedId:null,activePage:0});

test('刪除、清空、換模板可整次撤銷及重做，狀態互不污染',()=>{
  const initial=state(),h=new DocumentHistory(initial);
  const cleared=structuredClone(initial);cleared.blocks[0].count=0;h.record(cleared);
  const replaced={...cleared,blocks:createTemplate('blank')};h.record(replaced);
  assert.equal(h.undo().blocks[0].count,0);
  const restored=h.undo();assert.equal(restored.blocks[0].count,6);
  restored.blocks[0].count=2;
  assert.equal(h.redo().blocks[0].count,0);
  assert.equal(h.redo().blocks.length,13);
  assert.equal(h.redo(),null);
});

test('撤銷後的新修改清除重做分支，選取及頁面導覽不消耗步數',()=>{
  const initial=state(),h=new DocumentHistory(initial);
  assert.equal(h.record({...initial,selectedId:'other',activePage:1}),false);
  h.record({...initial,sourceText:'李'});h.undo();
  h.record({...initial,sourceText:'宇'});
  assert.equal(h.canRedo,false);assert.equal(h.undo().sourceText,'李宇晴');
});

test('連續輸入合併，切換欄位、逾時或明確動作切開歷史',()=>{
  let now=0;const initial=state(),h=new DocumentHistory(initial,{now:()=>now});
  h.record({...initial,sourceText:'李'},'source');now=300;
  h.record({...initial,sourceText:'李宇'},'source');
  assert.equal(h.undo().sourceText,'李宇晴');assert.equal(h.redo().sourceText,'李宇');
  now=1200;h.record({...initial,sourceText:'宇'},'source');
  assert.equal(h.undo().sourceText,'李宇');
});

test('歷史上限為 50 步，背景素材補載不消耗步數或覆蓋自訂素材',()=>{
  const initial=state(),h=new DocumentHistory(initial);
  const custom=['data:image/svg+xml;base64,YQ=='];
  h.record({...initial,customAssets:{'學':custom},assetMetadata:{'學':{sourceName:'我的圖片'}}});
  h.addOfficialAsset('學',['official'],{sourceName:'中華民國教育部'});
  assert.equal(h.undo().customAssets['學'][0],'official');
  assert.equal(h.canUndo,false);assert.equal(h.redo().customAssets['學'],custom);
  for(let i=0;i<60;i++)h.record({...initial,sourceText:String(i)});
  let count=0;while(h.undo())count++;
  assert.equal(count,50);
});

test('更新文字保留手動行、自訂文字、ID、灰度、格數及分頁',()=>{
  const automatic={...createPracticeRow('李宇晴',3),pageBreakBefore:true,signature:true,light1:44};
  const manual={...createPracticeRow('李宇晴'),manual:Array.from({length:12},()=>({ch:'李',opacity:.5}))};
  const custom=createPracticeRow('自訂文字');
  const result=updateWorksheetText([automatic,manual,custom],'李宇晴','宇晴李');
  assert.deepEqual(result.blocks[0],{...automatic,text:'宇晴李'});
  assert.equal(result.blocks[1],manual);assert.equal(result.blocks[2],custom);
  assert.equal(result.preservedManual,1);
});

test('更新字數增減同步處理單字區塊與連寫標題，不重建既有區塊',()=>{
  const initial=createTemplate('v2','李宇');
  const added=updateWorksheetText(initial,'李宇','宇晴李');
  assert.deepEqual(added.blocks.filter(b=>b.type==='character').map(b=>b.text),['宇','晴','李']);
  assert.equal(added.blocks[0].id,initial[0].id);
  assert.equal(added.added,1);
  assert(added.blocks.some(b=>b.text==='連寫練習（宇晴李）'));
  const removed=updateWorksheetText(added.blocks,'宇晴李','宇');
  assert.equal(removed.blocks.filter(b=>b.type==='character').length,1);
  assert.equal(removed.removed,2);
});

test('重複字依出現位置更新，手動單字行保留',()=>{
  const initial=[createCharacterBlock('李'),createCharacterBlock('李')];
  assert.deepEqual(updateWorksheetText(initial,'李李','宇晴').blocks.map(b=>b.text),['宇','晴']);
  initial[0].manual=Array.from({length:12},()=>({ch:'李',opacity:.5}));
  assert.deepEqual(updateWorksheetText(initial,'李李','宇晴').blocks.map(b=>b.text),['李','晴']);
});

test('更新拒絕空文字及超額，來源草稿與已套用文字分別保存',()=>{
  assert.throws(()=>updateWorksheetText([],'李','   '),/輸入/);
  assert.throws(()=>updateWorksheetText([],'李','李'.repeat(241)),/240/);
  const project={...createProject('宇',[createPracticeRow('李')]),appliedText:'李'};
  assert.equal(validateProject(project).appliedText,'李');
  assert.equal(validateProject(createProject('宇',[])).appliedText,'宇');
});
