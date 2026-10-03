// 班級代碼：規則檢查、切換前確認、搬移後舊代碼清空、清空的代碼可重新使用
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

test('太簡單的代碼會被拒絕，英文自動轉小寫', async ({ browser }) => {
    const page = await openDevice(browser, createCloud());
    await unlockTeacher(page, 'settings');
    for (const bad of ['601', 'abcdef', '123456', 'ab 12cd', '六年一班1a']) {
        await page.fill('#settings-class-code', bad);
        await page.click('button:has-text("切換到此代碼")');
        await expect(page.locator('#toast-msg')).toContainText('6～30');
        expect(await page.evaluate(() => getClassCode())).toBe('main');
    }
    await page.fill('#settings-class-code', 'LIN601CS');
    await expect(page.locator('#settings-class-code')).toHaveValue('lin601cs');
});

test('切換到別人正在使用的代碼時先確認，取消就不會切換', async ({ browser }) => {
    const cloud = createCloud();
    cloud.setBoard('hs602wang', { students: [{ id: 1, name: '1' }, { id: 2, name: '2' }, { id: 3, name: '3' }], assignments: ['國習'], slots: [{ id: 1, assignment: '國習' }], serializedStatuses: {}, teacherPin: '4321', lastUpdated: Date.now() });
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    page.answerDialogs = false;
    await page.fill('#settings-class-code', 'hs602wang');
    await page.click('button:has-text("切換到此代碼")');
    await page.waitForTimeout(300);
    expect(page.dialogs[0]).toContain('3 位學生');
    expect(await page.evaluate(() => getClassCode())).toBe('main');
    expect(cloud.board('hs602wang').students).toHaveLength(3);
});

test('搬移後舊代碼清空，還在用舊代碼的裝置停止同步', async ({ browser }) => {
    const cloud = createCloud();
    const classroom = await openDevice(browser, cloud);
    const phone = await openDevice(browser, cloud);
    const codes = await classroom.evaluate(() => state.students.map((s) => s.parentCode));

    await classroom.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await classroom.click('#btn-slot-0-student-3');
    await classroom.waitForTimeout(400);
    await unlockTeacher(classroom, 'settings');
    await classroom.fill('#settings-class-code', 'lin601cs');
    await classroom.click('button:has-text("把目前資料搬過去")');
    await classroom.waitForTimeout(800);

    expect(Object.keys(cloud.board('main')).sort()).toEqual(['retired', 'retiredAt']);
    expect(cloud.board('lin601cs').students).toHaveLength(28);
    await expect(phone.locator('#view-dashboard')).toContainText('資料已經清空');

    phone.writes.length = 0;
    await phone.evaluate(() => { setStudentStatus('國習', 3, true); syncStateToCloud(true); });
    await phone.waitForTimeout(500);
    expect(phone.writes).toEqual([]);
    const view = cloud.view(codes[2]);
    expect(view.items.find((i) => i.name === '國習').finished).toBe(false);
});

test('清空的代碼可以重新建立新班級（例如下一屆）', async ({ browser }) => {
    const cloud = createCloud();
    cloud.setBoard('anan601x', { retired: true, retiredAt: 1 });
    const page = await openDevice(browser, cloud);
    await unlockTeacher(page, 'settings');
    await page.fill('#settings-class-code', 'anan601x');
    await page.click('button:has-text("切換到此代碼")');
    await page.waitForTimeout(800);
    expect(page.dialogs.some((d) => d.includes('以前用過，資料已經清空'))).toBe(true);
    const board = cloud.board('anan601x');
    expect(board.retired).toBeUndefined();
    expect(board.students).toHaveLength(28);
    expect(board.teacherPin).toBe('8888');
});
