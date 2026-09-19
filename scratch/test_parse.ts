import { chromium } from 'playwright';
import { parseShowtimeWidgets } from '../apps/worker/src/scraper.js';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  const url = "https://in.bookmyshow.com/buytickets/vibe-hyderabad/movie-hyd-ET00506465-MT/20260919";

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(4000);

  const rawWidgetData = await page.evaluate(() => {
    const st = (window as any).__INITIAL_STATE__ || {};
    const q = st.showtimesFunctionalApi?.queries || {};
    const target = q["fetchPrimaryDynamic-ET00506465---20260919-HYD"]?.data;
    return target;
  });

  console.log("Raw widget keys:", Object.keys(rawWidgetData || {}));
  const parsed = parseShowtimeWidgets(rawWidgetData);
  console.log("Parsed venues count:", Object.keys(parsed).length);
  for (const [venue, times] of Object.entries(parsed).slice(0, 5)) {
    console.log(`Venue: ${venue}`);
    console.log(`  Times:`, times);
  }

  await browser.close();
}

main().catch(console.error);
