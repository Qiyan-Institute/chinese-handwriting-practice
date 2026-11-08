/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {isPhoneticSymbol} from './phonetic.js?v=0.6.0';
import { BUILTIN_STROKES } from './builtin-strokes.js';
import { characters, validateProject } from './model.js';
import { STROKE_API_BASE } from './runtime-config.js';

/**
 * 只提供已取得來源的筆順圖；缺字時絕不自己猜一筆。
 * 新字透過本機服務取得官方原始 SVG 字卡，來源隨專案保存。
 */
export function getStages(ch, userAssets = {}) {
  return userAssets[ch] || BUILTIN_STROKES[ch] || null;
}

export function getGlyphUrl(ch, userAssets = {}) {
  const stages = getStages(ch, userAssets);
  return stages?.length ? stages[stages.length - 1] : null;
}

export function safeImageUrl(value) {
  if (typeof value !== 'string') return '';
  return /^\.\/assets\/strokes\/[a-f0-9]+\/\d+\.png$/.test(value) ||
    /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
}

export function officialLookupUrl(ch) {
  if (characters(ch).length !== 1) throw new Error('請輸入單一漢字或注音符號');
  return isPhoneticSymbol(ch)?`https://stroke-order.learningweb.moe.edu.tw/dictView.jsp?ID=${ch.codePointAt(0)}`:
    `https://stroke-order.learningweb.moe.edu.tw/searchW.jsp?WORD=${encodeURIComponent(ch)}`;
}

export function strokeApiUrl(ch,base=STROKE_API_BASE) {
  if(characters(ch).length!==1)throw new Error('請輸入單一漢字或注音符號');
  return `${base.replace(/\/$/,'')}/api/moe/strokes?character=${encodeURIComponent(ch)}`;
}

export async function fetchOfficialStages(ch, fetcher=fetch) {
  const response=await fetcher(strokeApiUrl(ch),{signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'教育部筆順下載失敗');
  if(result.character!==ch)throw new Error('官方字卡回傳的單字不符');
  const checked=validateProject({blocks:[],customAssets:{[ch]:result.stages},assetMetadata:{[ch]:result.metadata}});
  return {stages:checked.customAssets[ch],metadata:checked.assetMetadata[ch]};
}

export function getAssetInfo(ch, userAssets = {}, metadata = {}) {
  if (Object.hasOwn(userAssets, ch)) return metadata[ch] || { sourceName: '使用者匯入（舊專案）', license: '未記錄，請核對使用權' };
  if (Object.hasOwn(BUILTIN_STROKES, ch)) return { sourceName: '使用者提供的原始 PDF', license: '僅作私人示範；公開再分發權利未核實' };
  return null;
}

export async function importStrokeImages(ch, files) {
  if (characters(ch).length !== 1) throw new Error('請輸入單一漢字或注音符號');
  const ordered = Array.from(files || []).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
  if (!ordered.length || ordered.length > 64) throw new Error('請選擇 1–64 張圖片');
  const results=[];
  for (const file of ordered) {
    if (!['image/png','image/svg+xml'].includes(file.type)) throw new Error('目前僅支援 PNG / SVG');
    if (file.size > 5*1024*1024) throw new Error('單張圖片不能超過 5 MB');
    const uri = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    results.push(uri);
  }
  return results;
}
