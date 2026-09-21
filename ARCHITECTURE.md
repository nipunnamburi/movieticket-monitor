# BookMyShow Ticket Monitor — System Architecture & Data Flow

This document details the actual runtime architecture, data flow, background queue scheduling, and Gmail SMTP notification pipeline for the BookMyShow Ticket Monitor.

---

## 1. System Architecture Diagram

```mermaid
flowchart TB
    subgraph Client["👤 Client"]
        Browser["Browser / Mobile<br/>React + Vite SPA<br/>(apps/web)"]
    end

    subgraph Edge["☁️ Web Hosting (Vercel / Render)"]
        Vercel["Static SPA Hosting<br/>/api/* Proxy"]
    end

    subgraph Runtime["🐳 Backend Runtime (Container / Cloud Server)"]
        subgraph API["Fastify API (apps/api) — port 5055"]
            Routes["REST Routes<br/>/api/auth • /api/monitors<br/>/api/settings • /api/theatres<br/>/api/test-notification • /health"]
            Auth["Auth Layer<br/>JWT + bcrypt<br/>Google OAuth"]
            EventHub["SSE EventHub<br/>GET /api/events<br/>POST /api/events/broadcast"]
            Static["Serves Built SPA<br/>(apps/web/dist)"]
        end

        subgraph Worker["BullMQ Worker (apps/worker)"]
            PollWorker["Poll Worker<br/>queue: bms-poll<br/>concurrency 5"]
            AlertWorker["Alert Worker<br/>queue: bms-alert<br/>(test / async alerts)"]
            Scraper["Playwright Scraper<br/>headless Chromium + stealth<br/>shared browser instance"]
            Diff["Diff Engine (@bms/shared)<br/>snapshot compare →<br/>ticket openings"]
            Notifier["Gmail SMTP Notifier<br/>sendEmailAlert / sendTestEmail"]
        end
    end

    subgraph Data["💾 Data Layer"]
        PG[("PostgreSQL<br/>User • Monitor<br/>AlertLog • SystemSetting")]
        Redis[("Redis<br/>BullMQ queues +<br/>repeatable schedules +<br/>snapshot hashes")]
    end

    subgraph External["🌐 External Services"]
        BMS["BookMyShow<br/>(scrape target)"]
        Gmail["Gmail SMTP<br/>(smtp.gmail.com:465/587)"]
        Google["Google OAuth"]
        User["📬 User Inbox"]
    end

    Browser -->|"HTTPS / SSE"| Vercel
    Vercel --> Routes
    Routes --> Auth
    Auth --> Google
    Routes -->|"Prisma"| PG
    Routes -->|"enqueue repeatable poll job<br/>per monitor interval"| Redis
    Routes -->|"manual trigger / test alert"| Redis

    Redis -->|"job dispatch"| PollWorker
    Redis --> AlertWorker
    PollWorker --> Scraper
    Scraper -->|"fetch showtimes"| BMS
    PollWorker --> Diff
    PollWorker -->|"save snapshot + hash"| PG
    PollWorker --> Redis
    PollWorker -->|"openings found"| Notifier
    AlertWorker --> Notifier
    PollWorker -->|"AlertLog"| PG

    Notifier -->|"direct SMTP"| Gmail
    Gmail --> User

    PollWorker -->|"POST /api/events/broadcast<br/>(localhost)"| EventHub
    EventHub -->|"SSE: CHECK_STARTED •<br/>TICKET_DROP • ERROR"| Browser
```

---

## 2. Real-Time Ticket Drop Runtime Flow

```mermaid
sequenceDiagram
    participant W as Poll Worker
    participant S as Playwright Scraper
    participant B as BookMyShow
    participant DB as Postgres
    participant N as Gmail SMTP Notifier
    participant API as SSE EventHub
    participant U as User Browser

    W->>DB: Load monitor (url, filters, snapshot)
    W->>API: Broadcast CHECK_STARTED
    API->>U: SSE event
    W->>S: Scrape showtimes
    S->>B: Headless Chromium fetch
    B-->>S: Showtime HTML/API data
    S-->>W: SnapshotShows
    W->>W: Apply theatre/date/time filters
    W->>W: computeDiff(old, new) → openings
    W->>DB: Save snapshot, lastChecked
    W->>API: Broadcast TICKET_DROP (or CHECK_COMPLETED)
    API->>U: SSE event (live dashboard update)
    alt Openings found
        W->>N: sendEmailAlert(openings)
        N->>N: Gmail SMTP (nodemailer, IPv4, SSL)
        W->>DB: Write AlertLog
    end
```

---

## 3. Core Component Overview

1. **Monorepo Structure:**
   - `apps/api`: Fastify backend handling REST endpoints, device vault sessions, and SSE broadcasting.
   - `apps/worker`: BullMQ queue worker and Playwright scraping engine.
   - `apps/web`: React + Vite mobile-responsive web application.
   - `packages/db`: Prisma PostgreSQL client and migration schemas.
   - `packages/shared`: State diff engine, type definitions, and show status classifiers.

2. **Single Purpose Notification Pipeline:**
   - All alerts are sent directly through **Gmail SMTP** (`nodemailer`) using standard 16-character Google App Passwords.
   - Eliminates 3rd-party vendor rate-limits and fallback failures.

3. **Direct Database Inspectability:**
   - PostgreSQL is directly accessible with any standard database client (VS Code Database extensions, TablePlus, DBeaver, or psql) using `DATABASE_URL`.
