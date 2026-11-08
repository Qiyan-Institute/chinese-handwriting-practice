/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Each preset fills whole rows. Medium has 16 cells; other presets retain 12.
const style = (id, label, columns, lineHeight, practiceHeight, fontSize, capacity=12) => Object.freeze({
  id, label, columns, capacity, rows:Math.ceil(capacity / columns), lineHeight, practiceHeight, fontSize,
  cellSize:610 / columns, gridHeight:610 / columns * Math.ceil(capacity / columns),
});
export const GRID_STYLES = Object.freeze({
  standard:style('standard', '標準字格', 12, 52, 54, 38),
  medium:style('medium', '中型字格', 8, 155, 157, 57, 16),
  large:style('large', '幼兒大格', 6, 206, 208, 76),
});
export const getGridStyle = value => GRID_STYLES[value === 'medium' || value === 'large' ? value : 'standard'];

export const MAX_SYMBOL_CELLS = 48;
export const MAX_GRID_CELLS = 240;
export function getSizedGridStyle(cellCount, gridSize) {
  const grid=getGridStyle(gridSize);
  const count=Math.max(1,Math.min(MAX_GRID_CELLS,Math.trunc(Number(cellCount))||1));
  const rows=Math.ceil(count/grid.columns);
  const gridHeight=rows*grid.cellSize;
  return {...grid,rows,capacity:rows*grid.columns,gridHeight,
    lineHeight:Math.ceil(gridHeight)+2,practiceHeight:Math.ceil(gridHeight)+4};
}
export function getSymbolGridStyle(symbolCount, gridSize) {
  const count=Math.max(1,Math.min(MAX_SYMBOL_CELLS,Math.trunc(Number(symbolCount))||1));
  return getSizedGridStyle(count,gridSize);
}
