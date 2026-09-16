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
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }

  if (launchPromise) {
    return launchPromise;
  }

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
      browser.on('disconnected', () => {
        sharedBrowser = null;
      });
      return browser;
    } finally {
      launchPromise = null;
    }
  })();

  return launchPromise;
}

export function getDateCodes(url: string, filterDates?: string[]): string[] {
  // 1. Extract date from buytickets URL if present
  const m = url.match(/\/buytickets\/ET\d{8}\/(\d{8})/i) || url.match(/[?&]date=(\d{8})/i);
  if (m) {
    return [m[1]];
  }

  // 2. From filterDates
  if (filterDates && filterDates.length > 0) {
    const codes: string[] = [];
    for (const fd of filterDates) {
      if (/^\d{8}$/.test(fd)) {
        codes.push(fd);
        continue;
      }
      const cleaned = fd.replace(/\D/g, '');
      if (cleaned.length === 8) {
        codes.push(cleaned);
        continue;
      }
      // Try YYYY-MM-DD
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

  // 3. Default: today + next 2 days
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

export function dateCodeToLabel(dc: string): string {
  try {
    if (!/^\d{8}$/.test(dc)) return dc;
    const y = Number(dc.slice(0, 4));
    const m = Number(dc.slice(4, 6)) - 1;
    const d = Number(dc.slice(6, 8));
    const dt = new Date(y, m, d);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[dt.getDay()]}, ${String(dt.getDate()).padStart(2, '0')} ${months[dt.getMonth()]}`;
  } catch {
    return dc;
  }
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
          if (Object.keys(times).length > 0) {
            result[venueName] = times;
          }
        }
      }
    }
  }

  // Fallback: search recursively if standard showtimeWidgets not found
  if (Object.keys(result).length === 0) {
    function walk(obj: any) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const it of obj) walk(it);
        return;
      }
      if (obj.VenueName || obj.venueName || obj.cinemaName) {
        const venue = String(obj.VenueName || obj.venueName || obj.cinemaName).trim();
        const showtimes = obj.ShowTimes || obj.showTimes || obj.shows || [];
        if (Array.isArray(showtimes) && showtimes.length > 0) {
          if (!result[venue]) result[venue] = {};
          for (const st of showtimes) {
            const time = st.ShowTime || st.showTime || st.time;
            if (time) {
              result[venue][time] = classifyStyle(st.styleId || st.availStatus || st.status);
            }
          }
        }
      }
      for (const k of Object.keys(obj)) {
        walk(obj[k]);
      }
    }
    walk(data);
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
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
    });

    const page = await context.newPage();
    await page.addInitScript(STEALTH_SCRIPT);

    const capturedByDate: Record<string, any> = {};

    page.on('response', async (response) => {
      const u = response.url().toLowerCase();
      if (u.includes('showtime') || u.includes('primary-dynamic') || u.includes('buytickets') || u.includes('datecode=')) {
        const dcMatch = u.match(/datecode=(\d{8})/);
        const dc = dcMatch ? dcMatch[1] : '';
        try {
          const json = await response.json();
          const str = JSON.stringify(json);
          if (str.includes('showtimeWidgets') || str.includes('venue-card')) {
            const targetDc = dc || dateCodes[0] || 'unknown';
            capturedByDate[targetDc] = json;
          }
        } catch {
          // Non-JSON response
        }
      }
    });

    for (let i = 0; i < Math.min(dateCodes.length, 3); i++) {
      const dc = dateCodes[i];
      const navUrl = buildBuyticketsUrl(url, dc);
      console.log(`[Scraper] Navigating to (${dc}): ${navUrl}`);

      try {
        await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(3500);

        if (!capturedByDate[dc]) {
          const stateData = await page.evaluate(`(() => {
            const st = window.__INITIAL_STATE__ || window.__NEXT_DATA__;
            if (!st) return null;

            // Check queries in showtimesFunctionalApi
            const queries = st.showtimesFunctionalApi?.queries || {};
            for (const k in queries) {
              const qData = queries[k]?.data;
              if (qData && (qData.data?.showtimeWidgets || qData.showtimeWidgets)) {
                return qData;
              }
            }

            // Breadth-first widget finder
            const queue = [{ obj: st, depth: 0 }];
            while (queue.length > 0) {
              const item = queue.shift();
              if (!item || !item.obj || item.depth > 6) continue;
              if (item.obj.showtimeWidgets && Array.isArray(item.obj.showtimeWidgets)) return item.obj;
              for (const k in item.obj) {
                if (typeof item.obj[k] === 'object' && item.obj[k] !== null) {
                  queue.push({ obj: item.obj[k], depth: item.depth + 1 });
                }
              }
            }

            return null;
          })()`);

          if (stateData) {
            capturedByDate[dc] = stateData;
          }
        }

        const dateData = capturedByDate[dc];
        if (dateData) {
          const shows = parseShowtimeWidgets(dateData);
          if (Object.keys(shows).length > 0) {
            const label = dateCodeToLabel(dc);
            allShows[label] = shows;
            console.log(`[Scraper] Successfully extracted ${Object.keys(shows).length} venues for ${label}`);
          }
        }
      } catch (navErr: any) {
        console.warn(`[Scraper] Navigation failed for date ${dc}: ${navErr.message}`);
      }
    }

    return { shows: allShows };
  } catch (err: any) {
    console.error(`[Scraper] Scrape process exception: ${err.message}`);
    return { shows: {}, error: err.message };
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {
      // ignore
    }
    sharedBrowser = null;
  }
}
