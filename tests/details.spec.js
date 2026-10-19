// 作業細節（日期、頁數、單元）、已換下看板的小清單、刪除已完成的舊作業
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('新增作業時自動填今天日期、可補頁數；同一本作業不同次分開記錄', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    // 預設前一個上課日（週一預設上週五）
    expect(await page.evaluate(() => toDateInputValue(previousSchoolDay(new Date(2026, 9, 19))))).toBe('2026-10-16');
    expect(await page.evaluate(() => toDateInputValue(previousSchoolDay(new Date(2026, 9, 21))))).toBe('2026-10-20');
    const today = await page.evaluate(() => { const d = previousSchoolDay(new Date()); return `${d.getMonth() + 1}/${d.getDate()}`; });

    await page.click('#new-on-board-button');
    await expect(page.locator('#new-on-board-date')).toHaveValue(await page.evaluate(() => toDateInputValue(previousSchoolDay(new Date()))));
    await expect(page.locator('#new-on-board-detail')).toHaveValue('');
    // 常用名稱點一下就填好
    await page.locator('#new-on-board-quick button', { hasText: '國習' }).click();
    await expect(page.locator('#new-on-board-name')).toHaveValue('國習');
    await page.locator('#new-on-board-detail').pressSequentially('p.23-24');
    await page.selectOption('#new-on-board-slot', '0');
    await page.click('#modal-new-on-board button:has-text("新增並放上看板")');
    const first = `國習｜${today} p.23-24`;
    expect(await page.evaluate(() => state.slots[0].assignment)).toBe(first);
    await expect(page.locator('#view-dashboard > div').first().locator('.slot-detail')).toHaveText(`📅 ${today} p.23-24`);

    // 同一本作業的另一次：分開記錄紅綠燈
    await page.click('#btn-slot-0-student-3'); // 3 號待訂正
    await page.click('#new-on-board-button');
    await page.fill('#new-on-board-name', '國習');
    await page.fill('#new-on-board-date', '2026-10-01'); // 拖了幾天才改：自己選日期
    await page.fill('#new-on-board-detail', 'p.30');
    await page.selectOption('#new-on-board-slot', '1');
    await page.click('#modal-new-on-board button:has-text("新增並放上看板")');
    expect(await page.evaluate(() => state.slots[1].assignment)).toBe('國習｜10/1 p.30');
    expect(await page.evaluate(() => getStudentStatus(state.slots[1].assignment, 3))).not.toBe(false);
    await expect.poll(() => cloud.board('main').statuses?.[first]?.['3'], { timeout: 12000 }).toBe(false);

    // 家長頁和未訂正名單看得到是哪一次
    const code = await page.evaluate(() => state.students.find((s) => s.id === 3).parentCode);
    await expect.poll(() => cloud.view(code)?.items.find((i) => i.name === first)?.finished, { timeout: 20000 }).toBe(false);
});

test('換下看板後還沒完成的同學排在下方小清單；只有老師和小幫手能點掉', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await expect(page.locator('#offboard-strip')).toBeHidden();
    const off = await page.evaluate(() => {
        const onBoard = new Set(state.slots.map((s) => s.assignment));
        const a = state.assignments.find((x) => !onBoard.has(x));
        setStudentStatus(a, 4, false);
        setStudentStatus(a, 9, 'missing');
        renderDashboard();
        return a;
    });
    await expect(page.locator('#offboard-strip')).toBeVisible();
    await expect(page.locator('#offboard-list')).toContainText(off);
    const seats = page.locator('#offboard-list .offboard-seat');
    await expect(seats).toHaveCount(2);
    await expect(seats.nth(1)).toContainText('缺');

    // 學生模式：點了不會消掉
    await seats.first().click();
    await expect(page.locator('#toast-msg')).toContainText('找老師或小幫手');
    await expect(seats).toHaveCount(2);

    // 老師：點一下就完成，存到雲端；5 秒內可以復原
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.locator('#offboard-list .offboard-seat', { hasText: '4' }).click();
    await expect(seats).toHaveCount(1);
    await expect.poll(() => cloud.board('main').statuses?.[off]?.['4'], { timeout: 12000 }).toBe(true);
    await page.click('#undo-bar button');
    await expect(seats).toHaveCount(2);
    await page.locator('#offboard-list .offboard-seat', { hasText: '4' }).click();
    await page.locator('#offboard-list .offboard-seat', { hasText: '9' }).click();
    await expect(page.locator('#offboard-strip')).toBeHidden();

    // 其他分頁不顯示
    await page.evaluate(() => { setStudentStatus(state.assignments.find((x) => !state.slots.some((s) => s.assignment === x)), 5, false); renderDashboard(); });
    await expect(page.locator('#offboard-strip')).toBeVisible();
    await page.click('#tab-parent');
    await expect(page.locator('#offboard-strip')).toBeHidden();
});

test('設定後台可以一次刪除全班已完成、不在看板上的舊日期作業', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => {
        state.assignments.push('國習｜10/1', '國習｜10/2', '數習｜10/3');
        setStudentStatus('國習｜10/2', 7, false); // 還有人沒完成：保留
        state.slots[0].assignment = '數習｜10/3'; // 在看板上：保留
        renderDashboard();
        syncStateToCloud(true);
    });
    await unlockTeacher(page, 'settings');
    await page.click('#clean-old-assignments');
    await expect.poll(() => cloud.board('main').assignments.includes('國習｜10/1'), { timeout: 12000 }).toBe(false);
    const list = cloud.board('main').assignments;
    expect(list).toContain('國習｜10/2');
    expect(list).toContain('數習｜10/3');
    // 沒有日期的作業項目不會被刪
    expect(list).toContain('國習');
    await expect(page.locator('#toast-msg')).toContainText('已刪除 1 項');
});
