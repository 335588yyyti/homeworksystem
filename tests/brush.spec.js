// 潔牙站：點牙齒打勾、完成度、每天自動歸零、重置、倒數計時
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

// 潔牙站預設關閉，測試前先從後台打開
async function enableBrush(page) {
    await page.evaluate(() => setBrushEnabled(true));
    await expect(page.locator('#tab-brush')).toBeVisible();
}

test('潔牙站預設關閉；後台勾選後才出現分頁，其他裝置和家長頁也跟著', async ({ browser }) => {
    test.setTimeout(60000);
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud);
    await expect(room.locator('#tab-brush')).toBeHidden();
    const code = await room.evaluate(() => state.students.find((s) => s.id === 6).parentCode);
    await expect.poll(() => cloud.view(code), { timeout: 20000 }).toBeTruthy();
    expect('brushed' in cloud.view(code)).toBe(false);
    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#parent-result-box')).toBeVisible();
    await expect(parent.locator('#parent-brush')).toBeHidden();

    await unlockTeacher(room, 'settings');
    await expect(room.locator('#brush-enabled')).not.toBeChecked();
    await room.check('#brush-enabled');
    await expect(room.locator('#tab-brush')).toBeVisible();
    // 切換分頁後依然顯示
    await room.click('#tab-dashboard');
    await expect(room.locator('#tab-brush')).toBeVisible();
    await expect.poll(() => cloud.board('main').brush?.enabled, { timeout: 12000 }).toBe(true);
    await expect(phone.locator('#tab-brush')).toBeVisible({ timeout: 10000 });
    await expect(parent.locator('#parent-brush')).toContainText('還沒登記', { timeout: 20000 });

    // 另一台正在潔牙頁時被關閉：自動回到看板
    await phone.click('#tab-brush');
    await unlockTeacher(room, 'settings');
    await expect(room.locator('#brush-enabled')).toBeChecked();
    await room.uncheck('#brush-enabled');
    await expect(room.locator('#tab-brush')).toBeHidden();
    await expect(phone.locator('#tab-brush')).toBeHidden({ timeout: 10000 });
    await expect(phone.locator('#view-dashboard')).toBeVisible();
    await expect(parent.locator('#parent-brush')).toBeHidden({ timeout: 20000 });
});

test('潔牙站：學生點自己的牙齒打勾，再點一次取消；換一天自動歸零', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await enableBrush(page);
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
    await enableBrush(page);
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
    await enableBrush(room);
    const code = await room.evaluate(() => state.students.find((s) => s.id === 6).parentCode);
    await expect.poll(() => cloud.view(code)?.brushed, { timeout: 20000 }).toBe('');
    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#parent-brush')).toContainText('還沒登記');

    await room.click('#tab-brush');
    await room.click('#brush-6');
    await room.click('#brush-7');
    // 最後一次點擊後 5 秒才一次存雲端（只更新潔牙這一欄）
    await expect.poll(() => cloud.board('main').brush?.done, { timeout: 12000 }).toEqual([6, 7]);
    expect(cloud.board('main').brush.date).toBe(await room.evaluate(() => todayKey()));

    await expect(phone.locator('#tab-brush')).toBeVisible({ timeout: 10000 });
    await phone.click('#tab-brush');
    await expect(phone.locator('#brush-6')).toHaveClass(/done/, { timeout: 10000 });
    await expect(phone.locator('#brush-progress')).toHaveText('2/28');

    await expect(parent.locator('#parent-brush')).toContainText('已完成', { timeout: 20000 });
});

test('潔牙提醒可以修改（需要教師或小幫手密碼），並同步到雲端', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await enableBrush(page);
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
    await enableBrush(room);
    await room.click('#tab-brush');
    await expect(room.locator('#meal-grid > button')).toHaveCount(5);
    await expect(room.locator('#meal-4')).toContainText('湯桶');
    await expect(room.locator('#meal-progress')).toHaveText('0/5');

    await room.click('#meal-0');
    await expect(room.locator('#meal-pop-msg')).toHaveText('謝謝你💖');
    await expect(room.locator('#meal-pop')).toHaveClass(/show/);
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
    await expect(phone.locator('#tab-brush')).toBeVisible();
    await phone.click('#tab-brush');
    await expect(phone.locator('#meal-4')).toHaveClass(/done/);
    await phone.evaluate(() => { state.brush.date = '2000-01-01'; renderBrush(); });
    await expect(phone.locator('#meal-progress')).toHaveText('0/5');

    // 五格都抬完
    for (let i = 0; i < 5; i++) await phone.click(`#meal-${i}`);
    await expect(phone.locator('#meal-pop-msg')).toHaveText('謝謝你們的幫忙～都抬完了！🎉');
});

test('抬餐項目可以修改：加豆奶、水果，刪掉一格，名稱沒變的保留已抬', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await enableBrush(page);
    await page.click('#tab-brush');
    await page.click('#meal-4');

    await page.click('button:has-text("修改項目")');
    await expect(page.locator('#modal-teacher-auth')).toBeVisible();
    await page.click('#modal-teacher-auth button:has-text("取消")');
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });

    await page.click('button:has-text("修改項目")');
    const inputs = page.locator('.meal-item-input');
    await expect(inputs).toHaveCount(5);
    // 刪掉「菜 4」，再加「菜」（自動編號成菜 4）、豆奶、水果
    await page.locator('#meal-item-inputs > div').nth(3).locator('button').click();
    await page.click('#modal-meal-items button:has-text("＋ 菜")');
    await page.click('#modal-meal-items button:has-text("＋ 豆奶")');
    await page.click('#modal-meal-items button:has-text("＋ 水果")');
    await expect(inputs).toHaveCount(7);
    await expect(inputs.nth(4)).toHaveValue('菜 4');
    await page.click('#modal-meal-items button:has-text("儲存")');

    await expect(page.locator('#meal-grid > button')).toHaveCount(7);
    await expect(page.locator('#meal-5')).toContainText('豆奶');
    await expect(page.locator('#meal-6')).toContainText('水果');
    // 湯桶原本已抬，換位置後仍是已抬
    await expect(page.locator('#meal-3')).toContainText('湯桶');
    await expect(page.locator('#meal-3')).toHaveClass(/done/);
    await expect(page.locator('#meal-progress')).toHaveText('1/7');
    await expect.poll(() => cloud.board('main').brush?.items).toEqual(['菜 1', '菜 2', '菜 3', '湯桶', '菜 4', '豆奶', '水果']);

    // 其他裝置同步；重新開啟也還在
    const phone = await openDevice(browser, cloud);
    await expect(phone.locator('#tab-brush')).toBeVisible();
    await phone.click('#tab-brush');
    await expect(phone.locator('#meal-grid > button')).toHaveCount(7);
    await expect(phone.locator('#meal-3')).toHaveClass(/done/);

    // 恢復預設
    await page.click('button:has-text("修改項目")');
    await page.click('#modal-meal-items button:has-text("恢復預設")');
    await expect(page.locator('#meal-grid > button')).toHaveCount(5);
    await expect(page.locator('#meal-4')).toHaveClass(/done/);
});

test('筆電一頁放得下：版面不變、牙齒放大、座號清楚，不用捲動', async ({ browser }) => {
    const page = await openDevice(browser, createCloud(), { viewport: { width: 1366, height: 768 } });
    await enableBrush(page);
    await page.click('#tab-brush');
    const r = await page.evaluate(() => {
        const v = document.getElementById('view-brush');
        const aside = document.querySelector('#view-brush aside').getBoundingClientRect();
        const section = document.querySelector('#view-brush section').getBoundingClientRect();
        return { scroll: v.scrollHeight - v.clientHeight, tooth: document.getElementById('brush-28').getBoundingClientRect().width, asideW: aside.width, sideBySide: aside.right < section.left };
    });
    expect(r.scroll).toBeLessThanOrEqual(0);
    // 左邊小天使提醒區維持在左側、寬 300px
    expect(r.sideBySide).toBe(true);
    expect(Math.round(r.asideW)).toBe(300);
    expect(r.tooth).toBeGreaterThanOrEqual(76);
});
