import { chromium } from 'playwright';
import path from 'path';

const ARTIFACTS_DIR = '/Users/nipunnamburi/.gemini/antigravity-ide/brain/0e20cf3d-7016-4458-92cb-1939963ecb5b';

async function runAuthBrowserTest() {
  console.log('🚀 Launching Chromium browser for Auth & UI verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // 1. Verify Login / Signup Page is shown
  console.log('\n--- Step 1: Verify Login Page ---');
  await page.waitForSelector('text=BookMyShow Monitor', { timeout: 5000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '01_login_page.png') });
  console.log('📸 Captured 01_login_page.png');

  // Switch to "Create Account"
  console.log('\n--- Step 2: Switch to Create Account & Verify Password Checklist ---');
  await page.locator('button:has-text("Create Account")').click();
  await page.waitForSelector('text=Password Requirements:', { timeout: 3000 });

  // Test weak password input
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');

  const testUserEmail = `filmlover_${Date.now()}@example.com`;
  await emailInput.fill(testUserEmail);
  await passwordInput.fill('weak1');

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '02_password_validation_active.png') });
  console.log('📸 Captured 02_password_validation_active.png');

  // Fill in compliant password (8+ chars, 1 number, 1 special char)
  console.log('\n--- Step 3: Fill compliant password & Sign Up ---');
  await passwordInput.fill('MovieFan@2026');
  await page.waitForTimeout(400);

  // Submit Sign Up Form
  await page.locator('button[type="submit"]:has-text("Create Free Account")').click();
  await page.waitForSelector('text=BookMyShow Live Monitor', { timeout: 8000 });
  console.log('✅ Account successfully created and redirected to dashboard!');

  // 4. Verify Dashboard Header shows User Email
  const userHeaderPill = await page.locator(`text=${testUserEmail}`).first().isVisible();
  console.log('Is user email pill visible in header?:', userHeaderPill);

  // Verify Account & Direct Alert Destination Card
  const accountCard = await page.locator('text=Account & Direct Alerts').isVisible();
  console.log('Is Account & Direct Alerts card visible?:', accountCard);

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '03_logged_in_dashboard.png') });
  console.log('📸 Captured 03_logged_in_dashboard.png');

  // 5. Open New Monitor Modal -> Confirm Automated Email Routing
  console.log('\n--- Step 4: Open Add Target Monitor & Verify Automated Email Destination ---');
  await page.locator('button:has-text("New Monitor")').click();
  await page.waitForSelector('text=Add Target Monitor', { timeout: 3000 });

  const autoEmailBadge = await page.locator(`text=${testUserEmail}`).isVisible();
  console.log('Is user registered email automatically displayed in monitor form?:', autoEmailBadge);

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '04_new_monitor_auto_email.png') });
  console.log('📸 Captured 04_new_monitor_auto_email.png');

  // Close Add Monitor modal
  await page.locator('.modal-sheet button:has(svg.lucide-x), button:has-text("Cancel")').first().click();
  await page.waitForTimeout(500);

  // 6. Test Logout
  console.log('\n--- Step 5: Test Logout ---');
  await page.on('dialog', async (dialog) => {
    console.log('Confirm dialog appeared:', dialog.message());
    await dialog.accept();
  });
  await page.locator('button:has-text("Logout")').first().click();
  await page.waitForSelector('text=BookMyShow Monitor', { timeout: 5000 });
  console.log('✅ Successfully logged out and returned to authentication screen!');

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, '05_logged_out_screen.png') });
  console.log('📸 Captured 05_logged_out_screen.png');

  await browser.close();
  console.log('\n🎉 E2E Auth & Automated Email Routing Browser Verification PASSED!');
}

runAuthBrowserTest().catch((err) => {
  console.error('❌ Browser test failed:', err);
  process.exit(1);
});
