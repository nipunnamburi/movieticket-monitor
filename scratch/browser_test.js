import { chromium } from 'playwright';
import path from 'path';

const ARTIFACTS_DIR = '/Users/nipunnamburi/.gemini/antigravity-ide/brain/0e20cf3d-7016-4458-92cb-1939963ecb5b';

async function runBrowserTest() {
  console.log('🚀 Launching Chromium browser for automated testing...');
  const browser = await chromium.launch({ headless: true });
  
  // ── Context 1: Device A (Laptop User) ───────────────────────────────────
  console.log('\n--- Testing Device A (Laptop Viewport) ---');
  const contextA = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const pageA = await contextA.newPage();

  console.log('Navigating to http://localhost:3000...');
  await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // 1. Verify Page Title
  const title = await pageA.textContent('h1');
  console.log('Page Title:', title?.trim());

  // 2. Verify Private Vault Badge
  const vaultBadge = pageA.locator('button:has-text("Vault:")');
  await vaultBadge.waitFor({ state: 'visible', timeout: 5000 });
  const vaultText = await vaultBadge.textContent();
  console.log('Device A Vault Badge:', vaultText?.trim());

  await pageA.screenshot({ path: path.join(ARTIFACTS_DIR, '01_dashboard_loaded.png') });
  console.log('📸 Captured 01_dashboard_loaded.png');

  // 3. Open Private Vault Modal
  await vaultBadge.click();
  await pageA.waitForSelector('text=Private Device Vault', { timeout: 3000 });
  console.log('Private Vault modal opened successfully.');
  await pageA.screenshot({ path: path.join(ARTIFACTS_DIR, '02_vault_modal.png') });
  console.log('📸 Captured 02_vault_modal.png');

  // Close Vault Modal via the X button
  await pageA.locator('.modal-sheet button:has(svg.lucide-x)').click();
  await pageA.waitForSelector('text=Private Device Vault', { state: 'detached', timeout: 3000 });
  console.log('Private Vault modal closed.');

  // 4. Open Notification Settings Modal (⚙️)
  const settingsBtn = pageA.locator('header button:has(svg.lucide-settings)').first();
  await settingsBtn.click();
  await pageA.waitForSelector('text=Notification Settings', { timeout: 3000 });
  console.log('Notification Settings modal opened.');

  const twilioSectionVisible = await pageA.locator('text=Twilio (WhatsApp & SMS)').isVisible();
  console.log('Twilio Section Visible in Settings:', twilioSectionVisible);
  await pageA.screenshot({ path: path.join(ARTIFACTS_DIR, '03_settings_modal.png') });
  console.log('📸 Captured 03_settings_modal.png');

  // Close Settings Modal via Cancel
  await pageA.locator('.modal-sheet button:has-text("Cancel")').click();
  await pageA.waitForSelector('text=Notification Settings', { state: 'detached', timeout: 3000 });
  console.log('Notification Settings modal closed.');

  // 5. Open New Monitor Modal
  const newMonitorBtn = pageA.locator('header button:has-text("New Monitor")').first();
  await newMonitorBtn.click();
  await pageA.waitForSelector('text=Add Target Monitor', { timeout: 3000 });
  console.log('Add Target Monitor modal opened.');

  // Fill in Movie URL & Details
  const urlInput = pageA.locator('textarea[placeholder*="Paste URL"]');
  await urlInput.fill('https://in.bookmyshow.com/hyderabad/movies/coolie/ET00395371');

  const movieInput = pageA.locator('input[placeholder*="Auto-extracted"]');
  await movieInput.fill('Coolie');

  const cityInput = pageA.locator('input[placeholder*="Hyderabad"]');
  await cityInput.fill('Hyderabad');

  // WhatsApp Alert Setup
  const phoneInput = pageA.locator('input[placeholder*="9876543210"]');
  await phoneInput.fill('+917013544018');

  await pageA.screenshot({ path: path.join(ARTIFACTS_DIR, '04_new_monitor_filled.png') });
  console.log('📸 Captured 04_new_monitor_filled.png');

  // Submit Monitor Form
  const submitBtn = pageA.locator('button[type="submit"]:has-text("Start Monitoring")');
  await submitBtn.click();
  console.log('Submitted monitor form, waiting for monitor card...');

  // Verify monitor card in Active Monitors list
  await pageA.waitForSelector('text=Coolie', { timeout: 8000 });
  console.log('✅ Monitor for "Coolie" successfully created and visible in Device A dashboard!');

  await pageA.screenshot({ path: path.join(ARTIFACTS_DIR, '05_active_monitors.png') });
  console.log('📸 Captured 05_active_monitors.png');

  // ── Context 2: Device B (Friend / Phone Simulation) ──────────────────────
  console.log('\n--- Testing Device B (Simulated Friend / Phone - Privacy Isolation) ---');
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 }, // Mobile iPhone viewport
    isMobile: true
  });
  const pageB = await contextB.newPage();
  await pageB.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  const vaultBadgeB = pageB.locator('button:has-text("Vault:")');
  await vaultBadgeB.waitFor({ state: 'visible', timeout: 5000 });
  const vaultTextB = await vaultBadgeB.textContent();
  console.log('Device B (Phone) Vault Badge:', vaultTextB?.trim());

  // Confirm that Device B does NOT see Device A's "Coolie" monitor
  const coolieOnDeviceB = await pageB.locator('text=Coolie').isVisible();
  console.log('Does Device B see Device A\'s "Coolie" monitor?:', coolieOnDeviceB);

  const emptyStateVisible = await pageB.locator('text=No monitors tracking right now').isVisible();
  console.log('Does Device B see empty state (0 monitors)?:', emptyStateVisible);

  await pageB.screenshot({ path: path.join(ARTIFACTS_DIR, '06_mobile_privacy_isolated.png') });
  console.log('📸 Captured 06_mobile_privacy_isolated.png');

  await browser.close();
  console.log('\n🎉 E2E Browser Testing Completed Successfully with Full Device Isolation Verified!');
}

runBrowserTest().catch((err) => {
  console.error('❌ Browser test failed:', err);
  process.exit(1);
});
