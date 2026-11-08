/* Copyright (C) 2026 Qiyan Institute contributors. SPDX-License-Identifier: AGPL-3.0-only */
// Raster A4 pages at 300 dpi, independently of the browser's print preview.
const libraries = new Map();

function deadline(promise, milliseconds, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

function loadLibrary(file, getLibrary) {
  if (getLibrary()) return Promise.resolve(getLibrary());
  if (!libraries.has(file)) {
    const script = document.createElement('script');
    script.src = new URL(file, import.meta.url).href;
    const loaded = new Promise((resolve, reject) => {
      script.onload = () => getLibrary() ? resolve(getLibrary()) : reject(new Error('PDF 元件未能啟動'));
      script.onerror = () => reject(new Error('PDF 元件載入失敗，請檢查網路後重試'));
      document.head.append(script);
    });
    libraries.set(file, deadline(loaded, 30000, 'PDF 元件載入逾時，請重試').catch(error => {
      script.remove(); libraries.delete(file); throw error;
    }));
  }
  return libraries.get(file);
}

export async function waitForImages(root) {
  await deadline(Promise.all([...root.querySelectorAll('img')].map(image => image.decode())),
    20000, '字圖載入逾時，請稍後重試');
}

function createSnapshot(sheets) {
  const frame = document.createElement('iframe');
  frame.title = 'PDF 匯出暫存';
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:900px;height:1200px;border:0;pointer-events:none';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    doc.documentElement.lang = document.documentElement.lang;
    const style = doc.createElement('style');
    // Local styles only. Copying rules avoids a second stylesheet request and
    // preserves the same layout even when the editor is scrolled or narrow.
    style.textContent = [...document.styleSheets].map(sheet => [...sheet.cssRules].map(rule => rule.cssText).join('\n')).join('\n') + `
      body{margin:0;padding:0;background:white}
      .sheet{margin:0;box-shadow:none}
      .sheet .block{outline:none!important;border-color:transparent!important;background:transparent!important}
      .block-toolbar{display:none!important}
      .practice-grid .grid-bg:hover{background-color:transparent}
    `;
    doc.head.append(style);
    // Clone once: edits made while exporting cannot mix different document states.
    for (const sheet of sheets) doc.body.append(sheet.cloneNode(true));
    return {frame, doc, pages:[...doc.querySelectorAll('.sheet')]};
  } catch (error) { frame.remove(); throw error; }
}

export async function downloadWorksheetPdf(sheets, filename, onProgress = () => {}) {
  if (!sheets.length) throw new Error('沒有可匯出的頁面');
  const snapshot = createSnapshot(sheets);
  try {
    const [render, Pdf] = await Promise.all([
      loadLibrary('./vendor-html2canvas.min.js', () => window.html2canvas),
      loadLibrary('./vendor-jspdf.umd.min.js', () => window.jspdf?.jsPDF),
    ]);
    await deadline(snapshot.doc.fonts.ready, 20000, '字型載入逾時，請重試');
    await waitForImages(snapshot.doc);
    const pdf = new Pdf({orientation:'portrait', unit:'mm', format:'a4', compress:true});
    for (let index = 0; index < snapshot.pages.length; index++) {
      onProgress(index + 1, snapshot.pages.length);
      // Yield between pages so progress is visible; retain only one large canvas.
      await new Promise(resolve => setTimeout(resolve, 0));
      const page = snapshot.pages[index];
      const canvas = await render(page, {
        scale:300 / 96, backgroundColor:'#fff', logging:false,
        windowWidth:900, windowHeight:1200, scrollX:0, scrollY:0,
        width:page.getBoundingClientRect().width, height:page.getBoundingClientRect().height,
        imageTimeout:20000,
      });
      try {
        if (index) pdf.addPage('a4', 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 210, 297);
      } finally { canvas.width = canvas.height = 0; }
    }
    const url = URL.createObjectURL(pdf.output('blob'));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.replace(/[\u0000-\u001f/\\:*?"<>|]/g, '_');
    document.body.append(link); link.click(); link.remove();
    // Leave time for the browser to start the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return snapshot.pages.length;
  } finally { snapshot.frame.remove(); }
}
