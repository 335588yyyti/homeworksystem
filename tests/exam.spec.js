// 考試：開關、時程（節和節中間自動下課）、時鐘和倒數條、同步到另一台
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

test('考試預設關閉；打開後老師排時程，現在這節顯示倒數條、節和節中間自動是下課，另一台也看到', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    const other = await openDevice(browser, cloud);
    await expect(room.locator('#tab-exam')).toBeHidden();
    await room.evaluate(() => setExamEnabled(true));
    await unlockTeacher(room, 'exam');
    await expect(room.locator('#exam-clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

    // 現在正在考第一節，第二節在 20 分鐘後（時間固定住，測試電腦慢也不會差太多）
    await room.clock.setFixedTime(new Date(2026, 10, 2, 10, 0, 0));
    const now = 10 * 60;
    await room.click('text=✏️ 時程');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-s', hhmm(now - 10));
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-e', hhmm(now + 10));
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-n', '國語');
    await room.click('text=＋ 再加一節');
    await expect(room.locator('#exam-rows .exam-row >> nth=1 >> .exam-s')).toHaveValue(hhmm(now + 20));
    await room.fill('#exam-rows .exam-row >> nth=1 >> .exam-n', '數學');
    await room.click('#exam-save');

    await expect(room.locator('#exam-name')).toHaveText('國語');
    await expect(room.locator('#exam-left')).toHaveText('10:00');
    const width = await room.evaluate(() => parseFloat(document.getElementById('exam-bar').style.width));
    expect(width).toBeCloseTo(50, 0);
    await expect(room.locator('#exam-timeline .exam-block')).toHaveCount(3);
    await expect(room.locator('#exam-timeline .exam-block').nth(1)).toContainText('下課');
    await expect.poll(() => cloud.board('main').daily?.exam?.items?.length, { timeout: 15000 }).toBe(2);

    await expect(other.locator('#tab-exam')).toBeVisible({ timeout: 15000 });
    await other.clock.setFixedTime(new Date(2026, 10, 2, 10, 0, 0));
    await other.click('#tab-exam');
    await expect(other.locator('#exam-name')).toHaveText('國語');
    // 考試頁不顯示上面的標語
    await expect(other.locator('#slogan-section')).toBeHidden();
    expect(room.errors).toEqual([]);
    expect(other.errors).toEqual([]);
});

test('考試時程：時間重疊或結束比開始早不能存；關掉考試就看不到分頁', async ({ browser }) => {
    const room = await openDevice(browser, createCloud());
    await room.evaluate(() => setExamEnabled(true));
    await unlockTeacher(room, 'exam');
    await room.click('text=✏️ 時程');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-s', '09:00');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-e', '08:40');
    await room.click('#exam-save');
    await expect(room.locator('#toast-msg')).toContainText('結束時間要比開始晚');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-e', '09:40');
    await room.click('text=＋ 再加一節');
    await room.fill('#exam-rows .exam-row >> nth=1 >> .exam-s', '09:30');
    await room.click('#exam-save');
    await expect(room.locator('#toast-msg')).toContainText('重疊');
    await expect(room.locator('#modal-exam')).toBeVisible();

    await room.evaluate(() => setExamEnabled(false));
    await expect(room.locator('#tab-exam')).toBeHidden();
    await expect(room.locator('#view-dashboard')).toBeVisible();
    expect(room.errors).toEqual([]);
});

test('考試畫面有應到、實到、未到座號：開了早自習就照打卡，老師也可以自己點未到', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    await room.evaluate(() => { setExamEnabled(true); setMorningEnabled(true); });
    await unlockTeacher(room, 'exam');
    // 早自習只有 1、2 號打卡
    await room.evaluate(() => {
        state.daily = { ...state.daily, date: todayKey(), arrive: { 1: '07:40', 2: '07:45' }, leave: [] };
        syncDaily(true);
    });
    await expect.poll(() => cloud.board('main').daily?.arrive?.['2'], { timeout: 15000 }).toBe('07:45');
    await expect(room.locator('#exam-should')).toHaveText('28');
    await expect(room.locator('#exam-present')).toHaveText('2');
    await expect(room.locator('#exam-absent')).toContainText('3、4、5');

    // 老師自己點：只有 5、17 號未到
    await room.click('#exam-attend');
    await expect(room.locator('text=照早自習打卡')).toHaveCount(0);
    const seats = room.locator('#exam-absent-seats .exam-absent-seat');
    for (let i = 0; i < 28; i++) {
        if (![1, 2, 5, 17].includes(i + 1)) await seats.nth(i).click();
    }
    await room.click('#exam-absent-save');
    await expect(room.locator('#exam-present')).toHaveText('26');
    await expect(room.locator('#exam-absent')).toHaveText('5、17');
    await expect.poll(() => cloud.board('main').daily?.exam?.absent?.ids, { timeout: 15000 }).toEqual([5, 17]);
    expect(room.errors).toEqual([]);
});

test('考試時鐘照網路時間（不靠這台電腦的時鐘），老師可以調快調慢對齊學校鐘聲', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    // 這台電腦慢了 30 秒：網站回應的時間是 10:00:30
    await room.clock.setFixedTime(new Date(2026, 10, 2, 10, 0, 0));
    await room.route('**/*clock=*', (route) => route.fulfill({ status: 200, headers: { date: new Date(2026, 10, 2, 10, 0, 30).toUTCString() }, body: '' }));
    await room.evaluate(() => setExamEnabled(true));
    await unlockTeacher(room, 'exam');
    await expect(room.locator('#exam-clock')).toHaveText('10:00:30');

    // 學校鐘聲慢 10 秒：按 −10，時鐘跟著變慢
    await room.click('text=✏️ 時程');
    await expect(room.locator('#exam-net-status')).toContainText(/這台電腦慢 3[01] 秒/);
    await room.click('text=−10');
    await expect(room.locator('#exam-adjust-text')).toHaveText('−10 秒');
    await expect(room.locator('#exam-clock')).toHaveText('10:00:20');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-n', '國語');
    await room.click('#exam-save');
    await expect(room.locator('#exam-clock')).toHaveText('10:00:20');
    await expect.poll(() => cloud.board('main').daily?.exam?.adjust, { timeout: 15000 }).toBe(-10);

    // 取消的話不會改到
    await room.click('text=✏️ 時程');
    await room.click('text=+10');
    await room.click('#modal-exam >> text=取消');
    await expect(room.locator('#exam-clock')).toHaveText('10:00:20');
    expect(room.errors).toEqual([]);
});

test('倒數條顏色：剩 15 分鐘變黃、10 分鐘變粉紅、5 分鐘變紅', async ({ browser }) => {
    const room = await openDevice(browser, createCloud());
    await room.clock.setFixedTime(new Date(2026, 10, 2, 9, 0, 0));
    await room.evaluate(() => {
        state.daily = { ...state.daily, exam: { enabled: true, adjust: 0, items: [{ s: '08:40', e: '09:25', n: '國語' }] } };
        syncDaily(true);
    });
    await unlockTeacher(room, 'exam');
    const bar = room.locator('#exam-bar');
    for (const [time, color] of [[[9, 0], /bg-emerald-400/], [[9, 11], /bg-amber-400/], [[9, 16], /bg-pink-400/], [[9, 21], /bg-red-500/]]) {
        await room.clock.setFixedTime(new Date(2026, 10, 2, time[0], time[1], 0));
        await expect(bar).toHaveClass(color);
    }
    expect(room.errors).toEqual([]);
});

test('考試時程用 24 小時制輸入：「1200」「1:20」都看得懂；錯的那一行會標紅並說是第幾行', async ({ browser }) => {
    const room = await openDevice(browser, createCloud());
    await room.evaluate(() => setExamEnabled(true));
    await unlockTeacher(room, 'exam');
    await room.click('text=✏️ 時程');
    const row = (i, cls) => `#exam-rows .exam-row >> nth=${i} >> ${cls}`;
    await room.fill(row(0, '.exam-s'), '1120');
    await room.fill(row(0, '.exam-e'), '1200');
    await room.click('text=＋ 再加一節');
    await room.fill(row(1, '.exam-s'), '1:20');
    await room.fill(row(1, '.exam-e'), '2:00');
    await room.click('text=＋ 再加一節');
    await room.fill(row(2, '.exam-s'), '15:00');
    await room.fill(row(2, '.exam-e'), '14:00');
    await room.click('#exam-save');
    await expect(room.locator('#toast-msg')).toContainText('第 3 行的結束時間要比開始晚');
    await expect(room.locator('#exam-rows .exam-row').nth(2)).toHaveClass(/ring-rose-400/);
    await room.click('#exam-rows .exam-row >> nth=2 >> text=✕');
    await room.click('#exam-save');
    await expect(room.locator('#modal-exam')).toBeHidden();
    expect(await room.evaluate(() => state.daily.exam.items.map((x) => `${x.s}-${x.e}`))).toEqual(['11:20-12:00', '13:20-14:00']);
    expect(room.errors).toEqual([]);
});

test('指定考試日期：先排好那天的時程，到了那天不用開考試也會自動出現考試分頁', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    await room.clock.setFixedTime(new Date(2026, 10, 2, 9, 0, 0));
    await unlockTeacher(room, 'settings');
    await expect(room.locator('#tab-exam')).toBeHidden();
    await room.click('text=📅 指定考試日期和時程');
    // 排 11/4 的期中考
    await room.fill('#exam-day-add', '2026-11-04');
    await room.dispatchEvent('#exam-day-add', 'change');
    await expect(room.locator('#exam-days .exam-day').nth(1)).toContainText('11/4（三）');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-s', '08:40');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-e', '09:25');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-n', '國語');
    await room.click('#exam-save');
    await expect(room.locator('#toast-msg')).toContainText('11/4（三） 會自動出現考試分頁');
    await expect.poll(() => cloud.board('main').daily?.exam?.days?.['2026-11-04']?.[0]?.n, { timeout: 15000 }).toBe('國語');
    // 今天還不是考試日：分頁不出現
    await expect(room.locator('#tab-exam')).toBeHidden();
    // 到了 11/4：分頁自動出現，顯示那天的時程
    await room.clock.setFixedTime(new Date(2026, 10, 4, 9, 0, 0));
    await room.evaluate(() => applyExamVisibility());
    await expect(room.locator('#tab-exam')).toBeVisible();
    await room.click('#tab-exam');
    await expect(room.locator('#exam-name')).toHaveText('國語');
    expect(room.errors).toEqual([]);
});
