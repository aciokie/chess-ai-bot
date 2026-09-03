const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  use: {
    browserName: 'chromium',
    headless: false,
    trace: 'on-first-retry',
    launchOptions: {
      executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    }
  }
});
