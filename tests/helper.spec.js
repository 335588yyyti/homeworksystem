// 小幫手模式、分享全新看板
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

async function enableHelper(page, pin) {
    await unlockTeacher(page, 'settings');
    await page.check('#helper-enabled');
    if (pin) {
        await page.check('#helper-pin-required');
        await page.fill('#helper-pin-input', pin);
    } else {
        await page.check('#helper-pin-none');
    }
    await page.click('text=儲存小幫手設定');
    await page.evaluate(() => lockTeacherSession());
}

test('小幫手（有密碼）：能登記紅燈、換作業，不能進設定後台、看不到家長查詢碼', async ({ browser }) => {
    const cloud = createCloud();
    const teacher = await openDevice(browser, cloud);
    await expect(teacher.locator('#role-helper')).toBeHidden(); // 預設關閉
    await enableHelper(teacher, '2468');
    await expect.poll(() => [cloud.board('main').helperEnabled, cloud.board('main').helperPin]).toEqual([true, '2468']);

    const room = await openDevice(browser, cloud);
    await expect(room.locator('#role-helper')).toBeVisible();
    await room.click('#role-helper');
    await expect(room.locator('#auth-title')).toHaveText('小幫手驗證');
    await expect(room.locator('#auth-default-hint')).toBeHidden(); // 不提示教師預設密碼
    await room.fill('#teacher-password-input', '1111');
    await room.press('#teacher-password-input', 'Enter');
    await expect(room.locator('#toast-msg')).toContainText('密碼錯誤');
    await room.fill('#teacher-password-input', '2468');
    await room.press('#teacher-password-input', 'Enter');
    await expect(room.locator('#role-status-text')).toContainText('小幫手登記中');

    // 登記紅燈、全部完成、換作業都可以
    await room.click('#btn-slot-0-student-6');
    await expect(room.locator('#btn-slot-0-student-6')).toHaveClass(/seat-pending/);
    await room.selectOption('.slot-select >> nth=1', { index: 10 });
    expect(await room.evaluate(() => state.slots[1].assignment)).toBe(await room.evaluate(() => state.assignments[10]));

    // 設定後台：要求教師密碼，小幫手密碼無效
    await room.click('#tab-settings');
    await expect(room.locator('#modal-teacher-auth')).toBeVisible();
    await expect(room.locator('#auth-title')).toHaveText('教師權限驗證');
    await room.fill('#teacher-password-input', '2468');
    await room.press('#teacher-password-input', 'Enter');
    await expect(room.locator('#view-settings')).toBeHidden();
    await room.click('#modal-teacher-auth button:has-text("取消")');

    // 個別查詢：小幫手看到的是家長用的查詢碼輸入，不是教師專用畫面
    await room.click('#tab-parent');
    await expect(room.locator('#parent-teacher-picker')).toBeHidden();
    await expect(room.locator('#parent-code-section')).toBeVisible();

    // 鎖定後回到學生消單
    await room.click('#tab-dashboard');
    await room.click('#role-lock');
    await expect(room.locator('#role-status-text')).toContainText('學生自主消單');
});

test('小幫手免密碼；老師關閉小幫手模式時，正在使用的小幫手自動登出', async ({ browser }) => {
    const cloud = createCloud();
    const teacher = await openDevice(browser, cloud);
    await enableHelper(teacher, '');
    await expect.poll(() => cloud.board('main').helperEnabled).toBe(true);

    const room = await openDevice(browser, cloud);
    await room.click('#role-helper');
    await expect(room.locator('#modal-teacher-auth')).toBeHidden();
    await expect(room.locator('#role-status-text')).toContainText('小幫手登記中');

    // 從看板直接換作業（未登入時）也可以選「以小幫手身分繼續」
    const other = await openDevice(browser, cloud);
    await other.selectOption('.slot-select >> nth=0', { index: 9 });
    await expect(other.locator('#auth-helper-button')).toBeVisible();
    await other.click('#auth-helper-button');
    await expect.poll(() => other.evaluate(() => state.isHelperUnlocked)).toBe(true);

    // 老師關閉小幫手模式
    await unlockTeacher(teacher, 'settings');
    await teacher.uncheck('#helper-enabled');
    await teacher.click('text=儲存小幫手設定');
    await expect(room.locator('#toast-msg')).toContainText('老師已關閉小幫手模式', { timeout: 15000 });
    await expect(room.locator('#role-helper')).toBeHidden();
    expect(await room.evaluate(() => state.isHelperUnlocked)).toBe(false);
});

test('小幫手密碼必須是 4 位數字，且不能和教師密碼相同', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings'); // 教師密碼 1357
    await page.check('#helper-enabled');
    await page.check('#helper-pin-required');
    await page.fill('#helper-pin-input', '12');
    await page.click('text=儲存小幫手設定');
    await expect(page.locator('#toast-msg')).toContainText('4 位數字');
    await page.fill('#helper-pin-input', '1357');
    await page.click('text=儲存小幫手設定');
    await expect(page.locator('#toast-msg')).toContainText('不能和教師密碼相同');
    expect(await page.evaluate(() => state.helperEnabled)).toBe(false);
});

test('分享全新看板：對方打開連結會建立自己的空白班級，看不到原班資料', async ({ browser }) => {
    const cloud = createCloud();
    const teacher = await openDevice(browser, cloud, { clipboard: true });
    await teacher.evaluate(() => { state.sloganTitle = '我的班級'; syncStateToCloud(true); });
    await unlockTeacher(teacher, 'settings');
    await teacher.click('#share-new-board');
    const link = await teacher.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/index\.html\?new$/);

    // 分享者自己的班級有人還沒訂正
    await teacher.evaluate(() => { setStudentStatus(state.slots[0].assignment, 3, false); syncStateToCloud(true); });

    const other = await openDevice(browser, cloud, { query: '?new' });
    await expect.poll(() => other.dialogs.length).toBe(1);
    expect(other.dialogs[0]).toContain('已為你建立全新的班級看板');
    const code = await other.evaluate(() => getClassCode());
    expect(code).toMatch(/^class[2-9]{2}[a-z0-9]{6}$/);
    expect(other.dialogs[0]).toContain(code);
    await expect.poll(() => cloud.board(code)?.teacherPin).toBe('8888');
    expect(cloud.board(code).sloganTitle).not.toBe('我的班級');
    expect(cloud.board('main').sloganTitle).toBe('我的班級');
    expect(await other.evaluate(() => location.search)).toBe(''); // 重新整理不會再建立
    // 新看板全部是綠燈，不會帶到分享者的訂正狀況
    expect(await other.locator('.seat-pending').count()).toBe(0);
    expect(Object.values(cloud.board(code).statuses || {}).every((m) => Object.values(m).every(Boolean))).toBe(true);

    // 同一台裝置（原本有自己班級的紅燈）打開連結：一開始就顯示全新的空白看板
    const same = await openDevice(browser, cloud);
    await same.evaluate(() => { localStorage.setItem('checkpoint_class_code', 'mine123'); setStudentStatus(state.slots[0].assignment, 4, false); saveLocalBackup(); });
    await same.goto(same.url().split('?')[0] + '?new');
    expect(await same.locator('.seat-pending').count()).toBe(0);
    await expect.poll(() => same.evaluate(() => getClassCode())).not.toBe('mine123');
    await same.waitForTimeout(500);
    expect(await same.locator('.seat-pending').count()).toBe(0);

    // 已經在用其他班級的裝置：先確認，取消就不建立
    const existing = await openDevice(browser, cloud);
    existing.answerDialogs = false;
    await existing.evaluate(() => { localStorage.setItem('checkpoint_class_code', 'abc123x'); });
    await existing.goto(existing.url().split('?')[0] + '?new');
    await expect.poll(() => existing.dialogs.length).toBeGreaterThan(0);
    expect(existing.dialogs[0]).toContain('abc123x');
    await existing.waitForTimeout(800);
    expect(await existing.evaluate(() => getClassCode())).toBe('abc123x');
    expect(await existing.evaluate(() => location.search)).toBe('');
});
