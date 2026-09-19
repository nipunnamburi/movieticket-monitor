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

  const synopsisStore = await page.evaluate(() => {
    const st = (window as any).__INITIAL_STATE__ || {};
    return st.synopsisStore;
  });
  console.log("SynopsisStore:", JSON.stringify(synopsisStore, null, 2));

  await browser.close();
}

main().catch(console.error);
