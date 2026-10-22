// 早自習：到校打卡、早修任務、聯絡簿（直式／橫式）、家長頁到教室時間
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('早自習預設關閉；打開後學生點座號打卡、老師可切換已到／請假、其他裝置同步', async ({ browser }) => {
    test.setTimeout(120000);
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud);
    await expect(room.locator('#tab-morning')).toBeHidden();

    await unlockTeacher(room, 'settings');
    await room.check('#morning-enabled');
    await expect(room.locator('#tab-morning')).toBeVisible();
    await expect.poll(() => cloud.board('main').daily?.enabled, { timeout: 15000 }).toBe(true);
    await expect(phone.locator('#tab-morning')).toBeVisible({ timeout: 15000 });

    // 學生身分點座號：記下時間，再點一次不會取消
    await room.evaluate(() => { lockTeacherSession(); switchTab('morning', true); });
    await room.click('#arrive-1');
    await expect(room.locator('#arrive-1')).toContainText(/\d\d:\d\d/);
    await expect(room.locator('#arrive-count')).toContainText('1');
    await room.click('#arrive-1');
    await expect(room.locator('#arrive-1')).toContainText(/\d\d:\d\d/);
    await expect.poll(() => cloud.board('main').daily?.arrive?.['1'], { timeout: 15000 }).toMatch(/^\d\d:\d\d$/);
    await phone.click('#tab-morning');
    await expect(phone.locator('#arrive-1')).toContainText(/\d\d:\d\d/, { timeout: 15000 });

    // 老師：未到 → 已到 → 請假 → 未到
    await unlockTeacher(room, 'morning');
    await room.evaluate(() => applyRoleUI('teacher'));
    await room.click('#arrive-2');
    await expect(room.locator('#arrive-2')).toContainText(/\d\d:\d\d/);
    await room.click('#arrive-2');
    await expect(room.locator('#arrive-2')).toContainText('請假');
    await room.click('#arrive-2');
    await expect(room.locator('#arrive-2')).toContainText('未到');
    expect(room.errors).toEqual([]);
    expect(phone.errors).toEqual([]);
});

test('聯絡簿：老師編輯後直式一項一欄、可切換橫式，另一台也看到', async ({ browser }) => {
    test.setTimeout(120000);
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud, { viewport: { width: 390, height: 844 } });
    await room.evaluate(() => setMorningEnabled(true));
    await unlockTeacher(room, 'morning');
    await room.click('text=✏️ 編輯');
    await room.fill('#task-input', '訂正國卷 L.3\n英習 P.13');
    await room.fill('#contact-input', '國習 P.48、P.49\n\n數習 P.13\n帶水彩用具');
    await room.click('#modal-contact >> text=儲存');
    await expect(room.locator('#contact-body .contact-col')).toHaveCount(3);
    await expect(room.locator('#contact-body .contact-col').first()).toContainText('國習');
    await expect(room.locator('#morning-task li')).toHaveText(['1.訂正國卷 L.3', '2.英習 P.13']);
    // 早修任務緊靠在聯絡簿左邊，中間沒有大片空白
    const gap = await room.evaluate(() => document.querySelector('#contact-body .contact-paper').getBoundingClientRect().left
        - document.getElementById('morning-task').getBoundingClientRect().right);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(20);

    // 直式每個字都在自己那一欄裡，不會超出也不會疊在一起
    const problems = await room.evaluate(() => {
        let bad = 0;
        document.querySelectorAll('#contact-body .contact-col').forEach(col => {
            const c = col.getBoundingClientRect();
            let prevBottom = -Infinity;
            col.querySelectorAll('.txt > span').forEach(s => {
                const r = s.getBoundingClientRect();
                if (r.left < c.left - 1 || r.right > c.right + 1 || r.bottom > c.bottom + 1 || r.top < prevBottom - 1) bad++;
                prevBottom = r.bottom;
            });
        });
        return bad;
    });
    expect(problems).toBe(0);

    await room.click('#contact-layout-h');
    await expect(room.locator('#contact-body .contact-paper li')).toHaveCount(3);
    await expect.poll(() => cloud.board('main').daily?.contact?.layout, { timeout: 15000 }).toBe('h');
    expect(cloud.board('main').daily.contact.items).toEqual(['國習 P.48、P.49', '數習 P.13', '帶水彩用具']);
    expect(cloud.board('main').daily.contact.tasks).toEqual(['訂正國卷 L.3', '英習 P.13']);

    await phone.click('#tab-morning');
    await expect(phone.locator('#contact-body .contact-paper li')).toHaveCount(3, { timeout: 15000 });
    await expect(phone.locator('#morning-task li')).toHaveCount(2);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(room.errors).toEqual([]);
    expect(phone.errors).toEqual([]);
});

test('家長頁看得到孩子今天幾點到教室；遲到也會標出來', async ({ browser }) => {
    test.setTimeout(120000);
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const code = await room.evaluate(() => state.students.find((s) => s.id === 1).parentCode);
    const parent = await openDevice(browser, cloud, { query: '?p=' + code, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#parent-result-box')).toBeVisible();
    await expect(parent.locator('#parent-arrive')).toBeHidden();
    expect(await room.evaluate(() => state.daily.deadline)).toBe('08:00');

    await room.evaluate(() => setMorningEnabled(true));
    await expect(parent.locator('#parent-arrive')).toContainText('還沒打卡', { timeout: 20000 });
    await room.evaluate(() => { switchTab('morning', true); tapArrival(1); });
    await expect(parent.locator('#parent-arrive')).toContainText(/今日到教室：\d\d:\d\d/, { timeout: 20000 });

    // 老師把遲到時間改早：之後的打卡算遲到
    await room.evaluate(() => { state.daily.deadline = '00:00'; state.daily.arrive = {}; tapArrival(1); });
    await expect(parent.locator('#parent-arrive')).toContainText('（遲到）', { timeout: 20000 });
    expect(Object.keys(cloud.view(code)).length).toBeLessThanOrEqual(6);
    expect(room.errors).toEqual([]);
    expect(parent.errors).toEqual([]);
});
