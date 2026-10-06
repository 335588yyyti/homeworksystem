// 設定後台：三欄版面、各欄底部對齊、複製查詢碼與連結、名冊按鈕名稱
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('電腦版設定頁分三欄（設定｜作業項目｜名冊），三欄底部對齊；平板兩欄', async ({ browser }) => {
    for (const width of [1024, 1366, 1920]) {
        const page = await openDevice(browser, createCloud(), { viewport: { width, height: 1000 } });
        await unlockTeacher(page, 'settings');
        const r = await page.evaluate(() => {
            const box = (sel) => document.querySelector(sel).getBoundingClientRect();
            const left = box('.settings-left'), middle = box('.settings-middle'), right = box('.roster-card');
            const view = document.getElementById('view-settings');
            return { left, middle, right, hscroll: view.scrollWidth > view.clientWidth };
        });
        if (width >= 1280) {
            // 三欄並排：作業項目在中間，三欄底部對齊
            expect(r.middle.left).toBeGreaterThan(r.left.right - 1);
            expect(r.right.left).toBeGreaterThan(r.middle.right - 1);
            expect(Math.abs(r.middle.bottom - r.left.bottom), `寬度 ${width}`).toBeLessThan(2);
            expect(Math.abs(r.right.bottom - r.left.bottom), `寬度 ${width}`).toBeLessThan(2);
            expect(r.middle.width).toBeLessThan(r.left.width); // 作業項目較窄
        } else {
            // 平板：作業項目接在左欄下方，名冊在右邊對齊到底
            expect(Math.abs(r.middle.left - r.left.left)).toBeLessThan(2);
            expect(Math.abs(r.right.bottom - r.middle.bottom), `寬度 ${width}`).toBeLessThan(2);
        }
        expect(r.hscroll).toBe(false);
        await page.context().close();
    }
});

test('名冊按鈕使用清楚的名稱', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings');
    for (const label of ['全部連結重新產生', '複製查詢連結', '列印家長查詢碼', '全班訂正歸零', '全班人數重設為28人']) {
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

test('複製查詢連結是全班共用、不含查詢碼的連結，家長打開後可輸入查詢碼', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud, { clipboard: true });
    await unlockTeacher(page, 'settings');
    const code = await page.evaluate(() => state.students.find((s) => s.id === 5).parentCode);
    await page.locator('.roster-card button', { hasText: '複製查詢連結' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/[^?]*\?p$/);
    await expect.poll(() => cloud.view(code), { timeout: 20000 }).toBeTruthy();

    const parent = await openDevice(browser, cloud, { query: '?p' });
    await parent.fill('#parent-code-input', code);
    await parent.press('#parent-code-input', 'Enter');
    await expect(parent.locator('#parent-child-name')).toContainText('5 號');
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
