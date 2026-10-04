# 下課檢查站

作業與訂正追蹤看板：教室電腦顯示全班紅綠燈，學生自行消單，老師登記，家長用專屬查詢碼查看自己孩子的狀態。

網站：<https://335588yyyti.github.io/homeworksystem/>

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 整個網站（看板、家長查詢、設定後台） |
| `assets/tailwind.css` | 事先編譯好的樣式，由 `npm run build:css` 產生，不要手動修改 |
| `firestore.rules` | Firebase 安全規則，修改後要貼到 Firebase 主控台發布 |
| `tests/` | 自動測試（Firebase 以記憶體模擬，不會連到真正的雲端） |
| `tests/rules/` | 安全規則測試（用 Google 官方的 Firestore 模擬器，需要 Java） |

## 修改後要做的事

```bash
npm install          # 第一次使用時安裝套件
npm run build:css    # 改了 index.html 裡的 class 之後，重新產生樣式
npm test             # 執行自動測試
```

修改 `firestore.rules` 之後：

```bash
cd tests/rules && npm install && npm test   # 檢查安全規則
```
然後把 `firestore.rules` 的內容貼到 Firebase 主控台的 Firestore「規則」分頁並發布。

開 Pull Request 時，GitHub 會自動執行測試，並檢查 `assets/tailwind.css` 是否已重新產生。
