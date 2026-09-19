import asyncio
from playwright.async_api import async_playwright
import re

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ])
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="en-IN"
        )
        page = await ctx.new_page()
        
        # Test movie synopsis resolution
        movie_url = "https://in.bookmyshow.com/movies/hyderabad/vibe/ET00506465"
        print(f"Navigating to movie URL: {movie_url}")
        await page.goto(movie_url, wait_until="domcontentloaded", timeout=35000)
        await page.wait_for_timeout(3500)
        
        resolved = await page.evaluate('''() => {
            const st = window.__INITIAL_STATE__ || {};
            const q = st.synopsisMoviesApi?.queries || {};
            const firstKey = Object.keys(q)[0];
            if (!firstKey) return null;
            const qData = q[firstKey];
            const event = qData?.data?.meta?.event || {};
            const rgn = qData?.originalArgs?.regionCode || "";
            return {
                eventName: event.eventName,
                eventCode: event.eventCode,
                eventType: event.eventType || "MT",
                regionCode: rgn
            };
        }''')
        print(f"Resolved from page: {resolved}")
        
        if resolved:
            slug = re.sub(r'[^a-z0-9]+', '-', (resolved.get("eventName") or "movie").lower()).strip('-')
            rgn = (resolved.get("regionCode") or "hyd").lower()
            ecode = resolved.get("eventCode")
            etype = resolved.get("eventType")
            buytickets_url = f"https://in.bookmyshow.com/buytickets/{slug}/movie-{rgn}-{ecode}-{etype}/20260919"
            print(f"Constructed buytickets URL: {buytickets_url}")
            
            await page.goto(buytickets_url, wait_until="domcontentloaded", timeout=35000)
            await page.wait_for_timeout(3500)
            title = await page.title()
            print(f"Buytickets Page Title: {title}")
            
            # Extract showtimes
            shows_data = await page.evaluate('''() => {
                const st = window.__INITIAL_STATE__ || {};
                const queries = st.showtimesFunctionalApi?.queries || {};
                for (const k in queries) {
                    const qData = queries[k]?.data;
                    if (qData && (qData.data?.showtimeWidgets || qData.showtimeWidgets)) {
                        return qData;
                    }
                }
                return null;
            }''')
            print(f"Showtimes data captured successfully: {bool(shows_data)}")
        
        await browser.close()

asyncio.run(main())
