[English](./custom-domain-email-setup.md) ｜ **繁體中文**

# 品牌專屬客服信箱建置手冊 (100% 免費做法 A)

本手冊說明如何使用 **Spaceship 網域託管** 與 **個人免費 Gmail**，為 `vestential.com` 建立專屬的官方客服信箱別名（`service@vestential.com`），享有免費收信、代發與抗垃圾郵件防護，完全無需額外付費訂閱 Google Workspace。

---

## 📌 架構總覽

```
【收信流程】
用戶寄信至 service@vestential.com
       │
       ▼
Spaceship 內建免費郵件轉送 (Email Forwarding)
       │
       ▼
轉寄至個人 Gmail (例: yourname@gmail.com)


【發信流程】
在個人 Gmail 點擊「撰寫」，寄件者切換為 service@vestential.com
       │
       ▼
透過 Google 專用應用程式密碼由 smtp.gmail.com 代發
       │
       ▼
Spaceship 網域 SPF 紀錄認證合法來源
       │
       ▼
收件者收到專業的品牌郵件 (service@vestential.com)
```

---

## 🛠️ 詳細操作步驟

### 第一階段：在 Spaceship 設定免費收信轉寄（約 2 分鐘）

Spaceship 本身即提供免費的郵件轉送功能，無需變更 NS 伺服器即可直接設定。

1. **登入 Spaceship**：
   前往 [Spaceship.com](https://www.spaceship.com/) 並登入帳號進入 **Launchpad**（控制台）。
2. **進入網域管理**：
   點選 **Domain Manager（網域管理）**，在清單中點擊 **`vestential.com`**。
3. **開啟 Email Forwarding**：
   在網域功能選單中找到 **「Email Forwarding（郵件轉送）」**。
4. **新增轉送規則**：
   點擊 **「Add Forwarding Rule（新增轉送規則）」**：
   - **Alias（來源信箱別名）**：輸入 `service`（完整地址為 `service@vestential.com`）。
   - **Forward to（轉寄目標信箱）**：輸入您的**個人 Gmail 地址**（例如 `yourname@gmail.com`）。
5. **儲存規則**：
   點選 **Set Rule / Save** 儲存。Spaceship 會自動設定底層所需的 MX 記錄。
6. **驗證收信**：
   用其他任一信箱寄一封測試信到 `service@vestential.com`，檢查個人 Gmail 是否成功收到轉寄郵件。

---

### 第二階段：取得 Google「應用程式密碼」（約 3 分鐘）

為了讓 Gmail 能安全地以 `service@vestential.com` 身分發信，需向 Google 申請一組專屬的 16 碼授權密碼。

1. **前往 Google 帳戶安全性**：
   登入個人 Google 帳號，開啟 [Google 帳戶安全性設定](https://myaccount.google.com/security)。
2. **確認兩步驟驗證**：
   確認帳戶已開啟「兩步驟驗證」（若未開啟請依指示先完成啟用）。
3. **建立應用程式密碼**：
   - 在安全性頁面頂端的搜尋列直接輸入 **「應用程式密碼」**（或 App passwords）。
   - 點擊進入後，在「應用程式名稱」自訂輸入（例如：`vestential-service`）。
   - 點選 **「建立」**。
4. **保存密碼**：
   畫面會顯示一組 **16 個英文字母的專用密碼**（例如：`abcd efgh ijkl mnop`）。請複製並妥善留存（等一下綁定時使用）。

---

### 第三階段：在 Gmail 綁定自訂寄件者（約 3 分鐘）

1. **開啟 Gmail 設定**：
   打開 Gmail 網頁版，點選右上角 ⚙️ **設定** → **查看所有設定**。
2. **進入帳戶分頁**：
   點選頂端分頁的 **「帳戶和匯入 (Accounts and Import)」**。
3. **新增寄件地址**：
   在 **「以其他地址傳送郵件 (Send mail as)」** 區塊，點擊 **「新增其他電子郵件地址」**。
4. **輸入基本資料**：
   在彈出的黃色設定視窗中：
   - **名稱**：輸入發信時想顯示的品牌或團隊名稱（例如：`Vestential` 或 `Vestential 官方客服`）。
   - **電子郵件地址**：填入 `service@vestential.com`。
   - ⚠️ **務必取消勾選「視為別名 (Treat as an alias)」**。
   - 點擊「下一步」。
5. **設定 SMTP 伺服器**：
   - **SMTP 伺服器**：`smtp.gmail.com`
   - **通訊埠 (Port)**：`587`
   - **使用者名稱**：您的完整個人 Gmail 地址（例如 `yourname@gmail.com`）
   - **密碼**：第二階段產生的 **16 碼 Google 應用程式密碼**（不要包含空格）
   - **連線加密方式**：維持勾選「採用 TLS 的安全連線」
   - 點擊 **「新增帳戶」**。
6. **信箱驗證**：
   - Google 會立即寄送一封驗證信到 `service@vestential.com`。
   - 由於第一階段已完成轉送，您的個人 Gmail 收件匣會立刻收到該驗證信。
   - 打開驗證信，複製驗證碼填入視窗並按確認（或直接點擊驗證信中的確認連結）。

---

### 第四階段：在 Spaceship 設定 SPF 紀錄（防垃圾信認證）

為避免以 `service@vestential.com` 發出的郵件被其他郵件伺服器（Outlook、Yahoo 等）判為垃圾郵件，必須在 Spaceship DNS 加入授權宣告。

1. 回到 Spaceship 的 **Domain Manager** → 點選 **`vestential.com`**。
2. 進入 **Advanced DNS（進階 DNS）**。
3. 新增一筆 **TXT Record**：
   - **Type**：`TXT`
   - **Host**：`@`
   - **Value**：`v=spf1 include:_spf.google.com ~all`
   - **TTL**：`Automatic`（或維持預設值）
4. 儲存變更。此設定授權 Google 代為寄送 `vestential.com` 網域之郵件。

---

## ✉️ 日常使用與注意事項

1. **日常寄信**：
   - 打開 Gmail 按「撰寫」。
   - 點擊 **「寄件者」** 欄位下拉選單，即可切換為 **`service@vestential.com`**。
2. **回覆郵件**：
   - 當客戶寄信至 `service@vestential.com` 時，信件會自動進到您的 Gmail。
   - 直接按「回覆」時，Gmail 會自動以收到該信的地址（`service@vestential.com`）作為回覆寄件者。
3. **完全免費**：
   - 此方案終身免額外訂閱費。
   - 若未來團隊規模擴大需要多人獨立收發或團隊共享信箱，可再無縫升級為獨立企業郵件系統。
