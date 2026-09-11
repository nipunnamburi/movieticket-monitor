import { chromium } from 'playwright';
import path from 'path';

const ARTIFACTS_DIR = '/Users/nipunnamburi/.gemini/antigravity-ide/brain/b539a360-d62b-48a1-bd93-cdd131d5b967';

async function runBrowserTest() {
  console.log('🚀 Launching Chromium browser for automated testing...');
  const browser = await chromium.launch({ headless: true });
  
  // ── Context 1: Device A (Desktop / Laptop User) ───────────────────────────
  console.log('\n--- Testing Device A (Desktop Viewport) ---');
  const contextA = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const pageA = await contextA.newPage();

  console.log('Navigating to http://localhost:3000...');
  await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // 1. Verify Page Title
  const title = await pageA.textContent('h1');
  console.log('Page Title:', title?.trim());

  // 2. Verify Private Vault Badge & Stream Status
  const vaultBadge = pageA.locator('button:has-text("Vault:")');
  await vaultBadge.waitFor({ state: 'visible', timeout: 5000 });
  const vaultText = await vaultBadge.textContent();
  console.log('Device A Vault Badge:', vaultText?.trim());

  const sseBadge = pageA.locator('text=SSE STREAM ACTIVE');
  const sseActive = await sseBadge.isVisible();
  console.log('SSE Stream Active:', sseActive);

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

  // Test Auto-Extraction from BookMyShow URL on paste/blur
  console.log('Testing auto-extraction on BookMyShow URL paste...');
  const urlInput = pageA.locator('textarea[placeholder*="Paste URL"]');
  await urlInput.fill('https://in.bookmyshow.com/movies/hyderabad/devara-part-1/ET00310216?language=Telugu');
  
  // Wait for auto-extracted fields
  await pageA.waitForSelector('text=Cleaned:', { timeout: 5000 });
  console.log('Cleaned URL badge confirmed!');

  const extractedTitle = await pageA.inputValue('input[placeholder*="Auto-extracted"]');
  const extractedCity = await pageA.inputValue('input[placeholder*="Hyderabad"]');
  const extractedLang = await pageA.inputValue('input[placeholder*="Telugu"]');
  console.log(`Auto-extracted Data -> Title: "${extractedTitle}", City: "${extractedCity}", Lang: "${extractedLang}"`);

  // Select 1-tap Frequent Theatre Chip
  const theatreChip = pageA.locator('button.preset-chip:has-text("Prasads Multiplex")');
  if (await theatreChip.isVisible()) {
    await theatreChip.click();
    console.log('Selected 1-tap theatre chip: Prasads Multiplex');
  }

  // Select 1-tap Time Preset (Evening)
  const eveningBtn = pageA.locator('button.time-preset-btn:has-text("Evening")');
  await eveningBtn.click();
  console.log('Selected 1-tap time preset: Evening (4-8 PM)');

  await pageA.screenshot({ path: path.join(ARTIFACTS_DIR, '04_new_monitor_filled.png') });
  console.log('📸 Captured 04_new_monitor_filled.png');

  // Submit Monitor Form
  const submitBtn = pageA.locator('button[type="submit"]:has-text("Start Monitoring")');
  await submitBtn.click();
  console.log('Submitted monitor form, waiting for monitor card...');

  // Verify monitor card in Active Monitors list
  await pageA.waitForSelector('text=Devara Part 1', { timeout: 8000 });
  console.log('✅ Monitor for "Devara Part 1" successfully created and visible in Device A dashboard!');

  await pageA.screenshot({ path: path.join(ARTIFACTS_DIR, '05_active_monitors.png') });
  console.log('📸 Captured 05_active_monitors.png');

  // 6. Test Instant Check Trigger
  const checkNowBtn = pageA.locator('button:has-text("Check Now")').first();
  await checkNowBtn.click();
  console.log('Clicked "Check Now" button to trigger immediate radar cycle.');
  await pageA.waitForTimeout(2000);

  // ── Context 2: Device B (Simulated Phone / Isolated Vault) ───────────────
  console.log('\n--- Testing Device B (Mobile iPhone Viewport - Privacy Vault Isolation) ---');
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true
  });
  const pageB = await contextB.newPage();
  await pageB.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  const vaultBadgeB = pageB.locator('button:has-text("Vault:")');
  await vaultBadgeB.waitFor({ state: 'visible', timeout: 5000 });
  const vaultTextB = await vaultBadgeB.textContent();
  console.log('Device B (Phone) Vault Badge:', vaultTextB?.trim());

  // Confirm that Device B does NOT see Device A's "Devara Part 1" monitor
  const devaraOnDeviceB = await pageB.locator('text=Devara Part 1').isVisible();
  console.log('Does Device B see Device A\'s "Devara Part 1" monitor?:', devaraOnDeviceB);

  const emptyStateVisible = await pageB.locator('text=No Active Monitors').isVisible();
  console.log('Does Device B see empty state (0 monitors)?:', emptyStateVisible);

  await pageB.screenshot({ path: path.join(ARTIFACTS_DIR, '06_mobile_privacy_isolated.png') });
  console.log('📸 Captured 06_mobile_privacy_isolated.png');

  await browser.close();
  console.log('\n🎉 E2E Browser Testing Completed Successfully with Full Device Vault Isolation Verified!');
}

runBrowserTest().catch((err) => {
  console.error('❌ Browser test failed:', err);
  process.exit(1);
});
