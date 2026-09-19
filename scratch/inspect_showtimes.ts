import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  const url = "https://in.bookmyshow.com/buytickets/vibe-hyderabad/movie-hyd-ET00506465-MT/20260919";

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(4000);

  const showtimeData = await page.evaluate(() => {
    const st = (window as any).__INITIAL_STATE__ || {};
    const q = st.showtimesFunctionalApi?.queries || {};
    const keys = Object.keys(q);
    const result: any = {};
    for (const k of keys) {
      result[k] = {
        status: q[k]?.status,
        hasData: !!q[k]?.data,
        hasWidgets: !!(q[k]?.data?.showtimeWidgets || q[k]?.data?.data?.showtimeWidgets),
        widgetsCount: (q[k]?.data?.showtimeWidgets || q[k]?.data?.data?.showtimeWidgets)?.length
      };
    }
    return {
      queryKeys: keys,
      queries: result,
      showtimesByEvent: st.showtimesByEvent
    };
  });

  console.log("Showtimes data in state:", JSON.stringify(showtimeData, null, 2));

  await browser.close();
}

main().catch(console.error);
