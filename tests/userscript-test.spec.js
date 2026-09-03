const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.setTimeout(120000);

test('Install userscript and verify Chess.com integration', async ({ page, context }) => {
  // Read the userscript
  const scriptPath = path.join(__dirname, '..', 'chess-ai-bot.user.js');
  const userscript = fs.readFileSync(scriptPath, 'utf8');
  
  // Inject the userscript directly into the page (simulating Tampermonkey)
  await page.addInitScript(userscript);
  
  // Go to Chess.com - use domcontentloaded instead of networkidle
  await page.goto('https://www.chess.com/play/online', { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Wait for page to load
  await page.waitForTimeout(5000);
  
  // Check if the script loaded (look for SF Engine logs)
  const consoleLogs = [];
  page.on('console', msg => {
    if (msg.text().includes('[SF Engine]')) {
      consoleLogs.push(msg.text());
    }
  });
  
  // Wait a bit more for engine to load
  await page.waitForTimeout(10000);
  
  // Check if SF Engine detected platform
  const platformLogs = consoleLogs.filter(l => l.includes('Platform detected'));
  console.log('Platform logs:', platformLogs);
  
  // Check if engine loading started
  const engineLogs = consoleLogs.filter(l => l.includes('loadLocalEngine'));
  console.log('Engine logs:', engineLogs);
  
  // Verify the script is running by checking for the UI button
  const sfButton = page.locator('text=SF ENGINE, text=Engine, [id*="bot"]').first();
  const hasUI = await sfButton.isVisible().catch(() => false);
  console.log('UI visible:', hasUI);
  
  // Log all console messages for debugging
  console.log('All SF Engine logs:', consoleLogs);
  
  // The test passes if the script loaded without ReferenceError
  expect(consoleLogs.some(l => l.includes('ReferenceError'))).toBeFalsy();
});

test('Verify no ReferenceError on Chess.com', async ({ page }) => {
  test.setTimeout(120000);
  const scriptPath = path.join(__dirname, '..', 'chess-ai-bot.user.js');
  const userscript = fs.readFileSync(scriptPath, 'utf8');
  
  await page.addInitScript(userscript);
  
  // Track all errors
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  
  await page.goto('https://www.chess.com/play/online', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000);
  
  // Filter for our script errors
  const scriptErrors = errors.filter(e => e.includes('SF Engine') || e.includes('getRawBoardFEN') || e.includes('ReferenceError'));
  console.log('Script errors:', scriptErrors);
  
  // Should have no ReferenceError
  expect(scriptErrors.some(e => e.includes('ReferenceError') || e.includes('getRawBoardFEN'))).toBeFalsy();
});