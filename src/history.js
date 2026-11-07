/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// SVG strings are immutable and shared; document edits are copied independently.
function snapshot(state) {
  return {...state,blocks:structuredClone(state.blocks),settings:structuredClone(state.settings),
    customAssets:{...state.customAssets},assetMetadata:{...state.assetMetadata}};
}
function sameAssets(a={},b={}) {
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>a[key]===b[key]);
}
function equal(a,b) {
  return a.sourceText===b.sourceText&&a.appliedText===b.appliedText&&
    JSON.stringify(a.blocks)===JSON.stringify(b.blocks)&&JSON.stringify(a.settings)===JSON.stringify(b.settings)&&
    sameAssets(a.customAssets,b.customAssets)&&sameAssets(a.assetMetadata,b.assetMetadata);
}

export class DocumentHistory {
  constructor(state,{limit=50,now=()=>Date.now()}={}) {
    this.entries=[snapshot(state)];this.cursor=0;this.limit=limit;this.now=now;this.group=null;this.changedAt=0;
  }
  get canUndo(){return this.cursor>0;}
  get canRedo(){return this.cursor<this.entries.length-1;}
  record(state,group=null) {
    const current=this.entries[this.cursor];
    if(equal(current,state))return false;
    const at=this.now();
    const merge=group&&group===this.group&&at-this.changedAt<750&&!this.canRedo&&this.cursor>0;
    this.entries.splice(this.cursor+1);
    if(merge)this.entries[this.cursor]=snapshot(state);
    else {
      this.entries.push(snapshot(state));this.cursor++;
      if(this.entries.length>this.limit+1){this.entries.shift();this.cursor--;}
    }
    this.group=group;this.changedAt=at;return true;
  }
  undo(){if(!this.canUndo)return null;this.group=null;return snapshot(this.entries[--this.cursor]);}
  redo(){if(!this.canRedo)return null;this.group=null;return snapshot(this.entries[++this.cursor]);}
  endGroup(){this.group=null;}
  // Background downloads add reusable assets without consuming an undo step or
  // replacing a user's imported override in any saved state.
  addOfficialAsset(ch,stages,metadata) {
    for(const state of this.entries)if(!Object.hasOwn(state.customAssets,ch)) {
      state.customAssets[ch]=stages;state.assetMetadata[ch]=metadata;
    }
  }
}
