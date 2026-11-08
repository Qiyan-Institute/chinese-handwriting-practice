/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {isPhoneticSymbol} from './phonetic.js?v=0.6.0';

export const MOE_SITE = 'https://stroke-order.learningweb.moe.edu.tw/';
export const MOE_RIGHTS = `${MOE_SITE}page.jsp?ID=52`;
export const MOE_CSV = `${MOE_SITE}file/files/%E5%85%A8%E7%AD%86%E9%A0%86%E5%8B%95%E7%95%AB%E5%B5%8C%E5%85%A5%E7%A2%BC%E7%B6%B2%E5%9D%80%E5%88%97%E8%A1%A8.csv`;

// Read only the character/codepoint/iframe URL index. No animation conversion.
export function parseOfficialIndex(csv) {
  const characters = [];
  const seen = new Set();
  for (const line of csv.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const match = line.match(/^\d+,(\d+),([^,]+),<iframe src=['"]https:\/\/stroke-order\.learningweb\.moe\.edu\.tw\/dictFrame\.jsp\?ID=(\d+)['"]/);
    if (!match || Array.from(match[2]).length !== 1 || match[2].codePointAt(0) !== Number(match[1]) || match[1] !== match[3]) {
      throw new Error('官方嵌入清單格式改變，停止更新');
    }
    if (!seen.has(match[2])) { characters.push(match[2]); seen.add(match[2]); }
  }
  if (!characters.length) throw new Error('官方嵌入清單為空');
  return characters;
}

export function officialEmbedUrl(ch, supported) {
  if (isPhoneticSymbol(ch) || Array.from(ch || '').length !== 1 || !supported.has(ch)) return null;
  return `${MOE_SITE}dictFrame.jsp?ID=${ch.codePointAt(0)}`;
}
