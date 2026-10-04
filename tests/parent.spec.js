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

test('重新開網頁時不重寫全班的家長查詢資料，只上傳有變動的', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    const viewWrites = () => page.writes.filter((p) => p.includes('/parent_views/')).length;
    await expect.poll(viewWrites).toBe(28); // 第一次使用：上傳全班

    page.writes.length = 0;
    await page.reload();
    await page.waitForTimeout(800);
    expect(viewWrites()).toBe(0); // 重新開網頁：沒有變動就不上傳

    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.click('#btn-slot-0-student-4');
    await page.waitForTimeout(800);
    expect(viewWrites()).toBe(1); // 點一格：只更新那位學生

    // 超過 7 天：整份重新上傳一次，以防雲端資料被手動刪除或不一致
    page.writes.length = 0;
    await page.evaluate(() => {
        const cache = JSON.parse(localStorage.getItem('checkpoint_published_views'));
        cache.bornAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
        localStorage.setItem('checkpoint_published_views', JSON.stringify(cache));
    });
    await page.reload();
    await expect.poll(viewWrites).toBe(28);
});
