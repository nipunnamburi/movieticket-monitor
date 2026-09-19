# BookMyShow Ticket Monitor - System Architecture, Codebase & Behavioral Specification

This document provides a comprehensive technical breakdown of the **BookMyShow Ticket Monitor** project, detailing its architecture, major behavioral components, system flow, and full source code modules.

---

## Table of Contents
1. [Architectural Overview](#1-architectural-overview)
2. [Major Behavioral Elements](#2-major-behavioral-elements)
   - [2.1 Stealth Playwright Scraping & Response Interception](#21-stealth-playwright-scraping--response-interception)
   - [2.2 Snapshot Diffing & Ticket Opening Extraction](#22-snapshot-diffing--ticket-opening-extraction)
   - [2.3 Real-Time Server-Sent Events (SSE) Streaming](#23-real-time-server-sent-events-sse-streaming)
   - [2.4 Multi-Channel Notification Dispatch (Email & WhatsApp)](#24-multi-channel-notification-dispatch-email--whatsapp)
   - [2.5 Background Queue & Concurrency Management](#25-background-queue--concurrency-management)
   - [2.6 24/7 Cloud & Cron Runner](#26-247-cloud--cron-runner)
3. [Database Schema & Data Model](#3-database-schema--data-model)
4. [Source Code Implementations](#4-source-code-implementations)
   - [Package: Shared Library (`packages/shared/src/index.ts`)](#package-shared-library-packagessharedsrcindexts)
   - [Package: Database Client (`packages/db/src/index.ts`)](#package-database-client-packagesdbsrcindexts)
   - [App: API Auth (`apps/api/src/auth.ts`)](#app-api-auth-appsapisrcauthts)
   - [App: Real-Time SSE Hub (`apps/api/src/events.ts`)](#app-real-time-sse-hub-appsapisrceventsts)
   - [App: BullMQ Queue Setup (`apps/api/src/queue.ts`)](#app-bullmq-queue-setup-appsapisrcqueuets)
   - [App: Playwright Scraper (`apps/worker/src/scraper.ts`)](#app-playwright-scraper-appsworkersrcscraperts)
   - [App: Worker Process (`apps/worker/src/index.ts`)](#app-worker-process-appsworkersrcindexts)
   - [App: Notification Engines (`apps/worker/src/notifiers.ts`)](#app-notification-engines-appsworkersrcnotifiersts)
   - [App: Standalone Cloud Runner (`apps/worker/src/runner.ts`)](#app-standalone-cloud-runner-appsworkersrcrunnerts)

---

## 1. Architectural Overview

The application is structured as a TypeScript monorepo using **npm workspaces**. It automates ticket availability checks on BookMyShow, tracks state transitions, alerts subscribers instantly via Email/WhatsApp, and provides live status updates on a dashboard UI.

```
                  ┌──────────────────────────────────────────────┐
                  │                 React Frontend               │
                  │             (Vite + Tailwind UI)             │
                  └───────┬──────────────────────────────▲───────┘
                          │ HTTP REST API                │ SSE Stream
                          ▼                              │
                  ┌──────────────────────────────────────────────┐
                  │                 Fastify API                  │
                  │             (Auth, SSE, Queue)               │
                  └───────┬──────────────────────────────┬───────┘
                          │ Enqueue Jobs                 │ Database Operations
                          ▼                              ▼
                  ┌───────────────┐              ┌───────────────┐
                  │ Redis/BullMQ  │              │ PostgreSQL DB │
                  └───────┬───────┘              └───────▲───────┘
                          │ Process Jobs                 │ Read/Write Snapshots
                          ▼                              │
                  ┌──────────────────────────────────────┴───────┐
                  │                Worker Pool                   │
                  │   Playwright Scraper + Multi-Channel Alerts   │
                  └──────────────────────────────────────────────┘
```

---

## 2. Major Behavioral Elements

### 2.1 Stealth Playwright Scraping & Response Interception
- **Stealth Initialization**: Overrides `navigator.webdriver`, `navigator.languages`, and `window.chrome` properties to evade automated headless bot detection.
- **Dual Data Capture Mechanism**:
  1. **Network Interception**: Intercepts BookMyShow dynamic REST requests (`showtimeWidgets`, `primary-dynamic`) to extract pure JSON show payloads.
  2. **DOM Window Fallback**: If network capture yields no data, evaluates `window.__INITIAL_STATE__` / `window.__NEXT_DATA__` via a depth-first search for `showtimeWidgets`.
- **Date Code Resolution**: Automatically converts date inputs (e.g. `YYYYMMDD`, `YYYY-MM-DD`, or default today + 2 days) into canonical BookMyShow `buytickets` URL routes.

### 2.2 Snapshot Diffing & Ticket Opening Extraction
- **Nested State Representation**: Formats snapshots as `{ [date]: { [theatre]: { [showtime]: status } } }`.
- **Status Classification**: Categorizes status into `available`, `fast-filling`, `sold-out`, `not listed`, and `unavailable`.
- **Delta Detection**:
  - Compares previous snapshot with newly scraped snapshot.
  - Identifies state transitions from non-bookable (`sold-out`, `not listed`) to bookable (`available`, `fast-filling`).
  - Formats user-friendly change descriptions (e.g., `"🟢 Tickets opened up from sold-out!"`).

### 2.3 Real-Time Server-Sent Events (SSE) Streaming
- **Persistent HTTP Streaming**: Fastify SSE endpoint streams live lifecycle events (`CHECK_STARTED`, `CHECK_COMPLETED`, `TICKET_DROP`, `ERROR`, `HEARTBEAT`) directly to connected dashboard clients.
- **Client & User Scoping**: Filters broadcast payloads so users receive updates relevant to their active monitors.
- **Connection Keep-Alive**: Periodically sends ping heartbeats every 15 seconds to prevent network timeout disconnects.

### 2.4 Multi-Channel Notification Dispatch (Email & WhatsApp)
- **Email Pipeline**:
  - **Primary**: Resend API service for instant, high-deliverability HTML email alerts.
  - **Fallback**: Nodemailer with SMTP (e.g., Gmail App Passwords).
- **WhatsApp & SMS Pipeline**:
  - **Primary**: Twilio WhatsApp API (with support for sandbox verification & opt-in handling).
  - **Fallback**: CallMeBot free HTTP WhatsApp API.

### 2.5 Background Queue & Concurrency Management
- **BullMQ Queue**: Isolates background polling (`bms-poll`) and notification dispatch (`bms-alert`).
- **Concurrency & Retry**: Scrapes up to 5 monitors in parallel per worker process with exponential backoff on failure.

### 2.6 24/7 Cloud & Cron Runner
- **Standalone CLI Execution**: Allows execution in serverless or CI environments (such as GitHub Actions or cron jobs) without requiring continuous Redis daemon processes.

---

## 3. Database Schema & Data Model

Defined using **Prisma ORM** for PostgreSQL:

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  monitors  Monitor[]
}

model Monitor {
  id              String     @id @default(uuid())
  userId          String?
  user            User?      @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientId        String?
  name            String
  url             String
  city            String
  language        String?
  status          String     @default("active") // "active" | "paused" | "error"
  checkIntervalSec Int       @default(120)
  lastChecked     DateTime?
  lastError       String?
  snapshot        Json?
  filterTheatres  String[]   @default([])
  filterDates     String[]   @default([])
  filterTimeFrom  String?
  filterTimeTo    String?
  emailTo         String?
  whatsappPhone   String?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  alertLogs       AlertLog[]
}

model AlertLog {
  id        String   @id @default(uuid())
  monitorId String
  monitor   Monitor  @relation(fields: [monitorId], references: [id], onDelete: Cascade)
  openings  Json
  channels  String[]
  sentAt    DateTime @default(now())
}

model SystemSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

---

## 4. Source Code Implementations

### Package: Shared Library (`packages/shared/src/index.ts`)

```typescript
export type ShowStatus = 'available' | 'fast-filling' | 'sold-out' | 'not listed' | 'unavailable';

export interface ShowOpening {
  date: string;
  dateCode: string;
  theatre: string;
  showtime: string;
  format?: string;
  oldStatus?: string | null;
  newStatus: string;
  change: string;
}

export type SnapshotShows = Record<string, Record<string, Record<string, string>>>;

export interface MonitorFilters {
  theatres?: string[];
  dates?: string[];
  timeFrom?: string;
  timeTo?: string;
  language?: string;
}

export interface LiveEventPayload {
  type: 'CHECK_STARTED' | 'CHECK_COMPLETED' | 'TICKET_DROP' | 'ERROR' | 'HEARTBEAT';
  clientId?: string;
  monitorId?: string;
  monitorName?: string;
  timestamp: string;
  message?: string;
  openings?: ShowOpening[];
  stats?: {
    totalShows: number;
    theatresCount: number;
    durationMs: number;
  };
}

export const BOOKABLE_STATUSES = new Set(['available', 'fast-filling']);
export const NOT_BOOKABLE_STATUSES = new Set(['sold-out', 'not listed', 'unavailable', '', 'removed']);

export function isBookable(status?: string | null): boolean {
  if (!status) return false;
  return BOOKABLE_STATUSES.has(status.toLowerCase().trim());
}

export function computeDiff(
  oldSnapshot: SnapshotShows,
  newSnapshot: SnapshotShows
): Array<{ date: string; theatre: string; showtime: string; oldStatus: string; newStatus: string }> {
  const diffs: Array<{ date: string; theatre: string; showtime: string; oldStatus: string; newStatus: string }> = [];

  for (const [date, theatres] of Object.entries(newSnapshot)) {
    const oldTheatres = oldSnapshot[date] || {};
    for (const [theatre, showtimes] of Object.entries(theatres)) {
      const oldShowtimes = oldTheatres[theatre] || {};
      for (const [time, newStatus] of Object.entries(showtimes)) {
        const oldStatus = oldShowtimes[time] || 'not listed';
        if (oldStatus !== newStatus) {
          diffs.push({
            date,
            theatre,
            showtime: time,
            oldStatus,
            newStatus,
          });
        }
      }
    }
  }
  return diffs;
}

export function extractOpenings(
  diffs: Array<{ date: string; theatre: string; showtime: string; oldStatus: string; newStatus: string }>
): ShowOpening[] {
  const openings: ShowOpening[] = [];

  for (const diff of diffs) {
    const wasBookable = isBookable(diff.oldStatus);
    const nowBookable = isBookable(diff.newStatus);

    if (!wasBookable && nowBookable) {
      const changeText =
        diff.oldStatus === 'sold-out'
          ? '🟢 Tickets opened up from sold-out!'
          : diff.newStatus === 'fast-filling'
          ? '🟡 Newly listed (fast-filling)'
          : '🟢 Tickets are now available!';

      openings.push({
        date: diff.date,
        dateCode: '',
        theatre: diff.theatre,
        showtime: diff.showtime,
        oldStatus: diff.oldStatus,
        newStatus: diff.newStatus,
        change: changeText,
      });
    }
  }

  return openings;
}
```

---

### Package: Database Client (`packages/db/src/index.ts`)

```typescript
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma =
  globalThis.prismaGlobal ??
  new PrismaClient({
    datasources: process.env.DATABASE_URL
      ? {
          db: {
            url: process.env.DATABASE_URL,
          },
        }
      : undefined,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

export * from '@prisma/client';
```

---

### App: API Auth (`apps/api/src/auth.ts`)

```typescript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bms_jwt_secret_super_secure_key_2026';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  if (!password || typeof password !== 'string' || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/\d/.test(password || '')) {
    errors.push('Password must contain at least 1 number (0-9)');
  }
  if (!/[!@#$%^&*(),.?":{}|<>_~`\-+=/]/.test(password || '')) {
    errors.push('Password must contain at least 1 special character (!@#$%^&*...)');
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface TokenPayload {
  userId: string;
  email: string;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}
```

---

### App: Real-Time SSE Hub (`apps/api/src/events.ts`)

```typescript
import { EventEmitter } from 'events';
import { FastifyReply } from 'fastify';
import { LiveEventPayload } from '@bms/shared';

interface ClientSubscription {
  clientId?: string;
  userId?: string;
}

class EventHub extends EventEmitter {
  private clients: Map<FastifyReply, ClientSubscription> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startHeartbeat();
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.clients.size === 0) return;
      const ping = `: ping - ${new Date().toISOString()}\n\n`;
      for (const [reply] of this.clients.entries()) {
        try {
          reply.raw.write(ping);
        } catch {
          this.removeClient(reply);
        }
      }
    }, 15000);
  }

  addClient(reply: FastifyReply, clientId?: string, userId?: string) {
    this.clients.set(reply, { clientId, userId });

    const initial: LiveEventPayload = {
      type: 'HEARTBEAT',
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Connected to private BMS Monitor SSE stream',
    };

    try {
      reply.raw.write(`data: ${JSON.stringify(initial)}\n\n`);
    } catch {
      this.removeClient(reply);
      return;
    }

    reply.raw.on('close', () => {
      this.removeClient(reply);
    });

    reply.raw.on('error', () => {
      this.removeClient(reply);
    });
  }

  removeClient(reply: FastifyReply) {
    this.clients.delete(reply);
    try {
      if (!reply.raw.destroyed) {
        reply.raw.end();
      }
    } catch {
      // ignore
    }
  }

  broadcast(event: LiveEventPayload & { userId?: string }) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const [reply, sub] of this.clients.entries()) {
      if (event.userId && sub.userId) {
        if (event.userId !== sub.userId) continue;
      } else if (event.clientId && sub.clientId) {
        if (event.clientId !== sub.clientId) continue;
      }
      try {
        reply.raw.write(payload);
      } catch {
        this.removeClient(reply);
      }
    }
  }
}

export const eventHub = new EventHub();
```

---

### App: BullMQ Queue Setup (`apps/api/src/queue.ts`)

```typescript
import { Redis } from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isTls = redisUrl.startsWith('rediss://');

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
});

export const bmsPollQueue = new Queue('bms-poll', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

export const bmsAlertQueue = new Queue('bms-alert', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
```

---

### App: Playwright Scraper (`apps/worker/src/scraper.ts`)

```typescript
import { chromium, Browser, BrowserContext } from 'playwright';
import { SnapshotShows } from '@bms/shared';

let sharedBrowser: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
  Object.defineProperty(navigator, 'languages', {get: () => ['en-IN', 'en-US', 'en']});
  Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
  window.chrome = { runtime: {} };
`;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    try {
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      sharedBrowser = browser;
      browser.on('disconnected', () => { sharedBrowser = null; });
      return browser;
    } finally {
      launchPromise = null;
    }
  })();

  return launchPromise;
}

export function getDateCodes(url: string, filterDates?: string[]): string[] {
  const m = url.match(/\/buytickets\/ET\d{8}\/(\d{8})/i) || url.match(/[?&]date=(\d{8})/i);
  if (m) return [m[1]];

  if (filterDates && filterDates.length > 0) {
    const codes: string[] = [];
    for (const fd of filterDates) {
      if (/^\d{8}$/.test(fd)) { codes.push(fd); continue; }
      const dateObj = new Date(fd);
      if (!isNaN(dateObj.getTime())) {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        codes.push(`${yyyy}${mm}${dd}`);
      }
    }
    if (codes.length > 0) return Array.from(new Set(codes));
  }

  const today = new Date();
  const defCodes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    defCodes.push(`${yyyy}${mm}${dd}`);
  }
  return defCodes;
}

export function buildBuyticketsUrl(baseUrl: string, dateCode?: string): string {
  const clean = baseUrl.split('?')[0].replace(/\/$/, '');
  if (clean.includes('/buytickets/')) {
    const m = clean.match(/\/buytickets\/([^/]+)(?:\/(\d{8}))?/);
    if (m) {
      const eventCode = m[1];
      const targetDc = dateCode || m[2];
      const basePrefix = clean.slice(0, clean.indexOf('/buytickets/'));
      return targetDc ? `${basePrefix}/buytickets/${eventCode}/${targetDc}` : clean;
    }
    return clean;
  }
  const eventMatch = clean.match(/\/(ET\d{8})/);
  if (eventMatch) {
    const eventCode = eventMatch[1];
    return dateCode ? `${clean}/buytickets/${eventCode}/${dateCode}` : `${clean}/buytickets/${eventCode}`;
  }
  return clean;
}

export function classifyStyle(styleId?: string | null): string {
  const s = String(styleId || '').toLowerCase();
  if (s.includes('grey') || s.includes('gray') || s.includes('sold') || s === '0') return 'sold-out';
  if (s.includes('orange') || s.includes('fast') || s.includes('filling') || s === '2') return 'fast-filling';
  return 'available';
}

export function parseShowtimeWidgets(data: any): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  if (!data || typeof data !== 'object') return result;

  const root = data?.data || data;
  const widgets = root?.showtimeWidgets || [];

  if (Array.isArray(widgets) && widgets.length > 0) {
    for (const widget of widgets) {
      if (widget.type !== 'groupList') continue;
      for (const group of widget.data || []) {
        for (const item of group.data || []) {
          if (item.type !== 'venue-card') continue;
          const venueName = item.additionalData?.venueName || item.venueName;
          if (!venueName) continue;
          const times: Record<string, string> = {};
          for (const section of item.showtimesSections || []) {
            for (const st of section.showtimes || []) {
              const title = st.title?.trim() || st.showTime;
              if (title) {
                times[title] = classifyStyle(st.styleId || st.availStatus);
              }
            }
          }
          if (Object.keys(times).length > 0) result[venueName] = times;
        }
      }
    }
  }
  return result;
}

export async function fetchBmsShows(
  url: string,
  filterDates?: string[]
): Promise<{ shows: SnapshotShows; error?: string }> {
  const dateCodes = getDateCodes(url, filterDates);
  const allShows: SnapshotShows = {};
  let context: BrowserContext | null = null;

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
    });

    const page = await context.newPage();
    await page.addInitScript(STEALTH_SCRIPT);
    const capturedByDate: Record<string, any> = {};

    page.on('response', async (response) => {
      const u = response.url().toLowerCase();
      if (u.includes('showtime') || u.includes('primary-dynamic') || u.includes('buytickets')) {
        const dcMatch = u.match(/datecode=(\d{8})/);
        const dc = dcMatch ? dcMatch[1] : '';
        try {
          const json = await response.json();
          if (JSON.stringify(json).includes('showtimeWidgets')) {
            capturedByDate[dc || dateCodes[0] || 'unknown'] = json;
          }
        } catch {}
      }
    });

    for (let i = 0; i < Math.min(dateCodes.length, 3); i++) {
      const dc = dateCodes[i];
      const navUrl = buildBuyticketsUrl(url, dc);
      try {
        await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(3500);

        const dateData = capturedByDate[dc];
        if (dateData) {
          const shows = parseShowtimeWidgets(dateData);
          if (Object.keys(shows).length > 0) {
            allShows[dc] = shows;
          }
        }
      } catch (navErr: any) {
        console.warn(`[Scraper] Navigation failed for date ${dc}: ${navErr.message}`);
      }
    }

    return { shows: allShows };
  } catch (err: any) {
    return { shows: {}, error: err.message };
  } finally {
    if (context) await context.close();
  }
}
```

---

### App: Worker Process (`apps/worker/src/index.ts`)

```typescript
import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '@bms/db';
import { computeDiff, extractOpenings, SnapshotShows } from '@bms/shared';
import { fetchBmsShows } from './scraper.js';
import { sendEmailAlert, sendWhatsAppAlert } from './notifiers.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isTls = redisUrl.startsWith('rediss://');
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
});

export const pollWorker = new Worker(
  'bms-poll',
  async (job: Job) => {
    const { monitorId } = job.data;
    const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
    if (!monitor || monitor.status === 'paused') {
      return { skipped: true };
    }

    const { shows, error } = await fetchBmsShows(monitor.url, monitor.filterDates);

    if (error) {
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { lastChecked: new Date(), lastError: error },
      });
      return { error };
    }

    const oldSnapshot = (monitor.snapshot as SnapshotShows) || {};
    const rawDiffs = computeDiff(oldSnapshot, shows);
    const openings = extractOpenings(rawDiffs);

    await prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        lastChecked: new Date(),
        lastError: null,
        snapshot: shows as any,
      },
    });

    if (openings.length > 0) {
      const channelsUsed: string[] = [];

      const targetEmail = monitor.emailTo || process.env.DEFAULT_EMAIL_TO;
      if (targetEmail) {
        const res = await sendEmailAlert(targetEmail, monitor.name, monitor.city, monitor.url, openings);
        if (res.success) channelsUsed.push('EMAIL');
      }

      const targetWhatsApp = monitor.whatsappPhone || process.env.DEFAULT_WHATSAPP_TO;
      if (targetWhatsApp) {
        const res = await sendWhatsAppAlert(targetWhatsApp, monitor.name, monitor.city, monitor.url, openings);
        if (res.success) channelsUsed.push('WHATSAPP');
      }

      await prisma.alertLog.create({
        data: {
          monitorId: monitor.id,
          openings: openings as any,
          channels: channelsUsed,
        },
      });
    }

    return { success: true, openingsCount: openings.length };
  },
  {
    connection: redis,
    concurrency: 5,
  }
);
```

---

### App: Notification Engines (`apps/worker/src/notifiers.ts`)

```typescript
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { Resend } from 'resend';
import { ShowOpening } from '@bms/shared';
import { prisma } from '@bms/db';

export async function sendEmailAlert(
  recipientEmail: string,
  monitorName: string,
  city: string,
  url: string,
  openings: ShowOpening[]
): Promise<{ success: boolean; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM || '';
  const emailAppPassword = process.env.EMAIL_APP_PASSWORD || '';
  const to = recipientEmail || process.env.DEFAULT_EMAIL_TO || emailFrom;

  const subject = `🔔 BMS Alert: ${monitorName} (${city}) — ${openings.length} Show(s) Bookable Now!`;
  const html = `<h1>New Tickets Available!</h1><p>Check bookmyshow: <a href="${url}">${url}</a></p>`;

  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      await resend.emails.send({
        from: 'BookMyShow Alerts <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  if (emailFrom && emailAppPassword) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: 587,
        auth: { user: emailFrom, pass: emailAppPassword },
      });
      await transporter.sendMail({ from: emailFrom, to, subject, html });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'No email credentials configured' };
}

export async function sendWhatsAppAlert(
  recipientPhone: string,
  monitorName: string,
  city: string,
  url: string,
  openings: ShowOpening[]
): Promise<{ success: boolean; error?: string }> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const callmebotKey = process.env.CALLMEBOT_API_KEY;
  const phone = recipientPhone || process.env.DEFAULT_WHATSAPP_TO;

  const formattedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
  const messageBody = `🚨 *BMS TICKET ALERT!* 🎬\nMovie: ${monitorName}\nCity: ${city}\nBook: ${url}`;

  if (twilioSid && twilioToken) {
    try {
      const client = twilio(twilioSid, twilioToken);
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
        to: `whatsapp:${formattedPhone}`,
        body: messageBody,
      });
      return { success: true };
    } catch (err: any) {
      if (!callmebotKey) return { success: false, error: err.message };
    }
  }

  if (callmebotKey) {
    try {
      const encodedMsg = encodeURIComponent(messageBody);
      const cleanPhone = formattedPhone.replace('+', '');
      const cmbUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodedMsg}&apikey=${callmebotKey}`;
      const res = await fetch(cmbUrl);
      if (res.ok) return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'No active WhatsApp provider available' };
}
```

---

### App: Standalone Cloud Runner (`apps/worker/src/runner.ts`)

```typescript
import dotenv from 'dotenv';
import { prisma } from '@bms/db';
import { computeDiff, extractOpenings, SnapshotShows } from '@bms/shared';
import { fetchBmsShows, closeBrowser } from './scraper.js';
import { sendEmailAlert, sendWhatsAppAlert } from './notifiers.js';

export async function runAllChecks(targetMonitorId?: string) {
  console.log(`[CloudRunner] Initializing 24/7 check...`);

  try {
    const monitors = await prisma.monitor.findMany({
      where: {
        status: 'active',
        ...(targetMonitorId ? { id: targetMonitorId } : {}),
      },
    });

    for (const monitor of monitors) {
      const { shows, error } = await fetchBmsShows(monitor.url, monitor.filterDates);
      if (error) continue;

      const oldSnapshot = (monitor.snapshot as SnapshotShows) || {};
      const diff = computeDiff(oldSnapshot, shows);
      const openings = extractOpenings(diff);

      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { snapshot: shows as any, lastChecked: new Date(), lastError: null },
      });

      if (openings.length > 0) {
        const emailTarget = monitor.emailTo || process.env.DEFAULT_EMAIL_TO;
        if (emailTarget) await sendEmailAlert(emailTarget, monitor.name, monitor.city, monitor.url, openings);

        const waTarget = monitor.whatsappPhone || process.env.DEFAULT_WHATSAPP_TO;
        if (waTarget) await sendWhatsAppAlert(waTarget, monitor.name, monitor.city, monitor.url, openings);
      }
    }
  } finally {
    await closeBrowser();
    await prisma.$disconnect();
  }
}
```
