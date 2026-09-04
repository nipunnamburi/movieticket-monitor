import { chromium, Browser } from 'playwright';
import { SnapshotShows } from '@bms/shared';

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return sharedBrowser;
}

export async function fetchBmsShows(url: string): Promise<{ shows: SnapshotShows; error?: string }> {
  // Strategy 1: Fast direct HTTP fetch with mobile-web User-Agent & headers
  try {
    const directResult = await fetchViaDirectApi(url);
    if (directResult && Object.keys(directResult).length > 0) {
      return { shows: directResult };
    }
  } catch (err: any) {
    console.warn(`[Scraper] Direct API attempt failed: ${err.message}. Falling back to browser interceptor...`);
  }

  // Strategy 2: Headless Browser XHR & __INITIAL_STATE__ interceptor
  try {
    const browserResult = await fetchViaBrowser(url);
    return { shows: browserResult };
  } catch (err: any) {
    console.error(`[Scraper] Browser interception failed: ${err.message}`);
    return { shows: {}, error: err.message };
  }
}

async function fetchViaDirectApi(url: string): Promise<SnapshotShows | null> {
  const eventMatch = url.match(/(ET\d{8})/);
  const cityMatch = url.match(/in\.bookmyshow\.com\/movies\/([^/]+)/);
  if (!eventMatch || !cityMatch) return null;

  const eventCode = eventMatch[1];
  const city = cityMatch[1];

  const regionMap: Record<string, string> = {
    mumbai: 'MUMBAI',
    hyderabad: 'HYD',
    secunderabad: 'HYD',
    bengaluru: 'BANG',
    bangalore: 'BANG',
    delhi: 'NCR',
    ncr: 'NCR',
    chennai: 'CHEN',
    kolkata: 'KOLK',
    pune: 'PUNE',
    ahmedabad: 'AHED',
  };
  const regionCode = regionMap[city.toLowerCase()] || city.toUpperCase().slice(0, 4);

  // Generate today and tomorrow date codes (YYYYMMDD)
  const today = new Date();
  const dateCodes = [0, 1, 2].map((offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  });

  const allShows: SnapshotShows = {};

  for (const dateCode of dateCodes) {
    const apiUrl = `https://in.bookmyshow.com/api/explore/v1/discover/regions/${regionCode}/movies/${eventCode}/shows?date=${dateCode}`;
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        'Accept': 'application/json, text/plain, */*',
        'Referer': url,
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) continue;

    const data = (await res.json()) as any;
    const dateLabel = formatDateCode(dateCode);
    const dateShows = parseBmsApiResponse(data);
    if (Object.keys(dateShows).length > 0) {
      allShows[dateLabel] = dateShows;
    }
  }

  return Object.keys(allShows).length > 0 ? allShows : null;
}

async function fetchViaBrowser(url: string): Promise<SnapshotShows> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  const capturedResponses: any[] = [];

  page.on('response', async (response) => {
    const resUrl = response.url().toLowerCase();
    if (resUrl.includes('showtime') || resUrl.includes('shows') || resUrl.includes('buytickets')) {
      try {
        const json = await response.json();
        capturedResponses.push(json);
      } catch {
        // Not JSON
      }
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Also extract embedded page state
    const pageState = await page.evaluate(() => {
      return (window as any).__INITIAL_STATE__ || (window as any).__NEXT_DATA__?.props?.pageProps;
    });

    if (pageState) {
      capturedResponses.push(pageState);
    }
  } finally {
    await context.close();
  }

  const allShows: SnapshotShows = {};
  for (const resp of capturedResponses) {
    const shows = parseBmsApiResponse(resp);
    const dateLabel = formatDateCode(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    if (Object.keys(shows).length > 0) {
      allShows[dateLabel] = { ...(allShows[dateLabel] || {}), ...shows };
    }
  }

  return allShows;
}

function parseBmsApiResponse(data: any): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  if (!data || typeof data !== 'object') return result;

  // Search venues / cinemas recursively
  function walk(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }

    if (obj.VenueName || obj.venueName || obj.cinemaName) {
      const venue = String(obj.VenueName || obj.venueName || obj.cinemaName).trim();
      const showtimes = obj.ShowTimes || obj.showTimes || obj.shows || [];
      if (Array.isArray(showtimes) && showtimes.length > 0) {
        if (!result[venue]) result[venue] = {};
        for (const st of showtimes) {
          const time = st.ShowTime || st.showTime || st.time;
          const status = classifyShowStatus(st);
          if (time) {
            result[venue][time] = status;
          }
        }
      }
    }

    for (const key of Object.keys(obj)) {
      walk(obj[key]);
    }
  }

  walk(data);
  return result;
}

function classifyShowStatus(showItem: any): string {
  const code = String(showItem.AvailStatus || showItem.availStatus || showItem.status || '').toLowerCase();
  const color = String(showItem.styleId || showItem.color || '').toLowerCase();

  if (code === '0' || code.includes('sold') || color.includes('grey') || color.includes('gray')) {
    return 'sold-out';
  }
  if (code === '2' || code.includes('fast') || color.includes('orange')) {
    return 'fast-filling';
  }
  return 'available';
}

function formatDateCode(dc: string): string {
  try {
    const y = Number(dc.slice(0, 4));
    const m = Number(dc.slice(4, 6)) - 1;
    const d = Number(dc.slice(6, 8));
    const date = new Date(y, m, d);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]}`;
  } catch {
    return dc;
  }
}
