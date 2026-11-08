/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseOfficialIndex, officialEmbedUrl} from '../src/moe.js';
import {officialLookupUrl, getAssetInfo, safeImageUrl, strokeApiUrl} from '../src/stroke-service.js';
import {createProject, validateProject, createPracticeRow} from '../src/model.js';

test('官方 6063 字索引可查標準動畫；未知字不編造網址', async () => {
  const index = JSON.parse(await readFile(new URL('../assets/moe-index.json', import.meta.url)));
  const supported = new Set(index.characters);
  assert.equal(supported.size, 6063);
  assert.equal(officialEmbedUrl('學', supported), 'https://stroke-order.learningweb.moe.edu.tw/dictFrame.jsp?ID=23416');
  assert.equal(officialEmbedUrl('🙂', supported), null);
  assert.equal(officialEmbedUrl('學習', supported), null);
  assert(officialLookupUrl('學').endsWith('WORD=%E5%AD%B8'));
});

test('官方清單格式或來源變更時停止更新', () => {
  const header = '\uFEFF序號,uniocde(10進位制) ,國字,iframe網址\r\n';
  const row = "1,19968,一,<iframe src='https://stroke-order.learningweb.moe.edu.tw/dictFrame.jsp?ID=19968' frameborder=0></iframe>\r\n";
  assert.deepEqual(parseOfficialIndex(header + row), ['一']);
  assert.throws(() => parseOfficialIndex(header + row.replace('ID=19968','ID=19969')));
  assert.throws(() => parseOfficialIndex(header + row.replace('https://stroke-order.learningweb.moe.edu.tw','https://example.com')));
});

test('素材來源、授權與署名隨專案儲存，舊檔仍可載入', () => {
  const assets = {'學':['data:image/png;base64,aGVsbG8=']};
  const metadata = {'學':{sourceName:'自行繪製', license:'個人練習', attribution:'測試作者', sourceUrl:'https://example.com', acquiredAt:'2026-11-06', changes:'無'}};
  const project = {...createProject('學',[createPracticeRow('學')],assets,metadata), pageTitle:'課文', pageLabel:'學生'};
  const restored = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.assetMetadata, metadata);
  assert.equal(restored.pageTitle, '課文');
  assert.equal(getAssetInfo('學', assets, metadata).sourceName, '自行繪製');
  assert.match(getAssetInfo('學',assets).license,/未記錄/);
  assert.equal(getAssetInfo('不存在'),null);
});

test('拒絕危險圖片網址並修復重複區塊 ID', () => {
  assert.equal(safeImageUrl('./assets/strokes/../other.png'), '');
  assert.equal(safeImageUrl('data:image/png;base64,xxx" onerror="alert(1)'), '');
  const block = createPracticeRow();
  const project = validateProject(createProject('學', [block, {...block}]));
  assert.notEqual(project.blocks[0].id,project.blocks[1].id);
  assert.throws(() => validateProject({blocks:[],customAssets:{'學':[]}}));
});

test('筆順地址支援 Pages 後端及原有同源模式，單字有正確編碼',()=>{
  assert.equal(strokeApiUrl('孫',''),'/api/moe/strokes?character=%E5%AD%AB');
  assert.equal(strokeApiUrl('孫','https://api.example.test/'),'https://api.example.test/api/moe/strokes?character=%E5%AD%AB');
  assert.throws(()=>strokeApiUrl('孫中山',''));
});
