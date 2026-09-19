import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  const url = "https://in.bookmyshow.com/movies/hyderabad/vibe/ET00506465";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(4000);
  const stateKeys = await page.evaluate(() => {
    const st = (window as any).__INITIAL_STATE__ || {};
    return Object.keys(st);
  });
  console.log("__INITIAL_STATE__ keys:", stateKeys);

  const matched = await page.evaluate(() => {
    const str = JSON.stringify((window as any).__INITIAL_STATE__ || {});
    const buytickets = str.match(/buytickets[^"\\]*/g) || [];
    return {
      buytickets: Array.from(new Set(buytickets)).slice(0, 10),
      hasShowtimes: str.includes('showtime'),
      hasVenue: str.includes('venue')
    };
  });
  console.log("Matched in __INITIAL_STATE__:", matched);

  await browser.close();
}

main().catch(console.error);
