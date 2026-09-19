import asyncio
from playwright.async_api import async_playwright
import re

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = await ctx.new_page()
        
        # Test direct buytickets with city slug
        buytickets_url = "https://in.bookmyshow.com/buytickets/vibe-hyderabad/movie-hyd-ET00506465-MT/20260919"
        print(f"Navigating directly to: {buytickets_url}")
        await page.goto(buytickets_url, wait_until="domcontentloaded", timeout=35000)
        await page.wait_for_timeout(4000)
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
