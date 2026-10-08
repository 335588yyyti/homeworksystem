// 一次登記缺交：請假的同學，勾選沒交的作業一次變成缺交
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('一次登記缺交：輸入座號、勾選作業，看板與雲端都變成缺交', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);

    // 學生模式按下會先要求教師（或小幫手）密碼
    await page.click('#bulk-missing-button');
    await expect(page.locator('#modal-teacher-auth')).toBeVisible();
    await page.click('#modal-teacher-auth button:has-text("取消")');

    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.click('#bulk-missing-button');
    await expect(page.locator('#modal-bulk-missing')).toBeVisible();
    await page.fill('#bulk-missing-seat', '99');
    await expect(page.locator('#bulk-missing-hint')).toContainText('找不到 99 號');

    await page.fill('#bulk-missing-seat', '7');
    const [onBoardA, onBoardB, offBoard] = await page.evaluate(() => {
        const off = state.assignments.find((a) => !state.slots.some((s) => s.assignment === a));
        return [state.slots[0].assignment, state.slots[2].assignment, off];
    });
    // 看板上的作業排在前面
    await expect(page.locator('#bulk-missing-list label').first()).toContainText(onBoardA);
    for (const a of [onBoardA, onBoardB, offBoard]) await page.check(`#bulk-missing-list input[value="${a}"]`);
    await page.click('#bulk-missing-confirm');
    await expect(page.locator('#modal-bulk-missing')).toBeHidden();
    await expect(page.locator('#toast-msg')).toContainText('7 號已登記 3 項缺交');

    await expect(page.locator('#btn-slot-0-student-7')).toHaveClass(/seat-missing/);
    await expect(page.locator('#btn-slot-2-student-7')).toHaveClass(/seat-missing/);
    await expect(page.locator('#btn-slot-1-student-7')).not.toHaveClass(/seat-missing/);
    await expect(page.locator('#slot-badge-0')).toHaveText('缺交 1 人');
    await expect.poll(() => [onBoardA, onBoardB, offBoard].map((a) => cloud.board('main').statuses?.[a]?.['7']), { timeout: 10000 })
        .toEqual(['missing', 'missing', 'missing']);

    // 再打開：已缺交的作業顯示「已缺交」並勾好；「勾選看板上的作業」補勾看板上其他作業
    await page.click('#bulk-missing-button');
    await page.fill('#bulk-missing-seat', '7');
    await expect(page.locator(`#bulk-missing-list label:has(input[value="${onBoardA}"])`)).toContainText('已缺交');
    await page.click('button:has-text("勾選看板上的作業")');
    const checkedOnBoard = await page.evaluate(() => state.slots.every((s) => document.querySelector(`#bulk-missing-list input[value="${s.assignment}"]`).checked));
    expect(checkedOnBoard).toBe(true);
    await page.click('button:has-text("全部取消")');
    await page.click('#bulk-missing-confirm');
    await expect(page.locator('#toast-msg')).toContainText('請勾選');
});
