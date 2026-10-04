// 自動測試設定：npm test（測試檔在 tests/，Firebase 以記憶體模擬，不會連到真正的雲端）
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    timeout: 60000,
    // GitHub 的測試電腦較慢、又同時跑很多項：等待畫面或雲端資料的上限放寬到 10 秒
    expect: { timeout: 10000 },
    fullyParallel: true,
    retries: 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        browserName: 'chromium',
        viewport: { width: 1366, height: 768 }
    }
});
