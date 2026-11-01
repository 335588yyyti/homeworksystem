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

    // 現在正在考第一節，第二節在 20 分鐘後
    const now = await room.evaluate(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
    test.skip(now < 30 || now > 23 * 60, '跨午夜時不測');
    await room.click('text=✏️ 時程');
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-s', hhmm(now - 10));
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-e', hhmm(now + 10));
    await room.fill('#exam-rows .exam-row >> nth=0 >> .exam-n', '國語');
    await room.click('text=＋ 再加一節');
    await expect(room.locator('#exam-rows .exam-row >> nth=1 >> .exam-s')).toHaveValue(hhmm(now + 20));
    await room.fill('#exam-rows .exam-row >> nth=1 >> .exam-n', '數學');
    await room.click('#exam-save');

    await expect(room.locator('#exam-name')).toHaveText('國語');
    await expect(room.locator('#exam-left')).toHaveText(/^(9|10):\d{2}$/);
    const width = await room.evaluate(() => parseFloat(document.getElementById('exam-bar').style.width));
    expect(width).toBeGreaterThan(40);
    expect(width).toBeLessThan(55);
    await expect(room.locator('#exam-timeline .exam-block')).toHaveCount(3);
    await expect(room.locator('#exam-timeline .exam-block').nth(1)).toContainText('下課');
    await expect.poll(() => cloud.board('main').daily?.exam?.items?.length, { timeout: 15000 }).toBe(2);

    await expect(other.locator('#tab-exam')).toBeVisible({ timeout: 15000 });
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
