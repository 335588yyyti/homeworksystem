// 作業項目設定：刪除看板上的作業要先確認；有同學沒訂正完時，提醒會特別註明
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('刪除看板上的作業會先確認，有同學沒訂正完時加上提醒；按取消不刪除', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    const info = await page.evaluate(() => {
        const asgn = state.slots[0].assignment;
        setStudentStatus(asgn, 3, false);
        setStudentStatus(asgn, 12, false);
        const off = state.assignments.filter((a) => !state.slots.some((s) => s.assignment === a));
        setStudentStatus(off[2], 5, false); // 看板外還有人沒訂正的作業，會優先換上
        renderSettingsAssignments();
        return { asgn, index: state.assignments.indexOf(asgn), next: off[2] };
    });

    // 按取消：什麼都不變
    page.answerDialogs = false;
    await page.evaluate((i) => deleteAssignment(i), info.index);
    expect(page.dialogs).toHaveLength(1);
    expect(page.dialogs[0]).toContain(`【${info.asgn}】目前正在看板上（第 1 框）`);
    expect(page.dialogs[0]).toContain('還有 2 位同學沒有訂正完成（座號 3、12）');
    expect(page.dialogs[0]).toContain(`換成【${info.next}】`);
    expect(await page.evaluate((a) => state.assignments.includes(a) && state.slots[0].assignment === a, info.asgn)).toBe(true);

    // 按確定：刪除，看板那一框換成還有人沒訂正的作業
    page.answerDialogs = true;
    await page.evaluate((i) => deleteAssignment(i), info.index);
    expect(await page.evaluate((a) => state.assignments.includes(a), info.asgn)).toBe(false);
    expect(await page.evaluate(() => state.slots[0].assignment)).toBe(info.next);
    await expect.poll(() => cloud.board('main').slots[0].assignment).toBe(info.next);
    expect(cloud.board('main').assignments).not.toContain(info.asgn);
});

test('看板上的作業全班都完成時，確認訊息不會出現未完成提醒；看板外的作業直接刪除', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings');
    const asgn = await page.evaluate(() => state.slots[1].assignment);
    await page.evaluate((a) => deleteAssignment(state.assignments.indexOf(a)), asgn);
    expect(page.dialogs).toHaveLength(1);
    expect(page.dialogs[0]).toContain('確定要刪除嗎');
    expect(page.dialogs[0]).not.toContain('沒有訂正完成');

    const off = await page.evaluate(() => state.assignments.find((a) => !state.slots.some((s) => s.assignment === a)));
    await page.evaluate((a) => deleteAssignment(state.assignments.indexOf(a)), off);
    expect(page.dialogs).toHaveLength(1); // 沒有再跳確認
    expect(await page.evaluate((a) => state.assignments.includes(a), off)).toBe(false);
});

test('作業項目只剩看板框數時，不能刪除看板上的作業', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings');
    await page.evaluate(() => { state.assignments = state.slots.map((s) => s.assignment); renderSettingsAssignments(); deleteAssignment(0); });
    expect(page.dialogs).toHaveLength(0);
    await expect(page.locator('#toast-msg')).toContainText('不能少於看板');
    expect(await page.evaluate(() => state.assignments.length)).toBe(await page.evaluate(() => state.slots.length));
});
