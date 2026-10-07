// 作業框「換下一項」：全班訂正完的作業，一鍵換成下一項還有人沒訂正的作業
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, seatLayoutProblems } = require('./helpers');

test('全班訂正完時出現「換下一項」，按下後換成還有人沒訂正的作業並同步到雲端', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    const first = await page.evaluate(() => state.slots[0].assignment);
    // 看板外的兩項作業有人還沒訂正（只有第二項是排在前面的才會被選到）
    const [later, earlier] = await page.evaluate(() => {
        const off = state.assignments.filter((a) => !state.slots.some((s) => s.assignment === a));
        setStudentStatus(off[3], 9, false);
        setStudentStatus(off[1], 2, false);
        setStudentStatus(off[1], 7, false);
        renderDashboard();
        syncStateToCloud(true);
        return [off[3], off[1]];
    });
    await expect.poll(() => Object.keys(cloud.board('main').statuses).length).toBeGreaterThan(1);

    // 還有人沒訂正：不顯示
    await page.click('#btn-slot-0-student-5');
    await expect(page.locator('#slot-next-0')).toBeHidden();
    // 全部訂正完（紅燈 → 缺交 → 綠燈）：出現
    await page.click('#btn-slot-0-student-5');
    await expect(page.locator('#slot-next-0')).toBeHidden(); // 缺交也還沒完成
    await page.click('#btn-slot-0-student-5');
    await expect(page.locator('#slot-next-0')).toBeVisible();
    await expect(page.locator('#slot-next-0')).toContainText('換下一項');

    await page.click('#slot-next-0');
    expect(await page.evaluate(() => state.slots[0].assignment)).toBe(earlier);
    await expect(page.locator('#slot-badge-0')).toContainText('待訂正 2 人');
    await expect(page.locator('#toast-msg')).toContainText(`【${first}】換成【${earlier}】`);
    await expect.poll(() => cloud.board('main').slots[0].assignment).toBe(earlier);

    // 原本的作業紀錄還在，之後還能選回來
    expect(await page.evaluate((a) => state.assignments.includes(a), first)).toBe(true);

    // 下一張完成的卡片會換到剩下的那一項；都沒有了就不顯示按鈕
    await page.evaluate(() => markSlotAllDone(0));
    await page.click('#slot-next-0');
    expect(await page.evaluate(() => state.slots[0].assignment)).toBe(later);
    await page.click('#btn-slot-0-student-9');
    await expect(page.locator('#slot-next-0')).toBeHidden();
    await expect(page.locator('#slot-next-1')).toBeHidden();
});

test('學生模式看不到「換下一項」，8 框時按鈕不會擠壞作業名稱', async ({ browser }) => {
    const page = await openDevice(browser, createCloud(), { viewport: { width: 1366, height: 768 } });
    await page.evaluate(() => { startTeacherSession(); switchTab('settings', true); setSlotCount(8); switchTab('dashboard', true); });
    await page.evaluate(() => {
        const off = state.assignments.filter((a) => !state.slots.some((s) => s.assignment === a));
        setStudentStatus(off[off.length - 1], 1, false); // 看板外還有人沒訂正的作業
        renderDashboard();
        syncStateToCloud(true);
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => applyRoleUI('student'));
    await expect(page.locator('#slot-next-0')).toBeHidden();

    await page.evaluate(() => applyRoleUI('teacher'));
    await expect(page.locator('#slot-next-0')).toBeVisible();
    const fits = await page.evaluate(() => [...document.querySelectorAll('.slot-select')].map((s) => {
        const st = getComputedStyle(s);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `900 ${st.fontSize} ${st.fontFamily}`;
        return ctx.measureText(s.options[s.selectedIndex].text).width <= s.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) + 1;
    }));
    expect(fits).toEqual(Array(8).fill(true));
    expect(await seatLayoutProblems(page)).toEqual({ outside: 0, overflow: 0 });
});
