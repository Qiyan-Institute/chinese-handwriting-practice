/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {getPaperSize} from './paper.js';
import {getGridStyle} from './grid-style.js?v=0.5.6';
// Keep A4 defaults for existing callers; selected paper controls the page height.
export const PAGE = Object.freeze({
  width:getPaperSize('a4').width, height:getPaperSize('a4').height,
  paddingTop: 23, paddingBottom: 19, header: 98, headerGap: 8, footer: 28,
  practice: 54, heading: 40, characterBase: 86, strokeRow: 48, strokesPerRow: 16,
});
export const CONTENT_HEIGHT = PAGE.height - PAGE.paddingTop - PAGE.paddingBottom - PAGE.header - PAGE.headerGap - PAGE.footer;

export function blockHeight(block, stageCount = 0, gridSize = 'standard') {
  const practiceHeight=getGridStyle(gridSize).practiceHeight;
  if (block.type === 'heading') return PAGE.heading;
  if (block.type === 'practice') return practiceHeight;
  if (block.type === 'character') return PAGE.characterBase + practiceHeight - PAGE.practice + PAGE.strokeRow * Math.max(1, Math.ceil(stageCount / PAGE.strokesPerRow));
  throw new Error(`無法排版的區塊：${block.type}`);
}

export function paginate(blocks, getStageCount = () => 0, headerHeight = PAGE.header, paperSize = 'a4', gridSize = 'standard') {
  const paper=getPaperSize(paperSize);
  const available=paper.height-PAGE.paddingTop-PAGE.paddingBottom-headerHeight-(headerHeight?PAGE.headerGap:0)-PAGE.footer;
  const pages = [];
  let page = { entries: [], used: 0 };
  const flush = () => { if (page.entries.length) pages.push(page); page = { entries: [], used: 0 }; };
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const count = getStageCount(block);
    const height = blockHeight(block, count, gridSize);
    if (height > available) throw new Error(`單一區塊超過 ${paper.label} 可用高度`);
    // Keep a heading with its following block whenever that pair fits on a page.
    const next = blocks[index + 1];
    const pair = block.type === 'heading' && next && !next.pageBreakBefore
      ? height + blockHeight(next, getStageCount(next), gridSize) : height;
    if (block.pageBreakBefore || page.used + height > available ||
        (pair <= available && page.used + pair > available)) flush();
    page.entries.push({ block, height, stageCount: count });
    page.used += height;
  }
  flush();
  return pages.length ? pages : [{ entries: [], used: 0 }];
}

export function moveBlockToPage(blocks, id, pages, targetIndex) {
  const block = blocks.find(item => item.id === id);
  const target = pages[targetIndex];
  if (!block || !target || target.entries.some(entry => entry.block.id === id)) return blocks;
  const reordered = blocks.filter(item => item.id !== id);
  const first = target.entries[0]?.block;
  const at = first ? reordered.findIndex(item => item.id === first.id) : reordered.length;
  // Transfer a forced page boundary to the new first block.
  block.pageBreakBefore = targetIndex > 0;
  if (first?.pageBreakBefore) first.pageBreakBefore = false;
  reordered.splice(at, 0, block);
  return reordered;
}
