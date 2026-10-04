// 同步：兩台裝置同時點不同座號不會互相覆蓋、舊格式自動轉換、卡片「全部完成」、重新開機後資料還在
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

async function teacherMode(page) {
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
}

test('兩台裝置同一瞬間點不同座號，兩邊的修改都會保留', async ({ browser }) => {
    const cloud = createCloud();
    const classroom = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud);
    await teacherMode(classroom);
    await teacherMode(phone);

    // 手機暫時收不到雲端更新：模擬兩台裝置在同一瞬間各點一格
    await phone.evaluate(() => { window.__pauseSnapshots = true; });
    await classroom.click('#btn-slot-0-student-3');
    await classroom.waitForTimeout(400);
    await phone.click('#btn-slot-0-student-4');
    await phone.waitForTimeout(400);
    await phone.evaluate(() => { window.__pauseSnapshots = false; });
    await phone.waitForTimeout(600);

    const statuses = cloud.board('main').statuses['國習'];
    expect(statuses['3']).toBe(false);
    expect(statuses['4']).toBe(false);
    for (const page of [classroom, phone]) {
        await expect.poll(() => page.evaluate(() => [state.assignmentStatuses['國習'][3], state.assignmentStatuses['國習'][4]])).toEqual([false, false]);
    }
    // 點一格只更新那一格，不是整份重傳
    const before = classroom.writes.length;
    await classroom.click('#btn-slot-0-student-9');
    await classroom.waitForTimeout(500);
    const boardWrites = classroom.writes.slice(before).filter((p) => p.includes('checkpoint_boards'));
    expect(boardWrites).toHaveLength(1);
});

test('舊格式的看板會自動轉成新格式，紅綠燈不遺失', async ({ browser }) => {
    const cloud = createCloud();
    cloud.setBoard('main', {
        students: [{ id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }],
        assignments: ['國習', '數習'],
        slots: [{ id: 1, assignment: '國習' }, { id: 2, assignment: '數習' }],
        serializedStatuses: { '國習': JSON.stringify({ 2: false }), '數習': JSON.stringify({ 3: false }) },
        teacherPin: '8888',
        lastUpdated: 1
    });
    const page = await openDevice(browser, cloud);
    await expect.poll(() => cloud.board('main').statuses).toBeTruthy();
    const board = cloud.board('main');
    expect(board.serializedStatuses).toBeUndefined();
    expect(board.statuses['國習']['2']).toBe(false);
    expect(board.statuses['數習']['3']).toBe(false);
    await expect(page.locator('#btn-slot-0-student-2')).toHaveClass(/seat-pending/);
});

test('卡片「全部完成」只在教師登記模式出現，按下後只影響那一項作業', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await teacherMode(page);
    await page.click('#btn-slot-0-student-3');
    await page.click('#btn-slot-0-student-5');
    await page.click('#btn-slot-1-student-7');
    await expect(page.locator('#slot-done-0')).toBeVisible();

    await page.evaluate(() => applyRoleUI('student'));
    await expect(page.locator('#slot-done-0')).toBeHidden();
    await page.evaluate(() => applyRoleUI('teacher'));

    await page.click('#slot-done-0');
    expect(page.dialogs.at(-1)).toContain('2 位待訂正');
    await expect(page.locator('#slot-badge-0')).toContainText('全員完成');
    await expect(page.locator('#slot-done-0')).toBeHidden();
    await page.waitForTimeout(500);
    const statuses = cloud.board('main').statuses;
    expect(statuses['國習']['3']).toBe(true);
    expect(statuses['國習']['5']).toBe(true);
    expect(statuses['國作']['7']).toBe(false); // 其他作業不受影響
});

test('有網路時修改會存到雲端，電腦重新開機後資料還在', async ({ browser }) => {
    const cloud = createCloud();
    const classroom = await openDevice(browser, cloud);
    await teacherMode(classroom);
    for (const seat of [2, 9, 17]) await classroom.click(`#btn-slot-0-student-${seat}`);
    await classroom.click('#btn-slot-1-student-5');
    // 狀態燈回到「已連線存檔」代表全部都已存進雲端
    await expect(classroom.locator('#cloud-sync-status')).toContainText('已連線存檔');
    expect(cloud.board('main').statuses['國習']).toMatchObject({ 2: false, 9: false, 17: false });
    expect(cloud.board('main').statuses['國作']['5']).toBe(false);

    // 模擬電腦重新開機：關掉整個瀏覽器，再用全新的瀏覽器開啟
    await classroom.context().close();
    const restarted = await openDevice(browser, cloud);
    for (const seat of [2, 9, 17]) await expect(restarted.locator(`#btn-slot-0-student-${seat}`)).toHaveClass(/seat-pending/);
    await expect(restarted.locator('#btn-slot-1-student-5')).toHaveClass(/seat-pending/);
    await expect(restarted.locator('#slot-badge-0')).toContainText('待訂正 3 人');
});
