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
