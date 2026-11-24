// 聯絡簿進階：國語課次變數、共用號碼、數學頁數記憶、提醒事項、發到 BAND
const { test, expect } = require('@playwright/test');
const { createCloud, openDevice, unlockTeacher } = require('./helpers');

const BAND_URL = 'https://script.google.com/macros/s/TEST_DEPLOY_ID/exec';

async function openEditorAt(browser, cloud, when) {
    const room = await openDevice(browser, cloud, { viewport: { width: 1366, height: 768 } });
    await room.clock.setFixedTime(when);
    await room.evaluate(() => setMorningEnabled(true));
    // 等開啟早自習那次存檔傳回來，免得舊的雲端資料晚到、蓋掉後面的修改
    await expect.poll(() => cloud.board('main')?.daily?.enabled, { timeout: 15000 }).toBe(true);
    await room.waitForTimeout(500);
    await unlockTeacher(room, 'morning');
    return room;
}

test('國語課次：{L}、{甲乙}、{國習頁}帶進聯絡簿，每週一自動 +1，範本一次套用', async ({ browser }) => {
    const cloud = createCloud();
    // 2026-11-23 是星期一，早上
    const room = await openEditorAt(browser, cloud, new Date(2026, 10, 23, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await room.click('#contact-fixed summary');
    await room.fill('#contact-lesson', '9');
    await room.fill('#contact-lesson-pages', '9=P.50-53\n10=P.54-57');
    await room.click('#contact-fixed-template');
    await expect(room.locator('#contact-fixed-1')).toHaveValue('預習{L}+padlet、{甲乙}本{L}生造、帶直笛');
    await expect(room.locator('#contact-fixed-5')).toHaveValue('國習{L}、{甲乙}本{L}萬花筒、品德學習單#1、閱讀#1、週記、帶美勞用具');
    // 週一：L9 是單數課 → 甲
    await expect(room.locator('#contact-input')).toHaveValue('預習L9+padlet\n甲本L9生造\n帶直笛');
    await room.click('#modal-contact >> text=儲存');
    await expect(room.locator('#contact-body')).toContainText('甲本L9生造');
    await expect.poll(() => cloud.board('main').daily?.contact?.lesson, { timeout: 15000 }).toEqual({ n: 9, week: '2026-11-23' });
    // 這週二：國習頁碼；下週三：L10、乙
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-11-24'))).toEqual(['國重L9', '國習P.50-53']);
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-12-02'))).toEqual(['乙本L10詞', '閱讀1', '完成書法作業']);
    // 沒設定頁碼的課：空著讓老師填
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-12-08'))).toEqual(['國重L11', '國習']);

    // 下週一打開：課次自動變 10；放假停一週就改回 10，下週還是 10
    await room.clock.setFixedTime(new Date(2026, 10, 30, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await expect(room.locator('#contact-lesson')).toHaveValue('10');
    await expect(room.locator('#contact-input')).toHaveValue('預習L10+padlet\n乙本L10生造\n帶直笛');
    await room.click('#modal-contact >> text=取消');
    expect(room.errors).toEqual([]);
});

test('同名的「閱讀#」週三、週五共用一組號碼；改比較早的那天不會把號碼改回去', async ({ browser }) => {
    const cloud = createCloud();
    // 2026-11-25 是星期三
    const room = await openEditorAt(browser, cloud, new Date(2026, 10, 25, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await room.click('#contact-fixed summary');
    await room.fill('#contact-fixed-3', '閱讀#5');
    await room.fill('#contact-fixed-5', '閱讀#5、週記');
    await room.dispatchEvent('#contact-fixed-3', 'change');
    await expect(room.locator('#contact-input')).toHaveValue('閱讀5');
    await room.click('#modal-contact >> text=儲存');
    await expect.poll(() => cloud.board('main').daily?.contact?.fixed, { timeout: 15000 }).toEqual({ 3: ['閱讀#6'], 5: ['閱讀#6', '週記'] });
    // 週五：接著是 6
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-11-27'))).toEqual(['閱讀6', '週記']);
    await room.clock.setFixedTime(new Date(2026, 10, 27, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await expect(room.locator('#contact-input')).toHaveValue('閱讀6\n週記');
    await room.click('#modal-contact >> text=儲存');
    await room.waitForTimeout(300);
    expect(await room.evaluate(() => state.daily.contact.fixed)).toEqual({ 3: ['閱讀#7'], 5: ['閱讀#7', '週記'] });
    // 回去改週三那份：已經寫的「閱讀5」不會再多帶一個，號碼也不會退回
    await room.click('text=✏️ 編輯');
    await room.fill('#contact-for-date', '2026-11-25');
    await room.dispatchEvent('#contact-for-date', 'change');
    await expect(room.locator('#contact-input')).toHaveValue('閱讀5');
    await room.click('#modal-contact >> text=儲存');
    await room.waitForTimeout(300);
    expect(await room.evaluate(() => state.daily.contact.fixed)).toEqual({ 3: ['閱讀#7'], 5: ['閱讀#7', '週記'] });
    expect(room.errors).toEqual([]);
});

test('舊版的號碼紀錄（前面有星期幾）讀進來還能用', async ({ browser }) => {
    const cloud = createCloud();
    const first = await openEditorAt(browser, cloud, new Date(2026, 10, 27, 9, 0, 0));
    await expect.poll(() => !!cloud.board('main')?.daily, { timeout: 15000 }).toBe(true);
    await first.context().close();
    const board = cloud.board('main');
    board.daily.contact = { ...board.daily.contact, fixed: { 5: ['品德學習單#5'] }, fixedUsed: { '5|品德學習單': { date: '2026-11-27', n: 4 } } };
    const room = await openDevice(browser, cloud);
    await room.clock.setFixedTime(new Date(2026, 10, 27, 9, 0, 0));
    await expect.poll(() => room.evaluate(() => JSON.stringify(state.daily.contact.fixedUsed))).toBe(JSON.stringify({ 品德學習單: { date: '2026-11-27', n: 4 } }));
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-11-27'))).toEqual(['品德學習單4']);
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-12-04'))).toEqual(['品德學習單5']);
    expect(room.errors).toEqual([]);
});

test('數學頁數：數習、數練、數課各自記住寫到第幾頁，打書名自動接下一頁', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openEditorAt(browser, cloud, new Date(2026, 10, 24, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await room.fill('#contact-input', '數習P.38-40\n數練p.12\n數課P.20~21\n八格卷');
    await room.click('#modal-contact >> text=儲存');
    await expect.poll(() => cloud.board('main').daily?.contact?.pages, { timeout: 15000 }).toEqual({
        數習: { p: 40, date: '2026-11-24' }, 數練: { p: 12, date: '2026-11-24' }, 數課: { p: 21, date: '2026-11-24' }
    });
    // 隔天：打「數習」就接 P.41-
    await room.clock.setFixedTime(new Date(2026, 10, 25, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await expect(room.locator('#contact-page-hint')).toContainText('數習 P.40');
    await room.waitForTimeout(300); // 編輯視窗打開後會先把游標放在早修任務
    await room.fill('#contact-input', '');
    await room.locator('#contact-input').pressSequentially('數習');
    await expect(room.locator('#contact-input')).toHaveValue('數習P.41-');
    await room.locator('#contact-input').pressSequentially('43\n數課');
    await expect(room.locator('#contact-input')).toHaveValue('數習P.41-43\n數課P.22-');
    // 沒記頁數的書照常
    await room.locator('#contact-input').pressSequentially('24\n八格卷');
    await expect(room.locator('#contact-input')).toHaveValue('數習P.41-43\n數課P.22-24\n八格卷');
    await room.click('#modal-contact >> text=儲存');
    await room.waitForTimeout(300);
    expect(await room.evaluate(() => state.daily.contact.pages['數習'])).toEqual({ p: 43, date: '2026-11-25' });
    expect(room.errors).toEqual([]);
});

test('提醒事項：提前幾天開始自動加在聯絡簿最後，可以倒數', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openEditorAt(browser, cloud, new Date(2026, 10, 24, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await room.fill('#contact-input', '國習P.48');
    await room.click('#contact-reminders-box summary');
    await room.click('#contact-reminder-add');
    const row = room.locator('#contact-reminders .reminder-row').last();
    await row.locator('.reminder-text').fill('畢旅');
    await row.locator('.reminder-date').fill('2026-11-27');
    await row.locator('.reminder-before').fill('3');
    await room.click('#contact-reminder-add');
    const row2 = room.locator('#contact-reminders .reminder-row').last();
    await row2.locator('.reminder-text').fill('帶健保卡');
    await row2.locator('.reminder-date').fill('2026-12-10');
    await row2.locator('.reminder-countdown').uncheck();
    await room.click('#modal-contact >> text=儲存');
    await room.click('#contact-layout-h');
    const lis = room.locator('#contact-body .contact-paper li');
    await expect(lis).toHaveCount(2);
    await expect(lis.nth(1)).toContainText('2.');
    await expect(lis.nth(1)).toContainText('畢旅倒數3天');
    await expect.poll(() => cloud.board('main').daily?.contact?.reminders?.length, { timeout: 15000 }).toBe(2);
    expect(await room.evaluate(() => [reminderItems(state.daily.contact, '2026-11-23'), reminderItems(state.daily.contact, '2026-11-27'), reminderItems(state.daily.contact, '2026-12-10')]))
        .toEqual([[], ['今天畢旅'], ['帶健保卡']]);
    // 收作業不會把提醒當成作業
    const collected = await room.evaluate(() => collectSources().flatMap((src) => src.items));
    expect(collected.join()).not.toContain('畢旅');
    expect(room.errors).toEqual([]);
});

test('發到 BAND：老師看預覽、輸入發布密碼送出，成功後標記今日已發布，不會重複發', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openEditorAt(browser, cloud, new Date(2026, 10, 24, 7, 30, 0));
    const posts = [];
    await room.context().route('https://script.google.com/**', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        posts.push(body);
        const ok = body.password === 'band-secret';
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(ok ? { ok: true } : { ok: false, error: '發布密碼不對' }) });
    });
    await room.click('text=✏️ 編輯');
    await room.fill('#contact-input', '國習P.48\n*帶水彩');
    await room.click('#modal-contact >> text=儲存');
    await expect.poll(() => cloud.board('main').daily?.contact?.history?.['2026-11-24'], { timeout: 15000 }).toEqual(['國習P.48', '*帶水彩']);
    await expect(room.locator('#contact-body')).toContainText('國習P.48');

    // 學生模式看不到按鈕
    await room.evaluate(() => applyRoleUI('student'));
    await expect(room.locator('#band-publish-btn')).toBeHidden();
    await room.evaluate(() => { startTeacherSession(); applyRoleUI('teacher'); });
    await expect(room.locator('#band-publish-btn')).toHaveText('📣 發到BAND');
    await room.click('#band-publish-btn');
    await expect(room.locator('#modal-band')).toBeVisible();
    await expect(room.locator('#band-content')).toHaveValue('📒 11/24（週二）聯絡簿\n1. 國習P.48\n▲ 帶水彩');
    // 還沒填網址
    await room.fill('#band-password', 'band-secret');
    await room.click('#band-send');
    await expect(room.locator('#band-status')).toContainText('網址');
    await room.fill('#band-url', BAND_URL);
    // 密碼錯
    await room.fill('#band-password', 'wrong');
    await room.click('#band-send');
    await expect(room.locator('#band-status')).toContainText('發布密碼不對');
    // 正確
    await room.fill('#band-password', 'band-secret');
    await room.check('#band-remember');
    await room.click('#band-send');
    await expect(room.locator('#modal-band')).toBeHidden();
    await expect(room.locator('#band-publish-btn')).toHaveText('✅ 今日已發布');
    expect(posts.at(-1)).toEqual({ password: 'band-secret', content: '📒 11/24（週二）聯絡簿\n1. 國習P.48\n▲ 帶水彩', date: '2026-11-24', force: false });
    await expect.poll(() => cloud.board('main').daily?.contact?.bandPosted?.date, { timeout: 15000 }).toBe('2026-11-24');
    expect(cloud.board('main').daily.contact.bandUrl).toBe(BAND_URL);
    // 密碼只記在這台裝置，不會存到雲端
    expect(JSON.stringify(cloud.board('main'))).not.toContain('band-secret');
    expect(await room.evaluate(() => localStorage.getItem('checkpoint_band_password'))).toBe('band-secret');

    // 再按一次：提醒已經發過，沒勾「再發一次」不會送出
    const count = posts.length;
    await room.click('#band-publish-btn');
    await expect(room.locator('#band-already')).toBeVisible();
    await expect(room.locator('#band-password')).toHaveValue('band-secret');
    await room.click('#band-send');
    await expect(room.locator('#band-status')).toContainText('已經發過');
    expect(posts.length).toBe(count);
    await room.check('#band-force');
    await room.click('#band-send');
    await expect(room.locator('#modal-band')).toBeHidden();
    expect(posts.length).toBe(count + 1);
    expect(posts.at(-1).force).toBe(true);
    expect(room.errors).toEqual([]);
});
