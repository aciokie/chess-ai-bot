const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.setTimeout(300000);

// Mock Violentmonkey/Tampermonkey GM APIs for testing
const GM_MOCK = `
// Mock GM APIs for testing
window.GM_getValue = (key, defaultValue) => {
  const store = window.__GM_STORE || {};
  return store[key] !== undefined ? store[key] : defaultValue;
};
window.GM_setValue = (key, value) => {
  window.__GM_STORE = window.__GM_STORE || {};
  window.__GM_STORE[key] = value;
};
window.GM_deleteValue = (key) => {
  if (window.__GM_STORE) delete window.__GM_STORE[key];
};
window.GM_xmlhttpRequest = (options) => {
  // Mock implementation - in real test we'd use fetch
  const url = options.url;
  fetch(url, { cache: 'no-cache' })
    .then(r => {
      if (options.responseType === 'arraybuffer') return r.arrayBuffer();
      return r.text();
    })
    .then(data => options.onload({ status: 200, response: data, responseText: typeof data === 'string' ? data : new TextDecoder().decode(data) }))
    .catch(e => options.onerror && options.onerror(e));
  return { abort: () => {} };
};
window.GM_openInTab = (url) => window.open(url);
window.GM_info = {
  script: { name: 'Chess AI Bot', version: 'test', author: 'test' },
  scriptHandler: 'Violentmonkey'
};
window.GM_getResourceText = (name) => '';
window.GM_addStyle = (css) => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
};
`;

test('Install Tampermonkey, create Chess.com account, install userscript', async ({ page, context }) => {
  const scriptPath = path.join(__dirname, '..', 'chess-ai-bot.user.js');
  const userscript = fs.readFileSync(scriptPath, 'utf8');
  
  // Track all console logs and errors
  const consoleLogs = [];
  const errors = [];
  
  page.on('console', msg => {
    if (msg.text().includes('[SF Engine]') || msg.text().includes('ReferenceError')) {
      consoleLogs.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  
  // Inject GM mock first, then userscript
  await page.addInitScript(GM_MOCK);
  await page.addInitScript(userscript);
  
  // Go to Chess.com login/register
  await page.goto('https://www.chess.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  // Check if we need to create an account
  // For now, let's just verify the script loads on the login page
  await page.waitForTimeout(5000);
  
  // Check for SF Engine logs
  const platformLogs = consoleLogs.filter(l => l.includes('Platform detected'));
  console.log('Platform logs:', platformLogs);
  
  const engineLogs = consoleLogs.filter(l => l.includes('loadLocalEngine') || l.includes('Engine ready'));
  console.log('Engine logs:', engineLogs);
  
  const refErrors = consoleLogs.filter(l => l.includes('ReferenceError'));
  console.log('ReferenceError logs:', refErrors);
  
  // Check for any page errors
  const scriptErrors = errors.filter(e => e.includes('SF Engine') || e.includes('getRawBoardFEN') || e.includes('ReferenceError'));
  console.log('Page errors:', scriptErrors);
  
  // Should have no ReferenceError
  expect(consoleLogs.some(l => l.includes('ReferenceError') || l.includes('getRawBoardFEN'))).toBeFalsy();
  expect(errors.some(e => e.includes('ReferenceError') || e.includes('getRawBoardFEN'))).toBeFalsy();
});

test('Test userscript on Chess.com play page (after manual login)', async ({ page, context }) => {
  // This test assumes you've already logged in manually
  // Run with: npx playwright test --project=chromium --headed
  
  const scriptPath = path.join(__dirname, '..', 'chess-ai-bot.user.js');
  const userscript = fs.readFileSync(scriptPath, 'utf8');
  
  const consoleLogs = [];
  const errors = [];
  
  page.on('console', msg => {
    if (msg.text().includes('[SF Engine]') || msg.text().includes('ReferenceError')) {
      consoleLogs.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  
  await page.addInitScript(GM_MOCK);
  await page.addInitScript(userscript);
  
  // Go to play page - will redirect to login if not authenticated
  await page.goto('https://www.chess.com/play/online', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // Check if we're on login page
  const url = page.url();
  console.log('Current URL:', url);
  
  if (url.includes('/login') || url.includes('/register')) {
    console.log('On login page - need to authenticate first');
    // Could automate account creation here with temp email
    // For now, just verify script loads without error on login page
  } else {
    // On play page - check for engine
    await page.waitForTimeout(10000);
    
    const engineLogs = consoleLogs.filter(l => l.includes('loadLocalEngine') || l.includes('Engine ready'));
    console.log('Engine logs:', engineLogs);
  }
  
  // Should have no ReferenceError
  expect(consoleLogs.some(l => l.includes('ReferenceError') || l.includes('getRawBoardFEN'))).toBeFalsy();
  expect(errors.some(e => e.includes('ReferenceError') || e.includes('getRawBoardFEN'))).toBeFalsy();
});