// 使用說明、閒置上鎖時間、作業排序
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('設定後台的「使用說明」可以一頁一頁看完', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings');
    await page.click('#open-guide');
    await expect(page.locator('#modal-guide')).toBeVisible();
    await expect(page.locator('#guide-step')).toHaveText('1 / 5');
    await expect(page.locator('#guide-prev')).toBeDisabled();
    const titles = [];
    for (let i = 0; i < 5; i++) {
        titles.push(await page.locator('#guide-body h3').innerText());
        await page.click('#guide-next');
    }
    expect(titles[1]).toContain('老師登記');
    expect(titles[2]).toContain('學生');
    expect(titles[3]).toContain('家長');
    await expect(page.locator('#modal-guide')).toBeHidden(); // 最後一頁按「開始使用」關閉

    // 手機也能完整顯示
    await page.setViewportSize({ width: 390, height: 700 });
    await page.click('#open-guide');
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-guide')).toBeHidden();
});

test('閒置自動上鎖時間可選 1.5／3／5／10 分鐘，同步到雲端', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    await page.click('#lock-minute-buttons button[data-minutes="5"]');
    await expect(page.locator('#lock-minute-buttons button[data-minutes="5"]')).toHaveClass(/bg-rose-500/);
    await expect.poll(() => cloud.board('main').lockMinutes).toBe(5);
    expect(await page.evaluate(() => teacherIdleMs())).toBe(300000);

    // 另一台裝置也套用
    const other = await openDevice(browser, cloud);
    expect(await other.evaluate(() => teacherIdleMs())).toBe(300000);

    // 實際到時間會自動上鎖（把時間縮短來測）
    await other.evaluate(() => { state.lockMinutes = 0.01; startTeacherSession(); applyRoleUI('teacher'); });
    await expect(other.locator('#role-status-text')).toContainText('學生自主消單', { timeout: 5000 });
});

test('作業項目可以拖曳或用 ▲▼ 調整順序，看板選單照新順序', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    const before = await page.evaluate(() => state.assignments.slice(0, 4));

    // ▼：第 1 項往下移
    await page.click('#settings-assignment-list > div:nth-child(1) button[title="往下移"]');
    expect(await page.evaluate(() => state.assignments.slice(0, 2))).toEqual([before[1], before[0]]);
    await expect(page.locator('#settings-assignment-list > div:nth-child(1) button[title="往上移"]')).toBeDisabled();

    // 拖曳：第 4 項拖到第 1 項的位置
    await page.dragAndDrop('#settings-assignment-list > div:nth-child(4) .drag-handle', '#settings-assignment-list > div:nth-child(1)');
    expect(await page.evaluate(() => state.assignments[0])).toBe(before[3]);
    await expect.poll(() => cloud.board('main').assignments[0]).toBe(before[3]);

    // 看板下拉選單的順序也跟著變
    await page.evaluate(() => switchTab('dashboard', true));
    const options = await page.evaluate(() => [...document.querySelector('.slot-select').options].map((o) => o.value));
    expect(options[0]).toBe(before[3]);
});
