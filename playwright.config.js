// 自動測試設定：npm test（測試檔在 tests/，Firebase 以記憶體模擬，不會連到真正的雲端）
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    timeout: 60000,
    fullyParallel: true,
    retries: 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        browserName: 'chromium',
        viewport: { width: 1366, height: 768 }
    }
});
