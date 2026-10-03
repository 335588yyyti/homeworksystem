// 班級看板：座號排版、作業框數量、長作業名稱、音效開關、待訂正記號
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher, seatLayoutProblems } = require('./helpers');

const SIZES = [[1920, 1080], [1366, 768], [1280, 650], [1024, 600], [800, 1000], [390, 844]];

test('28、35、40 人在各種螢幕大小，座號都不會超出卡片', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    for (const count of [28, 35, 40]) {
        await page.evaluate((n) => {
            state.students = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
            renderDashboard();
        }, count);
        for (const [width, height] of SIZES) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(150);
            expect(await seatLayoutProblems(page), `${count} 人 @ ${width}x${height}`).toEqual({ outside: 0, overflow: 0 });
        }
    }
    expect(page.errors).toEqual([]);
});

test('作業框數量可切換 4、6、8 框，並同步到雲端', async ({ browser }) => {
    const cloud = createCloud();
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    for (const count of [4, 8, 6]) {
        await page.click(`#slot-count-buttons button[data-count="${count}"]`);
        await page.evaluate(() => switchTab('dashboard', true));
        await expect(page.locator('#view-dashboard > div')).toHaveCount(count);
        const cols = await page.evaluate(() => getComputedStyle(document.getElementById('view-dashboard')).gridTemplateColumns.split(' ').length);
        expect(cols).toBe(count / 2);
        expect(await seatLayoutProblems(page)).toEqual({ outside: 0, overflow: 0 });
        await page.waitForTimeout(500);
        expect(cloud.board('main').slots).toHaveLength(count);
        await page.evaluate(() => switchTab('settings', true));
    }
    // 增加框數時補上還沒放上看板的作業，不會重複
    const names = cloud.board('main').slots.map((s) => s.assignment);
    expect(new Set(names).size).toBe(names.length);
});

test('作業名稱太長時自動縮小字級，短名稱維持原大小', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.evaluate(() => {
        state.assignments.push('國語習作第二課訂正');
        state.slots[0].assignment = '國語習作第二課訂正';
        renderDashboard();
    });
    const fit = await page.evaluate(() => {
        const select = document.querySelector('.slot-select');
        const style = getComputedStyle(select);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `900 ${style.fontSize} ${style.fontFamily}`;
        return {
            size: parseFloat(style.fontSize),
            text: ctx.measureText(select.options[select.selectedIndex].text).width,
            room: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        };
    });
    expect(fit.size).toBeLessThan(22);
    expect(fit.text).toBeLessThanOrEqual(fit.room + 1);
    expect(await page.evaluate(() => getComputedStyle(document.querySelectorAll('.slot-select')[1]).fontSize)).toBe('22px');
});

test('每班最多 40 人', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings');
    await page.evaluate(() => {
        state.students = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
        document.getElementById('new-student-name').value = '41';
        addStudent();
    });
    expect(await page.evaluate(() => state.students.length)).toBe(40);
    await expect(page.locator('#toast-msg')).toContainText('最多 40');
});

test('音效開關在看板最上方，關閉後重新整理仍維持關閉', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    const button = page.locator('#sound-toggle');
    await expect(button).toBeVisible();
    await expect(button).toContainText('音效：開');
    const box = await button.boundingBox();
    expect(box.y).toBeLessThan(60); // 在第一排（標題列）
    await button.click();
    await expect(button).toContainText('音效：關');
    expect(await page.evaluate(() => window.soundEffect.enabled)).toBe(false);
    await page.reload();
    await expect(page.locator('#sound-toggle')).toContainText('音效：關');
});

test('待訂正的座號有「!」記號（紅綠色弱也能分辨）', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await page.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await page.click('#btn-slot-0-student-5');
    const marker = await page.evaluate(() => getComputedStyle(document.getElementById('btn-slot-0-student-5'), '::after').content);
    expect(marker).toBe('"!"');
    const doneMarker = await page.evaluate(() => getComputedStyle(document.getElementById('btn-slot-0-student-6'), '::after').content);
    expect(doneMarker).toBe('none');
});
