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
    // 早修任務緊靠在聯絡簿左邊，中間只有可以拖曳的分隔線
    const gap = await room.evaluate(() => document.querySelector('#contact-body .contact-paper').getBoundingClientRect().left
        - document.getElementById('morning-task').getBoundingClientRect().right);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(40);

    // 直式每個字都在自己那一欄裡，不會超出也不會疊在一起
    const problems = await room.evaluate(() => {
        let bad = 0;
        document.querySelectorAll('#contact-body .contact-col').forEach(col => {
            const c = col.getBoundingClientRect();
            col.querySelectorAll('.txt').forEach(line => {
                let prevBottom = -Infinity;
                line.querySelectorAll(':scope > span').forEach(s => {
                    const r = s.getBoundingClientRect();
                    if (r.left < c.left - 1 || r.right > c.right + 1 || r.bottom > c.bottom + 1 || r.top < prevBottom - 1) bad++;
                    prevBottom = r.bottom;
                });
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

test('家長頁的到教室時間：遲到時間以前顯示「幾點後更新」，到了才統一更新；遲到、請假也會顯示', async ({ browser }) => {
    test.setTimeout(120000);
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const [code1, code2] = await room.evaluate(() => [1, 2].map(id => state.students.find((s) => s.id === id).parentCode));
    const parent = await openDevice(browser, cloud, { query: '?p=' + code1, viewport: { width: 390, height: 844 } });
    await expect(parent.locator('#parent-result-box')).toBeVisible();
    await expect(parent.locator('#parent-arrive')).toBeHidden();
    expect(await room.evaluate(() => state.daily.deadline)).toBe('08:00');

    // 還沒到遲到時間：打卡不會馬上寫到家長頁
    await room.evaluate(() => { state.daily.deadline = '23:59'; setMorningEnabled(true); switchTab('morning', true); });
    await expect(parent.locator('#parent-arrive')).toContainText('23:59 後更新', { timeout: 20000 });
    const viewWrites = () => room.writes.filter((p) => p.includes('parent_views')).length;
    await room.evaluate(() => { tapArrival(1); tapArrival(2); syncDaily(true); });
    await expect.poll(() => cloud.board('main').daily?.arrive?.['1'], { timeout: 15000 }).toMatch(/^\d\d:\d\d$/);
    // 先等開啟早自習時的那一次上傳結束（電腦較慢時會晚一點）
    let previous = -1;
    await expect.poll(() => { const now = viewWrites(); const settled = now === previous; previous = now; return settled; }, { intervals: [3000], timeout: 30000 }).toBe(true);
    const before = viewWrites();
    await room.waitForTimeout(3500);
    expect(viewWrites()).toBe(before);
    await expect(parent.locator('#parent-arrive')).toContainText('23:59 後更新');

    // 到了遲到時間（這裡把時間改成 00:00 來模擬）：全班一起更新
    await room.evaluate(() => {
        state.daily.deadline = '00:00';
        state.daily.arrive = { 1: '00:00', 2: '07:30' };
        state.daily.leave = [3];
        scheduleParentPublish();
    });
    await expect(parent.locator('#parent-arrive')).toContainText('今日到教室：00:00 ✨', { timeout: 20000 });
    await expect.poll(() => cloud.view(code2)?.arrived, { timeout: 15000 }).toMatch(/ 00:00 07:30$/);
    const parent2 = await openDevice(browser, cloud, { query: '?p=' + code2, viewport: { width: 390, height: 844 } });
    await expect(parent2.locator('#parent-arrive')).toContainText('07:30（遲到）');
    expect(Object.keys(cloud.view(code1)).length).toBeLessThanOrEqual(6);
    expect(room.errors).toEqual([]);
    expect(parent.errors).toEqual([]);
});

test('隔天遲到時間以前，家長頁的內容和前一天一樣（不會多寫雲端），學生打卡也不會改到', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const result = await room.evaluate(() => {
        state.daily = { ...defaultDaily(), enabled: true, deadline: '23:59', date: '2000-01-01', arrive: { 1: '07:50' }, leave: [2] };
        const before = [1, 2, 3].map(arrivedText);
        tapArrival(1);
        const after = [1, 2, 3].map(arrivedText);
        return { before, after, prev: state.daily.prev, today: state.daily.date === todayKey() };
    });
    expect(result.before).toEqual(['2000-01-01 23:59 07:50', '2000-01-01 23:59 請假', '2000-01-01 23:59 未到']);
    expect(result.after).toEqual(result.before);
    expect(result.prev).toEqual({ date: '2000-01-01', arrive: { 1: '07:50' }, leave: [2] });
    expect(result.today).toBe(true);
});

test('早修任務和聯絡簿中間的線可以拖曳，這台電腦會記住；自己打的編號不會重複；字會放大填滿', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud, { viewport: { width: 1536, height: 730 } });
    await room.evaluate(() => setMorningEnabled(true));
    await unlockTeacher(room, 'morning');
    await room.click('text=✏️ 編輯');
    await room.fill('#task-input', '完成訂正');
    await room.fill('#contact-input', '1.國卷L5\n2、字詞單L6\n數練p.28');
    await room.click('#modal-contact >> text=儲存');
    await room.click('#contact-layout-h');
    await expect(room.locator('#contact-body .contact-paper li').first()).toHaveText(/^\s*1\.\s*國卷L5\s*$/);
    await expect(room.locator('#contact-body .contact-paper li').nth(1)).toHaveText(/^\s*2\.\s*字詞單L6\s*$/);
    // 橫式的字比原本的固定大小（36px）大
    expect(parseFloat(await room.locator('#contact-body .contact-list').evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThan(36);

    const noteWidth = () => room.locator('#morning-task').evaluate((el) => el.getBoundingClientRect().width);
    const before = await noteWidth();
    const bar = await room.locator('.contact-split').boundingBox();
    const wrap = await room.locator('#contact-wrap').boundingBox();
    await room.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await room.mouse.down();
    await room.mouse.move(wrap.x + wrap.width * 0.25, bar.y + bar.height / 2, { steps: 5 });
    await room.mouse.up();
    const after = await noteWidth();
    expect(after).toBeLessThan(before - 50);
    expect(await room.evaluate(() => localStorage.getItem('checkpoint_morning_split'))).toBe('0.25');

    // 重新畫一次（例如換頁回來）還是同樣的寬度
    await room.evaluate(() => { switchTab('dashboard', true); switchTab('morning', true); });
    expect(Math.abs(await noteWidth() - after)).toBeLessThan(5);
    expect(room.errors).toEqual([]);
});

test('早修任務也可以切換直式，另一台跟著變，格子不會超出便利貼', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud, { viewport: { width: 1920, height: 1080 } });
    const other = await openDevice(browser, cloud);
    await room.evaluate(() => setMorningEnabled(true));
    await unlockTeacher(room, 'morning');
    await room.click('text=✏️ 編輯');
    await room.fill('#task-input', '打卡，8：00換成訂正頁面\n完成訂正\n完成訂正的人，整理考卷\n都好了請複習國L5第一節要考');
    await room.fill('#contact-input', '國卷L5\n字詞單L6');
    await room.click('#modal-contact >> text=儲存');
    await expect(room.locator('#morning-task .task-list li')).toHaveCount(4);
    await room.click('#task-layout-v');
    await expect(room.locator('#morning-task .contact-col')).toHaveCount(4);
    await expect(room.locator('#morning-task .task-list')).toHaveCount(0);
    const box = await room.locator('.task-cols-box').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(box[0]).toBeLessThanOrEqual(box[1] + 1);
    await expect.poll(() => cloud.board('main').daily?.contact?.taskLayout, { timeout: 15000 }).toBe('v');
    await other.click('#tab-morning');
    await expect(other.locator('#morning-task .contact-col')).toHaveCount(4, { timeout: 15000 });
    // 換回橫式
    await room.click('#task-layout-h');
    await expect(room.locator('#morning-task .task-list li')).toHaveCount(4);
    expect(room.errors).toEqual([]);
    expect(other.errors).toEqual([]);
});

test('早修任務・聯絡簿的標題每天顯示今天的日期；內容是前幾天寫的會小字提醒', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    await room.evaluate(() => setMorningEnabled(true));
    await unlockTeacher(room, 'morning');
    await room.click('text=✏️ 編輯');
    await room.fill('#contact-input', '國卷L5');
    await room.click('#modal-contact >> text=儲存');
    const today = await room.evaluate(() => { const d = new Date(); return `（${d.getMonth() + 1}/${d.getDate()}）`; });
    await expect(room.locator('#contact-date')).toHaveText(today);
    // 模擬內容是前一天寫的
    await room.evaluate(() => { state.daily.contact.date = '2000-01-02'; renderContact(); });
    await expect(room.locator('#contact-date')).toContainText(today);
    await expect(room.locator('#contact-date')).toContainText('內容是 1/2 寫的');
    expect(room.errors).toEqual([]);
});
