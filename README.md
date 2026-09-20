# BookMyShow Ticket Monitor 🎬

> A real-time, automated ticket availability monitor and notification system for BookMyShow movie and event listings, featuring anti-detection browser scraping, multi-channel alerts, Google OAuth 2.0 authentication, and a modern glassmorphism React dashboard.

---

## 🌟 Key Features

- **⚡ Anti-Detection Playwright Engine**: Headless Chromium scraping pipeline that bypasses bot detection and intercepts BookMyShow internal API feeds and showtime state trees.
- **🔍 Granular Diffing & Alerting**: Real-time snapshot comparison engine that isolates showtime state transitions (`sold-out` $\rightarrow$ `available`, new dates, or newly added theatre screens).
- **📲 Multi-Channel Alert Delivery**:
  - **Email (Resend API & Gmail SMTP)**: Instant HTML email alerts with theatre showtime tables and direct 1-click booking links.
  - **WhatsApp (Twilio & CallMeBot)**: Instant WhatsApp push messages with automated sandbox opt-in diagnostics.
- **🔒 Authentication & Vault Security**:
  - **Google OAuth 2.0 & JWT Authentication**: 1-click sign-in with Google or custom email/password authentication.
  - **Device Isolation Vault**: Optional anonymous device keys with secure cross-device synchronization.
- **📡 Real-Time SSE Updates**: Server-Sent Events (SSE) live updates streaming live monitor checks and showtime status changes straight to the dashboard.
- **☁️ Cloud Native Monorepo Architecture**:
  - **Fastify API**: Light, resilient Node.js server with JSON Web Token session management and custom REST endpoints.
  - **BullMQ Worker Pool**: Background job queue processing powered by Redis for reliable task distribution and retry exponential backoffs.
  - **Glassmorphism UI**: React 18 SPA built with Vite, TypeScript, and Lucide React icons.

---

## 🛠️ Tech Stack

### Frontend & Core
- **Framework**: React 18, Vite, TypeScript
- **Styling**: Modern Vanilla CSS Design System with dark mode glassmorphic UI, HSL color tokens & custom animations
- **Icons & UI**: Lucide React

### Backend & Infrastructure
- **API Framework**: Node.js, Fastify, TypeScript
- **Database & ORM**: Neon (Serverless PostgreSQL) & Prisma ORM
- **Queue & Cache**: BullMQ & Upstash (Serverless Redis)
- **Scraper Engine**: Playwright Chromium (Anti-Detection stealth configuration)
- **Auth**: Google OAuth 2.0, bcryptjs, JSON Web Tokens (JWT)
- **Notifiers**: Resend API, Nodemailer SMTP, Twilio WhatsApp API, CallMeBot API

---

## 📁 Repository Structure

```
bookmyshow-monitor/
├── apps/
│   ├── api/          # Fastify REST API, JWT auth, SSE live stream, BullMQ queues
│   ├── web/          # React 18 + Vite + TypeScript Dashboard (Glassmorphism UI)
│   └── worker/       # BullMQ Background Worker + Playwright Scraper + Notifiers
├── packages/
│   ├── db/           # Prisma ORM Schema & Client (PostgreSQL)
│   └── shared/       # Shared TypeScript interfaces, diffing algorithms & utilities
├── .github/workflows/ # 24/7 GitHub Actions Cloud Runner
├── Dockerfile        # Multi-stage production Dockerfile (Playwright Noble base)
├── docker-compose.yml# Container orchestration for local development
└── package.json      # Monorepo workspace configuration & root scripts
```

---

## 🚀 Quick Start Instructions

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **PostgreSQL Database**: Local PostgreSQL or [Neon Serverless Postgres](https://neon.tech)
- **Redis Cache**: Local Redis or [Upstash Serverless Redis](https://upstash.com)

---

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/nipunnamburi/movieticket-monitor.git
cd movieticket-monitor
npm install
```

---

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Update your `.env` configuration:

```env
# Database & Redis
DATABASE_URL="postgresql://user:password@localhost:5432/bms_monitor?schema=public"
REDIS_URL="redis://localhost:6379"

# JWT Authentication & Google OAuth
JWT_SECRET="your-super-secret-jwt-key"
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Notifications (Email via Resend or Gmail SMTP)
RESEND_API_KEY="re_123456789"
EMAIL_FROM="your-email@gmail.com"
EMAIL_APP_PASSWORD="your-gmail-app-password"

# Notifications (WhatsApp via Twilio or CallMeBot)
TWILIO_ACCOUNT_SID="AC123456789"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
CALLMEBOT_API_KEY="123456"
```

---

### 3. Database Initialization

Push the Prisma schema to your PostgreSQL database and generate the Prisma Client:

```bash
npm run db:push
npm run db:generate
```

---

### 4. Run Development Servers

Start the API server, Worker process, and Web Dashboard concurrently:

```bash
npm run dev
```

- **Web Dashboard**: `http://localhost:5173`
- **Fastify API Server**: `http://localhost:5055`

---

## 💻 Usage Examples

### 1. Creating a New Ticket Monitor via API

```bash
curl -X POST http://localhost:5055/api/monitors \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -d '{
    "name": "Avatar 3 - IMAX 3D",
    "url": "https://in.bookmyshow.com/buytickets/avatar-3-hyderabad/movie-hyd-ET00000000-MT/20260920",
    "city": "Hyderabad",
    "pollIntervalMins": 5,
    "filterTheatres": ["PVR Forum Sujana", "AMB Cinemas"],
    "filterTimeFrom": "06:00 PM",
    "filterTimeTo": "11:00 PM"
  }'
```

---

### 2. Programmatic Scraper & Diff Execution (Node.js)

```typescript
import { fetchBmsShows } from '@bms/worker/scraper';
import { computeDiff, extractOpenings } from '@bms/shared';

// Fetch current snapshot from BookMyShow
const currentSnapshot = await fetchBmsShows(
  'https://in.bookmyshow.com/buytickets/movie-name/movie-hyd-ET00000000-MT/20260920'
);

// Compare with previous snapshot stored in DB
const diff = computeDiff(previousSnapshot, currentSnapshot);

// Extract new showtime openings
const openings = extractOpenings(diff);
console.log(`Found ${openings.length} new show opening(s)!`);
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
