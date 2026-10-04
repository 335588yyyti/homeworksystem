// 刪除這個班級：兩次確認、刪除家長查詢資料、其他裝置停止同步、代碼可再使用
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('刪除班級要兩次確認，輸入錯的代碼或取消都不會刪', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');

    // 第一次確認就取消
    page.answerDialogs = false;
    await page.click('#delete-class-button');
    expect(page.dialogs[0]).toContain('確定要刪除班級【main】');
    expect(page.dialogs[0]).toContain('無法復原');

    // 輸入錯的代碼
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { page.dialogs.push(d.message()); d.type() === 'prompt' ? d.accept('wrong1') : d.accept(); });
    await page.click('#delete-class-button');
    await expect(page.locator('#toast-msg')).toContainText('已取消刪除');
    expect(cloud.board('main').students).toHaveLength(28);
    expect(cloud.board('main').retired).toBeUndefined();
});

test('刪除班級：雲端只留「已清空」標記、家長查詢資料刪除、其他裝置停止同步，之後可用同代碼建立新班級', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud);
    const codes = await page.evaluate(() => state.students.map((s) => s.parentCode));
    await expect.poll(() => codes.every((c) => cloud.view(c))).toBe(true);
    // 等手機也上傳完家長查詢資料（第一次會先確認查詢碼）
    await expect.poll(() => phone.writes.filter((p) => p.includes('/parent_views/')).length).toBe(28);
    await page.evaluate(() => { setStudentStatus(state.slots[0].assignment, 3, false); syncStateToCloud(true); });

    await unlockTeacher(page, 'settings');
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { page.dialogs.push(d.message()); d.type() === 'prompt' ? d.accept('main') : d.accept(); });
    await page.click('#delete-class-button');
    await expect(page.locator('#toast-msg')).toContainText('已刪除班級【main】');

    const board = cloud.board('main');
    expect(Object.keys(board).sort()).toEqual(['retired', 'retiredAt']);
    expect(codes.some((c) => cloud.view(c))).toBe(false);
    await expect(page.locator('#cloud-sync-status')).toContainText('班級代碼已清空');

    // 另一台裝置停止同步，也不會把資料傳回去
    await expect(phone.locator('#view-dashboard')).toContainText('這個班級代碼的資料已經清空');
    await phone.evaluate(() => { setStudentStatus(state.assignments[0], 2, false); syncStateToCloud(true); });
    await phone.waitForTimeout(800);
    expect(Object.keys(cloud.board('main')).sort()).toEqual(['retired', 'retiredAt']);

    // 家長用舊查詢碼查不到
    const parent = await openDevice(browser, cloud, { query: '?p=' + codes[0] });
    await expect(parent.locator('#parent-result-box')).toBeHidden();

    // 同一個代碼可以重新建立新班級（例如下一屆）：全新、全部綠燈
    await page.evaluate(() => window.changeClassCode('main', true));
    await expect.poll(() => cloud.board('main').retired).toBeUndefined();
    expect(cloud.board('main').students).toHaveLength(28);
    expect(Object.values(cloud.board('main').statuses || {}).every((m) => Object.values(m).every(Boolean))).toBe(true);
});
