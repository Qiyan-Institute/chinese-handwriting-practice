/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
/**
 * 版型與文字資料模型。純函式，不讀寫 DOM，方便測試、替換 UI。
 */
import {getPaperSize} from './paper.js';
import {PHONETIC_SYMBOLS,PHONETIC_TEXT} from './phonetic.js?v=0.6.0';
import {getGridStyle} from './grid-style.js?v=0.5.6';

export const CELLS_PER_ROW = 12;
export const MAX_CELLS_PER_GROUP = 16;
export const FORMAT = 'hanzi-worksheet-studio-v2';
export const DEFAULT_TEXT = '孫中山';
export const DEFAULT_TITLE = '正體字書寫練習';

export function documentSettings(data={}) {
  const legacyTitle='姓名描寫規範字帖（正體楷體）';
  return {
    paperSize:getPaperSize(data.paperSize).id,
    gridSize:getGridStyle(data.gridSize).id,
    pageTitle:data.pageTitle===legacyTitle?DEFAULT_TITLE:String(data.pageTitle??DEFAULT_TITLE).slice(0,120),
    showTitle:data.showTitle!==false,
    showName:data.showName===true,showClass:data.showClass===true,showDate:data.showDate===true,
    pageLabel:String(data.pageLabel??'姓名').slice(0,40),
    studentName:String(data.studentName??'').slice(0,80),
    className:String(data.className??'').slice(0,80),
    practiceDate:String(data.practiceDate??'').slice(0,40),
    blankStyle:data.blankStyle==='space'?'space':'grid',
  };
}

export function characters(text) {
  // Array.from 可正確處理代理對 (surrogate pairs)。保留中文標點，排除空白。
  return Array.from(String(text ?? '')).filter(ch => !/\s/u.test(ch));
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

export function createPracticeRow(text = DEFAULT_TEXT, count = 6, gridSize = 'standard') {
  return {
    id: newId(), type: 'practice', text: text || DEFAULT_TEXT,
    count: Math.trunc(clamp(count, 0, getGridStyle(gridSize).capacity)),
    light1: 27, light2: 16,
    signature: false, label: '', manual: null,
  };
}

export function createCharacterBlock(ch) {
  return {
    id: newId(), type: 'character', text: ch,
    count: 5, light1: 32, light2: 18,
    signature: false, label: '',
  };
}

export function createHeading(text) {
  return { id: newId(), type: 'heading', text, sub: '可自訂描紅及空白格比例' };
}

export function createTemplate(kind, input = DEFAULT_TEXT, gridSize = 'standard') {
  const text = kind==='phonetic'?PHONETIC_TEXT:characters(input).join('') || DEFAULT_TEXT;
  const glyphs = characters(text);
  const capacity=getGridStyle(gridSize).capacity;
  if (glyphs.length > 240) throw new Error('單次範本最多 240 字，請拆成多個專案');
  if (kind === 'phonetic') {
    return [
      {...createHeading('注音符號全套（37音）'),sub:'依教育部注音順序 · 逐筆、描紅與空白練習'},
      ...PHONETIC_SYMBOLS.map(ch=>({...createCharacterBlock(ch),count:capacity/2})),
    ];
  }
  if (kind === 'blank') {
    return [createHeading('自由書寫練習'), ...Array.from({length: 12}, () => createPracticeRow(text, 0))];
  }
  if (kind === 'word') {
    return [
      createHeading('生字逐筆與書寫'),
      ...glyphs.map(createCharacterBlock),
      createHeading('詞語連寫練習'),
      ...Array.from({length: 4}, (_, i) => createPracticeRow(text, i < 2 ? capacity/2 : capacity/4, gridSize)),
    ];
  }
  if (kind === 'v1' || kind === 'v2') {
    const rows = Array.from({length: 9}, (_, i) => {
      const row = createPracticeRow(text, kind === 'v1' ? capacity : capacity/2, gridSize);
      // 全描紅版：首兩行略深，後七行稍淺。第二版：一律半行淡灰。
      row.light1 = kind === 'v1' && i < 2 ? 34 : 26;
      row.light2 = kind === 'v1' && i < 2 ? 18 : 15;
      return row;
    });
    return [
      ...glyphs.map(createCharacterBlock),
      createHeading(`連寫練習（${text}）`),
      ...rows,
    ];
  }
  throw new Error(`未知範本：${kind}`);
}

function normalizeCell(cell) {
  const ch=characters(cell?.ch)[0]||'';
  const opacity=clamp(cell?.opacity,0,1);
  return ch&&opacity>0?{ch,opacity}:{ch:'',opacity:0};
}

export function cellsForRow(block, gridSize = 'standard') {
  const capacity=getGridStyle(gridSize).capacity;
  if (Array.isArray(block.manual) && [CELLS_PER_ROW,MAX_CELLS_PER_GROUP].includes(block.manual.length)) {
    // Legacy 12-cell layouts gain four empty cells. Keep stored 16-cell layouts
    // intact when another preset displays only their first twelve cells.
    return Array.from({length:capacity},(_,index)=>normalizeCell(block.manual[index]));
  }
  const chars = block.type==='character'?characters(block.text).slice(0,1):characters(block.text);
  const count = Math.trunc(clamp(block.count, 0, capacity));
  return Array.from({length: capacity}, (_, index) => {
    if (index >= count || !chars.length) return {ch:'', opacity:0};
    const ch = chars[index % chars.length];
    const opacity = block.type==='character'&&index===0?1:
      (index < (block.type==='character'?2:chars.length) ? clamp(block.light1, 0, 100) : clamp(block.light2, 0, 100)) / 100;
    return opacity>0?{ch,opacity}:{ch:'',opacity:0};
  });
}

export function cellCounts(block, gridSize = 'standard') {
  const cells=cellsForRow(block,gridSize);
  const filled=cells.filter(cell=>cell.ch&&cell.opacity>0).length;
  return {filled,blank:cells.length-filled};
}

export function charactersInBlocks(blocks, gridSize = 'standard') {
  return [...new Set(blocks.flatMap(block=>block.type==='heading'?[]:
    [...(block.type==='character'?characters(block.text).slice(0,1):[]),
      ...cellsForRow(block,gridSize).flatMap(cell=>characters(cell.ch))]))];
}

export function officialCredits(blocks,metadata={},gridSize='standard') {
  return charactersInBlocks(blocks,gridSize).filter(ch=>metadata[ch]?.sourceName==='中華民國教育部');
}

export function createProject(sourceText, blocks, customAssets = {}, assetMetadata = {}) {
  return {
    format: FORMAT,
    updatedAt: new Date().toISOString(),
    sourceText,
    blocks,
    customAssets,
    assetMetadata,
  };
}

export function validateProject(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.blocks)) throw new Error('不是有效的字帖專案');
  if (data.blocks.length > 250) throw new Error('單一專案最多 250 個區塊');
  const valid = new Set(['heading','character','practice']);
  const ids = new Set();
  const blocks = data.blocks.map((block, i) => {
    if (!block || typeof block !== 'object' || !valid.has(block.type)) throw new Error(`區塊 ${i+1} 格式錯誤`);
    const b = {...block};
    b.id = (typeof b.id === 'string' && b.id.length < 120) ? b.id : newId();
    if (ids.has(b.id)) b.id = newId();
    ids.add(b.id);
    b.text = String(b.text ?? '').slice(0, 500);
    if(b.type==='heading')b.text=b.text.replace(/^全名連寫練習（/,'連寫練習（');
    b.sub = String(b.sub ?? '').slice(0, 160);
    b.pageBreakBefore = b.pageBreakBefore === true;
    b.signature = b.signature !== false;
    if (b.type === 'practice' || b.type === 'character') {
      b.count = Math.trunc(clamp(b.count, 0, MAX_CELLS_PER_GROUP));
      b.light1 = clamp(b.light1 ?? 27, 0, 100);
      b.light2 = clamp(b.light2 ?? 16, 0, 100);
      if (b.manual) {
        if (!Array.isArray(b.manual) || ![CELLS_PER_ROW,MAX_CELLS_PER_GROUP].includes(b.manual.length)) throw new Error('手工字格數量應為 12 或 16');
        b.manual = b.manual.map(normalizeCell);
      }
    }
    return b;
  });
  const customAssets = data.customAssets ?? data.assets ?? {};
  if (typeof customAssets !== 'object' || Array.isArray(customAssets) || !customAssets) throw new Error('字形資料格式錯誤');
  for (const [character, steps] of Object.entries(customAssets)) {
    if (characters(character).length !== 1 || !Array.isArray(steps) || !steps.length || steps.length > 64) throw new Error('逐筆資料格式錯誤');
    for (const uri of steps) {
      if (typeof uri !== 'string' || !(/^(data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2})$/.test(uri) || /^\.\/assets\/strokes\/[a-f0-9]+\/\d+\.png$/.test(uri))) {
        throw new Error('只接受 PNG/SVG 圖片資料或內建字形路徑');
      }
    }
  }
  const assetMetadata = {};
  if (data.assetMetadata != null && (typeof data.assetMetadata !== 'object' || Array.isArray(data.assetMetadata))) throw new Error('素材來源紀錄格式錯誤');
  for (const [ch, metadata] of Object.entries(data.assetMetadata || {})) {
    if (!Object.hasOwn(customAssets, ch) || !metadata || typeof metadata !== 'object') continue;
    assetMetadata[ch] = {};
    for (const key of ['sourceName', 'sourceUrl', 'license', 'attribution', 'acquiredAt', 'changes']) {
      assetMetadata[ch][key] = String(metadata[key] ?? '').slice(0, 1000);
    }
  }
  return {
    format: FORMAT,
    sourceText: String(data.sourceText ?? DEFAULT_TEXT).slice(0, 500),
    appliedText:characters(data.appliedText??data.sourceText??DEFAULT_TEXT).join('').slice(0,500),
    blocks,
    customAssets,
    assetMetadata,
    ...documentSettings(data),
  };
}
