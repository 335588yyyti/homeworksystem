// 設定後台：左右平分、名冊對齊左欄底部、複製查詢碼與連結、名冊按鈕名稱
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('電腦版設定頁左右平分，名冊底部對齊左欄', async ({ browser }) => {
    for (const width of [1024, 1366, 1920]) {
        const page = await openDevice(browser, createCloud(), { viewport: { width, height: 1000 } });
        await unlockTeacher(page, 'settings');
        const r = await page.evaluate(() => {
            const left = document.querySelector('.settings-left').getBoundingClientRect();
            const right = document.querySelector('.roster-card').getBoundingClientRect();
            const view = document.getElementById('view-settings');
            return { left: left.width, right: right.width, leftBottom: left.bottom, rightBottom: right.bottom, hscroll: view.scrollWidth > view.clientWidth };
        });
        expect(Math.abs(r.left - r.right), `寬度 ${width}`).toBeLessThan(2);
        expect(Math.abs(r.leftBottom - r.rightBottom), `寬度 ${width}`).toBeLessThan(2);
        expect(r.hscroll).toBe(false);
        await page.context().close();
    }
});

test('名冊按鈕使用清楚的名稱', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings');
    for (const label of ['全部連結重新產生', '列印家長查詢碼', '全班訂正歸零', '全班人數重設為28人']) {
        await expect(page.locator('.roster-card button', { hasText: label })).toBeVisible();
    }
});

test('複製碼只複製查詢碼，複製連結複製完整網址', async ({ browser }) => {
    const page = await openDevice(browser, createCloud(), { clipboard: true });
    await unlockTeacher(page, 'settings');
    const code = await page.evaluate(() => state.students.find((s) => s.id === 5).parentCode);
    const row = page.locator('#settings-student-table tr').nth(4);
    await row.getByText('複製碼').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await row.getByText('複製連結').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`\\?p=${code}$`));
});

test('切換班級時新班級的教師密碼為 8888，原班級不受影響', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { state.teacherPin = '1234'; syncStateToCloud(true); });
    await page.waitForTimeout(400);
    await unlockTeacher(page, 'settings');
    await page.fill('#settings-class-code', 'lin601cs');
    await page.click('button:has-text("切換到此代碼")');
    await page.waitForTimeout(800);
    expect(cloud.board('lin601cs').teacherPin).toBe('8888');
    expect(cloud.board('main').teacherPin).toBe('1234');
    expect(await page.evaluate(() => state.isTeacherUnlocked)).toBe(false);
});
