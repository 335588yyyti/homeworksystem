// 潔牙站：點牙齒打勾、完成度、每天自動歸零、重置、倒數計時
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('潔牙站：學生點自己的牙齒打勾，再點一次取消；換一天自動歸零', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.click('#tab-brush');
    await expect(page.locator('#view-brush')).toBeVisible();
    await expect(page.locator('#slogan-section')).toBeHidden();
    await expect(page.locator('#brush-grid > button')).toHaveCount(28);
    await expect(page.locator('#brush-progress')).toHaveText('0/28');

    await page.click('#brush-5');
    await page.click('#brush-9');
    await expect(page.locator('#brush-5')).toHaveClass(/done/);
    await expect(page.locator('#brush-progress')).toHaveText('2/28');
    await page.click('#brush-9');
    await expect(page.locator('#brush-9')).not.toHaveClass(/done/);
    await expect(page.locator('#brush-progress')).toHaveText('1/28');

    // 重新整理後還在
    await page.reload();
    await page.click('#tab-brush');
    await expect(page.locator('#brush-progress')).toHaveText('1/28');

    // 換一天：自動歸零
    await page.evaluate(() => {
        const key = 'checkpoint_brush_' + getClassCode();
        const data = JSON.parse(localStorage.getItem(key));
        data.date = '2000-01-01';
        localStorage.setItem(key, JSON.stringify(data));
        renderBrush();
    });
    await expect(page.locator('#brush-progress')).toHaveText('0/28');

    // 重置
    await page.click('#brush-3');
    await page.click('button:has-text("🔄 重置")');
    await expect(page.locator('#brush-progress')).toHaveText('0/28');

    // 回到看板：標語橫幅恢復
    await page.click('#tab-dashboard');
    await expect(page.locator('#slogan-section')).toBeVisible();
});

test('潔牙站倒數計時：開始、暫停、時間到提示', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.click('#tab-brush');
    await expect(page.locator('#brush-timer-display')).toHaveText('03:00');
    await page.selectOption('#brush-timer-minutes', '1');
    await expect(page.locator('#brush-timer-display')).toHaveText('01:00');
    await page.evaluate(() => { brushRemaining = 2; renderBrushTimer(); });
    await page.click('#brush-timer-start');
    await expect(page.locator('#brush-timer-start')).toHaveText('暫停');
    await expect(page.locator('#brush-timer-display')).toHaveText('00:00', { timeout: 5000 });
    await expect(page.locator('#toast-msg')).toContainText('時間到');
    await expect(page.locator('#brush-timer-box')).toHaveClass(/brush-timer-done/);
    await page.click('button:has-text("重設")');
    await expect(page.locator('#brush-timer-display')).toHaveText('01:00');
});
