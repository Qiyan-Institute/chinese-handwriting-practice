/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Local Chrome integration check. No npm dependencies; uses Node 22's WebSocket.
// Run: npm run test:browser (CHROME_PATH can override the executable).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (typeof WebSocket === 'undefined') throw new Error('瀏覽器測試需要 Node.js 22 以上');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'worksheet-browser-'));
const output = path.resolve(process.env.QA_OUTPUT || path.join(temporary, 'results'));
await mkdir(output, {recursive:true});
console.log(`QA output: ${output}`);
const port = Number(process.env.QA_PORT || 4187);
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = spawn(process.execPath, [process.env.QA_HOSTED==='1'?'scripts/serve-hosted.mjs':'scripts/serve.mjs'], {cwd:root, env:{...process.env, PORT:String(port)}, stdio:'pipe'});
const chrome = spawn(chromePath, ['--headless=new','--no-first-run','--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${path.join(temporary,'chrome')}`,
  '--window-size=1500,1000', 'about:blank'], {stdio:'pipe'});
let ws;
const exceptions=[];
const passed=[];
let chromeErrors='';
chrome.stderr.on('data',chunk => {chromeErrors=(chromeErrors + chunk).slice(-4000);});
chrome.on('error',error => {chromeErrors+=error.message;});
server.on('error',error => {chromeErrors+=error.message;});
server.stderr.on('data',chunk=>{chromeErrors=(chromeErrors+chunk).slice(-4000);});
const waitFor = async (predicate, label, timeout=15000) => {
  const start=Date.now();
  while (Date.now()-start < timeout) {
    try {const value=await predicate();if(value)return value;} catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`等待逾時：${label}\n${chromeErrors}`);
};

try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}`)).ok,'本地伺服器');
  const active=await waitFor(()=>readFile(path.join(temporary,'chrome','DevToolsActivePort'),'utf8'),'Chrome CDP');
  const [debugPort,debugPath]=active.trim().split('\n');
  ws=new WebSocket(`ws://127.0.0.1:${debugPort}${debugPath}`);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let sequence=0;
  const pending=new Map();
  let mockRequests=0;
  let dialogAnswer=true;
  let failPdfLibrary=false;
  ws.addEventListener('message', event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Fetch.requestPaused') {
      const request=message.params;
      if(request.request.url.includes('/vendor-jspdf.umd.min.js')) {
        if(failPdfLibrary) {
          failPdfLibrary=false;
          send('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:503,body:''},message.sessionId).catch(()=>{});
        } else send('Fetch.continueRequest',{requestId:request.requestId},message.sessionId).catch(()=>{});
        return;
      }
      const ch=new URL(request.request.url).searchParams.get('character');
      const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540" viewBox="0 0 540 540"><path d="M80 80 L460 460" stroke="black" stroke-width="24"/></svg>').toString('base64');
      const payload={character:ch,stages:['data:image/svg+xml;base64,'+svg],metadata:{sourceName:'合成測試圖片',license:'test fixture',attribution:'不代表真實字形'}};
      mockRequests++;
      send('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(payload)).toString('base64')},message.sessionId).catch(()=>{});
    }
    if(message.method==='Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog',{accept:dialogAnswer},message.sessionId).catch(()=>{});
    }
    if(message.method==='Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if(message.id) {
      const item=pending.get(message.id);
      if(!item)return;
      clearTimeout(item.timer);pending.delete(message.id);
      if(message.error)item.reject(new Error(JSON.stringify(message.error)));else item.resolve(message.result);
    }
  });
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},method==='Page.printToPDF'?60000:20000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const cdp=(method,params)=>send(method,params,sessionId);
  const evaluate=async expression=>{
    const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const click=async selector=>{
    const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});
    await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
  };
  const input=(selector,value,event='input')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`);
  const setFiles=async (selector,files)=>{
    const {root:document}=await cdp('DOM.getDocument');
    const {nodeId}=await cdp('DOM.querySelector',{nodeId:document.nodeId,selector});
    await cdp('DOM.setFileInputFiles',{nodeId,files});
  };
  const layout=()=>evaluate(`(()=>{
    const pages=[...document.querySelectorAll('.sheet')];
    return pages.map(page=>{const body=(page.querySelector('.sheet-body')||page.querySelector('.source-body')).getBoundingClientRect();
      return {width:page.getBoundingClientRect().width,height:page.getBoundingClientRect().height,
        fits:[...page.querySelectorAll('.block')].every(block=>block.getBoundingClientRect().bottom<=body.bottom+1),
        scrollFits:page.scrollHeight<=page.clientHeight+1};});})()`);
  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Fetch.enable',{patterns:[{urlPattern:'*/api/moe/strokes?*'},{urlPattern:'*/vendor-jspdf.umd.min.js'}]});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:process.env.QA_URL||`http://127.0.0.1:${port}`});
  await waitFor(()=>evaluate("document.querySelectorAll('.worksheet-page').length === 1 && document.getElementById('officialStatus').textContent.includes('6063')"),'編輯器及 6063 字索引');
  await evaluate('Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))');
  assert.equal(await evaluate("document.querySelectorAll('[data-block-type=\"practice\"] [data-cell-block]').length"),108);
  assert((await layout()).every(page=>page.fits&&page.scrollFits&&Math.abs(page.width-793.7)<1&&Math.abs(page.height-1122.52)<1));
  passed.push('預設三字字帖：108 個可編輯字格、單張 A4 無溢位');
  const initialScreenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(path.join(output,'editor.png'),Buffer.from(initialScreenshot.data,'base64'));

  const cleanInitial=await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio'))");
  assert(await evaluate("document.getElementById('undoBtn').disabled && document.getElementById('redoBtn').disabled"));
  const selectPractice="[data-block-type='practice'] [data-cell-index='0']";
  await click(selectPractice);await click('#clearRow');
  assert(await evaluate("document.querySelector('.block.selected [data-cell-index=\"0\"]').dataset.cellState==='blank'"));
  await click('#undoBtn');
  assert(await evaluate("document.querySelector('[data-block-type=\"practice\"] [data-cell-index=\"0\"]').dataset.cellState==='filled'"));
  await click('#redoBtn');
  assert(await evaluate("document.querySelector('[data-block-type=\"practice\"] [data-cell-index=\"0\"]').dataset.cellState==='blank'"));
  await click('#undoBtn');
  await click('#duplicate');
  assert(await evaluate("document.getElementById('redoBtn').disabled"));
  await click('#undoBtn');
  const beforeDelete=await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)");
  await click('#removeBlock');await click('#undoBtn');
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeDelete);
  const beforeDraft=await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)");
  await input('#sourceText','中孫');
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeDraft);
  assert(await evaluate("document.getElementById('textUpdateStatus').textContent.includes('尚未套用')"));
  await click('#applyText');
  assert(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks.filter(b=>b.type==='character').map(b=>b.text).join('')==='中孫'"));
  await click('#undoBtn');
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeDraft);
  assert.equal(await evaluate("document.getElementById('sourceText').value"),'中孫');
  await click('#redoBtn');
  assert(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).appliedText==='中孫'"));
  passed.push('清空與複製可撤銷／重做，新修改清除重做分支；輸入草稿不改字帖，套用文字可整次恢復');
  const beforeTemplate=await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)");
  dialogAnswer=false;await evaluate("document.getElementById('templateBlank').click()");
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeTemplate);
  dialogAnswer=true;await evaluate("document.getElementById('templateBlank').click()");
  assert(await evaluate("document.querySelectorAll('[data-block-type=\"character\"]').length===0"));
  await click('#undoBtn');
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeTemplate);
  await click('#redoBtn');
  assert(await evaluate("document.querySelectorAll('[data-block-type=\"character\"]').length===0"));
  // Keyboard shortcuts are scoped to the editor; text inputs keep native undo.
  await evaluate("document.activeElement.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'z',ctrlKey:true}))");
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeTemplate);
  passed.push('換範本取消不改內容，套用可整次撤銷／重做；編輯區 Ctrl+Z 恢復編排');
  const historyReset=path.join(temporary,'history-reset.json');await writeFile(historyReset,JSON.stringify(cleanInitial));await setFiles('#loadJson',[historyReset]);
  await waitFor(()=>evaluate("document.querySelectorAll('[data-block-type=\"character\"]').length===3"),'還原歷史測試');
  assert(await evaluate("!document.querySelector('.sheet-meta') && !document.querySelector('.sign') && !document.querySelector('.worksheet-page').textContent.includes('姓名')"));
  const blankCell='[data-block-type="practice"] [data-cell-index="11"]';
  await click(blankCell);
  assert(await evaluate(`document.querySelector(${JSON.stringify(blankCell)}).dataset.cellState==='blank' && !document.querySelector(${JSON.stringify(blankCell)}).querySelector('.cell-character')`));
  assert(await evaluate("document.getElementById('cellSummary').textContent.includes('空白 6 格')"));
  await input('#insCount','3');
  assert(await evaluate("document.getElementById('cellSummary').textContent.includes('空白 9 格')"));
  await click('#clearRow');
  assert(await evaluate("document.getElementById('cellSummary').textContent.includes('空白 12 格')"));
  assert(await evaluate("[...document.querySelector('.block.selected .practice-grid').children].every(e=>!e.querySelector('.cell-character')&&e.querySelector('.grid-lines')&&getComputedStyle(e.querySelector('.grid-lines')).display!=='none')"));
  passed.push('選取不會填字、實際空白格計數、清空行保留米字格且沒有字圖');
  await evaluate("document.getElementById('headerOptions').open=true;document.getElementById('showName').click();document.getElementById('showClass').click();document.getElementById('showDate').click()");
  await input('#studentName','小朋友');await input('#className','三年級');await input('#practiceDate','2026/11/06');
  assert(await evaluate("document.querySelector('.sheet-meta').textContent.includes('姓名：小朋友') && !document.querySelector('.sheet-meta').textContent.includes('孫中山')"));
  await click('#cleanLayout');
  await click('#showTitle');
  assert(await evaluate("!document.querySelector('.sheet-header') && !document.querySelector('.sign')"));
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  passed.push('姓名與練習字獨立、班級日期可關閉、隱藏頁首不留固定空洞');

  const creditsProject={...cleanInitial,customAssets:{'李':['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=']},assetMetadata:{'李':{sourceName:'中華民國教育部',license:'CC BY-NC-ND 3.0 臺灣版'}},blocks:[{id:'credit-check',type:'practice',text:'李',count:6,light1:27,light2:16,signature:false}]};
  const creditsFile=path.join(temporary,'credits.json');await writeFile(creditsFile,JSON.stringify(creditsProject));
  await setFiles('#loadJson',[creditsFile]);
  await waitFor(()=>evaluate("document.querySelectorAll('.credits-page').length===1"),'單獨素材來源頁');
  assert(await evaluate("!document.querySelector('.worksheet-page').textContent.includes('中華民國教育部') && document.querySelector('.credits-page').textContent.includes('中華民國教育部')"));
  await input('#pageSelect','1','change');
  assert(await evaluate("document.getElementById('pageSelect').selectedOptions[0].textContent==='素材來源'"));
  await evaluate('Promise.all([...document.images].map(i=>i.decode()))');
  const creditPdf=await cdp('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  await writeFile(path.join(output,'clean-worksheet-with-sources.pdf'),Buffer.from(creditPdf.data,'base64'));
  creditsProject.blocks[0].count=0;
  await writeFile(creditsFile,JSON.stringify(creditsProject));await setFiles('#loadJson',[creditsFile]);
  await waitFor(()=>evaluate("!document.querySelector('.credits-page') && document.querySelectorAll('[data-cell-state=\"blank\"]').length===12"),'純空白不附無關來源頁');
  passed.push('來源移至獨立末頁、來源頁導航、空白文件不附未使用素材來源');
  const resetFile=path.join(temporary,'reset-clean.json');await writeFile(resetFile,JSON.stringify(cleanInitial));await setFiles('#loadJson',[resetFile]);
  await waitFor(()=>evaluate("document.querySelectorAll('[data-block-type=\"practice\"] [data-cell-block]').length===108"),'還原預設字帖');

  if(process.env.QA_LIVE_STROKES==='1') {
    await cdp('Fetch.disable');
    const initial=await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio'))");
    const project={...initial,sourceText:'學習',pageTitle:'官方楷體逐筆接入驗證',customAssets:{},assetMetadata:{},blocks:[
      {id:'live-xue',type:'character',text:'學',count:5,signature:true},
      {id:'live-xi',type:'character',text:'習',count:5,signature:true},
    ]};
    const file=path.join(temporary,'live-strokes.json');
    await writeFile(file,JSON.stringify(project));await setFiles('#loadJson',[file]);
    try {
      await waitFor(()=>evaluate("document.querySelectorAll('[data-block=\"live-xue\"] .stroke-mini img').length===16 && document.querySelectorAll('[data-block=\"live-xi\"] .stroke-mini img').length===11"),'官方真實字卡：學 16 畫、習 11 畫',120000);
    } catch(error) {
      console.log(await evaluate("({status:document.getElementById('strokeLoadStatus').textContent,toast:document.getElementById('toast').textContent,strokes:[...document.querySelectorAll('.stroke-cells')].map(e=>e.textContent),exceptions:document.body.textContent.slice(-500)})"));
      throw error;
    }
    await evaluate('Promise.all([...document.images].map(i=>i.decode()))');
    assert(await evaluate("[...document.querySelectorAll('.stroke-mini img')].every(i=>i.complete&&i.naturalWidth===540)"));
    assert(await evaluate("document.querySelector('.credits-page').textContent.includes('中華民國教育部') && !document.querySelector('.worksheet-page').textContent.includes('CC BY-NC-ND')"));
    assert((await layout()).every(page=>page.fits&&page.scrollFits));
    const image=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(path.join(output,'official-strokes.png'),Buffer.from(image.data,'base64'));
    const pdf=await cdp('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
    await writeFile(path.join(output,'official-strokes.pdf'),Buffer.from(pdf.data,'base64'));
    // The project retains all original SVGs and provenance for offline reload.
    const loaded=await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio'))");
    assert.equal(loaded.customAssets['學'].length,16);assert.equal(loaded.customAssets['習'].length,11);
    assert.match(loaded.assetMetadata['學'].sourceUrl,/stroke_card\.jsp/);
    await click('#undoBtn');
    assert(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).sourceText!=='學習'"));
    await click('#redoBtn');
    assert(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).customAssets['學'].length===16"));
    passed.push('真實教育部下載 → 學 16 畫／習 11 畫 → 預覽、描紅、來源及 PDF');
    passed.push('背景筆順下載不消耗撤銷步驟，撤銷載入專案及重做均保留官方原稿');
    const reset=path.join(temporary,'initial.json');await writeFile(reset,JSON.stringify(initial));
    await setFiles('#loadJson',[reset]);
    await waitFor(()=>evaluate("document.querySelectorAll('[data-block-type=\"practice\"] [data-cell-block]').length===108"),'還原預設字帖');
  }

  await input('#importChar','學');
  assert.equal(await evaluate("document.getElementById('showOfficial').disabled"),false);
  await click('#showOfficial');
  assert.equal(await evaluate("document.getElementById('officialFrame').getAttribute('src')"),'https://stroke-order.learningweb.moe.edu.tw/dictFrame.jsp?ID=23416');
  assert(await evaluate("document.getElementById('officialDialog').open && document.getElementById('officialDialog').textContent.includes('中華民國教育部')"));
  await click('#closeOfficial');
  await input('#importChar','🙂');
  assert.equal(await evaluate("document.getElementById('showOfficial').disabled"),true);
  passed.push('官方動畫對應單字、署名、關閉後卸載、缺字停用（未驗證遠端動畫播放）');

  for(let i=0;i<24;i++)await evaluate("document.getElementById('addBlankRow').click()");
  const pageCount=await evaluate("document.querySelectorAll('.sheet').length");
  assert(pageCount>=2);
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  await input('#pageSelect','1','change');
  assert.equal(await evaluate("document.getElementById('pageSelect').value"),'1');
  await input('#moveToPage','0','change');
  assert.equal(await evaluate("document.querySelector('.sheet [data-block]').dataset.block === JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).selectedId"),true);
  await click('#insPageBreak');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks.find(b=>b.id===JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).selectedId).pageBreakBefore"),true);
  passed.push('自動多頁、頁碼導航、跨頁移動與手動分頁儲存');

  const beforeDrag=await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)");
  await evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-block-type="practice"]')];
    const source=rows[0],target=rows.at(-1),id=source.dataset.block,dt=new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    window.movedId=id;})()`);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks.at(-2).id === window.movedId"),true);
  await click('#undoBtn');
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeDrag);
  await click('#redoBtn');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks.at(-2).id === window.movedId"),true);
  passed.push('跨頁區塊拖放事件：順序與儲存同步');

  await evaluate("document.querySelector('[data-glyph]').click()");
  const firstCell="[data-block-type='practice'] [data-cell-block][data-cell-index='0']";
  await click(firstCell);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstCell)}).textContent.trim() || document.querySelector(${JSON.stringify(firstCell)}).querySelector('img')?.alt`),'孫');
  await evaluate(`document.querySelector(${JSON.stringify(firstCell)}).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstCell)}).textContent.trim()`),'');
  passed.push('實際滑鼠填字、Shift 清空字格');

  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const fixture=path.join(temporary,'01.png');await writeFile(fixture,png);
  await evaluate("document.getElementById('assetAdvanced').open=true");
  await input('#importChar','學');await input('#assetSource','瀏覽器測試來源');await input('#assetLicense','本機驗證');await input('#assetAttribution','測試作者');
  await setFiles('#stageFiles',[fixture]);
  await click('#rightsConfirmed');await click('#importStages');
  await waitFor(()=>evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).assetMetadata['學']?.attribution === '測試作者'"),'圖片匯入與來源儲存');
  await click('#undoBtn');
  assert(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).assetMetadata['學']?.attribution !== '測試作者'"));
  await click('#redoBtn');
  assert(await evaluate("JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).assetMetadata['學'].attribution === '測試作者'"));
  passed.push('真實檔案選取、FileReader 圖片匯入與來源／授權存取');

  await cdp('Page.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  await click('#downloadProject');
  const download=await waitFor(async ()=>(await readdir(output)).find(name=>name.endsWith('.json')),'JSON 匯出');
  const saved=JSON.parse(await readFile(path.join(output,download),'utf8'));
  assert(saved.assetMetadata['學']);assert(saved.blocks.some(block=>block.pageBreakBefore));
  await setFiles('#loadJson',[path.join(output,download)]);
  await waitFor(()=>evaluate("document.getElementById('toast').textContent.includes('已載入')"),'專案重新載入');
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  passed.push('瀏覽器下載 JSON 與檔案重新匯入，保留多頁及來源');

  // Extreme case: 64 cumulative strokes, multi-line index, long headings.
  const image='data:image/png;base64,'+png.toString('base64');
  saved.customAssets['學']=Array(64).fill(image);
  saved.blocks.unshift({id:'qa-64-strokes',type:'character',text:'學',count:6,signature:true});
  saved.pageTitle='多頁測試標題'.repeat(10);
  const stressFile=path.join(temporary,'stress.json');await writeFile(stressFile,JSON.stringify(saved));
  await setFiles('#loadJson',[stressFile]);
  await waitFor(()=>evaluate("document.querySelector('[data-block=\"qa-64-strokes\"] .stroke-cells').children.length===64"),'64 畫分行');
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  const stepsFit=await evaluate("(()=>{const line=document.querySelector('[data-block=\"qa-64-strokes\"] .stroke-line').getBoundingClientRect();return [...document.querySelectorAll('[data-block=\"qa-64-strokes\"] .stroke-mini')].every(e=>e.getBoundingClientRect().bottom<=line.bottom&&e.getBoundingClientRect().right<=line.right)})()");
  assert(stepsFit);
  passed.push('64 畫分成 4 行與長頁標題不破壞分頁');

  // Direct PDF uses the actual download button, without invoking print preview.
  await evaluate("window.print=()=>{throw new Error('直接下載不可呼叫瀏覽器列印')}");
  failPdfLibrary=true;
  await click('#downloadPdf');
  await waitFor(()=>evaluate("document.getElementById('toast').textContent.includes('PDF 元件載入失敗')&&!document.getElementById('downloadPdf').disabled"),'元件下載失敗後恢復按鈕');
  assert.equal(await evaluate("document.querySelectorAll('iframe[title=\"PDF 匯出暫存\"]').length"),0);
  passed.push('PDF 元件下載失敗有提示、清理快照，恢復按鈕後可直接重試');
  const previewBeforeExport=await evaluate("document.querySelectorAll('.sheet').length");
  const stateBeforeExport=await evaluate("localStorage.getItem('hanzi-worksheet-studio')");
  await click('#downloadPdf');
  const directFile=await waitFor(async ()=>(await readdir(output)).find(name=>name.startsWith('正體字帖_')&&name.endsWith('.pdf')),'直接下載多頁 PDF',90000);
  const directBytes=await readFile(path.join(output,directFile));
  assert.equal(directBytes.subarray(0,5).toString(),'%PDF-');
  const directPages=[...directBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
  assert.equal(directPages,previewBeforeExport,'直接 PDF 頁數必須與預覽一致');
  assert.match(directBytes.toString('latin1'),/\/MediaBox \[0 0 595\.2[0-9]* 841\.8[0-9]*\]/);
  await waitFor(()=>evaluate("!document.getElementById('downloadPdf').disabled"),'PDF 完成後按鈕恢復');
  assert.equal(await evaluate("localStorage.getItem('hanzi-worksheet-studio')"),stateBeforeExport);
  assert.equal(await evaluate("document.querySelectorAll('iframe[title=\"PDF 匯出暫存\"]').length"),0);
  passed.push(`直接下載 ${directPages} 頁 A4 PDF，無列印視窗、不改動專案`);

  await cdp('Emulation.setEmulatedMedia',{media:'print'});
  const expectedPages=await evaluate("document.querySelectorAll('.sheet').length");
  await evaluate('Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))');
  await cdp('Page.stopLoading');
  const pdf=await cdp('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  const pdfBytes=Buffer.from(pdf.data,'base64');
  const actualPages=[...pdfBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
  assert.equal(actualPages,expectedPages,'PDF 頁數必須等於預覽，不可多出空白頁');
  await writeFile(path.join(output,'multi-page-a4.pdf'),pdfBytes);
  passed.push(`Chrome 列印 PDF ${actualPages} 頁，與預覽一致`);
  await cdp('Emulation.setEmulatedMedia',{media:''});
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  passed.push('390px 窄螢幕保留 A4 幾何（工作區可水平捲動）');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,0)');
  const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(path.join(output,'stress.png'),Buffer.from(screenshot.data,'base64'));
  creditsProject.blocks[0].count=6;
  creditsProject.sourceText=creditsProject.appliedText='來源頁驗證';
  await writeFile(creditsFile,JSON.stringify(creditsProject));await setFiles('#loadJson',[creditsFile]);
  await waitFor(()=>evaluate("document.querySelectorAll('.credits-page').length===1"),'匯出前來源頁');
  const beforeSourceDownload=new Set(await readdir(output));
  await click('#downloadPdf');
  const sourceDownload=await waitFor(async ()=>(await readdir(output)).find(name=>!beforeSourceDownload.has(name)&&name.endsWith('.pdf')),'直接 PDF 包含素材來源',60000);
  const sourceBytes=await readFile(path.join(output,sourceDownload));
  assert.equal([...sourceBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,2);
  passed.push('含官方來源的字帖直接匯出 2 頁 PDF：1 頁字帖＋1 頁素材來源');
  // A boundary case that fits A4 but must paginate on the shorter Letter page.
  const letterProject={...creditsProject,sourceText:'Letter驗證',appliedText:'Letter驗證',paperSize:'a4',
    blocks:Array.from({length:17},(_,i)=>({id:`letter-row-${i}`,type:'practice',text:'李',count:i?0:6,light1:27,light2:16,signature:false}))};
  const letterFixture=path.join(temporary,'letter-fixture.json');
  await writeFile(letterFixture,JSON.stringify(letterProject));await setFiles('#loadJson',[letterFixture]);
  await waitFor(()=>evaluate("document.getElementById('sourceText').value==='Letter驗證'"),'Letter 邊界專案');
  assert.equal(await evaluate("document.querySelectorAll('.worksheet-page').length"),1);
  const beforePaperChange=await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)");
  await input('#paperSize','letter','change');
  assert.equal(await evaluate("document.querySelectorAll('.worksheet-page').length"),2);
  assert((await layout()).every(page=>page.fits&&page.scrollFits&&Math.abs(page.width-816)<1&&Math.abs(page.height-1056)<1));
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforePaperChange);
  await click('#undoBtn');
  assert.equal(await evaluate("document.getElementById('paperSize').value"),'a4');
  assert.equal(await evaluate("document.querySelectorAll('.worksheet-page').length"),1);
  await click('#redoBtn');
  assert.equal(await evaluate("document.getElementById('paperSize').value"),'letter');
  passed.push('A4 切換 Letter 重新分頁、保留字格及來源，支援撤銷／重做');
  await click('#downloadProject');
  const letterJson=await waitFor(async ()=>(await readdir(output)).find(name=>name.includes('Letter驗證')&&name.endsWith('.json')),'Letter JSON 下載');
  assert.equal(JSON.parse(await readFile(path.join(output,letterJson),'utf8')).paperSize,'letter');
  await input('#paperSize','a4','change');
  await setFiles('#loadJson',[path.join(output,letterJson)]);
  await waitFor(()=>evaluate("document.getElementById('paperSize').value==='letter'"),'JSON 還原 Letter');
  assert((await layout()).every(page=>page.fits&&page.scrollFits&&Math.abs(page.height-1056)<1));
  passed.push('Letter 紙張隨 JSON 保存及載入，舊專案維持 A4');
  const letterPages=await evaluate("document.querySelectorAll('.sheet').length");
  const assertLetterPdf=bytes=>{
    assert.equal([...bytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,letterPages);
    const boxes=[...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
    assert(boxes.length>0);
    assert(boxes.every(box=>Math.abs(Number(box[1])-612)<0.05&&Math.abs(Number(box[2])-792)<0.05));
  };
  const letterNative=await cdp('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  const letterNativeBytes=Buffer.from(letterNative.data,'base64');assertLetterPdf(letterNativeBytes);
  await writeFile(path.join(output,'multi-page-letter-print.pdf'),letterNativeBytes);
  const beforeLetterDownload=new Set(await readdir(output));
  await click('#downloadPdf');
  const letterDownload=await waitFor(async ()=>(await readdir(output)).find(name=>!beforeLetterDownload.has(name)&&name.endsWith('.pdf')),'Letter 直接 PDF',60000);
  assertLetterPdf(await readFile(path.join(output,letterDownload)));
  passed.push(`原生列印與直接下載均為 ${letterPages} 頁 Letter（612 × 792 pt），包含同尺寸來源頁`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert((await layout()).every(page=>page.fits&&page.scrollFits&&Math.abs(page.width-816)<1));
  await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  passed.push('Letter 在 390px 窄螢幕仍保留完整紙張幾何');
  const largeProject={...creditsProject,sourceText:'大格驗證',appliedText:'大格驗證',paperSize:'letter',gridSize:'standard',
    customAssets:{...saved.customAssets,...creditsProject.customAssets},assetMetadata:{...saved.assetMetadata,...creditsProject.assetMetadata},
    blocks:[{id:'large-strokes',type:'character',text:'學',count:6,signature:true},
      {id:'large-heading',type:'heading',text:'大格練習',sub:'每組兩行'},
      {id:'large-manual',type:'practice',text:'孫中山',count:6,signature:true,manual:Array.from({length:12},(_,i)=>({ch:i===0?'孫':i===6?'山':'',opacity:.5}))},
      {id:'large-auto',type:'practice',text:'李',count:6,signature:false},
      {id:'large-blank',type:'practice',text:'孫中山',count:0,signature:false}]};
  const largeFixture=path.join(temporary,'large-fixture.json');
  await writeFile(largeFixture,JSON.stringify(largeProject));await setFiles('#loadJson',[largeFixture]);
  await waitFor(()=>evaluate("document.querySelector('[data-block=\"large-strokes\"] .stroke-cells').children.length===64"),'大格前的 64 畫專案');
  const beforeLarge=await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)");
  const standardPageCount=await evaluate("document.querySelectorAll('.worksheet-page').length");
  await input('#gridSize','large','change');
  assert((await evaluate("document.querySelectorAll('.worksheet-page').length"))>standardPageCount);
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  assert(await evaluate(`(()=>{
    const grid=document.querySelector('[data-block="large-manual"] .practice-grid');
    const first=grid.children[0].getBoundingClientRect(),second=grid.children[6].getBoundingClientRect();
    return grid.children.length===12&&Math.abs(first.width-610/6)<.1&&Math.abs(first.height-first.width)<.1&&
      Math.abs(second.left-first.left)<.1&&Math.abs(second.top-first.bottom)<.1&&
      parseFloat(getComputedStyle(grid.querySelector('.cell-character')).fontSize)===76;
  })()`));
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeLarge);
  assert(await evaluate("[...document.querySelector('[data-block=\"large-blank\"] .practice-grid').children].every(cell=>!cell.querySelector('.cell-character')&&cell.querySelector('.grid-lines'))"));
  await click('#undoBtn');assert.equal(await evaluate("document.getElementById('gridSize').value"),'standard');
  await click('#redoBtn');assert.equal(await evaluate("document.getElementById('gridSize').value"),'large');
  passed.push('幼兒大格約 2.7 cm、每行 6 格、每組兩行，保留 12 格資料並支援撤銷／重做');
  await input('#cellMode','select','change');
  const lowerCell='[data-block="large-manual"] [data-cell-index="6"]';
  await click(lowerCell);
  assert(await evaluate("document.getElementById('clearRow').textContent.includes('本組')"));
  await evaluate(`document.querySelector(${JSON.stringify(lowerCell)}).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(lowerCell)}).dataset.cellState`),'blank');
  await click('#undoBtn');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(lowerCell)}).dataset.cellState`),'filled');
  const largeShots=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(path.join(output,'large-editor.png'),Buffer.from(largeShots.data,'base64'));
  await click('#downloadProject');
  const largeJson=await waitFor(async ()=>(await readdir(output)).find(name=>name.includes('大格驗證')&&name.endsWith('.json')),'大格 JSON');
  assert.equal(JSON.parse(await readFile(path.join(output,largeJson),'utf8')).gridSize,'large');
  await input('#gridSize','standard','change');await setFiles('#loadJson',[path.join(output,largeJson)]);
  await waitFor(()=>evaluate("document.getElementById('gridSize').value==='large'"),'大格 JSON 還原');
  passed.push('大格第二行仍可清空及撤銷，空白米字格無字，樣式與手動字格隨 JSON 還原');
  const largePages=await evaluate("document.querySelectorAll('.sheet').length");
  const nativeLarge=await cdp('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  const nativeLargeBytes=Buffer.from(nativeLarge.data,'base64');
  assert.equal([...nativeLargeBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,largePages);
  await writeFile(path.join(output,'large-letter-print.pdf'),nativeLargeBytes);
  const beforeLargePdf=new Set(await readdir(output));
  await click('#downloadPdf');
  const largeDownload=await waitFor(async ()=>(await readdir(output)).find(name=>!beforeLargePdf.has(name)&&name.endsWith('.pdf')),'大格 Letter PDF',60000);
  const largeBytes=await readFile(path.join(output,largeDownload));
  assert.equal([...largeBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,largePages);
  const largeBoxes=[...largeBytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  assert(largeBoxes.length&&largeBoxes.every(box=>Math.abs(Number(box[1])-612)<.05&&Math.abs(Number(box[2])-792)<.05));
  await input('#paperSize','a4','change');
  assert((await layout()).every(page=>page.fits&&page.scrollFits&&Math.abs(page.width-793.7)<1));
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  passed.push('64 畫與大格簽核不溢位，A4／Letter 及窄螢幕正確重排，大格 PDF 頁數與預覽一致');
  const mediumFixture=path.join(temporary,'medium-fixture.json');
  await writeFile(mediumFixture,JSON.stringify({...largeProject,sourceText:'中型驗證',appliedText:'中型驗證',gridSize:'large'}));
  await setFiles('#loadJson',[mediumFixture]);
  await waitFor(()=>evaluate("document.getElementById('sourceText').value==='中型驗證'"),'中型測試專案');
  const beforeMedium=await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)");
  const beforeMediumPages=await evaluate("document.querySelectorAll('.worksheet-page').length");
  await input('#gridSize','medium','change');
  assert((await evaluate("document.querySelectorAll('.worksheet-page').length"))<beforeMediumPages);
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  assert(await evaluate(`(()=>{
    const grid=document.querySelector('[data-block="large-manual"] .practice-grid');
    const first=grid.children[0].getBoundingClientRect(),lastTop=grid.children[7].getBoundingClientRect(),bottom=grid.children[8].getBoundingClientRect();
    return grid.children.length===12&&Math.abs(first.width-76.25)<.1&&Math.abs(first.height-first.width)<.1&&
      Math.abs(lastTop.top-first.top)<.1&&Math.abs(bottom.top-first.bottom)<.1&&Math.abs(bottom.left-first.left)<.1&&
      Math.abs(grid.getBoundingClientRect().height-152.5)<.1;
  })()`));
  assert.equal(await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('hanzi-worksheet-studio')).blocks)"),beforeMedium);
  await click('#undoBtn');assert.equal(await evaluate("document.getElementById('gridSize').value"),'large');
  await click('#redoBtn');assert.equal(await evaluate("document.getElementById('gridSize').value"),'medium');
  await click('[data-block="large-manual"] [data-cell-index="8"]');
  assert(await evaluate("document.getElementById('inspector').textContent.includes('8＋4') && document.getElementById('clearRow').textContent.includes('本組')"));
  await click('#downloadProject');
  const mediumJson=await waitFor(async ()=>(await readdir(output)).find(name=>name.includes('中型驗證')&&name.endsWith('.json')),'中型 JSON');
  assert.equal(JSON.parse(await readFile(path.join(output,mediumJson),'utf8')).gridSize,'medium');
  await input('#gridSize','standard','change');await setFiles('#loadJson',[path.join(output,mediumJson)]);
  await waitFor(()=>evaluate("document.getElementById('gridSize').value==='medium'"),'中型 JSON 還原');
  passed.push('中型字格約 2.0 cm、方形米字格、8＋4 兩行，原有 12 格與撤銷及 JSON 均正常');
  const mediumPages=await evaluate("document.querySelectorAll('.sheet').length");
  const nativeMedium=await cdp('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  const nativeMediumBytes=Buffer.from(nativeMedium.data,'base64');
  assert.equal([...nativeMediumBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,mediumPages);
  await writeFile(path.join(output,'medium-letter-print.pdf'),nativeMediumBytes);
  const beforeMediumPdf=new Set(await readdir(output));
  await click('#downloadPdf');
  const mediumDownload=await waitFor(async ()=>(await readdir(output)).find(name=>!beforeMediumPdf.has(name)&&name.endsWith('.pdf')),'中型直接 PDF',60000);
  const mediumBytes=await readFile(path.join(output,mediumDownload));
  assert.equal([...mediumBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,mediumPages);
  const mediumBoxes=[...mediumBytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  assert(mediumBoxes.length&&mediumBoxes.every(box=>Math.abs(Number(box[1])-612)<.05&&Math.abs(Number(box[2])-792)<.05));
  await input('#paperSize','a4','change');
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert((await layout()).every(page=>page.fits&&page.scrollFits));
  await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  passed.push('中型 64 畫及簽核不溢位、A4／Letter 重排與下載 PDF 頁數正確');
  if(process.env.QA_PDF_PROJECT) {
    await setFiles('#loadJson',[path.resolve(process.env.QA_PDF_PROJECT)]);
    await waitFor(()=>evaluate("document.getElementById('toast').textContent.includes('已載入字帖專案')"),'真實字卡專案');
    const expected=await evaluate("document.querySelectorAll('.sheet').length");
    await evaluate('Promise.all([...document.images].map(i=>i.decode()))');
    assert((await layout()).every(page=>page.fits&&page.scrollFits));
    const before=new Set(await readdir(output));
    await click('#downloadPdf');
    const file=await waitFor(async ()=>(await readdir(output)).find(name=>!before.has(name)&&name.endsWith('.pdf')),'真實官方字卡直接 PDF',60000);
    const bytes=await readFile(path.join(output,file));
    assert.equal([...bytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,expected);
    passed.push(`提供的真實字卡專案直接下載 ${expected} 頁 PDF，字格與來源完整`);
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  const report={passed,exceptions,previewPages:expectedPages,pdfPages:actualPages,
    limits:['未自動驗證教育部遠端動畫的播放及音訊；測試只確認官方原始 iframe 位址及署名。'],output};
  await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  ws?.close();chrome.kill();server.kill();
  // Keep outputs when QA_OUTPUT is omitted, otherwise remove the isolated profile.
  if(process.env.QA_OUTPUT) {
    await new Promise(resolve=>setTimeout(resolve,300));
    await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});
  }
}
