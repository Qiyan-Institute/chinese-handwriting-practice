/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MOE_CSV, MOE_RIGHTS, parseOfficialIndex } from '../src/moe.js';

const [option, input] = process.argv.slice(2);
if (option && (option !== '--input' || !input)) throw new Error('用法：node scripts/update-moe-index.mjs [--input 官方.csv]');
let bytes;
if (input) bytes = await readFile(input);
else {
  const response = await fetch(MOE_CSV, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`官方清單下載失敗：HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
const characters = parseOfficialIndex(bytes.toString('utf8'));
const index = { sourceUrl: MOE_CSV, rightsUrl: MOE_RIGHTS,
  acquiredAt: new Date().toISOString(), sha256: createHash('sha256').update(bytes).digest('hex'),
  note: '僅記錄官方提供的嵌入網址索引；不含筆順動畫或字形圖片。', characters };
await writeFile(new URL('../assets/moe-index.json', import.meta.url), JSON.stringify(index, null, 2) + '\n');
console.log(`已更新 ${characters.length} 字的官方動畫嵌入索引（未下載動畫）。`);
