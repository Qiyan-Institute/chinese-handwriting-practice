# 源碼與第三方素材授權

本倉庫自行開發的程式碼採 GNU Affero General Public License version 3 only（SPDX：AGPL-3.0-only），完整文本見 LICENSE。Copyright (C) 2026 Qiyan Institute contributors.

AGPL 是自由／開源軟體授權，允許商業利用，沒有附加「禁止商用」限制。依適用條款散布軟體或提供修改版網路服務時，須提供相應源碼並保留必要聲明。

教育部的筆順動畫、逐筆字卡、使用者匯入字圖、系統字型等第三方作品不包含於這份源碼授權內，不因本程式讀取或呈現而被重新授權。

## 教育部資料

來源：中華民國教育部《國字標準字體筆順學習網》

- https://stroke-order.learningweb.moe.edu.tw/
- 版權說明：https://stroke-order.learningweb.moe.edu.tw/page.jsp?ID=52
- 相關動畫／全筆順提示依官方說明採 CC BY-NC-ND 3.0 臺灣版，包含姓名標示、非商業、禁止改作條件。
- assets/moe-index.json 僅保存官方公開嵌入清單的單字索引與來源資訊，不含字形或動畫。
- 字卡由使用者執行本機程式後按需請求官方下載端點；倉庫不附完整字庫或官方字卡圖片。使用官方素材的輸出附素材來源頁。

商用源碼的權利不等於商用教育部素材的權利。若要以商業目的使用官方素材，需另行確認或取得許可。自行匯入素材與其他字體依各自條款處理。

## 公開版本範圍

舊私人示範 PDF、三字逐筆 PNG、個人範例 JSON、含這些素材的評審截圖及 PDF 未納入此公開倉庫，也未出現在公開 Git 歷史。原有私人版本另外保留。

測試中的 SVG／PNG 圖形是合成測試資料，僅用於驗證容器解析、字格操作及排版，不代表真實字形或筆順。

## PDF 匯出函式庫

html2canvas 1.4.1 與 jsPDF 4.2.1 採 MIT 授權；原始版權與許可文本保留於 [src/vendor-licenses.md](src/vendor-licenses.md)，不受本專案 AGPL 授權重新授權。
