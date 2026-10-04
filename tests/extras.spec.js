// 點錯復原、新增並放上看板、預設密碼提醒、家長加到主畫面、螢幕不休眠
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('點座號後 5 秒內可以復原，雲端只存最後的結果', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.click('#btn-slot-0-student-4');
    await expect(page.locator('#undo-bar')).toBeVisible();
    await expect(page.locator('#undo-text')).toContainText('4 號【國習】改成紅燈');
    await page.click('#undo-button');
    await expect(page.locator('#btn-slot-0-student-4')).not.toHaveClass(/seat-pending/);
    await expect(page.locator('#undo-bar')).toHaveClass(/opacity-0/);
    await page.waitForTimeout(6000);
    expect((cloud.board('main').statuses['國習'] || {})['4']).not.toBe(false);

    // 學生消單點錯也能復原；5 秒後按鈕自動消失
    await page.click('#btn-slot-0-student-7');
    await page.evaluate(() => applyRoleUI('student'));
    await page.click('#btn-slot-0-student-7');
    await expect(page.locator('#undo-text')).toContainText('7 號【國習】已消單');
    await page.click('#undo-button');
    await expect(page.locator('#btn-slot-0-student-7')).toHaveClass(/seat-pending/);
    await page.click('#btn-slot-0-student-8'); // 已是綠燈：不會改變，也不出現復原
    await page.waitForTimeout(5500);
    await expect(page.locator('#undo-bar')).toHaveClass(/opacity-0/);
    await expect.poll(() => cloud.board('main').statuses['國習']['7'], { timeout: 8000 }).toBe(false);
});

test('看板「新增並放上看板」：預設換掉全班已完成的框，新增的作業同步到雲端', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => {
        setStudentStatus(state.slots[0].assignment, 3, false); // 第 1 框還有人沒訂正
        renderDashboard();
    });
    // 沒解鎖：先要求教師密碼
    await page.click('#new-on-board-button');
    await expect(page.locator('#modal-teacher-auth')).toBeVisible();
    await page.fill('#teacher-password-input', '8888');
    await page.press('#teacher-password-input', 'Enter');
    await expect(page.locator('#modal-new-on-board')).toBeVisible();
    expect(await page.inputValue('#new-on-board-slot')).toBe('1'); // 第 2 框（全班已完成）
    await expect(page.locator('#new-on-board-hint')).toContainText('全班已完成');

    // 改選第 1 框時提醒還有人沒訂正
    await page.selectOption('#new-on-board-slot', '0');
    await expect(page.locator('#new-on-board-hint')).toContainText('還有 1 人沒訂正');
    await page.selectOption('#new-on-board-slot', '1');

    const replaced = await page.evaluate(() => state.slots[1].assignment);
    await page.fill('#new-on-board-name', '國語考卷');
    await page.press('#new-on-board-name', 'Enter');
    await expect(page.locator('#modal-new-on-board')).toBeHidden();
    expect(await page.evaluate(() => state.slots[1].assignment)).toBe('國語考卷');
    await expect(page.locator('#toast-msg')).toContainText(`【${replaced}】已換成新作業【國語考卷】`);
    await expect.poll(() => cloud.board('main').slots[1].assignment).toBe('國語考卷');
    expect(cloud.board('main').assignments).toContain('國語考卷');
    expect(cloud.board('main').assignments).toContain(replaced);

    // 已經在看板上的名稱：提示，不重複放
    await page.click('#new-on-board-button');
    await page.fill('#new-on-board-name', '國語考卷');
    await page.press('#new-on-board-name', 'Enter');
    await expect(page.locator('#toast-msg')).toContainText('已經在看板第 2 框');
    await expect(page.locator('#modal-new-on-board')).toBeVisible();
});

test('驗證視窗提示預設密碼 8888；第一次進設定後台必須先改密碼', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.click('#role-teacher');
    await expect(page.locator('#auth-default-hint')).toContainText('8888');
    await page.fill('#teacher-password-input', '8888');
    await page.press('#teacher-password-input', 'Enter');

    // 進設定後台：跳出強制改密碼，按「先不要」回到看板
    await page.click('#tab-settings');
    await expect(page.locator('#modal-force-pin')).toBeVisible();
    await page.click('#modal-force-pin button:has-text("先不要")');
    await expect(page.locator('#modal-force-pin')).toBeHidden();
    await expect(page.locator('#view-dashboard')).toBeVisible();

    // 再進一次：不能沿用 8888、兩次要一致
    await page.click('#tab-settings');
    await page.fill('#force-pin-new', '8888');
    await page.fill('#force-pin-confirm', '8888');
    await page.press('#force-pin-confirm', 'Enter');
    await expect(page.locator('#force-pin-msg')).toContainText('8888');
    await page.fill('#force-pin-new', '2468');
    await page.fill('#force-pin-confirm', '2460');
    await page.press('#force-pin-confirm', 'Enter');
    await expect(page.locator('#force-pin-msg')).toContainText('不一樣');
    await page.fill('#force-pin-confirm', '2468');
    await page.press('#force-pin-confirm', 'Enter');
    await expect(page.locator('#modal-force-pin')).toBeHidden();
    await expect(page.locator('#view-settings')).toBeVisible();
    await expect(page.locator('#pin-default-warning')).toBeHidden();
    await expect.poll(() => cloud.board('main').teacherPin).toBe('2468');

    // 改過之後：不再提示預設密碼，也不再強制
    await page.evaluate(() => lockTeacherSession());
    await page.click('#role-teacher');
    await expect(page.locator('#auth-default-hint')).toBeHidden();
});

test('家長頁可以加到手機主畫面（有圖示與 manifest），老師的頁面不會', async ({ browser }) => {
    const parent = await openDevice(browser, createCloud(), { query: '?p', viewport: { width: 390, height: 844 } });
    const manifest = await parent.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
    expect(manifest).toBe('manifest.webmanifest');
    const json = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
    expect(json.start_url).toContain('?p');
    for (const icon of json.icons) expect(require('fs').existsSync(require('path').join(__dirname, '..', icon.src))).toBe(true);

    const teacher = await openDevice(browser, createCloud());
    expect(await teacher.evaluate(() => !!document.querySelector('link[rel="manifest"]'))).toBe(false);
});

test('家長查到孩子後顯示「加到手機主畫面」，沒有安裝提示時顯示操作步驟', async ({ browser }) => {
    const cloud = createCloud();
    const teacher = await openDevice(browser, cloud);
    const code = await teacher.evaluate(() => state.students[0].parentCode);
    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#install-hint')).toBeVisible();
    await parent.click('#install-hint button');
    await expect(parent.locator('#install-steps')).toContainText('加到主畫面');
    const scrolls = await parent.evaluate(() => { const v = document.getElementById('view-parent'); return v.scrollHeight > v.clientHeight; });
    expect(scrolls).toBe(false);
});

test('看板頁會請瀏覽器保持螢幕亮著，家長頁不會', async ({ browser }) => {
    const fakeWakeLock = () => {
        window.__wakeRequests = 0;
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__wakeRequests++; return { released: false }; } } });
    };
    const page = await openDevice(browser, createCloud());
    await page.evaluate(fakeWakeLock);
    await page.click('#btn-slot-0-student-1'); // 點畫面時請求
    await expect.poll(() => page.evaluate(() => window.__wakeRequests)).toBe(1);
    await page.click('#btn-slot-0-student-2'); // 已經保持亮著：不重複請求
    expect(await page.evaluate(() => window.__wakeRequests)).toBe(1);
    expect(page.errors).toEqual([]);

    const parent = await openDevice(browser, createCloud(), { query: '?p' });
    await parent.evaluate(fakeWakeLock);
    await parent.click('#parent-code-input');
    expect(await parent.evaluate(() => window.__wakeRequests)).toBe(0);
});
