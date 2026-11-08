/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {getPaperSize} from './paper.js';
import {getGridStyle} from './grid-style.js?v=0.6.2';
import {gridForBlock} from './model.js?v=0.6.2';
// Keep A4 defaults for existing callers; selected paper controls the page height.
export const PAGE = Object.freeze({
  width:getPaperSize('a4').width, height:getPaperSize('a4').height,
  paddingTop: 23, paddingBottom: 19, header: 98, headerGap: 8, footer: 28,
  practice: 54, heading: 40, characterBase: 86, strokeRow: 48, strokesPerRow: 16,
});
export const CONTENT_HEIGHT = PAGE.height - PAGE.paddingTop - PAGE.paddingBottom - PAGE.header - PAGE.headerGap - PAGE.footer;

function overhead(block,stageCount,continuation=false) {
  return block.type==='character' ? PAGE.characterBase-PAGE.practice+
    (continuation?0:PAGE.strokeRow*Math.max(1,Math.ceil(stageCount/PAGE.strokesPerRow))) : 0;
}

export function blockHeight(block, stageCount = 0, gridSize = 'standard') {
  if (block.type === 'heading') return PAGE.heading;
  if (['practice','symbol-grid','character'].includes(block.type))return gridForBlock(block,gridSize).practiceHeight+overhead(block,stageCount);
  throw new Error(`無法排版的區塊：${block.type}`);
}

export function paginate(blocks, getStageCount = () => 0, headerHeight = PAGE.header, paperSize = 'a4', gridSize = 'standard') {
  const paper=getPaperSize(paperSize);
  const available=paper.height-PAGE.paddingTop-PAGE.paddingBottom-headerHeight-(headerHeight?PAGE.headerGap:0)-PAGE.footer;
  const pages=[];
  let page={entries:[],used:0};
  const flush=()=>{if(page.entries.length)pages.push(page);page={entries:[],used:0};};
  for(let index=0;index<blocks.length;index++) {
    const block=blocks[index],count=getStageCount(block),height=blockHeight(block,count,gridSize);
    const next=blocks[index+1];
    let pair=height;
    if(block.type==='heading'&&next&&!next.pageBreakBefore) {
      const nextCount=getStageCount(next),nextHeight=blockHeight(next,nextCount,gridSize);
      const minimum=nextHeight>available&&next.type!=='heading'?
        Math.ceil(gridForBlock(next,gridSize).cellSize)+4+overhead(next,nextCount):nextHeight;
      pair+=minimum;
    }
    if(block.pageBreakBefore)flush();
    if(height>available&&block.type!=='heading') {
      // Split on complete grid rows. Cell indices remain global to the block.
      const grid=gridForBlock(block,gridSize);
      let cellStart=0;
      while(cellStart<grid.capacity) {
        const continuation=cellStart>0,extra=overhead(block,count,continuation);
        const fittingRows=Math.floor((available-page.used-extra-4)/grid.cellSize);
        if(fittingRows<1) {
          if(!page.entries.length)throw new Error('單一字格與筆順超過紙張可用高度');
          flush();continue;
        }
        const gridRows=Math.min(fittingRows,(grid.capacity-cellStart)/grid.columns);
        const cellEnd=cellStart+gridRows*grid.columns;
        const segmentHeight=Math.ceil(gridRows*grid.cellSize)+4+extra;
        page.entries.push({block,height:segmentHeight,stageCount:count,cellStart,cellEnd,gridRows,continuation});
        page.used+=segmentHeight;cellStart=cellEnd;
        if(cellStart<grid.capacity)flush();
      }
      continue;
    }
    if(page.used+height>available||(pair<=available&&page.used+pair>available))flush();
    page.entries.push({block,height,stageCount:count});page.used+=height;
  }
  flush();
  return pages.length?pages:[{entries:[],used:0}];
}

export function moveBlockToPage(blocks, id, pages, targetIndex) {
  const block = blocks.find(item => item.id === id);
  const target = pages[targetIndex];
  if (!block || !target || target.entries[0]?.continuation || target.entries.some(entry => entry.block.id === id)) return blocks;
  const reordered = blocks.filter(item => item.id !== id);
  const first = target.entries[0]?.block;
  const at = first ? reordered.findIndex(item => item.id === first.id) : reordered.length;
  // Transfer a forced page boundary to the new first block.
  block.pageBreakBefore = targetIndex > 0;
  if (first?.pageBreakBefore) first.pageBreakBefore = false;
  reordered.splice(at, 0, block);
  return reordered;
}
