/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Millimetres for CSS/PDF, converted to CSS pixels for pagination.
const paper = (id, label, widthMm, heightMm, cssName) => Object.freeze({
  id, label, widthMm, heightMm, cssName,
  width:widthMm * 96 / 25.4, height:heightMm * 96 / 25.4,
});
export const PAPER_SIZES = Object.freeze({
  a4:paper('a4', 'A4', 210, 297, 'A4'),
  letter:paper('letter', 'US Letter', 215.9, 279.4, 'Letter'),
});
export const getPaperSize = value => PAPER_SIZES[value === 'letter' ? 'letter' : 'a4'];
