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
    // 一直顯示；沒有人欠的時候顯示「都完成了」
    await expect(page.locator('#offboard-strip')).toBeVisible();
    await expect(page.locator('#offboard-hint')).toHaveText('✅ 換下看板的作業都完成了');
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
    await expect(page.locator('#offboard-hint')).toHaveText('✅ 換下看板的作業都完成了');
    await expect(seats).toHaveCount(0);

    // 其他分頁不顯示
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
    await expect(page.locator('#assignment-count-hint')).toContainText('最多 50 項（目前 ');
    await page.click('#clean-old-assignments');
    await expect.poll(() => cloud.board('main').assignments.includes('國習｜10/1'), { timeout: 12000 }).toBe(false);
    const list = cloud.board('main').assignments;
    expect(list).toContain('國習｜10/2');
    expect(list).toContain('數習｜10/3');
    // 沒有日期的作業項目不會被刪
    expect(list).toContain('國習');
    await expect(page.locator('#toast-msg')).toContainText('已刪除 1 項');
});

test('家長頁和未訂正名單：同一本作業的不同次合在一起，日期頁數列在下面', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => {
        state.assignments.push('國習｜10/15 p.20', '國習｜10/16 p.23-24', '國習｜10/17');
        setStudentStatus('國習｜10/15 p.20', 3, false);
        setStudentStatus('國習｜10/16 p.23-24', 3, false);
        setStudentStatus('國習｜10/17', 3, 'missing');
        renderDashboard();
        syncStateToCloud(true);
    });
    const code = await page.evaluate(() => state.students.find((s) => s.id === 3).parentCode);
    await expect.poll(() => cloud.view(code)?.items.filter((i) => !i.finished).length, { timeout: 20000 }).toBe(3);
    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    const cards = parent.locator('#parent-assignment-list > div');
    await expect(cards).toHaveCount(2); // 缺交一格、待訂正一格
    await expect(cards.nth(0)).toContainText('缺交');
    await expect(cards.nth(0)).toContainText('10/17');
    await expect(cards.nth(1)).toContainText('國習');
    await expect(cards.nth(1)).toContainText('10/15 p.20');
    await expect(cards.nth(1)).toContainText('10/16 p.23-24');
    await expect(parent.locator('#parent-status-title')).toHaveText('缺交 1 項、待訂正 2 項');

    await page.click('#pending-list-button');
    await expect(page.locator('#pending-list-body')).toContainText('國習 10/15 p.20、10/16 p.23-24');
    await expect(page.locator('#pending-list-body')).toContainText('缺交・國習 10/17');
});

test('作業框選單的「新增作業」打開同一個新增視窗（可選日期、填頁數），預設放到這一框', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.locator('#view-dashboard .slot-select').nth(2).selectOption('__custom__');
    await expect(page.locator('#modal-new-on-board')).toBeVisible();
    expect(await page.inputValue('#new-on-board-slot')).toBe('2');
    await expect(page.locator('#new-on-board-date')).not.toHaveValue('');
    await page.fill('#new-on-board-name', '乙本');
    await page.fill('#new-on-board-date', '2026-10-16');
    await page.fill('#new-on-board-detail', '25-26');
    await page.click('#modal-new-on-board button:has-text("新增並放上看板")');
    expect(await page.evaluate(() => state.slots[2].assignment)).toBe('乙本｜10/16 25-26');
    // 取消時選單回到原本的作業
    const before = await page.evaluate(() => state.slots[0].assignment);
    await page.locator('#view-dashboard .slot-select').nth(0).selectOption('__custom__');
    await page.click('#modal-new-on-board button:has-text("取消")');
    expect(await page.evaluate(() => state.slots[0].assignment)).toBe(before);
    expect(await page.locator('#view-dashboard .slot-select').nth(0).inputValue()).toBe(before);
});

test('設定後台的作業項目標出「訂正中」或「全部完成」，以及是否在看板上', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.evaluate(() => {
        state.assignments.push('國習｜10/16 p.23');
        setStudentStatus('國習｜10/16 p.23', 3, false);
        setStudentStatus('國習｜10/16 p.23', 5, 'missing');
    });
    await unlockTeacher(page, 'settings');
    const rows = page.locator('#settings-assignment-list .assign-row');
    const row = rows.filter({ has: page.locator('input[value="國習｜10/16 p.23"]') });
    await expect(row.locator('.assign-status')).toHaveText('🔴 訂正 1 人・缺交 1 人');
    await expect(rows.first().locator('.assign-status')).toHaveText('✅ 全部完成');
    await expect(rows.first()).toContainText('看板中');
    await expect(page.locator('#assignment-status-summary')).toContainText('訂正中 1 項');
});
