// 個別查詢：老師輸入座號查詢、教師專用畫面（不顯示家長查詢碼輸入區）、電腦版一頁看完；看板框數優先放未完成的作業
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('分頁名稱為「個別查詢」，家長頁仍可用查詢碼', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await expect(page.locator('nav')).toContainText('個別查詢');
    await expect(page.locator('nav')).not.toContainText('家長查詢');
    await page.evaluate(() => switchTab('parent', true));
    await expect(page.locator('#parent-code-section')).toBeVisible(); // 沒解鎖：維持查詢碼輸入
    await expect(page.locator('#parent-teacher-picker')).toBeHidden();
});

test('老師輸入座號查詢，找不到時提示；教師專用畫面不顯示查詢碼輸入區', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.evaluate(() => {
        startTeacherSession();
        setStudentStatus(state.assignments[0], 12, false);
        setStudentStatus(state.assignments[5], 12, false);
        switchTab('parent', true);
    });
    await expect(page.locator('#parent-code-section')).toBeHidden();
    await expect(page.locator('#parent-teacher-picker')).toBeVisible();

    await page.fill('#teacher-seat-input', '１２'); // 全形數字也可以
    await page.press('#teacher-seat-input', 'Enter');
    await expect(page.locator('#parent-child-name')).toHaveText('12 號 同學');
    await expect(page.locator('#parent-status-title')).toContainText('2 項');
    expect(await page.inputValue('#parent-student-select')).toBe('12');

    await page.fill('#teacher-seat-input', '99');
    await page.click('#parent-teacher-picker button');
    await expect(page.locator('#parent-code-msg')).toContainText('找不到 99 號');
    await expect(page.locator('#parent-result-box')).toBeHidden();

});

test('電腦版教師查詢左右兩欄、50 項作業也不用捲動；手機維持單欄', async ({ browser }) => {
    for (const [width, height, wide] of [[1366, 768, true], [390, 844, false]]) {
        const page = await openDevice(browser, createCloud(), { viewport: { width, height } });
        await page.evaluate(() => {
            startTeacherSession();
            while (state.assignments.length < 50) state.assignments.push('作業' + state.assignments.length);
            state.assignments.forEach((a) => setStudentStatus(a, 5, false));
            switchTab('parent', true);
        });
        await page.fill('#teacher-seat-input', '5');
        await page.press('#teacher-seat-input', 'Enter');
        await expect(page.locator('#parent-assignment-list > div')).toHaveCount(50);
        const r = await page.evaluate(() => {
            const v = document.getElementById('view-parent');
            const summary = document.getElementById('parent-summary').getBoundingClientRect();
            const list = document.getElementById('parent-pending-section').getBoundingClientRect();
            return { scrolls: v.scrollHeight > v.clientHeight + 1, sideBySide: list.left >= summary.right, width: v.clientWidth };
        });
        if (wide) expect(r).toMatchObject({ scrolls: false, sideBySide: true });
        else expect(r.sideBySide).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.context().close();
    }
});

test('切換看板框數時，優先呈現還有人沒訂正的作業', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { startTeacherSession(); switchTab('settings', true); });
    const r = await page.evaluate(() => {
        setSlotCount(4);
        const board4 = state.slots.map((s) => s.assignment);
        // 看板外最後一項有人沒訂正、看板上第 2 框也有人沒訂正
        const off = state.assignments.filter((a) => !board4.includes(a));
        const lateOff = off[off.length - 1];
        setStudentStatus(lateOff, 3, false);
        setStudentStatus(board4[1], 4, false);
        setSlotCount(6);
        const board6 = state.slots.map((s) => s.assignment);
        setSlotCount(4);
        const back4 = state.slots.map((s) => s.assignment);
        return { board4, lateOff, board6, back4 };
    });
    // 加框：先放上有人沒訂正的作業
    expect(r.board6.slice(0, 4)).toEqual(r.board4);
    expect(r.board6[4]).toBe(r.lateOff);
    // 減框：保留有人沒訂正的兩框
    expect(r.back4).toContain(r.lateOff);
    expect(r.back4).toContain(r.board4[1]);
    expect(r.back4).toHaveLength(4);
    await expect.poll(() => cloud.board('main').slots.map((s) => s.assignment)).toEqual(r.back4);
});
