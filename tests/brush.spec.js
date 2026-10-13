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
    await page.evaluate(() => { state.brush.date = '2000-01-01'; renderBrush(); });
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

test('潔牙紀錄存在雲端：另一台裝置看得到，家長頁顯示今日潔牙', async ({ browser }) => {
    test.setTimeout(60000);
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud);
    const code = await room.evaluate(() => state.students.find((s) => s.id === 6).parentCode);
    await expect.poll(() => cloud.view(code), { timeout: 20000 }).toBeTruthy();
    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#parent-brush')).toContainText('還沒登記');

    await room.click('#tab-brush');
    await room.click('#brush-6');
    await room.click('#brush-7');
    // 最後一次點擊後 5 秒才一次存雲端（只更新潔牙這一欄）
    await expect.poll(() => cloud.board('main').brush?.done, { timeout: 12000 }).toEqual([6, 7]);
    expect(cloud.board('main').brush.date).toBe(await room.evaluate(() => todayKey()));

    await phone.click('#tab-brush');
    await expect(phone.locator('#brush-6')).toHaveClass(/done/, { timeout: 10000 });
    await expect(phone.locator('#brush-progress')).toHaveText('2/28');

    await expect(parent.locator('#parent-brush')).toContainText('已完成', { timeout: 20000 });
});

test('潔牙提醒可以修改（需要教師或小幫手密碼），並同步到雲端', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.click('#tab-brush');
    await expect(page.locator('#brush-tips > div')).toHaveCount(3);
    await expect(page.locator('#brush-tips')).toContainText('吃完飯要潔牙');

    await page.click('button:has-text("修改提醒")');
    await expect(page.locator('#modal-teacher-auth')).toBeVisible();
    await page.click('#modal-teacher-auth button:has-text("取消")');

    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.click('button:has-text("修改提醒")');
    const inputs = page.locator('.brush-tip-input');
    await expect(inputs).toHaveCount(5);
    await inputs.nth(1).fill('🍱 收餐具');
    await inputs.nth(3).fill('喝水');
    await page.click('#modal-brush-tips button:has-text("儲存")');
    await expect(page.locator('#brush-tips > div')).toHaveCount(4);
    await expect(page.locator('#brush-tips > div').nth(1)).toContainText('🍱收餐具');
    await expect(page.locator('#brush-tips > div').nth(3)).toContainText('⭐喝水');
    await expect.poll(() => cloud.board('main').brush?.tips).toEqual(['🦷 吃完飯要潔牙', '🍱 收餐具', '🚽 上廁所', '喝水']);

    await page.click('button:has-text("修改提醒")');
    await page.click('button:has-text("恢復預設提醒")');
    await expect(page.locator('#brush-tips > div')).toHaveCount(3);
});

test('抬餐任務：四菜一湯桶，抬完點一下變色，存雲端、每天歸零', async ({ browser }) => {
    test.setTimeout(60000);
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    await room.click('#tab-brush');
    await expect(room.locator('#meal-grid > button')).toHaveCount(5);
    await expect(room.locator('#meal-4')).toContainText('湯桶');
    await expect(room.locator('#meal-progress')).toHaveText('0/5');

    await room.click('#meal-0');
    await room.click('#meal-4');
    await expect(room.locator('#meal-0')).toHaveClass(/done/);
    await expect(room.locator('#meal-0')).toContainText('已抬');
    await expect(room.locator('#meal-1')).toContainText('還沒抬');
    await expect(room.locator('#meal-progress')).toHaveText('2/5');
    await room.click('#meal-0');
    await expect(room.locator('#meal-progress')).toHaveText('1/5');
    await expect.poll(() => cloud.board('main').brush?.meal, { timeout: 12000 }).toEqual([false, false, false, false, true]);

    // 另一台裝置看得到；換一天自動歸零
    const phone = await openDevice(browser, cloud);
    await phone.click('#tab-brush');
    await expect(phone.locator('#meal-4')).toHaveClass(/done/);
    await phone.evaluate(() => { state.brush.date = '2000-01-01'; renderBrush(); });
    await expect(phone.locator('#meal-progress')).toHaveText('0/5');
});
