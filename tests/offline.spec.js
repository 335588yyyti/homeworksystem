// 離線：斷線時狀態燈提示、修改暫存，恢復連線後自動上傳；空的離線快取不會被誤當成新班級
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('斷線時顯示離線中，恢復連線後自動上傳修改', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });

    await page.context().setOffline(true);
    await expect(page.locator('#cloud-sync-status')).toContainText('離線中');
    await page.click('#btn-slot-0-student-7');
    await page.click('#btn-slot-0-student-8');
    await page.waitForTimeout(600);
    // 離線時還沒上傳
    expect(JSON.parse(cloud.board('main').serializedStatuses['國習'] || '{}')[7]).not.toBe(false);
    await expect(page.locator('#cloud-sync-status')).toContainText('離線中');

    await page.context().setOffline(false);
    await expect(page.locator('#cloud-sync-status')).toContainText('已連線存檔');
    const statuses = JSON.parse(cloud.board('main').serializedStatuses['國習']);
    expect(statuses[7]).toBe(false);
    expect(statuses[8]).toBe(false);
});

test('離線開啟網頁、本機沒有快取時，不會把本機資料當成新班級上傳', async ({ browser }) => {
    const cloud = createCloud();
    // 雲端已有一份 3 人的班級
    cloud.setBoard('main', { students: [{ id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }], assignments: ['國習'], slots: [{ id: 1, assignment: '國習' }], serializedStatuses: {}, teacherPin: '8888', lastUpdated: 1 });
    const page = await openDevice(browser, cloud, { offline: true });
    await page.waitForTimeout(600);
    // 離線時沒有寫入任何資料
    expect(page.writes).toEqual([]);

    // 恢復連線後載入雲端的 3 人，不會用本機預設的 28 人覆蓋
    await page.context().setOffline(false);
    await expect(page.locator('#cloud-sync-status')).toContainText('已連線存檔');
    await expect.poll(() => page.evaluate(() => state.students.length)).toBe(3);
    await page.waitForTimeout(500);
    expect(cloud.board('main').students).toHaveLength(3);
    expect(page.writes.filter((p) => p.includes('checkpoint_boards'))).toEqual([]);
});
