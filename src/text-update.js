/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
import {characters,createCharacterBlock,newId} from './model.js';

export function updateWorksheetText(blocks,previousText,nextText) {
  const previous=characters(previousText).join('');
  const next=characters(nextText).join('');
  if(!next)throw new Error('請先輸入練習文字');
  const oldChars=characters(previous),newChars=characters(next);
  if(newChars.length>240)throw new Error('單次更新最多 240 字，請拆成多個專案');
  const result=[];
  const occurrences=new Map();
  let updated=0,preservedManual=0,removed=0,added=0,lastCharacter=-1,characterStyle=null;
  for(const block of blocks) {
    const ch=block.type==='character'?characters(block.text)[0]:null;
    const positions=ch?oldChars.flatMap((value,index)=>value===ch?[index]:[]):[];
    const occurrence=occurrences.get(ch)||0;
    const characterIndex=positions.length?positions[occurrence%positions.length]:-1;
    if(positions.length)occurrences.set(ch,occurrence+1);
    if(block.manual) {result.push(block);preservedManual++;continue;}
    if(block.type==='practice'&&characters(block.text).join('')===previous) {
      result.push({...block,text:next});updated++;continue;
    }
    if(block.type==='heading'&&block.text===`連寫練習（${previous}）`) {
      result.push({...block,text:`連寫練習（${next}）`});updated++;continue;
    }
    const index=characterIndex;
    if(index>=0) {
      characterStyle=block;
      if(index<newChars.length){result.push({...block,text:newChars[index]});updated++;}
      else removed++;
      lastCharacter=result.length;
      continue;
    }
    result.push(block);
  }
  if(lastCharacter>=0&&newChars.length>oldChars.length) {
    const extra=newChars.slice(oldChars.length).map(ch=>({...createCharacterBlock(ch),...characterStyle,
      id:newId(),text:ch,manual:null,pageBreakBefore:false}));
    result.splice(lastCharacter,0,...extra);added=extra.length;
  }
  if(result.length>250)throw new Error('更新後超過 250 個區塊，請減少文字');
  return {blocks:result,text:next,updated,preservedManual,added,removed};
}
