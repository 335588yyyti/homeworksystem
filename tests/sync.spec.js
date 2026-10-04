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
    await phone.click('#btn-slot-0-student-4');
    // 教師登記的紅綠燈等 5 秒沒有新變動才上傳
    await expect.poll(() => { const st = cloud.board('main').statuses['國習'] || {}; return [st['3'], st['4']]; }, { timeout: 10000 }).toEqual([false, false]);
    await phone.evaluate(() => { window.__pauseSnapshots = false; });

    for (const page of [classroom, phone]) {
        await expect.poll(() => page.evaluate(() => [state.assignmentStatuses['國習'][3], state.assignmentStatuses['國習'][4]])).toEqual([false, false]);
    }
    // 點一格只更新那一格，不是整份重傳
    const before = classroom.writes.length;
    await classroom.click('#btn-slot-0-student-9');
    const boardWrites = () => classroom.writes.slice(before).filter((p) => p.includes('checkpoint_boards')).length;
    await expect.poll(boardWrites, { timeout: 10000 }).toBe(1);
});

test('連續點座號：最後一次點擊後 5 秒才一次存到雲端（教師登記、學生消單都一樣）', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud);
    await teacherMode(page);
    const boardWrites = () => page.writes.filter((p) => p.includes('checkpoint_boards')).length;
    const start = boardWrites();

    await page.click('#btn-slot-0-student-3');
    await page.waitForTimeout(3000);
    await page.click('#btn-slot-0-student-5');
    await page.click('#btn-slot-1-student-7');
    await page.waitForTimeout(3500);
    // 最後一次點擊後還不到 5 秒：還沒上傳，狀態燈顯示同步中
    expect(boardWrites()).toBe(start);
    await expect(page.locator('#cloud-sync-status')).toContainText('同步中');
    // 等待期間，另一台裝置的修改不會被蓋掉
    await phone.evaluate(() => { setStudentStatus('數課', 12, false); syncStatusChange([['數課', 12, false]]); });

    await expect.poll(boardWrites, { timeout: 4000 }).toBe(start + 1); // 三格一次送出
    await expect(page.locator('#cloud-sync-status')).toContainText('已連線存檔');
    const statuses = cloud.board('main').statuses;
    expect([statuses['國習']['3'], statuses['國習']['5'], statuses['國作']['7'], statuses['數課']['12']]).toEqual([false, false, false, false]);
    await expect.poll(() => page.evaluate(() => state.assignmentStatuses['數課'][12])).toBe(false);

    // 學生消單：也是等最後一次點擊後 5 秒才存
    await page.evaluate(() => applyRoleUI('student'));
    const beforeStudent = boardWrites();
    await page.click('#btn-slot-0-student-3');
    await page.waitForTimeout(2000);
    await page.click('#btn-slot-0-student-5');
    await page.waitForTimeout(3500);
    expect(cloud.board('main').statuses['國習']['3']).toBe(false);
    await expect.poll(boardWrites, { timeout: 4000 }).toBe(beforeStudent + 1);
    expect([cloud.board('main').statuses['國習']['3'], cloud.board('main').statuses['國習']['5']]).toEqual([true, true]);
});

test('按「立即同步」：馬上存出這台的修改，並載入另一台裝置的最新進度', async ({ browser }) => {
    const cloud = createCloud();
    const classroom = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud, { viewport: { width: 390, height: 844 } });
    await teacherMode(phone);
    await expect(classroom.locator('#sync-now-button')).toBeVisible();
    await expect(phone.locator('#sync-now-button')).toBeVisible();

    // 教室電腦暫時收不到自動更新，模擬兩台進度不一樣
    await classroom.evaluate(() => { window.__pauseSnapshots = true; });
    await phone.click('#btn-slot-0-student-11');
    await phone.click('#sync-now-button');
    await expect(phone.locator('#toast-msg')).toContainText('已同步');
    expect(cloud.board('main').statuses['國習']['11']).toBe(false); // 不用等 5 秒

    await expect(classroom.locator('#btn-slot-0-student-11')).not.toHaveClass(/seat-pending/);
    await classroom.click('#sync-now-button');
    await expect(classroom.locator('#toast-msg')).toContainText('這台裝置現在是最新進度');
    await expect(classroom.locator('#btn-slot-0-student-11')).toHaveClass(/seat-pending/);
    await expect(classroom.locator('#pending-list-count')).toHaveText('1');

    // 家長頁沒有這個按鈕
    const parent = await openDevice(browser, cloud, { query: '?p' });
    await expect(parent.locator('#sync-now-button')).toBeHidden();
});

test('沒有網路時按「立即同步」會說明修改已存在這台裝置', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.context().setOffline(true);
    await page.click('#sync-now-button');
    await expect(page.locator('#toast-msg')).toContainText('目前沒有網路');
});


test('點完紅燈 5 秒內關掉網頁，下次開啟時會補存到雲端', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await teacherMode(page);
    // 模擬上傳途中電腦當機：寫入永遠送不到雲端
    await page.evaluate(() => { window.__holdWrites = true; });
    await page.click('#btn-slot-0-student-6');
    await page.click('#btn-slot-1-student-8');
    await page.reload();
    await expect(page.locator('#cloud-sync-status')).toContainText('已連線存檔', { timeout: 10000 });
    await expect.poll(() => { const st = cloud.board('main').statuses; return [st['國習']['6'], st['國作']['8']]; }).toEqual([false, false]);
    await expect(page.locator('#btn-slot-0-student-6')).toHaveClass(/seat-pending/);
    expect(await page.evaluate(() => localStorage.getItem('checkpoint_queued_status'))).toBeNull();
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
    await expect.poll(() => cloud.board('main').statuses['國作']['7'], { timeout: 10000 }).toBe(false);
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
    // 狀態燈回到「已連線存檔」代表全部都已存進雲端（教師登記會等 5 秒沒有新變動才上傳）
    await expect(classroom.locator('#cloud-sync-status')).toContainText('同步中');
    await expect(classroom.locator('#cloud-sync-status')).toContainText('已連線存檔', { timeout: 10000 });
    expect(cloud.board('main').statuses['國習']).toMatchObject({ 2: false, 9: false, 17: false });
    expect(cloud.board('main').statuses['國作']['5']).toBe(false);

    // 模擬電腦重新開機：關掉整個瀏覽器，再用全新的瀏覽器開啟
    await classroom.context().close();
    const restarted = await openDevice(browser, cloud);
    for (const seat of [2, 9, 17]) await expect(restarted.locator(`#btn-slot-0-student-${seat}`)).toHaveClass(/seat-pending/);
    await expect(restarted.locator('#btn-slot-1-student-5')).toHaveClass(/seat-pending/);
    await expect(restarted.locator('#slot-badge-0')).toContainText('待訂正 3 人');
});
