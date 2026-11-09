const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('網站有新版本時，提醒重新整理；按「先不要」就不再提醒', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    let stamp = '"v1"';
    await page.context().route(/index\.html\?v=\d+/, (route) => route.fulfill({ status: 200, headers: { etag: stamp }, body: '' }));
    await page.evaluate(() => checkForUpdate()); // 記下目前版本
    await page.evaluate(() => checkForUpdate());
    await expect(page.locator('#update-banner')).toBeHidden();

    stamp = '"v2"';
    await page.evaluate(() => checkForUpdate());
    await expect(page.locator('#update-banner')).toBeVisible();
    await expect(page.locator('#update-banner')).toContainText('版本已更新，請重新整理');

    await page.click('#update-banner button[title="先不要"]');
    await expect(page.locator('#update-banner')).toBeHidden();
    stamp = '"v3"';
    await page.evaluate(() => checkForUpdate());
    await expect(page.locator('#update-banner')).toBeHidden();
});
