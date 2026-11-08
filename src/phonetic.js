/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// The 37 symbols, in the order listed by the MOE phonetic page. No artwork is bundled.
export const PHONETIC_SOURCE_URL = 'https://stroke-order.learningweb.moe.edu.tw/phonetic.jsp';
export const PHONETIC_SYMBOLS = Object.freeze(Array.from('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ'));
export const PHONETIC_TEXT = PHONETIC_SYMBOLS.join('');
export const isPhoneticSymbol = value => PHONETIC_SYMBOLS.includes(value);
