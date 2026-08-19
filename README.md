# MORDECAI_EA SCANNER

Smart Money Concepts market scanner and manual-trading signal dashboard.

**This is not an auto-trading bot.** It reads your MT5 account/market data, analyzes
chart screenshots with AI, and shows you BUY/SELL signals with entry/SL/TP/confidence.
**You** place every trade yourself in MT5. Nothing in this codebase opens, closes, or
modifies a trade — there is no such function anywhere in the EA or backend.

No system can guarantee trading profit, including this one. Confidence scores describe
pattern confluence, not certainty of outcome.

## What's in this repo

```
mt5-ea/      MORDECAI_EA_SCANNER.mq5  — read-only EA, pushes data from MT5 to your backend
backend/     Node.js + Express API + SQLite — auth, sync, AI screenshot analysis, performance
frontend/    Installable PWA (add-to-home-screen) — the dashboard you designed
```

## 1. Push this to GitHub

```bash
cd mordecai-ea-scanner
git init
git add .
git commit -m "Initial MORDECAI_EA SCANNER scaffold"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mordecai-ea-scanner.git
git push -u origin main
```

`backend/.env` is git-ignored on purpose — never commit real secrets.

## 2. Deploy the backend

Any Node host works (Railway, Render, Fly.io, a VPS). Example with Render:

1. Create a new **Web Service**, point it at this repo, root directory `backend/`.
2. Build command: `npm install`. Start command: `npm start`.
3. Add environment variables from `backend/.env.example`:
   - `JWT_SECRET` — generate with `openssl rand -hex 32`
   - `ANTHROPIC_API_KEY` — from https://console.anthropic.com
   - `ALLOWED_ORIGINS` — the URL you'll host the frontend at (step 3)
4. Deploy. Note the resulting URL, e.g. `https://mordecai-backend.onrender.com`.

The AI screenshot analysis costs a small amount per call through the Anthropic API
(pay-as-you-go) — it isn't free-tier by default.

## 3. Deploy the frontend (installable app / "add to home screen")

Easiest option — GitHub Pages, since it's already in this repo:

1. In your GitHub repo: **Settings → Pages → Deploy from branch → main → `/frontend`**.
2. Your app will be live at `https://YOUR_USERNAME.github.io/mordecai-ea-scanner/`.
3. Open that URL on your phone in Chrome → menu → **Add to Home screen**.
   The MORDECAI icon (from your uploaded image) will appear as an app icon.
4. In the app, go to **Settings** and paste in your backend URL from step 2.

## 4. Connect MT5

Two ways, pick per client:

### Option A — Login (no laptop/VPS needed, recommended for most clients)

1. Get the client's **Investor Password** (read-only) — in their MT5 app:
   Account → tap it → Manage Accounts → Change Password → generate/view the
   **Investor** password (not the main trading password). This password can
   view balance/positions/history but can never place a trade, even by mistake.
2. In the app: **☰ menu → MT5 Connection → LOGIN tab**, enter the account
   number, investor password, and server name (e.g. `AccuMarkets-Live`), tap
   **LINK MT5 ACCOUNT DETAILS**.
3. Under the hood this uses [MetaApi.cloud](https://metaapi.cloud) to run the
   actual MT5 session in their infrastructure — nothing needs to run on the
   client's device. To enable it:
   - Sign up free at metaapi.cloud, generate an API token
   - In `backend/.env`, set `METAAPI_TOKEN` and generate `CREDENTIAL_ENCRYPTION_KEY`
     with `openssl rand -hex 32`
   - `npm install metaapi.cloud-sdk` inside `backend/`
   - Redeploy the backend
   - MetaApi has a free tier for a handful of accounts; beyond that it's a
     paid subscription — check their current pricing before onboarding many clients.

### Option B — EA (for clients who do run MT5 themselves, or you run it for them on a VPS)

1. In the app: **☰ menu → MT5 Connection → EA / VPS tab → Generate Pairing Token**. Copy it.
2. Open `mt5-ea/MORDECAI_EA_SCANNER.mq5` in MetaEditor, compile it, attach it to any
   chart in MT5 (doesn't need to be a laptop — a cheap Windows VPS, ~$5-15/mo,
   works fine and runs 24/7 independent of anyone's personal device).
3. Set its inputs: `InpBackendURL` = your backend URL, `InpDeviceToken` = the pairing token.
4. In MT5: **Tools → Options → Expert Advisors → Allow WebRequest for listed URL**, add
   your backend URL.

Either way, the dashboard's connection dot turns green only once real data has
arrived — it's never faked.

## 5. Use it

- **START** activates the scanner engines and MT5/cloud sync. **STOP** pauses them —
  it never touches open MT5 positions.
- **Analytics / Smart Money Scanner** — pick a symbol, enter your balance/lot/risk/target,
  upload a chart screenshot, and the AI returns entry/SL/TP1-3/RR/confidence with its
  reasoning. If the screenshot doesn't have enough visible data, it says so instead of
  guessing.
- **Live Trading** shows your real open positions and floating P/L.
- **Performance** shows real synced trade history only — nothing here is fabricated.
- If your phone is off or the app is closed, pressing START next time triggers a
  catch-up sync of real MT5 history since the last successful sync.

## What's genuinely production-grade here vs. what still needs work

Built and working: auth, MT5 pairing (no password ever stored), account/position/history
sync with dedup, AI screenshot analysis with an insufficient-data path, signal storage,
real-data-only performance analytics, the full dashboard UI, theming, PWA installability.

Still worth doing before trusting this with a live account:
- Load-test the sync endpoints if you'll run multiple MT5 accounts
- Add 2FA / stronger session handling if this will hold real account data long-term
- Broker symbol-suffix normalization (`.mic`, `m`, etc.) — the EA reports whatever
  symbol name your broker uses; add a mapping table in the backend if you want unified
  display names across brokers
- News-calendar integration (the spec's News Engine) needs a real economic-calendar
  API key, which isn't wired up yet
- Chart-object visualization (drawing zones on a live chart) isn't built — the current
  version returns levels as data, not an annotated chart image
