// 早上收作業：照前一天的聯絡簿列好項目、一次放上看板；清點缺交模式；考卷簽名另成一項
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

async function teacherMode(page) {
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
}

// 把前一天寫的聯絡簿放進早自習（不用打開早自習分頁）
async function yesterdayContact(page, items) {
    await page.evaluate((list) => {
        const y = new Date(Date.now() - 86400000);
        const key = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
        state.daily = { ...state.daily, contact: { ...state.daily.contact, date: key, items: list } };
    }, items);
}

test('收作業：照前一天的聯絡簿列好項目，勾選後一次放上看板，自動切到清點缺交', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await teacherMode(page);
    await yesterdayContact(page, ['1.國卷L5訂簽', '字詞單L6', '數練p.28-p.30', '考國L6', '*下周社團停課', '數後測卷U4']);
    await page.click('#collect-button');
    const rows = page.locator('#collect-rows .collect-row');
    await expect(rows).toHaveCount(5); // 星號公告不列
    await expect(rows.nth(0).locator('.collect-base')).toHaveValue('國卷');
    await expect(rows.nth(0).locator('.collect-detail')).toHaveValue('L5');
    await expect(rows.nth(0).locator('.collect-sign')).toBeChecked(); // 寫了「訂簽」才要簽名
    await expect(rows.nth(4).locator('.collect-sign')).not.toBeChecked(); // 考卷沒寫訂簽就不用簽
    await expect(rows.nth(2).locator('.collect-base')).toHaveValue('數練');
    await expect(rows.nth(2).locator('.collect-detail')).toHaveValue('p.28-p.30');
    await expect(rows.nth(3).locator('.collect-on')).not.toBeChecked(); // 考試預告預設不收

    const date = await page.inputValue('#collect-date');
    const md = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
    await page.click('#collect-confirm');
    const slots = await page.evaluate(() => state.slots.map((s) => s.assignment));
    expect(slots).toContain(`國卷｜${md} L5`);
    expect(slots).toContain(`簽名｜國卷 ${md} L5`);
    expect(slots).toContain(`字詞單｜${md} L6`);
    expect(slots).toContain(`數練｜${md} p.28-p.30`);
    expect(slots.some((s) => s.startsWith('考國'))).toBe(false);
    await expect(page.locator('#role-status-text')).toContainText('清點缺交');
    await expect.poll(() => cloud.board('main').slots.map((s) => s.assignment), { timeout: 15000 }).toContain(`國卷｜${md} L5`);
    expect(page.errors).toEqual([]);
});

test('清點缺交：點一下變缺交、再點一下取消；改作業維持原本的 綠 → 紅 → 缺交 → 綠', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await teacherMode(page);
    await page.evaluate(() => { state.slots[0].assignment = state.assignments[0]; renderDashboard(); });
    await page.click('#mark-mode-missing');
    const seat = page.locator('#btn-slot-0-student-4');
    await seat.click();
    await expect(seat).toHaveClass(/seat-missing/);
    await seat.click();
    await expect(seat).not.toHaveClass(/seat-missing|seat-pending/);

    await page.click('#mark-mode-fix');
    await seat.click();
    await expect(seat).toHaveClass(/seat-pending/);
    await seat.click();
    await expect(seat).toHaveClass(/seat-missing/);
    await seat.click();
    await expect(seat).not.toHaveClass(/seat-missing|seat-pending/);
});

test('考卷簽名項目：沒簽是紫色「簽」，學生簽好自己點掉；家長頁另外寫「考卷沒簽名」', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await teacherMode(page);
    const code = await page.evaluate(() => state.students.find((s) => s.id === 6).parentCode);
    await page.evaluate(() => {
        state.assignments.push('簽名｜國卷 10/28 L5');
        state.slots[1].assignment = '簽名｜國卷 10/28 L5';
        renderDashboard();
        syncStateToCloud(true);
    });
    // 改作業模式下，簽名項目也是一點就變「沒簽」
    await page.click('#mark-mode-fix');
    const seat = page.locator('#btn-slot-1-student-6');
    await seat.click();
    await expect(seat).toHaveClass(/seat-sign/);
    await expect(page.locator('#view-dashboard > div').nth(1)).toContainText('沒簽 1 人');

    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#parent-status-title')).toContainText('考卷沒簽名 1 張', { timeout: 20000 });
    await expect(parent.locator('#parent-assignment-list')).toContainText('考卷簽名');
    await expect(parent.locator('#parent-assignment-list')).toContainText('沒簽');

    // 學生簽好名，自己點一下就變綠燈（不會變成要訂正）
    await page.evaluate(() => applyRoleUI('student'));
    await seat.click();
    await expect(seat).not.toHaveClass(/seat-sign|seat-missing|seat-pending/);
    expect(page.errors).toEqual([]);
});

test('今天寫了新的聯絡簿後，收作業仍然照前一天的那份', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await teacherMode(page);
    await yesterdayContact(page, ['國卷L5']);
    await page.evaluate(() => {
        state.daily.enabled = true;
        document.getElementById('contact-input').value = '明天的作業';
        document.getElementById('task-input').value = '';
        saveContact();
    });
    await page.click('#collect-button');
    await expect(page.locator('#collect-rows .collect-base')).toHaveValue('國卷');
    expect(page.errors).toEqual([]);
});

test('下午 3 點後寫的聯絡簿算下一個上課日出的作業；收作業用前一個上課日出的那份', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    const dates = await page.evaluate(() => [
        contactAssignDate(new Date(2026, 9, 29, 10, 0)),  // 週四上午：當天
        contactAssignDate(new Date(2026, 9, 29, 15, 30)), // 週四下午 3 點後：週五
        contactAssignDate(new Date(2026, 9, 30, 16, 0)),  // 週五下午：下週一
    ]);
    expect(dates).toEqual(['2026-10-29', '2026-10-30', '2026-11-02']);

    await teacherMode(page);
    await page.evaluate(() => {
        const key = (d) => toDateInputValue(d);
        const yesterday = key(previousSchoolDay(new Date()));
        state.daily = { ...state.daily, contact: { ...state.daily.contact, date: todayKey(), items: ['明天的數習P.50'],
            history: { [yesterday]: ['國習P.20'], [key(nextSchoolDay(new Date()))]: ['明天的數習P.50'] } } };
    });
    await page.click('#collect-button');
    await expect(page.locator('#collect-rows .collect-base')).toHaveValue('國習');
    const expected = await page.evaluate(() => toDateInputValue(previousSchoolDay(new Date())));
    await expect(page.locator('#collect-date')).toHaveValue(expected);
    expect(page.errors).toEqual([]);
});

test('收作業可以改日期回頭找前幾天出的作業；沒有紀錄就留空自己填', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await teacherMode(page);
    const [d1, d2] = await page.evaluate(() => {
        const a = toDateInputValue(previousSchoolDay(new Date()));
        const b = toDateInputValue(previousSchoolDay(previousSchoolDay(new Date())));
        state.daily = { ...state.daily, contact: { ...state.daily.contact, date: todayKey(), items: [], history: { [a]: ['國習P.20'], [b]: ['數習P.30', '甲本P.5'] } } };
        return [a, b];
    });
    await page.click('#collect-button');
    await expect(page.locator('#collect-rows .collect-base')).toHaveValue('國習');
    await page.fill('#collect-date', d2);
    await page.dispatchEvent('#collect-date', 'change');
    await expect(page.locator('#collect-rows .collect-base')).toHaveCount(2);
    await expect(page.locator('#collect-rows .collect-base').first()).toHaveValue('數習');
    await page.fill('#collect-date', '2000-01-03');
    await page.dispatchEvent('#collect-date', 'change');
    await expect(page.locator('#collect-source')).toContainText('沒有 1/3 出的作業紀錄');
    await expect(page.locator('#collect-rows .collect-base')).toHaveValue('');
    expect(page.errors).toEqual([]);
});

test('收作業列出「今天要收」的作業：不同天出、改過收作業日期的都會列出，各自標出作業那天；還沒到期的不列', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await teacherMode(page);
    const [d1, d2] = await page.evaluate(() => {
        const now = new Date();
        const day = now.getDay() === 0 || now.getDay() === 6 ? nextSchoolDay(now) : now;
        const a = toDateInputValue(previousSchoolDay(day));   // 前一個上課日出的：照預設今天收
        const b = toDateInputValue(previousSchoolDay(previousSchoolDay(day))); // 再前一天出的：老師改成今天收
        const c = toDateInputValue(previousSchoolDay(previousSchoolDay(previousSchoolDay(day)))); // 改成之後才收
        state.daily = { ...state.daily, contact: { ...state.daily.contact, date: todayKey(), items: [],
            history: { [a]: ['國習P.20'], [b]: ['週末作業甲本P.5'], [c]: ['數習P.30'] },
            due: { [b]: toDateInputValue(day), [c]: toDateInputValue(nextSchoolDay(day)) } } };
        return [a, b];
    });
    await page.click('#collect-button');
    const bases = page.locator('#collect-rows .collect-base');
    await expect(bases).toHaveCount(2);
    await expect(bases.nth(0)).toHaveValue('週末作業甲本');
    await expect(bases.nth(1)).toHaveValue('國習');
    await page.click('#collect-confirm');
    const md = (k) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
    const slots = await page.evaluate(() => state.slots.map((s) => s.assignment));
    expect(slots).toContain(`國習｜${md(d1)} P.20`);
    expect(slots).toContain(`週末作業甲本｜${md(d2)} P.5`);
    expect(page.errors).toEqual([]);
});
