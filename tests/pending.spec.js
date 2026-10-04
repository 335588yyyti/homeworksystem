// 未訂正名單：列出還有作業要訂正的同學、即時更新、全部完成時顯示恭喜
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('未訂正名單列出每位同學還沒訂正的作業，並即時更新', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await expect(page.locator('#pending-list-count')).toBeHidden();

    await page.click('#btn-slot-0-student-3');   // 3 號 國習
    await page.click('#btn-slot-2-student-3');   // 3 號 數課
    await page.click('#btn-slot-1-student-12');  // 12 號 國作
    await expect(page.locator('#pending-list-count')).toHaveText('2');

    await page.click('#pending-list-button');
    await expect(page.locator('#modal-pending-list')).toBeVisible();
    await expect(page.locator('#pending-list-summary')).toContainText('共 2 位同學、3 項作業');
    const cards = page.locator('#pending-list-body > div > div');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('3');
    await expect(cards.nth(0)).toContainText('還有 2 項');
    await expect(cards.nth(0)).toContainText('國習');
    await expect(cards.nth(0)).toContainText('數課');
    await expect(cards.nth(1)).toContainText('12');
    await expect(cards.nth(1)).toContainText('國作');

    // 另一台裝置（老師手機）消掉 12 號，名單即時更新
    const phone = await openDevice(browser, cloud);
    await phone.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await phone.click('#btn-slot-1-student-12');
    await expect(cards).toHaveCount(1);
    await expect(page.locator('#pending-list-count')).toHaveText('1');

    // 全部完成時顯示恭喜
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-pending-list')).toBeHidden();
    await page.click('#btn-slot-0-student-3');
    await page.click('#btn-slot-2-student-3');
    await page.click('#pending-list-button');
    await expect(page.locator('#pending-list-body')).toContainText('全班都訂正完成了');
    await expect(page.locator('#pending-list-count')).toBeHidden();
});

test('未訂正名單在手機和電腦都不會超出畫面，家長頁看不到這個按鈕', async ({ browser }) => {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
        const page = await openDevice(browser, createCloud(), { viewport });
        await page.evaluate(() => {
            state.students.slice(0, 40).forEach((st) => state.assignments.slice(0, 6).forEach((a) => setStudentStatus(a, st.id, false)));
            openPendingList();
        });
        const r = await page.evaluate(() => {
            const body = document.getElementById('pending-list-body');
            return { hscroll: body.scrollWidth > body.clientWidth + 1, pageScroll: document.documentElement.scrollWidth > window.innerWidth };
        });
        expect(r).toEqual({ hscroll: false, pageScroll: false });
        await page.context().close();
    }
    const parent = await openDevice(browser, createCloud(), { query: '?p' });
    await expect(parent.locator('#pending-list-button')).toBeHidden();
});
