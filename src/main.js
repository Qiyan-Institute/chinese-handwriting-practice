/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {
  CELLS_PER_ROW, DEFAULT_TEXT, characters, newId, clamp,
  createPracticeRow, createCharacterBlock, createHeading, createTemplate,
  cellsForRow, cellCounts, charactersInBlocks, officialCredits, documentSettings, createProject, validateProject,
} from './model.js';
import {getStages, getGlyphUrl, safeImageUrl, importStrokeImages, officialLookupUrl, getAssetInfo, fetchOfficialStages} from './stroke-service.js';
import {paginate, moveBlockToPage, PAGE} from './pagination.js';
import {officialEmbedUrl} from './moe.js';
import {DocumentHistory} from './history.js';
import {updateWorksheetText} from './text-update.js';

// 編輯和排版都在本機執行；缺字由本機服務向教育部請求字卡。
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[ch]));

const STORAGE_KEY = 'hanzi-worksheet-studio';
let blocks = [];
let selectedId = null;
let currentGlyph = characters(DEFAULT_TEXT)[0];
let customAssets = {};
let assetMetadata = {};
let pages = [];
let activePage = 0;
let previewPageCount=1;
let officialCharacters = new Set();
let officialIndexStatus = '正在載入官方動畫索引…';
const strokeRequests=new Map();
const strokeErrors=new Map();
let draggingBlockId = null;
let toastTimer;
let appliedText=DEFAULT_TEXT;
let history=null;
let projectEpoch=0;

function showToast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function sourceText() {
  return characters($('sourceText').value).join('');
}

function documentOptions() {
  return documentSettings(Object.fromEntries(['pageTitle','pageLabel','studentName','className','practiceDate','blankStyle',
    'showTitle','showName','showClass','showDate'].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value])));
}

function applyDocumentSettings(project) {
  for(const [id,value] of Object.entries(documentSettings(project))) {
    if($(id).type==='checkbox')$(id).checked=value;else $(id).value=value;
  }
}

function currentProject() {
  return {
    ...createProject($('sourceText').value, blocks, customAssets, assetMetadata),
    ...documentOptions(),
    appliedText,
  };
}

function historyState() {
  return {sourceText:$('sourceText').value,appliedText,blocks,settings:documentOptions(),customAssets,assetMetadata,selectedId,activePage};
}

function updateHistoryControls() {
  $('undoBtn').disabled=!history?.canUndo;
  $('redoBtn').disabled=!history?.canRedo;
}

function saveLocal(group=null,{record=true}={}) {
  if(record)history?.record(historyState(),group);
  updateHistoryControls();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({...currentProject(), selectedId}));
  } catch {
    showToast('本機空間不足，請改用「儲存專案」匯出 JSON。');
  }
}

function restoreHistory(direction) {
  const state=direction==='undo'?history?.undo():history?.redo();
  if(!state)return;
  projectEpoch++;
  blocks=state.blocks;customAssets=state.customAssets;assetMetadata=state.assetMetadata;
  appliedText=state.appliedText;$('sourceText').value=state.sourceText;
  applyDocumentSettings(state.settings);
  selectedId=blocks.some(block=>block.id===state.selectedId)?state.selectedId:blocks[0]?.id;
  activePage=state.activePage||0;strokeErrors.clear();
  saveLocal(null,{record:false});render();
}

function updateTextStatus() {
  const draft=characters($('sourceText').value).join('');
  const pending=draft!==appliedText;
  $('applyText').disabled=!draft||!pending;
  $('textUpdateStatus').textContent=!draft?'請輸入練習文字；目前字帖保持不變。':pending?
    '文字已修改，尚未套用到字帖。可更新現有編排，或到下方重新選擇範本。':'文字已套用。更新會保留灰度、空白格數、分頁及手動編排。';
}

function applyTemplate(kind) {
  const text=characters($('sourceText').value).join('');
  if(!text){showToast('請先輸入練習文字');return;}
  try { blocks = createTemplate(kind, text);appliedText=text; }
  catch(error) { showToast(error.message); return; }
  selectedId = blocks.find(block => block.type === 'practice')?.id || blocks[0]?.id || null;
  saveLocal();
  render();
}

function glyphHtml(ch, opacity = 1) {
  if (!ch) return '';
  const value = clamp(opacity, 0, 1);
  const glyphUrl = safeImageUrl(getGlyphUrl(ch, customAssets));
  const content = glyphUrl
    ? `<img alt="${escapeHtml(ch)}" src="${escapeHtml(glyphUrl)}">`
    : escapeHtml(ch);
  return `<span class="cell-character" style="opacity:${value}">${content}</span>`;
}

function signatureHtml(show) {
  return show ? '<div class="sign">簽核<div class="sign-line"></div></div>' : '';
}

function neededCharacters() {
  return charactersInBlocks(blocks);
}

function practiceHtml(block) {
  const blankStyle=$('blankStyle').value;
  const cells=cellsForRow(block);
  const cellHtml=cells.map((cell,index)=>{
    const blank=!cell.ch;
    return `<div class="grid-bg ${blank&&blankStyle==='space'?'blank-space':''}" data-cell-block="${escapeHtml(block.id)}" data-cell-index="${index}" data-cell-state="${blank?'blank':'filled'}" draggable="${!blank}" title="第 ${index+1} 格：${escapeHtml(cell.ch||'空白')}">${glyphHtml(cell.ch,cell.opacity)}</div>`;
  }).join('');
  return `<div class="practice-line ${block.signature?'':'no-signature'}"><div class="practice-grid">${cellHtml}</div>${signatureHtml(block.signature)}</div>`;
}

function ensureOfficialStrokes() {
  if(!officialCharacters.size)return;
  const missing=neededCharacters().filter(ch=>officialCharacters.has(ch)&&!getStages(ch,customAssets));
  for(const ch of missing) {
    if(strokeRequests.size>=2)break;
    if(strokeRequests.has(ch)||strokeErrors.has(ch))continue;
    const epoch=projectEpoch;
    const request=fetchOfficialStages(ch).then(result=>{
      history?.addOfficialAsset(ch,result.stages,result.metadata);
      if(epoch===projectEpoch&&neededCharacters().includes(ch)&&!getStages(ch,customAssets)) {
        customAssets[ch]=result.stages;
        assetMetadata[ch]=result.metadata;
        saveLocal(null,{record:false});
      }
    }).catch(error=>strokeErrors.set(ch,error.message)).finally(()=>{
      strokeRequests.delete(ch);
      renderSheet();renderAssetInfo();
    });
    strokeRequests.set(ch,request);
  }
  const failed=missing.filter(ch=>strokeErrors.has(ch));
  const waiting=missing.filter(ch=>!strokeErrors.has(ch));
  $('strokeLoadStatus').textContent=waiting.length?`正在載入 ${waiting.length} 個字的逐筆原稿…`:
    failed.length?`「${failed.join('、')}」載入失敗，請重試。`:'字帖中的可用逐筆素材已載入。';
  $('retryStrokes').hidden=!failed.length;
}

function renderBlock({block, height, stageCount}) {
  const selected = block.id === selectedId ? 'selected' : '';
  let content = '';

  if (block.type === 'heading') {
    content = `<div class="section-heading"><strong>${escapeHtml(block.text)}</strong>`+
      `<span class="sub">${escapeHtml(block.sub || '')}</span></div>`;
  }

  if (block.type === 'character') {
    const ch = characters(block.text)[0] || characters(DEFAULT_TEXT)[0];
    const steps = getStages(ch, customAssets);
    const stageHtml = steps?.length
      ? steps.map((uri, index) => {
        const safe = safeImageUrl(uri);
        return `<div><div class="grid-bg stroke-mini">`+
          `<img src="${escapeHtml(safe)}" alt="${escapeHtml(ch)}第${index+1}畫"></div>`+
          `<div class="stagecount">${index+1}</div></div>`;
      }).join('')
      : `<div class="stroke-unavailable">${escapeHtml(strokeErrors.has(ch)?`「${ch}」官方字卡載入失敗，請按左側「重試缺字筆順」。`:
        officialCharacters.has(ch)?`「${ch}」正在載入教育部逐筆原稿…`:
        !officialCharacters.size?'正在核對官方字庫…':`「${ch}」未收錄於官方清單，可自行匯入筆順素材。`)}</div>`;
    content = `<div class="char-caption"><div class="char-head-glyph">${escapeHtml(ch)}</div>`+
      `<strong>${escapeHtml(ch)}</strong><span>逐筆示範 · ${steps?.length ? `${steps.length} 畫` : '待載入原稿'}</span></div>`+
      `<div class="stroke-line"><span class="mini-label">楷體逐筆</span><div class="stroke-cells">${stageHtml}</div></div>`+
      practiceHtml(block);
  }

  if (block.type === 'practice') {
    content = practiceHtml(block);
  }

  return `<section class="block selectable ${selected}" style="height:${height}px;--stroke-height:${PAGE.strokeRow * Math.max(1, Math.ceil(stageCount / PAGE.strokesPerRow))}px" data-block="${escapeHtml(block.id)}"`+
    ` data-block-type="${block.type}" draggable="true">`+
    `<div class="block-toolbar" title="拖曳調整順序">⠿</div>${content}</section>`;
}

function renderSheet() {
  const opts = documentOptions();
  const meta=[opts.showName?`${escapeHtml(opts.pageLabel)}：${escapeHtml(opts.studentName)||'____________'}`:'',
    opts.showClass?`班級：${escapeHtml(opts.className)||'____________'}`:'',
    opts.showDate?`日期：${escapeHtml(opts.practiceDate)||'____________'}`:''].filter(Boolean);
  const hasTitle=opts.showTitle&&opts.pageTitle;
  const headerHeight=(hasTitle?71:0)+(meta.length?24:0);
  const header=headerHeight?`<div class="sheet-header" style="height:${headerHeight}px">${hasTitle?`<div class="sheet-title"><span>${escapeHtml(opts.pageTitle)}</span></div>`:''}${meta.length?`<div class="sheet-meta">${meta.map(text=>`<span>${text}</span>`).join('')}</div>`:''}</div>`:'';
  pages = paginate(blocks, block => getStages(characters(block.text)[0], customAssets)?.length || 0,headerHeight);
  const credits=officialCredits(blocks,assetMetadata);
  previewPageCount=pages.length+(credits.length?1:0);
  activePage = Math.min(activePage, previewPageCount - 1);
  $('sheet').innerHTML = pages.map((page, index) => {
    const footer = `<div class="sheet-footer"><span>第 ${index + 1} / ${pages.length} 頁</span></div>`;
    return `<article class="sheet worksheet-page" id="page-${index + 1}" data-page="${index}" aria-label="第 ${index + 1} 頁">${header}`+
      `<div class="sheet-body">${page.entries.map(renderBlock).join('')}</div>${footer}</article>`;
  }).join('')+(credits.length?`<article class="sheet credits-page" id="page-${previewPageCount}" aria-label="素材來源"><div class="source-body"><h2>素材來源</h2><p>本文件使用 ${credits.length} 個字的官方累積逐筆字卡。</p><dl><dt>著作權人</dt><dd>中華民國教育部</dd><dt>來源</dt><dd>國字標準字體筆順學習網<br><a href="https://stroke-order.learningweb.moe.edu.tw/">https://stroke-order.learningweb.moe.edu.tw/</a></dd><dt>授權</dt><dd>創用 CC 姓名標示－非商業性－禁止改作 3.0 臺灣版<br><a href="https://creativecommons.org/licenses/by-nc-nd/3.0/tw/">https://creativecommons.org/licenses/by-nc-nd/3.0/tw/</a></dd></dl><p>字卡保留官方原始 SVG 檔案內容。</p></div></article>`:'');
  $('pageStatus').textContent = `${pages.length} 頁練習${credits.length?' ＋ 1 頁素材來源':''} · 12 格 / 行`;
  $('pageSelect').innerHTML = Array.from({length:previewPageCount},(_, i) => `<option value="${i}" ${i === activePage ? 'selected' : ''}>${i<pages.length?`第 ${i + 1} 頁`:'素材來源'}</option>`).join('');
  if ($('moveToPage')) {
    const selectedPage=pages.findIndex(page=>page.entries.some(entry=>entry.block.id===selectedId));
    $('moveToPage').innerHTML=pages.map((_,i)=>`<option value="${i}" ${i===selectedPage?'selected':''}>第 ${i+1} 頁</option>`).join('');
  }
  renderPageButtons();
  const signatures=blocks.filter(block=>block.type!=='heading');
  $('allSignatures').checked=signatures.length>0&&signatures.every(block=>block.signature);
  $('allSignatures').indeterminate=signatures.some(block=>block.signature)&&!$('allSignatures').checked;
  updateCellSummary();
  ensureOfficialStrokes();
}

function renderPageButtons() {
  $('previousPage').disabled = activePage === 0;
  $('nextPage').disabled = activePage === previewPageCount - 1;
}

function goToPage(index) {
  activePage = clamp(index, 0, previewPageCount - 1);
  $('pageSelect').value = activePage;
  renderPageButtons();
  $(`page-${activePage + 1}`)?.scrollIntoView({behavior:'smooth', block:'start'});
}

function renderTray() {
  const glyphs = [...new Set(characters($('sourceText').value))].slice(0, 100);
  if (!glyphs.length) glyphs.push(...characters(DEFAULT_TEXT));
  if (!glyphs.includes(currentGlyph)) currentGlyph = glyphs[0];
  $('glyphTray').innerHTML = glyphs.map(ch =>
    `<div class="glyph ${ch === currentGlyph ? 'active' : ''}" data-glyph="${escapeHtml(ch)}"`+
    ` draggable="true" title="將「${escapeHtml(ch)}」拖入米字格">${escapeHtml(ch)}</div>`
  ).join('');
  renderAssetInfo();
}

function renderAssetInfo() {
  const entered = $('importChar').value.trim();
  const ch = characters(entered).length === 1 ? entered : '';
  const info = getAssetInfo(ch, customAssets, assetMetadata);
  $('assetInfo').textContent = info
    ? `「${ch}」：${info.sourceName} · ${info.license}${info.attribution ? ` · ${info.attribution}` : ''}`
    : `「${ch || '？'}」尚無本地筆順素材。`;
  $('officialLookup').href = ch ? officialLookupUrl(ch) : 'https://stroke-order.learningweb.moe.edu.tw/searchW.jsp?ID2=1';
  $('officialLookup').textContent = ch ? `到教育部查「${ch}」↗` : '前往教育部筆順網站 ↗';
  const available = officialEmbedUrl(ch, officialCharacters);
  $('showOfficial').disabled = !available;
  $('officialStatus').textContent = officialCharacters.size
    ? `官方索引 ${officialCharacters.size} 字 · ${available ? `可播放「${ch}」的原始動畫` : `未收錄「${ch || '？'}」的動畫`}` : officialIndexStatus;
}

function bind(id, event, action) {
  $(id)?.addEventListener(event, action);
}

function renderInspector() {
  const block = blocks.find(b => b.id === selectedId);
  if (!block) {
    $('inspector').innerHTML = '<div class="inspector-empty">點選紙張上的區塊，即可調整其內容、描紅及順序。</div>';
    return;
  }
  const typeName = {heading:'分組標題', character:'單字逐筆', practice:'12 格練習行'}[block.type];
  let html = `<div class="inspector-type">${typeName}</div>`+
    `<label class="field">${block.type === 'heading' ? '標題' : block.type === 'character' ? '單字' : '練習文字'}</label>`+
    `<input class="field-input" id="insText" value="${escapeHtml(block.text)}">`+
    `<div class="help">${block.type === 'character' ? '只顯示已取得來源的真正逐筆素材。' :
      block.type === 'practice' ? '文字自動重複排列在 12 個米字格中。' : ''}</div>`;

  if (block.type === 'heading') {
    html += `<label class="field">副標題</label><input class="field-input" id="insSub" value="${escapeHtml(block.sub || '')}">`;
  } else {
    html += `<div class="cell-summary" id="cellSummary" role="status"></div><label class="field">自動填字格數 <span id="countValue">${block.count}</span> / 12</label>`+
      `<input type="range" id="insCount" min="0" max="12" value="${block.count}" class="range">`+
      `<div class="help">空白格內不放文字或字圖；格線樣式可在左側設定。</div>`+
      `<button id="clearRow" class="mini" style="width:100%;margin-top:8px">清空本行 12 格</button>`;
    {
      html += `<label class="field">第一組灰度 <span id="light1Value">${block.light1}%</span></label>`+
        `<input type="range" id="insLight1" min="5" max="90" value="${block.light1}" class="range">`+
        `<label class="field">後續組灰度 <span id="light2Value">${block.light2}%</span></label>`+
        `<input type="range" id="insLight2" min="5" max="90" value="${block.light2}" class="range">`;
      if (block.manual) html += `<div class="warn">此行手動編排過格子。改變描紅格數將清除手動格子。</div>`+
        `<button id="restoreAuto" style="margin-top:8px">恢復自動排字</button>`;
    }
    html += `<div class="switch"><span>顯示簽核欄</span>`+
      `<input id="insSignature" type="checkbox" ${block.signature ? 'checked' : ''}></div>`;
  }
  html += `<div class="inspector-actions"><button id="moveUp">↑ 上移</button>`+
    `<button id="moveDown">↓ 下移</button><button id="duplicate">複製</button></div>`+
    `<button id="removeBlock" class="danger" style="width:100%;margin-top:9px">刪除區塊</button>`;
  const pageIndex = pages.findIndex(page => page.entries.some(entry => entry.block.id === block.id));
  html += `<div class="switch"><label for="insPageBreak">此區塊另起一頁</label><input id="insPageBreak" type="checkbox" ${block.pageBreakBefore ? 'checked' : ''}></div>`+
    `<label class="field" for="moveToPage">移到指定頁的開頭</label><select class="field-input" id="moveToPage">`+
    pages.map((_, index) => `<option value="${index}" ${index === pageIndex ? 'selected' : ''}>第 ${index + 1} 頁</option>`).join('') + '</select>';
  $('inspector').innerHTML = html;
  updateCellSummary();

  bind('insText', 'input', event => {
    block.text = event.target.value;
    if (block.type !== 'heading') block.manual = null;
    saveLocal(`text:${block.id}`); renderSheet();
  });
  bind('insSub', 'input', event => {
    block.sub = event.target.value; saveLocal(`sub:${block.id}`); renderSheet();
  });
  bind('insCount', 'input', event => {
    block.count = Number(event.target.value);
    block.manual = null;
    $('countValue').textContent = block.count;
    saveLocal(`count:${block.id}`); renderSheet();
  });
  for (const [id, field, display] of [
    ['insLight1','light1','light1Value'], ['insLight2','light2','light2Value'],
  ]) {
    bind(id, 'input', event => {
      block[field] = Number(event.target.value);
      block.manual = null;
      $(display).textContent = `${block[field]}%`;
      saveLocal(`${field}:${block.id}`); renderSheet();
    });
  }
  bind('insSignature','change',event => {
    block.signature = event.target.checked; saveLocal(); renderSheet();
  });
  bind('clearRow','click',()=>{
    block.count=0;block.manual=null;
    saveLocal();render();
  });
  bind('restoreAuto','click',() => {
    block.manual = null; saveLocal(); render();
  });
  bind('moveUp','click',() => moveBlock(block.id,-1));
  bind('moveDown','click',() => moveBlock(block.id,1));
  bind('duplicate','click',() => {
    if (blocks.length >= 250) {showToast('單一專案最多 250 個區塊');return;}
    const at = blocks.indexOf(block);
    const duplicated = {...clone(block),id:newId()};
    blocks.splice(at+1,0,duplicated);
    selectedId=duplicated.id; saveLocal(); render();
  });
  bind('removeBlock','click',() => {
    blocks = blocks.filter(b => b.id !== block.id);
    selectedId = blocks[0]?.id || null;
    saveLocal(); render();
  });
  bind('insPageBreak','change',event => {
    block.pageBreakBefore = event.target.checked;
    saveLocal(); render();
  });
  bind('moveToPage','change',event => {
    blocks = moveBlockToPage(blocks, block.id, pages, Number(event.target.value));
    saveLocal(); render();
    goToPage(pages.findIndex(page => page.entries.some(entry => entry.block.id === block.id)));
  });
}

function updateCellSummary() {
  const block=blocks.find(item=>item.id===selectedId);
  if(!$('cellSummary')||!block||block.type==='heading')return;
  const {filled,blank}=cellCounts(block);
  $('cellSummary').textContent=`已填 ${filled} 格 · 空白 ${blank} 格（共 12 格）`;
}

function render() {
  renderTray();
  renderSheet();
  renderInspector();
  updateTextStatus();updateHistoryControls();
}

function addBlock(block) {
  if (blocks.length >= 250) {showToast('單一專案最多 250 個區塊');return;}
  const at = blocks.findIndex(b => b.id === selectedId);
  blocks.splice(at < 0 ? blocks.length : at+1,0,block);
  selectedId=block.id;
  saveLocal(); render();
}

function moveBlock(id, diff) {
  const oldIndex = blocks.findIndex(b => b.id === id);
  const newIndex = oldIndex + diff;
  if (oldIndex < 0 || newIndex < 0 || newIndex >= blocks.length) return;
  [blocks[oldIndex],blocks[newIndex]] = [blocks[newIndex],blocks[oldIndex]];
  selectedId=id; saveLocal(); render();
}

function setCell(rowId, index, ch, source=null) {
  const target = blocks.find(b => b.id === rowId);
  if (!target || target.type === 'heading' || index < 0 || index >= CELLS_PER_ROW) return;
  const cells = cellsForRow(target);
  if (source) {
    const sourceBlock = blocks.find(b => b.id === source.id && b.type !== 'heading');
    if (sourceBlock && source.index >= 0 && source.index < CELLS_PER_ROW) {
      const sourceCells = sourceBlock.id === rowId ? cells : cellsForRow(sourceBlock);
      const moved = sourceCells[source.index];
      sourceCells[source.index] = {ch:'',opacity:0};
      if (sourceBlock.id !== rowId) sourceBlock.manual = sourceCells;
      cells[index] = {ch:moved.ch,opacity:moved.opacity};
    }
  } else {
    const single=characters(ch)[0]||'';
    cells[index] = {ch:single,opacity:single ? clamp(target.light1,0,100)/100 : 0};
  }
  target.manual = cells;
  selectedId=rowId; saveLocal(); render();
}

function downloadJson(value, filename) {
  const data=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(data);
  const link=document.createElement('a');
  link.href=url; link.download=filename; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}

// ---- 操作和拖放事件 ----
$('sourceText').addEventListener('input',()=> {renderTray();updateTextStatus();saveLocal('sourceText');});
for(const id of ['pageTitle','pageLabel','studentName','className','practiceDate']) bind(id,'input',()=> {renderSheet();saveLocal(id);});
bind('applyText','click',()=>{
  try {
    const result=updateWorksheetText(blocks,appliedText,$('sourceText').value);
    blocks=result.blocks;appliedText=result.text;
    selectedId=blocks.some(block=>block.id===selectedId)?selectedId:blocks[0]?.id;
    saveLocal();render();
    showToast(`已更新 ${result.updated} 個區塊${result.added?`，新增 ${result.added} 個生字`:''}${result.removed?`，移除 ${result.removed} 個生字`:''}${result.preservedManual?`；保留 ${result.preservedManual} 行手動編排`:''}`);
  } catch(error){showToast(error.message);}
});
bind('undoBtn','click',()=>restoreHistory('undo'));
bind('redoBtn','click',()=>restoreHistory('redo'));
document.addEventListener('focusout',()=>history?.endGroup());
document.addEventListener('keydown',event=>{
  if(event.isComposing||!(event.metaKey||event.ctrlKey)||event.altKey||$('officialDialog').open)return;
  const target=event.target;
  if(target.closest('textarea,input:not([type="range"]):not([type="checkbox"]),[contenteditable="true"]'))return;
  const key=event.key.toLowerCase();
  if(key==='z'||(key==='y'&&event.ctrlKey)) {
    event.preventDefault();restoreHistory(key==='y'||event.shiftKey?'redo':'undo');
  }
});
for(const id of ['showTitle','showName','showClass','showDate','blankStyle']) bind(id,'change',()=>{renderSheet();saveLocal();});
bind('allSignatures','change',event=>{for(const block of blocks)if(block.type!=='heading')block.signature=event.target.checked;saveLocal();render();});
bind('cleanLayout','click',()=>{
  for(const id of ['showName','showClass','showDate'])$(id).checked=false;
  for(const block of blocks)if(block.type!=='heading')block.signature=false;
  saveLocal();render();
});

$('glyphTray').addEventListener('click',event => {
  const glyph=event.target.closest('[data-glyph]');
  if (!glyph) return;
  currentGlyph=glyph.dataset.glyph;
  $('cellMode').value='fill';
  $('importChar').value=currentGlyph;
  renderTray();
});
$('glyphTray').addEventListener('dragstart',event => {
  const glyph=event.target.closest('[data-glyph]');
  if(!glyph) return;
  currentGlyph=glyph.dataset.glyph;
  event.dataTransfer.setData('text/plain',currentGlyph);
  event.dataTransfer.effectAllowed='copy';
});

$('sheet').addEventListener('click',event => {
  const page=event.target.closest('[data-page]');
  if(page) activePage=Number(page.dataset.page);
  const cell=event.target.closest('[data-cell-block]');
  if(cell) {
    const mode=$('cellMode').value;
    if(event.shiftKey||mode==='erase')setCell(cell.dataset.cellBlock,Number(cell.dataset.cellIndex),'');
    else if(mode==='fill')setCell(cell.dataset.cellBlock,Number(cell.dataset.cellIndex),currentGlyph);
    else {selectedId=cell.dataset.cellBlock;renderSheet();renderInspector();}
    return;
  }
  const node=event.target.closest('[data-block]');
  if(node) {
    selectedId=node.dataset.block;
    renderSheet();renderInspector();
  }
});
$('sheet').addEventListener('dragstart',event => {
  const cell=event.target.closest('[data-cell-block]');
  if(cell) {
    event.stopPropagation();
    const detail={id:cell.dataset.cellBlock,index:Number(cell.dataset.cellIndex)};
    event.dataTransfer.setData('application/x-hanzi-cell',JSON.stringify(detail));
    const block=blocks.find(b => b.id === detail.id);
    event.dataTransfer.setData('text/plain',cellsForRow(block)[detail.index].ch);
    event.dataTransfer.effectAllowed='move';
    return;
  }
  const node=event.target.closest('[data-block]');
  if(node) {
    draggingBlockId=node.dataset.block;
    event.dataTransfer.setData('application/x-hanzi-block',draggingBlockId);
    event.dataTransfer.effectAllowed='move';
    node.classList.add('dragging');
  }
});
$('sheet').addEventListener('dragover',event => {
  if (draggingBlockId) {
    event.preventDefault();
    event.dataTransfer.dropEffect='move';
    event.target.closest('[data-block]')?.classList.add('drag-over');
    return;
  }
  const cell=event.target.closest('[data-cell-block]');
  if(cell) {event.preventDefault(); event.dataTransfer.dropEffect='copy';return;}
  const node=event.target.closest('[data-block]');
  if(node && draggingBlockId) {event.preventDefault();node.classList.add('drag-over');}
});
$('sheet').addEventListener('dragleave',event => {
  const node=event.target.closest('[data-block]');
  node?.classList.remove('drag-over');
});
$('sheet').addEventListener('drop',event => {
  if (draggingBlockId) {
    event.preventDefault();
    const node=event.target.closest('[data-block]');
    const page=event.target.closest('[data-page]');
    const from=blocks.findIndex(b => b.id === draggingBlockId);
    if (node && node.dataset.block !== draggingBlockId) {
      const target=blocks.find(b => b.id === node.dataset.block);
      const item=blocks.splice(from,1)[0];
      item.pageBreakBefore=item.pageBreakBefore || target.pageBreakBefore === true;
      target.pageBreakBefore=false;
      blocks.splice(blocks.indexOf(target),0,item);
    } else if (!node && page) {
      blocks=moveBlockToPage(blocks,draggingBlockId,pages,Number(page.dataset.page));
    }
    selectedId=draggingBlockId;
    draggingBlockId=null;
    saveLocal();render();return;
  }
  const cell=event.target.closest('[data-cell-block]');
  if(cell) {
    event.preventDefault(); event.stopPropagation();
    let source=null;
    try {source=JSON.parse(event.dataTransfer.getData('application/x-hanzi-cell'));} catch {}
    const glyph=event.dataTransfer.getData('text/plain') || currentGlyph;
    setCell(cell.dataset.cellBlock,Number(cell.dataset.cellIndex),glyph,source);
    draggingBlockId=null;
    return;
  }
});
$('sheet').addEventListener('dragend',() => {
  draggingBlockId=null;
  document.querySelectorAll('.dragging,.drag-over').forEach(e => e.classList.remove('dragging','drag-over'));
});

bind('addTextRow','click',()=>{if(!sourceText()){showToast('請先輸入練習文字');return;}addBlock(createPracticeRow(sourceText(),6));});
bind('addBlankRow','click',()=>addBlock(createPracticeRow(sourceText(),0)));
bind('addHeading','click',()=>addBlock(createHeading('自訂練習主題')));
bind('addCharPractice','click',()=> {
  const letters=characters(sourceText());
  if(!letters.length){showToast('請先輸入練習文字');return;}
  if (blocks.length + letters.length + 1 > 250) {showToast('單一專案最多 250 個區塊，請減少文字或另存專案');return;}
  const at=blocks.findIndex(b => b.id === selectedId);
  const newBlocks=[createHeading('新增單字練習'),...letters.map(createCharacterBlock)];
  blocks.splice(at < 0 ? blocks.length : at+1,0,...newBlocks);
  selectedId=newBlocks[1]?.id;
  saveLocal();render();showToast(`已加入 ${letters.length} 個單字區塊`);
});

for (const [id,template] of [
  ['templateV1','v1'], ['templateV2','v2'], ['templateWord','word'], ['templateBlank','blank'],
]) {
  bind(id,'click',()=> {
    if (confirm('重新套用範本會重建區塊、灰度與手動字格；頁首設定保留。完成後可按「撤銷」恢復。是否繼續？')) {
      applyTemplate(template);
    }
  });
}

bind('downloadProject','click',()=> {
  const suffix=sourceText().slice(0,12).replace(/[\\/:*?"<>|]/g,'') || '未命名';
  downloadJson(currentProject(),`字帖專案_${suffix}.json`);
  showToast('JSON 專案已匯出');
});
bind('loadBtn','click',()=>$('loadJson').click());
bind('loadJson','change',async event=> {
  const file=event.target.files?.[0];
  if(!file) return;
  try {
    if(file.size > 40*1024*1024) throw new Error('專案檔案過大');
    const project=validateProject(JSON.parse(await file.text()));
    projectEpoch++;
    blocks=project.blocks;
    customAssets=project.customAssets;
    assetMetadata=project.assetMetadata;
    $('sourceText').value=project.sourceText;
    appliedText=project.appliedText;
    applyDocumentSettings(project);
    activePage=0;
    selectedId=blocks[0]?.id || null;
    saveLocal();render();showToast('已載入字帖專案');
  } catch (error) {showToast(`讀取失敗：${error.message}`);}
  event.target.value='';
});
bind('retryStrokes','click',()=>{strokeErrors.clear();renderSheet();});
bind('printBtn','click',async()=>{
  const button=$('printBtn');
  const label=button.textContent;
  button.disabled=true;button.textContent='正在準備筆順及圖片…';
  try {
    await officialIndexReady;
    if(!officialCharacters.size&&neededCharacters().some(ch=>!getStages(ch,customAssets)))throw new Error('官方字庫索引載入失敗，請重新整理後再列印。');
    ensureOfficialStrokes();
    while(strokeRequests.size)await Promise.all([...strokeRequests.values()]);
    const missing=neededCharacters().filter(ch=>officialCharacters.has(ch)&&!getStages(ch,customAssets));
    if(missing.length)throw new Error(`「${missing.join('、')}」筆順尚未載入，請先重試缺字筆順。`);
    await Promise.all([...document.querySelectorAll('.sheet img')].map(image=>image.decode()));
    window.print();
  } catch(error){showToast(error.message);}
  finally{button.disabled=false;button.textContent=label;}
});
bind('previousPage','click',()=>goToPage(activePage-1));
bind('nextPage','click',()=>goToPage(activePage+1));
bind('pageSelect','change',event=>goToPage(Number(event.target.value)));
bind('importChar','input',renderAssetInfo);
bind('showOfficial','click',()=> {
  const ch=$('importChar').value.trim();
  const url=officialEmbedUrl(ch,officialCharacters);
  if (!url) return;
  $('officialDialogTitle').textContent=`「${ch}」教育部標準筆順`;
  $('officialFrame').title=`教育部「${ch}」原始筆順動畫`;
  $('officialFrame').src=url;
  $('officialDialog').showModal();
});
bind('closeOfficial','click',()=>$('officialDialog').close());
bind('officialDialog','close',()=>$('officialFrame').removeAttribute('src'));
bind('importStages','click',async()=> {
  const ch=$('importChar').value.trim();
  try {
    if (!$('rightsConfirmed').checked) throw new Error('請先確認有權使用這批素材');
    const sourceName=$('assetSource').value.trim();
    const license=$('assetLicense').value.trim();
    if (!sourceName || !license) throw new Error('請填寫素材來源及適用授權／許可');
    const epoch=projectEpoch;
    const stages=await importStrokeImages(ch, $('stageFiles').files);
    if(epoch!==projectEpoch)throw new Error('編輯狀態已改變，請重新匯入素材');
    customAssets[ch]=stages;
    assetMetadata[ch]={sourceName, sourceUrl:$('assetSourceUrl').value.trim(), license,
      attribution:$('assetAttribution').value.trim(), changes:'使用者匯入累積逐筆圖片；未驗證筆順', acquiredAt:new Date().toISOString()};
    saveLocal();render();
    showToast(`已載入「${ch}」的 ${stages.length} 張逐筆圖；請自行核對來源及順序`);
  } catch(error) {showToast(error.message);}
});

// 啟動：先讀本機資料，不存在則載入「半行描紅」範本。
try {
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if(saved && Array.isArray(saved.blocks)) {
    const project=validateProject(saved);
    blocks=project.blocks;
    customAssets=project.customAssets;
    assetMetadata=project.assetMetadata;
    $('sourceText').value=project.sourceText;
    appliedText=project.appliedText;
    applyDocumentSettings(project);
    selectedId=blocks.some(b => b.id === saved.selectedId) ? saved.selectedId : blocks[0]?.id;
    render();
  } else {
    applyTemplate('v2');
  }
} catch (error) {
  console.warn('無法讀取之前的專案，改用預設範本。',error);
  applyTemplate('v2');
}

history=new DocumentHistory(historyState());
updateHistoryControls();updateTextStatus();

const officialIndexReady=fetch('./assets/moe-index.json').then(response => {
  if (!response.ok) throw new Error('索引讀取失敗');
  return response.json();
}).then(index => {
  if (!Array.isArray(index.characters)) throw new Error('索引格式錯誤');
  officialCharacters = new Set(index.characters.filter(ch => typeof ch === 'string' && Array.from(ch).length === 1));
  renderSheet();renderAssetInfo();
}).catch(() => {
  officialIndexStatus='官方動畫索引無法載入，仍可使用官網查詢連結及離線編輯。';
  renderAssetInfo();
});
