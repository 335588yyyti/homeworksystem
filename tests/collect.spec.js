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
