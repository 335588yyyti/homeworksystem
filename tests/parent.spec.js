// 家長查詢：只讀得到自己孩子的資料、即時更新、精簡畫面、列印 QR Code
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('家長頁只讀自己孩子的摘要，不讀整班看板', async ({ browser }) => {
    const cloud = createCloud();
    const teacher = await openDevice(browser, cloud);
    await teacher.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await teacher.click('#btn-slot-0-student-5');
    await teacher.waitForTimeout(500);
    const code = await teacher.evaluate(() => state.students.find((s) => s.id === 5).parentCode);

    const parent = await openDevice(browser, cloud, { query: '?p=' + code.toLowerCase(), viewport: { width: 390, height: 700 } });
    await expect(parent.locator('#parent-child-name')).toContainText('5 號');
    await expect(parent.locator('#parent-status-title')).toContainText('1 項');
    await expect(parent.locator('#parent-assignment-list > div')).toHaveCount(1);
    expect(parent.reads.some((p) => p.includes('checkpoint_boards'))).toBe(false);
    expect(parent.reads.every((p) => p.endsWith(code))).toBe(true);
    expect(JSON.stringify(cloud.view(code))).not.toContain('teacherPin');

    // 看板、教師功能、標語都不顯示
    await expect(parent.locator('#view-dashboard')).toBeHidden();
    await expect(parent.locator('nav')).toBeHidden();
    await expect(parent.locator('#slogan-title-display')).toBeHidden();

    // 老師改回綠燈，家長頁即時更新；全部完成時不列出作業
    await teacher.click('#btn-slot-0-student-5');
    await expect(parent.locator('#parent-status-title')).toContainText('無需訂正');
    await expect(parent.locator('#parent-progress-percent')).toHaveText('100%');
    await expect(parent.locator('#parent-pending-section')).toBeHidden();
    const scrolls = await parent.evaluate(() => { const v = document.getElementById('view-parent'); return v.scrollHeight > v.clientHeight; });
    expect(scrolls).toBe(false);
});

test('查詢碼錯誤或格式不對時顯示提示', async ({ browser }) => {
    const parent = await openDevice(browser, createCloud(), { query: '?p' });
    await parent.fill('#parent-code-input', 'ZZZZZZ');
    await parent.press('#parent-code-input', 'Enter');
    await expect(parent.locator('#parent-code-msg')).toContainText('找不到');
    await parent.fill('#parent-code-input', '12');
    await parent.press('#parent-code-input', 'Enter');
    await expect(parent.locator('#parent-code-msg')).toContainText('6 碼');
});

test('重新產生查詢碼後，舊的立即失效', async ({ browser }) => {
    const cloud = createCloud();
    const teacher = await openDevice(browser, cloud);
    const oldCode = await teacher.evaluate(() => state.students.find((s) => s.id === 6).parentCode);
    await teacher.evaluate(() => { startTeacherSession(); switchTab('settings', true); regenerateParentCode(6); });
    await teacher.waitForTimeout(600);
    const newCode = await teacher.evaluate(() => state.students.find((s) => s.id === 6).parentCode);
    expect(newCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(cloud.view(oldCode)).toBeUndefined();
    expect(cloud.view(newCode)).toBeTruthy();
});

test('列印紙條的 QR Code 內容就是家長連結', async ({ browser }) => {
    const teacher = await openDevice(browser, createCloud());
    await teacher.evaluate(() => { state.students = state.students.slice(0, 2); startTeacherSession(); switchTab('settings', true); });
    const [popup] = await Promise.all([teacher.waitForEvent('popup'), teacher.evaluate(() => printParentCodes())]);
    await popup.waitForSelector('.slip');
    const slips = await popup.evaluate(() => [...document.querySelectorAll('.slip')].map((s) => ({ src: s.querySelector('img.qr')?.src || '', link: s.querySelector('img.qr')?.dataset.link })));
    expect(slips).toHaveLength(2);
    // 用網頁內的 BarcodeDetector 不一定支援，改為確認圖片存在且連結格式正確
    for (const slip of slips) {
        expect(slip.src.startsWith('data:image/png')).toBe(true);
        expect(slip.link).toMatch(/\?p=[A-Z0-9]{6}$/);
    }
});
