# BookMyShow Live Monitor — Deployment & Mobile Access Guide

## 1. Instant Mobile Access (Testing Right Now)

Your local development server is now bound to all network interfaces (`0.0.0.0`) with private device isolation.

### Option A: Over Local Wi-Fi (Same Network)
1. Make sure your phone is connected to the same Wi-Fi network as your computer.
2. Open your phone's browser (Safari, Chrome, etc.) and go to:
   ```
   http://192.168.1.2:3000
   ```
   *(Or the unified production port `http://192.168.1.2:5055`)*
3. You will notice that your phone generates its own **Private Vault**.
4. Alerts or monitors created on your phone will **not** appear on your laptop, and vice versa!

### Option B: From Anywhere (Cellular / 4G / 5G / Remote) via Cloudflare Tunnel
If you want to access the app on your phone while away from home without deploying to the cloud yet:
```bash
npx untun@latest tunnel http://localhost:3000
```
This gives you a free, public HTTPS URL (e.g. `https://random-subdomain.trycloudflare.com`) that you can open directly on your mobile browser.

---

## 2. Cloud Deployment ($0/mo Free Tier Setup)

### Option A: 100% Free Serverless & Cron Hybrid (Recommended)

This setup runs your app 24/7 without paying hosting fees or running continuous server daemons.

#### Step 1: Create Free PostgreSQL Database (Neon)
1. Sign up for free at [neon.tech](https://neon.tech).
2. Create a project (e.g. `bms-monitor-db`).
3. Copy your Connection String (`postgres://...`). Ensure `?sslmode=require` is appended.

#### Step 2: Create Free Redis Cache (Upstash - Optional)
1. Sign up for free at [upstash.com](https://upstash.com).
2. Create a global Redis database and copy the `REDIS_URL`.

#### Step 3: Configure GitHub Actions 24/7 Cloud Scraper
1. Push your code repository to **GitHub**.
2. Go to your repository on GitHub -> **Settings** -> **Secrets and variables** -> **Actions**.
3. Click **New repository secret** and add:
   - `DATABASE_URL`: Your Neon Postgres connection string.
   - `DEFAULT_EMAIL_TO`: Your target notification email address.
   - `EMAIL_FROM`: Your sender email address.
   - `EMAIL_APP_PASSWORD`: Your Gmail App Password (or `RESEND_API_KEY`).
   - `CALLMEBOT_API_KEY` / `DEFAULT_WHATSAPP_TO`: (Optional for WhatsApp alerts).
4. The GitHub Action in `.github/workflows/monitor.yml` will now automatically run `npm run runner` every 5 minutes in the cloud 100% free! You can also trigger it manually anytime under the **Actions** tab.

#### Step 4: Deploy Frontend & Dashboard to Vercel
1. Import your GitHub repository on [vercel.com](https://vercel.com).
2. Set Build Command to: `npm --prefix apps/web run build`
3. Set Output Directory to: `apps/web/dist`
4. Add environment variables:
   - `DATABASE_URL`: Your Neon connection string.
5. Deploy! Vercel will host your web dashboard with zero costs.

---

### Option B: Paid Container Hosting (Railway / Render / VPS)
If you prefer a continuous Docker process rather than scheduled cron execution:
- **Railway:** Connect repo, add Postgres + Redis plugins, set `DATABASE_URL` and `REDIS_URL`. (~$5/mo).
- **Docker Compose (VPS):** Run `docker compose up -d --build` on an Oracle Cloud Always Free VPS or Linux server.

---

## 3. How the Private Device Vault Works

### Zero-Friction Default
- When you open the website on your phone, a unique **Vault Key** (e.g. `vlt_a8f9...`) is created in your phone's browser storage.
- When your friend opens the website on their phone or laptop, they receive their own unique Vault Key.
- All monitor queries, creations, edits, triggers, and live alert streams are strictly locked to that Vault Key.
- **Your friend cannot see your email, phone number, or movie targets.**
- **You will never see your friend's email or alerts on your laptop.**

### Optional Multi-Device Sync (Phone ↔ Laptop)
If you *do* want your phone and laptop to share the same monitors:
1. On your phone, tap the **Vault** button in the navigation bar.
2. Tap **Copy** next to your Vault Key.
3. On your laptop, click the **Vault** button in the header.
4. Paste your phone's Vault Key into **"Sync with another device"** and click **Link & Sync**.
5. Both devices will now stay synchronized while remaining private from everyone else!
