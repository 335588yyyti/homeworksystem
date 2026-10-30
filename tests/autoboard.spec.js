// 全班完成的舊作業自動問要不要刪；下方比較多人要訂正的作業自動換上看板
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('老師登記時，全班完成、已換下看板的舊日期作業會自動問要不要刪；按「先不要」今天不再問', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => {
        state.assignments.push('國習｜10/1', '數習｜10/2', '國習｜10/3');
        setStudentStatus('國習｜10/3', 5, false); // 還有人沒完成：不刪
        renderDashboard();
    });
    await expect(page.locator('#cleanup-bar')).toBeHidden(); // 學生模式不問
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await expect(page.locator('#cleanup-bar')).toBeVisible();
    await expect(page.locator('#cleanup-count')).toHaveText('有 2');
    await expect(page.locator('#cleanup-list')).toContainText('國習｜10/1');
    await expect(page.locator('#cleanup-list')).not.toContainText('10/3');

    await page.click('#cleanup-bar >> text=先不要');
    await expect(page.locator('#cleanup-bar')).toBeHidden();
    await page.evaluate(() => { applyRoleUI('student'); applyRoleUI('teacher'); });
    await expect(page.locator('#cleanup-bar')).toBeHidden();

    // 又多了一項全班完成的：再問一次，按「刪掉這些」
    await page.evaluate(() => { setStudentStatus('國習｜10/3', 5, true); renderOffBoard(); });
    await expect(page.locator('#cleanup-bar')).toBeVisible();
    await page.click('#cleanup-confirm');
    await expect(page.locator('#cleanup-bar')).toBeHidden();
    const left = await page.evaluate(() => state.assignments.filter((a) => a.includes('｜10/')));
    expect(left).toEqual([]);
    await expect.poll(() => cloud.board('main').assignments.some((a) => a.includes('｜10/')), { timeout: 15000 }).toBe(false);
    expect(page.errors).toEqual([]);
});

test('學生消單後，下方比較多人要訂正的作業會自動換上看板（今天才放上的不換）', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => {
        state.assignments.forEach((a) => { state.assignmentStatuses[a] = {}; });
        state.assignments.push('數練｜10/27 26-27');
        [2, 3, 5, 6, 7].forEach((id) => setStudentStatus('數練｜10/27 26-27', id, false));
        state.slots.forEach((s, i) => { s.placed = '2000-01-01'; });
        state.slots[1].placed = todayKey(); // 第 2 框是今天才放的
        setStudentStatus(state.slots[0].assignment, 9, false);
        setStudentStatus(state.slots[0].assignment, 10, false);
        state.slots.slice(2).forEach((s) => [11, 12].forEach((id) => setStudentStatus(s.assignment, id, false)));
        renderDashboard();
        applyRoleUI('student');
        syncStateToCloud(true);
    });
    await expect.poll(() => cloud.board('main')?.assignments?.includes('數練｜10/27 26-27'), { timeout: 15000 }).toBe(true);
    const firstBefore = await page.evaluate(() => state.slots[0].assignment);
    // 第 1 框剩 2 人，學生點掉一個後剩 1 人，比下方的數練（5 人）少：換上數練
    await page.click('#btn-slot-0-student-9');
    await expect.poll(() => page.evaluate(() => state.slots[0].assignment), { timeout: 15000 }).toBe('數練｜10/27 26-27');
    expect(await page.evaluate(() => state.slots[1].placed === todayKey())).toBe(true);
    expect(await page.evaluate((a) => state.assignments.includes(a), firstBefore)).toBe(true); // 換下的作業還在下方
    await expect(page.locator('#toast-msg')).toContainText('第 1 框換上【數練｜10/27 26-27】');
    await expect.poll(() => cloud.board('main').slots[0].assignment, { timeout: 15000 }).toBe('數練｜10/27 26-27');
    expect(page.errors).toEqual([]);
});

test('一樣多人要訂正時，日期較近的放看板、較舊的換到下方；老師登記時也會自動換', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => {
        state.assignments.forEach((a) => { state.assignmentStatuses[a] = {}; });
        state.assignments.push('國習｜10/20 p.5', '國習｜10/28 p.9');
        state.slots.forEach((s) => { s.placed = '2000-01-01'; });
        state.slots[0].assignment = '國習｜10/20 p.5';
        [2, 3, 4].forEach((id) => setStudentStatus('國習｜10/20 p.5', id, false)); // 看板上：3 人、10/20
        [5, 6].forEach((id) => setStudentStatus('國習｜10/28 p.9', id, false));   // 下方：2 人、10/28
        state.slots.slice(1).forEach((s) => [11, 12, 13].forEach((id) => setStudentStatus(s.assignment, id, false)));
        startTeacherSession(); applyRoleUI('teacher');
        renderDashboard();
        syncStateToCloud(true);
    });
    await expect.poll(() => cloud.board('main')?.assignments?.includes('國習｜10/28 p.9'), { timeout: 15000 }).toBe(true);
    // 老師把看板上 10/20 那項的 2 號改成綠燈：剩 2 人，跟下方 10/28 一樣多，日期較近的換上看板
    await page.click('#mark-mode-fix');
    await page.click('#btn-slot-0-student-2');
    await page.click('#btn-slot-0-student-2'); // 紅 → 缺交 → 綠
    await expect.poll(() => page.evaluate(() => state.slots[0].assignment), { timeout: 15000 }).toBe('國習｜10/28 p.9');
    expect(page.errors).toEqual([]);
});
