/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {documentSettings,createProject,validateProject,createPracticeRow,createCharacterBlock,createTemplate,cellsForRow,cellCounts,officialCredits} from '../src/model.js';
import {paginate} from '../src/pagination.js';

test('乾淨頁首預設不含姓名／班級／日期，空標題保持空白',()=>{
  const settings=documentSettings();
  assert.equal(settings.pageTitle,'正體字書寫練習');
  assert.equal(settings.showName,false);assert.equal(settings.showClass,false);assert.equal(settings.showDate,false);
  assert.equal(documentSettings({pageTitle:''}).pageTitle,'');
  assert.equal(documentSettings({showTitle:false}).showTitle,false);
});

test('抬頭設定獨立保存，姓名不從練習文字推定',()=>{
  const saved={...createProject('學習',[createPracticeRow('學習')]),showName:true,studentName:'小朋友',showClass:true,className:'三年級',showDate:false,blankStyle:'grid'};
  const restored=validateProject(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.studentName,'小朋友');assert.equal(restored.sourceText,'學習');
  assert.equal(restored.className,'三年級');assert.equal(restored.showDate,false);
  assert.equal(restored.blankStyle,'grid');
});

test('舊姓名範本的預設文字改為通用標題，保留自訂內容與原有簽核設定',()=>{
  const data=createProject('李宇晴',createTemplate('v2','李宇晴'));
  data.pageTitle='姓名描寫規範字帖（正體楷體）';
  data.blocks.find(b=>b.type==='heading').text='全名連寫練習（李宇晴）';
  data.blocks[0].signature=true;
  const restored=validateProject(data);
  assert.equal(restored.pageTitle,'正體字書寫練習');
  assert.equal(restored.blocks.find(b=>b.type==='heading').text,'連寫練習（李宇晴）');
  assert.equal(restored.blocks[0].signature,true);
  assert.equal(validateProject({...data,pageTitle:'我的自訂姓名字帖'}).pageTitle,'我的自訂姓名字帖');
});

test('空白格保證沒有隱藏字；整數格數及單字行一致',()=>{
  const block=createCharacterBlock('學');
  assert.deepEqual(cellCounts(block),{filled:5,blank:7});
  block.count=0;
  assert(cellsForRow(block).every(cell=>cell.ch===''&&cell.opacity===0));
  block.manual=Array.from({length:12},()=>({ch:'學',opacity:0}));
  assert.deepEqual(cellCounts(block),{filled:0,blank:12});
  const restored=validateProject(createProject('學',[block]));
  assert.deepEqual(cellCounts(restored.blocks[0]),{filled:0,blank:12});
  assert(restored.blocks[0].manual.every(cell=>cell.ch===''&&cell.opacity===0));
  block.manual=Array.from({length:12},()=>({ch:'  ',opacity:1}));
  assert.deepEqual(cellCounts(block),{filled:0,blank:12});
  assert.equal(cellCounts(createPracticeRow('學',6.9)).filled,6);
});

test('來源頁只計算實際使用素材，純空白字帖不受未使用字庫影響',()=>{
  const metadata={'學':{sourceName:'中華民國教育部'}};
  assert.deepEqual(officialCredits(createTemplate('blank','學'),metadata),[]);
  assert.deepEqual(officialCredits([createPracticeRow('學',6)],metadata),['學']);
  assert.deepEqual(officialCredits([createPracticeRow('宇',6)],metadata),[]);
  assert.equal(createPracticeRow().signature,false);
  assert.equal(createCharacterBlock('學').signature,false);
});

test('隱藏全部頁首會釋放實際排版空間，不留下固定抬頭空洞',()=>{
  const rows=Array.from({length:18},()=>createPracticeRow());
  assert.equal(paginate(rows).length,2);
  assert.equal(paginate(rows,()=>0,0).length,1);
});
