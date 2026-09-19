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

  const synopsisData = await page.evaluate(() => {
    const st = (window as any).__INITIAL_STATE__ || {};
    return {
      synopsisMoviesApi: st.synopsisMoviesApi,
      synopsisStore: st.synopsisStore,
    };
  });
  console.log("Synopsis info:", JSON.stringify(synopsisData, null, 2).slice(0, 2000));

  await browser.close();
}

main().catch(console.error);
