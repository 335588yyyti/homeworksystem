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

test('國語課次：{L}、{甲乙}、{國習頁}帶進聯絡簿，每週一自動 +1，閱讀階梯那週填文字，範本一次套用', async ({ browser }) => {
    const cloud = createCloud();
    // 2026-11-23 是星期一，早上
    const room = await openEditorAt(browser, cloud, new Date(2026, 10, 23, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await room.click('#contact-fixed summary');
    await room.fill('#contact-lesson', '9');
    await room.click('#contact-fixed-template');
    await expect(room.locator('#contact-fixed-1')).toHaveValue('預習{L}+padlet、{甲乙}本{L}生造、帶直笛');
    await expect(room.locator('#contact-fixed-5')).toHaveValue('國習{L}、{甲乙}本{L}萬花筒、品德學習單#1、閱讀#1、週記、帶美勞用具');
    // 週一：L9 是單數課 → 甲
    await expect(room.locator('#contact-input')).toHaveValue('預習L9+padlet\n甲本L9生造\n帶直笛');
    await room.click('#modal-contact >> text=儲存');
    await expect(room.locator('#contact-body')).toContainText('甲本L9生造');
    await expect.poll(() => cloud.board('main').daily?.contact?.lesson, { timeout: 15000 }).toEqual({ n: 9, week: '2026-11-23' });
    // 國習頁：L9 起始頁 70 →「P.70–P.71」；下週 L10 → 78
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-11-24'))).toEqual(['國重L9', '國習P.70–P.71']);
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-12-01'))).toEqual(['國重L10', '國習P.78–P.79']);
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-12-02'))).toEqual(['乙本L10詞', '閱讀1', '完成書法作業']);
    // 表裡沒有的課：空著讓老師填
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2027-01-26'))).toEqual(['國重L18', '國習']);

    // 下週一打開：課次自動變 10
    await room.clock.setFixedTime(new Date(2026, 10, 30, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await expect(room.locator('#contact-lesson')).toHaveValue('10');
    await room.waitForTimeout(300); // 編輯視窗打開後會先把游標放在早修任務
    await expect(room.locator('#contact-input')).toHaveValue('預習L10+padlet\n乙本L10生造\n帶直笛');
    // 閱讀階梯那週：填文字，國習頁照表（102），{甲乙} 空著，不會自動加
    await room.fill('#contact-input', '');
    await room.fill('#contact-lesson', '閱讀階梯二');
    await room.dispatchEvent('#contact-lesson', 'change');
    await expect(room.locator('#contact-input')).toHaveValue('預習閱讀階梯二+padlet\n本閱讀階梯二生造\n帶直笛');
    await room.click('#modal-contact >> text=儲存');
    await room.waitForTimeout(300);
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-12-01'))).toEqual(['國重閱讀階梯二', '國習P.102–P.103']);
    expect(await room.evaluate(() => contactFixedFor(state.daily.contact, '2026-12-08'))).toEqual(['國重閱讀階梯二', '國習P.102–P.103']);
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

test('數學預填：數習接下一頁、數練一次 2 頁不跨單元（剩 1 頁併成 3 頁）、八格卷接下一小節、單元寫完有提示', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openEditorAt(browser, cloud, new Date(2026, 10, 24, 9, 0, 0));
    // 設定目前寫到哪
    await room.click('text=✏️ 編輯');
    await room.click('#contact-fixed summary');
    await room.click('#contact-fixed >> text=📚 課本進度設定');
    await expect(room.locator('#modal-books')).toBeVisible();
    await expect(room.locator('#books-shulian')).toHaveValue('U5=31-38\nU6=39-45\nU7=46-52\nU8=53-61\n素養評量挑戰2=62\n學力來挑戰2=63');
    await expect(room.locator('#books-guoxi')).toHaveValue('L7=54\nL8=62\nL9=70\nL10=78\nL11=86\nL12=94\n閱讀階梯二=102');
    await room.fill('#progress-shuxi', '55');
    await room.fill('#progress-shulian', '33');
    await room.fill('#progress-bage', '5-2');
    await room.click('#books-save');
    await expect(room.locator('#modal-books')).toBeHidden();
    await expect(room.locator('#contact-page-hint')).toContainText('數習寫到 P.55');
    await room.waitForTimeout(300); // 編輯視窗打開後會先把游標放在早修任務
    await room.fill('#contact-input', '');
    const box = room.locator('#contact-input');
    await box.pressSequentially('數習');
    await expect(box).toHaveValue('數習P.56–');
    await box.pressSequentially('59\n數練');
    // 數練 34–35 之後 U5 只剩 36–38：這次 34–35
    await expect(box).toHaveValue('數習P.56–59\n數練P.34–35');
    await box.pressSequentially('\n八格卷');
    await expect(box).toHaveValue('數習P.56–59\n數練P.34–35\n八格卷5-3');
    await room.click('#modal-contact >> text=儲存');
    await expect.poll(() => cloud.board('main').daily?.contact?.progress, { timeout: 15000 }).toEqual({
        shuxi: { p: 59, date: '2026-11-24' }, shulian: { p: 35, date: '2026-11-24' }, bage: { u: 5, s: 3, date: '2026-11-24' }
    });
    // 函式直接確認：數練剩 3 頁時併成一次
    expect(await room.evaluate(() => mathAutoText(state.daily.contact, '數練'))).toBe('P.36–38');
    expect(await room.evaluate(() => mathAutoText({ ...state.daily.contact, progress: { shulian: { p: 38, date: '2026-11-24' } } }, '數練'))).toBe('P.39–40');
    expect(await room.evaluate(() => mathAutoText({ ...state.daily.contact, progress: { shulian: { p: 61, date: '2026-11-24' } } }, '數練'))).toBe('P.62');
    expect(await room.evaluate(() => mathAutoText(state.daily.contact, '八格卷'))).toBe('6-1');
    expect(await room.evaluate(() => mathAutoText(state.daily.contact, '數習'))).toBe('P.60–');

    // 隔天：數習和八格卷 U5 都寫完 → 帶入「U5後測卷」，數習進入 U6 → 帶入「U6前測卷」；提示單元寫完
    await room.clock.setFixedTime(new Date(2026, 10, 25, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await expect(room.locator('#contact-page-hint')).toContainText('數習寫到 P.59（第5單元已寫完）');
    await expect(room.locator('#contact-page-hint')).toContainText('八格卷寫到 5-3（第5單元已寫完）');
    await expect(box).toHaveValue('U5後測卷\nU6前測卷');
    // 老師不要前測卷：刪掉後存，之後就不會再帶入
    await room.fill('#contact-input', 'U5後測卷');
    await room.click('#modal-contact >> text=儲存');
    await expect.poll(() => cloud.board('main').daily?.contact?.mathTests, { timeout: 15000 }).toEqual({ U5後測: 'given', U6前測: 'skipped' });
    await room.clock.setFixedTime(new Date(2026, 10, 26, 9, 0, 0));
    await room.click('text=✏️ 編輯');
    await expect(box).toHaveValue('');
    await room.click('#modal-contact >> text=取消');
    expect(room.errors).toEqual([]);
});

test('課本進度設定可以改表格（下學期換書），格式不對會提醒', async ({ browser }) => {
    const cloud = createCloud();
    const room = await openDevice(browser, cloud);
    await unlockTeacher(room, 'settings');
    await room.click('#settings-books-button');
    await expect(room.locator('#modal-books')).toBeVisible();
    await room.fill('#books-shuxi', 'U1=2-11\nU2=12-23');
    await room.fill('#books-bage', 'U1=2\n亂寫');
    await room.click('#books-save');
    await expect(room.locator('#books-status')).toContainText('亂寫');
    await room.fill('#books-bage', 'U1=2\nU2=3');
    await room.fill('#books-guoxi', 'L1=4\nL2=10');
    await room.click('#books-save');
    await expect(room.locator('#modal-books')).toBeHidden();
    await expect.poll(() => cloud.board('main').daily?.contact?.books?.shuxi, { timeout: 15000 }).toEqual([{ name: 'U1', start: 2, end: 11 }, { name: 'U2', start: 12, end: 23 }]);
    expect(cloud.board('main').daily.contact.books.bage).toEqual({ U1: 2, U2: 3 });
    expect(cloud.board('main').daily.contact.books.guoxi).toEqual({ L1: 4, L2: 10 });
    // 恢復預設
    await room.click('#settings-books-button');
    await room.click('text=↩️ 表格恢復預設');
    await expect(room.locator('#books-shuxi')).toHaveValue('U5=50-59\nU6=60-69\nU7=70-81\nU8=82-95\n綜合練習二=96-101');
    await room.click('#modal-books >> text=取消');
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
