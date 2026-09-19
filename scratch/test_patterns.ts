import { chromium } from 'playwright';

async function test(slug: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });
  const url = `https://in.bookmyshow.com/buytickets/${slug}/20260919`;
  console.log("Testing:", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
  await page.waitForTimeout(4000);
  const title = await page.title();
  const hasShowtimes = await page.evaluate(() => {
    const st = (window as any).__INITIAL_STATE__ || {};
    return !!st.showtimesFunctionalApi;
  });
  console.log(`URL: ${url} -> Title: "${title}", hasShowtimes: ${hasShowtimes}`);
  await browser.close();
}

async function main() {
  await test("vibe-hyderabad/movie-hyd-ET00506465-MT");
  await test("vibe/movie-hyd-ET00506465-MT");
  await test("vibe/ET00506465");
  await test("vibe-hyderabad/ET00506465");
}

main().catch(console.error);
