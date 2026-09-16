# BookMyShow Live Monitor 🎬

A modern, high-performance BookMyShow ticket availability monitor with real-time SSE live updates, automated diff detection, and multi-channel alerts (Gmail SMTP, Twilio WhatsApp, CallMeBot).

---

## 🌟 Key Features

- ⚡ **Stealth Playwright Scraper**: Anti-detection browser automation that intercepts BookMyShow's internal showtime JSON feeds and widget state trees.
- 🔍 **Granular Diffing Engine**: Compares snapshots and isolates transitions (e.g. `sold-out` $\rightarrow$ `available` or newly added shows).
- 📲 **Multi-Channel Alerts**:
  - 📧 **Gmail / SMTP**: Rich HTML notification with direct booking buttons and theatre breakdown tables.
  - 💬 **Twilio WhatsApp**: Instant mobile WhatsApp messaging with automated sandbox diagnosis.
  - 🤖 **CallMeBot Fallback**: Free instant WhatsApp alert fallback.
- 📱 **Glassmorphism React Web UI**: Modern dark-mode dashboard with date filtering, theatre selection, and live Server-Sent Events (SSE).
- 🔒 **Private Device Vault**: Zero-friction device isolation via Vault Keys with optional cross-device linking.
- 🚀 **Full Containerization & Cloud Deployment**: Ready for 1-click Railway deployment, Docker Compose, or GitHub Actions 24/7 scanning.

---

## 📁 Monorepo Structure

```
bookmyshow-monitor/
├── apps/
│   ├── api/                  # Fastify REST API, JWT auth, SSE live stream, BullMQ queues
│   ├── web/                  # React 18 + Vite + TypeScript Dashboard (Glassmorphism UI)
│   └── worker/               # BullMQ Background Worker + Playwright Scraper + Notifiers
├── packages/
│   ├── db/                   # Prisma ORM Schema & Client (PostgreSQL)
│   └── shared/               # Shared TypeScript interfaces, diffing algorithms & utilities
├── .github/workflows/        # 24/7 GitHub Actions Cloud Runner
├── Dockerfile                # Production multi-stage Docker build (Playwright Noble base)
├── docker-compose.yml        # PostgreSQL 15 + Redis 7 + App orchestration
├── setup.sh                  # One-time automated setup script
└── package.json              # Monorepo workspaces & scripts
```

---

## 🚀 Quick Start (Local Development)

### 1. Automated Setup

```bash
bash setup.sh
```

### 2. Start Services

To run with PostgreSQL and Redis locally:

```bash
# Start API, Worker, and Web concurrently
npm run dev
```

Open `http://localhost:5055` (or Vite dev on `http://localhost:5173`) in your browser.

---

## 🐳 Docker Deployment (Recommended for VPS / 24/7 Hosting)

```bash
cp .env.example .env
# Edit .env with your database and email credentials
docker compose up -d --build
```

The app will be live on `http://localhost:5055`.

---

## ☁️ 24/7 Cloud Monitoring (GitHub Actions)

If you don't want to run a server locally, the included GitHub Actions workflow runs every 5 minutes in GitHub's cloud:

1. Add your cloud PostgreSQL connection string in GitHub Repository Secrets as `DATABASE_URL`.
2. Add your notification secrets (`EMAIL_FROM`, `EMAIL_APP_PASSWORD`, `DEFAULT_EMAIL_TO`, etc.).
3. The workflow in `.github/workflows/monitor.yml` runs `npm run runner` automatically on a 5-minute cron.

---

## 🧪 Testing & Verification

```bash
# Run unit tests
npm test

# Build all packages & apps
npm run build
```
