// 未訂正名單：列出還有作業要訂正的同學、變動停止 5 秒後自動更新、全部完成時顯示恭喜
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice } = require('./helpers');

test('未訂正名單列出每位同學還沒訂正的作業，並在變動停止後自動更新', async ({ browser }) => {
    // 要等好幾次 5 秒更新、再開第二台裝置，全部測試一起跑時會超過預設的 60 秒
    test.setTimeout(120000);
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await expect(page.locator('#pending-list-count')).toBeHidden();

    // 在頁面裡記錄每次點擊的時間和名單人數的每次變化，不受測試電腦快慢影響
    await page.evaluate(() => {
        window.__counts = [];
        const badge = document.getElementById('pending-list-count');
        new MutationObserver(() => window.__counts.push({ text: badge.classList.contains('hidden') ? '' : badge.textContent, at: performance.now() }))
            .observe(badge, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    const tap = (id) => page.evaluate((sel) => { document.querySelector(sel).click(); window.__lastTap = performance.now(); }, id);
    await tap('#btn-slot-0-student-3');   // 3 號 國習
    await tap('#btn-slot-2-student-3');   // 3 號 數課
    await tap('#btn-slot-1-student-12');  // 12 號 國作
    await page.waitForTimeout(2000);
    await tap('#btn-slot-3-student-20');  // 20 號 數習（又有變動，重新等 5 秒）
    await expect(page.locator('#pending-list-count')).toHaveText('3', { timeout: 15000 });
    // 名單只更新一次（中間沒有先出現 2），而且是在最後一次點擊 5 秒後
    const r = await page.evaluate(() => ({ counts: window.__counts.map((c) => c.text).filter(Boolean), waited: window.__counts.find((c) => c.text)?.at - window.__lastTap }));
    expect(r.counts[0]).toBe('3');
    expect(r.waited).toBeGreaterThanOrEqual(4900);
    // 20 號改回來（教師登記：紅燈 → 缺交 → 綠燈）
    await page.click('#btn-slot-3-student-20');
    await page.click('#btn-slot-3-student-20');
    await page.click('#pending-list-button');
    await expect(page.locator('#modal-pending-list')).toBeVisible();
    await expect(page.locator('#pending-list-summary')).toContainText('共 2 位同學、3 項作業', { timeout: 1000 });
    const cards = page.locator('#pending-list-body > div > div');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('3');
    await expect(cards.nth(0)).toContainText('還有 2 項');
    await expect(cards.nth(0)).toContainText('國習');
    await expect(cards.nth(0)).toContainText('數課');
    await expect(cards.nth(1)).toContainText('12');
    await expect(cards.nth(1)).toContainText('國作');

    // 另一台裝置（老師手機）消掉 12 號，名單等 5 秒後更新
    const phone = await openDevice(browser, cloud);
    await phone.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await phone.click('#btn-slot-1-student-12');
    await phone.click('#btn-slot-1-student-12');
    await page.waitForTimeout(2000);
    await expect(cards).toHaveCount(2); // 還在等 5 秒
    // 手機等 5 秒才上傳，教室電腦收到後再等 5 秒更新名單
    await expect(cards).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('#pending-list-count')).toHaveText('1');

    // 全部完成時顯示恭喜
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-pending-list')).toBeHidden();
    for (const id of ['#btn-slot-0-student-3', '#btn-slot-2-student-3']) {
        await page.click(id);
        await page.click(id);
    }
    await page.click('#pending-list-button'); // 打開時立刻顯示最新名單，不用等
    await expect(page.locator('#pending-list-body')).toContainText('全班都訂正完成了', { timeout: 1000 });
    await expect(page.locator('#pending-list-count')).toBeHidden();
});

test('未訂正名單在手機和電腦都不會超出畫面，家長頁看不到這個按鈕', async ({ browser }) => {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
        const page = await openDevice(browser, createCloud(), { viewport });
        await page.evaluate(() => {
            state.students.slice(0, 40).forEach((st) => state.assignments.slice(0, 6).forEach((a) => setStudentStatus(a, st.id, false)));
            openPendingList();
        });
        const r = await page.evaluate(() => {
            const body = document.getElementById('pending-list-body');
            return { hscroll: body.scrollWidth > body.clientWidth + 1, pageScroll: document.documentElement.scrollWidth > window.innerWidth };
        });
        expect(r).toEqual({ hscroll: false, pageScroll: false });
        await page.context().close();
    }
    const parent = await openDevice(browser, createCloud(), { query: '?p' });
    await expect(parent.locator('#pending-list-button')).toBeHidden();
});

test('未訂正名單可以列印紙條：每位同學一張，缺交和訂正分開標，有家長簽名欄', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.evaluate(() => {
        state.assignments.push('數習｜10/28 P40-43', '八格卷｜10/26 4-2');
        setStudentStatus('數習｜10/28 P40-43', 7, false);
        setStudentStatus('八格卷｜10/26 4-2', 7, 'missing');
        setStudentStatus('數習｜10/28 P40-43', 12, false);
        renderDashboard();
    });
    await page.click('#pending-list-button');
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#print-pending-button')]);
    await popup.waitForLoadState();
    const slips = popup.locator('.slip');
    await expect(slips).toHaveCount(await page.evaluate(() => getPendingByStudent().length));
    const seven = slips.filter({ hasText: '7 號' });
    await expect(seven).toContainText('缺交');
    await expect(seven).toContainText('八格卷');
    await expect(seven).toContainText('訂正');
    await expect(seven).toContainText('P40-43');
    await expect(seven).toContainText('家長簽名');
    expect(page.errors).toEqual([]);
});
