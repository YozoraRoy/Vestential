**English** ｜ [繁體中文](./custom-domain-email-setup_zh.md)

# Custom-Domain Support Inbox Setup Guide (Approach A: 100% free)

This guide explains how to use **Spaceship domain hosting** together with a **personal free Gmail** account to create a dedicated official support inbox alias for `vestential.com` (`service@vestential.com`), enjoying free receiving, sending on your behalf and anti-spam protection, with no need at all to pay for a Google Workspace subscription.

---

## 📌 Architecture Overview

```
[Receiving flow]
A user sends mail to service@vestential.com
       │
       ▼
Spaceship's built-in free Email Forwarding
       │
       ▼
Forwarded to a personal Gmail (e.g. yourname@gmail.com)


[Sending flow]
In personal Gmail click "Compose" and switch the sender to service@vestential.com
       │
       ▼
Sent on your behalf via smtp.gmail.com using a Google app password
       │
       ▼
Spaceship's domain SPF record certifies the legitimate source
       │
       ▼
The recipient receives a professional branded email (service@vestential.com)
```

---

## 🛠️ Detailed Steps

### Stage 1: Set up free receiving/forwarding in Spaceship (about 2 minutes)

Spaceship itself offers free email forwarding, which can be set up directly without changing the NS servers.

1. **Sign in to Spaceship**:
   Go to [Spaceship.com](https://www.spaceship.com/) and sign in to your account to enter the **Launchpad** (console).
2. **Enter domain management**:
   Click **Domain Manager** and click **`vestential.com`** in the list.
3. **Turn on Email Forwarding**:
   Find **"Email Forwarding"** in the domain feature menu.
4. **Add a forwarding rule**:
   Click **"Add Forwarding Rule"**:
   - **Alias (source mailbox alias)**: enter `service` (the full address is `service@vestential.com`).
   - **Forward to (forwarding target mailbox)**: enter your **personal Gmail address** (e.g. `yourname@gmail.com`).
5. **Save the rule**:
   Click **Set Rule / Save** to save. Spaceship will automatically configure the underlying MX records needed.
6. **Verify receiving**:
   Send a test message to `service@vestential.com` from any other mailbox and check whether your personal Gmail successfully receives the forwarded email.

---

### Stage 2: Obtain a Google "app password" (about 3 minutes)

So that Gmail can safely send as `service@vestential.com`, you need to request a dedicated 16-character authorization password from Google.

1. **Go to Google Account security**:
   Sign in to your personal Google account and open [Google Account security settings](https://myaccount.google.com/security).
2. **Confirm two-step verification**:
   Confirm that "2-Step Verification" is enabled on the account (if it is not, complete the setup following the instructions first).
3. **Create an app password**:
   - In the search bar at the top of the security page, type **"App passwords"** directly.
   - Click through, then enter a custom "app name" (e.g. `vestential-service`).
   - Click **"Create"**.
4. **Save the password**:
   The screen shows a **16-letter dedicated password** (e.g. `abcd efgh ijkl mnop`). Copy it and keep it safe (you will use it for the binding shortly).

---

### Stage 3: Bind the custom sender in Gmail (about 3 minutes)

1. **Open Gmail settings**:
   Open the Gmail web version and click ⚙️ **Settings** in the top right → **See all settings**.
2. **Go to the Accounts tab**:
   Click the **"Accounts and Import"** tab at the top.
3. **Add a sending address**:
   In the **"Send mail as"** section, click **"Add another email address"**.
4. **Enter the basic details**:
   In the yellow settings window that pops up:
   - **Name**: enter the brand or team name you want shown when sending (e.g. `Vestential` or `Vestential Support`).
   - **Email address**: enter `service@vestential.com`.
   - ⚠️ **Be sure to uncheck "Treat as an alias"**.
   - Click "Next step".
5. **Set the SMTP server**:
   - **SMTP server**: `smtp.gmail.com`
   - **Port**: `587`
   - **Username**: your full personal Gmail address (e.g. `yourname@gmail.com`)
   - **Password**: the **16-character Google app password** generated in Stage 2 (do not include the spaces)
   - **Connection encryption**: keep "Secure connection using TLS" checked
   - Click **"Add account"**.
6. **Mailbox verification**:
   - Google will immediately send a verification email to `service@vestential.com`.
   - Because forwarding was already set up in Stage 1, your personal Gmail inbox will receive that verification email right away.
   - Open the verification email, copy the verification code into the window and confirm (or simply click the confirmation link in the email).

---

### Stage 4: Set the SPF record in Spaceship (anti-spam certification)

To avoid emails sent as `service@vestential.com` being judged as spam by other mail servers (Outlook, Yahoo and so on), you must add an authorization declaration in Spaceship DNS.

1. Go back to Spaceship's **Domain Manager** → click **`vestential.com`**.
2. Enter **Advanced DNS**.
3. Add a **TXT Record**:
   - **Type**: `TXT`
   - **Host**: `@`
   - **Value**: `v=spf1 include:_spf.google.com ~all`
   - **TTL**: `Automatic` (or keep the default value)
4. Save the change. This setting authorizes Google to send mail on behalf of the `vestential.com` domain.

---

## ✉️ Daily Use and Notes

1. **Everyday sending**:
   - Open Gmail and press "Compose".
   - Click the **"From"** field dropdown to switch to **`service@vestential.com`**.
2. **Replying to mail**:
   - When a customer sends mail to `service@vestential.com`, the message automatically arrives in your Gmail.
   - When you simply press "Reply", Gmail automatically uses the address that received the message (`service@vestential.com`) as the reply sender.
3. **Completely free**:
   - This approach has no extra subscription fee for life.
   - If the team later grows and needs multiple people sending and receiving independently or a shared team mailbox, you can upgrade seamlessly to a standalone business email system.
