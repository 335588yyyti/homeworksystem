// 缺交：教師登記點座號輪流切換 綠 → 紅（待訂正）→ 橘（缺交）→ 綠；學生補交後變紅燈；家長頁分開列出
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

async function teacherMode(page) {
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
}

test('教師登記：點座號依序切換 綠燈 → 紅燈 → 缺交 → 綠燈，卡片標籤分開計算', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await teacherMode(page);
    const seat = page.locator('#btn-slot-0-student-5');
    const badge = page.locator('#slot-badge-0');

    await seat.click();
    await expect(seat).toHaveClass(/seat-pending/);
    await expect(badge).toHaveText('待訂正 1 人');
    await seat.click();
    await expect(seat).toHaveClass(/seat-missing/);
    await expect(seat).not.toHaveClass(/seat-pending/);
    await expect(badge).toHaveText('缺交 1 人');
    await expect(page.locator('#undo-text')).toContainText('登記缺交');
    await page.click('#btn-slot-0-student-6');
    await expect(badge).toHaveText('訂正 1・缺交 1');
    // 缺交也算還沒完成：可以按「全部完成」
    await expect(page.locator('#slot-done-0')).toBeVisible();
    await seat.click();
    await expect(seat).not.toHaveClass(/seat-missing|seat-pending/);
    await expect(badge).toHaveText('待訂正 1 人');

    // 缺交會存到雲端，另一台裝置也看到橘燈
    await seat.click();
    await seat.click();
    await expect.poll(() => cloud.board('main').statuses['國習']['5'], { timeout: 12000 }).toBe('missing');
    const other = await openDevice(browser, cloud);
    await expect(other.locator('#btn-slot-0-student-5')).toHaveClass(/seat-missing/);
    await expect(other.locator('#slot-badge-0')).toHaveText('訂正 1・缺交 1');

    // 全部完成：缺交也一起變成完成
    await page.click('#slot-done-0');
    await expect(seat).not.toHaveClass(/seat-missing|seat-pending/);
    await expect(badge).toContainText('全員完成');
});

test('學生消單：缺交點一下變成待訂正（補交），再點一下才消單', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.evaluate(() => { setStudentStatus(state.slots[0].assignment, 8, 'missing'); renderDashboard(); applyRoleUI('student'); });
    const seat = page.locator('#btn-slot-0-student-8');
    await expect(seat).toHaveClass(/seat-missing/);
    await seat.click();
    await expect(seat).toHaveClass(/seat-pending/);
    await expect(page.locator('#toast-msg')).toContainText('已補交');
    await expect(page.locator('#undo-text')).toContainText('已補交');
    await seat.click();
    await expect(seat).not.toHaveClass(/seat-missing|seat-pending/);
    // 已完成再點：不會變回紅燈
    await seat.click();
    await expect(seat).not.toHaveClass(/seat-missing|seat-pending/);
    // 點錯可以復原回缺交
    await page.evaluate(() => { setStudentStatus(state.slots[0].assignment, 9, 'missing'); renderDashboard(); });
    await page.click('#btn-slot-0-student-9');
    await page.click('#undo-bar button');
    await expect(page.locator('#btn-slot-0-student-9')).toHaveClass(/seat-missing/);
});

test('未訂正名單標出缺交；家長頁把缺交和待訂正分開列', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await teacherMode(page);
    const code = await page.evaluate(() => state.students.find((s) => s.id === 5).parentCode);
    await page.click('#btn-slot-0-student-5');           // 國習 待訂正
    await page.click('#btn-slot-1-student-5');
    await page.click('#btn-slot-1-student-5');           // 國作 缺交

    await page.click('#pending-list-button');
    await expect(page.locator('#pending-list-summary')).toContainText('其中 1 項缺交');
    await expect(page.locator('#pending-list-body')).toContainText('缺交・國作');
    await page.keyboard.press('Escape');

    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#parent-status-title')).toContainText('缺交 1 項、待訂正 1 項', { timeout: 20000 });
    await expect(parent.locator('#parent-pending-title')).toContainText('缺交');
    const items = parent.locator('#parent-assignment-list > div');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('缺交');
    await expect(items.nth(0)).toContainText('國作');
    await expect(items.nth(1)).toContainText('國習');
    await expect(items.nth(1)).not.toContainText('缺交');

    // 只剩缺交
    await page.click('#btn-slot-0-student-5');
    await page.click('#btn-slot-0-student-5');
    await expect(parent.locator('#parent-status-title')).toContainText('有 1 項作業缺交', { timeout: 20000 });
});
