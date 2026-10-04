// 班級座號名冊：新增座號依號碼順序插入、接續新增下一號
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('新增的座號依號碼順序插入（轉學生遞補中間的空缺）', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    await page.evaluate(() => {
        state.students = state.students.filter((s) => s.name !== '15');
        renderSettingsStudents();
    });
    await page.fill('#new-student-name', '15');
    await page.press('#new-student-name', 'Enter');
    await expect(page.locator('#toast-msg')).toContainText('已新增座號：【15】');
    const seats = await page.evaluate(() => state.students.map((s) => s.name));
    expect(seats.slice(13, 16)).toEqual(['14', '15', '16']);
    await expect.poll(() => cloud.board('main').students.map((s) => s.name).slice(13, 16)).toEqual(['14', '15', '16']);
    // 名冊表格也照順序顯示
    expect(await page.locator('#settings-student-table tr:nth-child(15) input').inputValue()).toBe('15');

    // 全形數字、重複座號
    await page.fill('#new-student-name', '３０');
    await page.click('#settings-student-table >> xpath=ancestor::div[contains(@class,"roster-card")]//button[contains(., "新增") and not(contains(., "接續"))]');
    expect(await page.evaluate(() => state.students.at(-1).name)).toBe('30');
    await page.fill('#new-student-name', '15');
    await page.press('#new-student-name', 'Enter');
    await expect(page.locator('#toast-msg')).toContainText('已存在');
});

test('接續新增：照最後一號直接加 1，連按到 40 人為止', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    await page.click('#append-student-button');
    await expect(page.locator('#toast-msg')).toContainText('【29】');
    for (let i = 0; i < 11; i++) await page.click('#append-student-button');
    const seats = await page.evaluate(() => state.students.map((s) => s.name));
    expect(seats).toHaveLength(40);
    expect(seats.at(-1)).toBe('40');
    await page.click('#append-student-button');
    await expect(page.locator('#toast-msg')).toContainText('最多 40');
    await expect.poll(() => cloud.board('main').students.length).toBe(40);
    // 每位新同學都有家長查詢碼
    expect(await page.evaluate(() => state.students.every((s) => /^[A-Z0-9]{6}$/.test(s.parentCode)))).toBe(true);
});
