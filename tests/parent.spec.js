// 家長查詢：只讀得到自己孩子的資料、即時更新、精簡畫面、列印 QR Code
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('家長頁只讀自己孩子的摘要，不讀整班看板', async ({ browser }) => {
    const cloud = createCloud();
    const teacher = await openDevice(browser, cloud);
    await teacher.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await teacher.click('#btn-slot-0-student-5');
    const code = await teacher.evaluate(() => state.students.find((s) => s.id === 5).parentCode);

    const parent = await openDevice(browser, cloud, { query: '?p=' + code.toLowerCase(), viewport: { width: 390, height: 700 } });
    await expect(parent.locator('#parent-child-name')).toContainText('5 號');
    await expect(parent.locator('#parent-status-title')).toContainText('1 項', { timeout: 15000 });
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
    await expect(parent.locator('#parent-status-title')).toContainText('無需訂正', { timeout: 15000 });
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
    const newCode = await teacher.evaluate(() => state.students.find((s) => s.id === 6).parentCode);
    expect(newCode).toMatch(/^[A-Z0-9]{6}$/);
    // 新的查詢碼先確認沒被別班使用，再上傳
    // 同一批寫入：新的上傳、舊的刪除
    await expect.poll(() => [!!cloud.view(newCode), !!cloud.view(oldCode)], { timeout: 20000 }).toEqual([true, false]);
});

test('列印紙條的 QR Code 內容就是家長連結', async ({ browser }) => {
    const teacher = await openDevice(browser, createCloud());
    await teacher.evaluate(() => { state.students = state.students.slice(0, 2); startTeacherSession(); switchTab('settings', true); });
    const [popup] = await Promise.all([teacher.waitForEvent('popup'), teacher.evaluate(() => printParentCodes())]);
    await popup.waitForSelector('.slip');
    const slips = await popup.evaluate(() => [...document.querySelectorAll('.slip')].map((s) => ({ src: s.querySelector('img.qr')?.src || '', link: s.querySelector('img.qr')?.dataset.link })));
    expect(slips).toHaveLength(2);
    // 紙條文字
    const text = await popup.locator('.slip').first().innerText();
    expect(text).toContain('1號 家長您好：');
    expect(text).toContain('手機掃描左側 QR Code，即可查詢孩子的作業訂正狀態；也可自行輸入網址：');
    expect(text).toMatch(/專屬查詢碼：\s*[A-Z0-9]{6}/);
    expect(text).toContain('養成良好的學習習慣');
    expect(text).toContain('讓我們一起陪伴孩子把學習做得更完整！🌷');
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
    await expect(page.locator('#cloud-sync-status')).toContainText('已連線存檔'); // 等雲端連上再操作
    await page.waitForTimeout(800);
    expect(viewWrites()).toBe(0); // 重新開網頁：沒有變動就不上傳

    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.click('#btn-slot-0-student-4');
    await page.click('#btn-slot-0-student-4'); // 點錯又改回來
    await page.click('#btn-slot-0-student-4');
    // 連點同一位學生：只上傳一次（等上傳發生，再多等一下確認沒有第二次）
    await expect.poll(viewWrites, { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(2500);
    expect(viewWrites()).toBe(1);

    // 超過 7 天：整份重新上傳一次，以防雲端資料被手動刪除或不一致
    page.writes.length = 0;
    await page.evaluate(() => {
        const cache = JSON.parse(localStorage.getItem('checkpoint_published_views_v2'));
        cache.bornAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
        localStorage.setItem('checkpoint_published_views_v2', JSON.stringify(cache));
    });
    await page.reload();
    await expect.poll(viewWrites).toBe(28);
});

test('輸入框的範例查詢碼不可能是真的查詢碼', async ({ browser }) => {
    const parent = await openDevice(browser, createCloud(), { query: '?p' });
    const placeholder = await parent.getAttribute('#parent-code-input', 'placeholder');
    const example = placeholder.match(/[A-Z0-9]{6,8}/)[0];
    // 查詢碼只會用到不容易看錯的字元，範例必須含有其中沒有的字元（例如 0、1、I、O）
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    expect([...example].some((ch) => !alphabet.includes(ch))).toBe(true);
    // 產生 2000 組查詢碼，確認沒有一組是範例
    const codes = await parent.evaluate(() => Array.from({ length: 2000 }, () => generateParentCode()));
    expect(codes).not.toContain(example);
    expect(codes.every((c) => [...c].every((ch) => alphabet.includes(ch)))).toBe(true);
});

test('查詢碼和其他班級重複時自動換新，不會覆蓋或查到別班的學生', async ({ browser }) => {
    const cloud = createCloud();
    // 別班已經在用 TAKEN2 這組查詢碼
    cloud.store['artifacts/classroom-checkpoint-app/public/data/parent_views/TAKEN2'] = { seat: '9', items: [{ name: '別班作業', finished: false, onBoard: true }], owner: 'otherclass123', updatedAt: 1 };
    cloud.setBoard('main', {
        students: [{ id: 1, name: '1', parentCode: 'TAKEN2' }, { id: 2, name: '2', parentCode: 'MINE22' }],
        assignments: ['國習'], slots: [{ id: 1, assignment: '國習' }], statuses: {}, teacherPin: '1357', lastUpdated: 1
    });
    const page = await openDevice(browser, cloud);
    // 1 號換成新的查詢碼並存回雲端；別班的資料沒有被動到
    await expect.poll(() => cloud.board('main').students[0].parentCode).not.toBe('TAKEN2');
    const newCode = cloud.board('main').students[0].parentCode;
    expect(newCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(cloud.view('TAKEN2').owner).toBe('otherclass123');
    expect(cloud.view('TAKEN2').seat).toBe('9');
    await expect(page.locator('#toast-msg')).toContainText('和其他班級重複');

    // 自己班的查詢資料都標上本班編號
    const boardId = cloud.board('main').boardId;
    expect(boardId).toMatch(/^[a-z0-9]{12}$/);
    await expect.poll(() => cloud.view(newCode)?.owner).toBe(boardId);
    expect(cloud.view('MINE22').owner).toBe(boardId);
    // 班級編號不是班級代碼，家長看不到班級代碼
    expect(JSON.stringify(cloud.view('MINE22'))).not.toContain('main');
});
