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

## 2. Cloud Deployment (24/7 Background Ticket Radar)

Because the project runs a persistent background worker with BullMQ, Redis, and Playwright for real-time ticket scanning, it requires a container or VPS rather than stateless serverless lambdas.

### Option A: Railway (Recommended — 5 Minutes)
Railway natively provisions PostgreSQL and Redis with 1 click:
1. Go to [railway.app](https://railway.app/) and create a new project.
2. Click **+ New** -> **Database** -> **Add PostgreSQL**.
3. Click **+ New** -> **Database** -> **Add Redis**.
4. Click **+ New** -> **GitHub Repo** -> select your BookMyShow repository.
5. In your App Service **Variables**, add:
   - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}`
   - `REDIS_URL`: `${{Redis.REDIS_URL}}`
   - `PORT`: `5055`
   - Plus your notification credentials (`EMAIL_FROM`, `EMAIL_APP_PASSWORD`, `CALLMEBOT_API_KEY`, etc.)
6. Railway will build the `Dockerfile` automatically and generate a public HTTPS URL for your phone!

### Option B: Docker Compose (VPS / DigitalOcean / Hetzner / AWS EC2)
If you have a Linux server or VPS:
```bash
git clone <your-repo-url>
cd bookmyshow-monitor
cp .env.example .env
docker compose up -d --build
```
Your app will be live on `http://<your-server-ip>:5055`.

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
