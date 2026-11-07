# 字形、筆順與源碼的權利

更新：2026-11-07。

程式碼採標準 AGPL-3.0-only。作者已確認接受 AGPL 允許依法商用，不另加非商業限制。完整文本見 ../LICENSE；第三方作品排除及來源見 ../NOTICE.md。

## 官方來源

- 國字查詢：https://stroke-order.learningweb.moe.edu.tw/searchW.jsp?ID2=1
- 版權說明：https://stroke-order.learningweb.moe.edu.tw/page.jsp?ID=52
- 教學資源：https://stroke-order.learningweb.moe.edu.tw/resource.jsp?ID=1

依已核對的官方說明，筆順動畫及全筆順提示採 CC BY-NC-ND 3.0 臺灣版，引用須標示中華民國教育部及來源網址。這些第三方授權獨立於本程式 AGPL，未被重新授權。

## 資料處理

官方索引包含 6,063 字及來源／取得時間／CSV SHA-256，不包含動畫及字形。按需字卡下載只解析官方 ZIP 容器，逐張保留原始累積 SVG 的 bytes，記錄來源與授權。不是從動畫猜畫、切割或重新繪製字形。

應用程式提供原始 iframe 動畫視窗；點開才連線至官方。缺字會將單字送到官方字卡端點，完整專案與使用者圖片不會上傳。官方字卡僅快取在執行中的本機服務及使用者自己的專案檔案，不在公開倉庫分發全字庫。

使用官方字卡的完整列印文件附一張素材來源頁；只依實際使用的字產生，純空白文件不附未使用素材來源。自行匯入的素材另記錄 sourceName、sourceUrl、license、attribution、acquiredAt、changes；記錄不等於自動審核授權或筆順正確性。

## 公開版與舊私人版本

公開版未納入來源不明或未核實再分發權利的舊三字 PDF／PNG、個人範例及衍生評審附件；這些檔案及其舊提交保留在獨立私有備份，未把私人 Git 歷史公開。

源碼採 AGPL 允許商用；需要商用字形／筆順時，使用者仍應取得適當素材權利或改用其他有權使用的素材。
