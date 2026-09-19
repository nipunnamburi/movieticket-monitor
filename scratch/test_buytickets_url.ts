import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  const url = "https://in.bookmyshow.com/buytickets/vibe-hyderabad/movie-hyd-ET00506465-MT/20260919";
  console.log("Navigating to direct buytickets URL:", url);

  page.on("response", async r => {
    const u = r.url();
    if (u.includes("showtime") || u.includes("primary-dynamic") || u.includes("buytickets")) {
      console.log("Intercepted XHR:", u);
      try {
        const j = await r.json();
        console.log("XHR has data:", !!j.data, "showtimeWidgets count:", j.data?.showtimeWidgets?.length);
      } catch {}
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(4000);

  const title = await page.title();
  console.log("Page title:", title);

  const stateData = await page.evaluate(() => {
    const st = (window as any).__INITIAL_STATE__ || {};
    return {
      keys: Object.keys(st),
      hasShowtimesFunctionalApi: !!st.showtimesFunctionalApi
    };
  });
  console.log("State on buytickets page:", stateData);

  await browser.close();
}

main().catch(console.error);
