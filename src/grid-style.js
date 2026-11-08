/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Preserve twelve editable cells. Medium groups wrap as 8 + 4, large as 6 + 6.
const style = (id, label, columns, lineHeight, practiceHeight, fontSize) => Object.freeze({
  id, label, columns, rows:Math.ceil(12 / columns), lineHeight, practiceHeight, fontSize,
  cellSize:610 / columns, gridHeight:610 / columns * Math.ceil(12 / columns),
});
export const GRID_STYLES = Object.freeze({
  standard:style('standard', '標準字格', 12, 52, 54, 38),
  medium:style('medium', '中型字格', 8, 155, 157, 57),
  large:style('large', '幼兒大格', 6, 206, 208, 76),
});
export const getGridStyle = value => GRID_STYLES[value === 'medium' || value === 'large' ? value : 'standard'];
