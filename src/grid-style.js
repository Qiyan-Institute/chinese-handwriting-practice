/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Keep all twelve editable cells; large writing groups wrap into two equal rows.
const style = (id, label, columns, lineHeight, practiceHeight, fontSize) => Object.freeze({
  id, label, columns, rows:12 / columns, lineHeight, practiceHeight, fontSize,
  cellSize:610 / columns, gridHeight:610 / columns * (12 / columns),
});
export const GRID_STYLES = Object.freeze({
  standard:style('standard', '標準字格', 12, 52, 54, 38),
  large:style('large', '幼兒大格', 6, 206, 208, 76),
});
export const getGridStyle = value => GRID_STYLES[value === 'large' ? 'large' : 'standard'];
