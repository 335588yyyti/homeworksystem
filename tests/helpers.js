// 測試工具：用記憶體模擬 Firestore，讓多個頁面（教室電腦、老師手機、家長手機）共用同一份「雲端」資料。
// 不會連到真正的 Firebase，外部字型、圖示也都不載入。
const fs = require('fs');
const path = require('path');

// 網址只是給瀏覽器看的，實際檔案由下方的 route 直接從專案資料夾提供
const BASE_URL = 'http://localhost:4173/';
const ROOT = path.resolve(__dirname, '..');
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript' };
const INDEX_URL = BASE_URL + 'index.html';
const QR_LIB = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
const BOARDS = 'artifacts/classroom-checkpoint-app/public/data/checkpoint_boards/';
const VIEWS = 'artifacts/classroom-checkpoint-app/public/data/parent_views/';

// 模擬的 Firebase 模組（app、auth、firestore 三個網址都回傳這一份）
const FIREBASE_STUB = `
const call = (...args) => window.__fs(...args);
const waitOnline = async () => { while (!navigator.onLine) await new Promise(r => setTimeout(r, 50)); };
// 測試用：window.__failWritesWith = 'resource-exhausted' 時，寫入會像 Firebase 額度用完一樣失敗
const maybeFail = () => { if (window.__failWritesWith) throw Object.assign(new Error('Quota exceeded.'), { code: window.__failWritesWith }); };
const snap = (data, fromCache = false) => ({ exists: () => data !== null, data: () => data, metadata: { hasPendingWrites: false, fromCache } });
export const initializeApp = () => ({});
export const getAuth = () => ({ currentUser: { uid: 'user-' + Math.random().toString(36).slice(2) }, authStateReady: async () => {} });
export const signInAnonymously = async () => {};
export const signInWithCustomToken = async () => {};
export const getFirestore = () => ({});
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const doc = (db, ...parts) => ({ path: parts.join('/') });
export class FieldPath { constructor(...segments) { this.segments = segments; } }
export const updateDoc = async (ref, ...pairs) => {
    const fields = [];
    for (let i = 0; i < pairs.length; i += 2) {
        const field = pairs[i];
        fields.push([field instanceof FieldPath ? field.segments : field.split('.'), JSON.parse(JSON.stringify(pairs[i + 1]))]);
    }
    await waitOnline();
    maybeFail();
    // 測試用：window.__holdWrites = true 時寫入永遠送不到雲端（模擬上傳途中關機）
    if (window.__holdWrites) await new Promise(() => {});
    await call('update', ref.path, fields);
};
export const getDoc = async (ref) => { await waitOnline(); return snap(await call('get', ref.path)); };
export const setDoc = async (ref, data) => { const copy = JSON.parse(JSON.stringify(data)); await waitOnline(); maybeFail(); await call('set', ref.path, copy); };
export const writeBatch = () => {
    const ops = [];
    return {
        set: (ref, data) => ops.push(['set', ref.path, JSON.parse(JSON.stringify(data))]),
        delete: (ref) => ops.push(['del', ref.path]),
        commit: async () => { await waitOnline(); maybeFail(); for (const op of ops) await call(...op); }
    };
};
export const onSnapshot = (ref, onNext) => {
    let last = '__init__';
    let alive = true;
    let sentOfflineEmpty = false;
    const tick = async () => {
        if (!alive) return;
        if (window.__pauseSnapshots) {
            // 測試用：暫停接收雲端更新，模擬兩台裝置在同一瞬間操作
        } else if (!navigator.onLine) {
            // 離線且本機沒有快取：回傳「來自快取、不存在」
            if (last === '__init__' && !sentOfflineEmpty) { sentOfflineEmpty = true; onNext(snap(null, true)); }
        } else {
            const data = await call('get', ref.path);
            const key = JSON.stringify(data);
            if (key !== last) { last = key; onNext(snap(data)); }
        }
        setTimeout(tick, 60);
    };
    tick();
    return () => { alive = false; };
};
`;

function createCloud() {
    const store = {};
    return {
        store,
        board: (code) => store[BOARDS + code],
        view: (code) => store[VIEWS + code],
        setBoard: (code, data) => { store[BOARDS + code] = data; }
    };
}

// 開一個模擬裝置。opts.query 例如 '?p=ABC123'；opts.viewport 自訂視窗大小；opts.offline 一開始就離線
async function openDevice(browser, cloud, opts = {}) {
    const context = await browser.newContext({ viewport: opts.viewport || { width: 1366, height: 768 } });
    if (opts.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    page.reads = [];
    page.writes = [];
    page.dialogs = [];
    page.errors = [];
    page.answerDialogs = true;
    page.on('pageerror', (e) => page.errors.push(e.stack || e.message));
    page.on('dialog', (d) => { page.dialogs.push(d.message()); page.answerDialogs ? d.accept() : d.dismiss(); });
    await page.exposeFunction('__fs', async (op, docPath, data) => {
        await new Promise((r) => setTimeout(r, 5));
        if (op === 'get') { page.reads.push(docPath); return cloud.store[docPath] ?? null; }
        page.writes.push(docPath);
        if (op === 'set') cloud.store[docPath] = data;
        if (op === 'del') delete cloud.store[docPath];
        if (op === 'update') {
            const target = cloud.store[docPath];
            if (!target) throw new Error('No document to update: ' + docPath);
            for (const [segments, value] of data) {
                let node = target;
                segments.slice(0, -1).forEach((key) => {
                    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
                    node = node[key];
                });
                node[segments[segments.length - 1]] = value;
            }
        }
        return null;
    });
    await context.addInitScript(() => { window.__firebase_config = '{}'; });
    await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(BASE_URL)) {
            // 網站本身的檔案直接從專案資料夾讀取（不需要另開伺服器，離線測試也能開啟）
            const file = path.join(ROOT, decodeURIComponent(new URL(url).pathname));
            if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
            return route.fulfill({ contentType: CONTENT_TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        }
        if (url.includes('gstatic.com/firebasejs')) {
            return route.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: FIREBASE_STUB });
        }
        if (url.includes('qrcodejs')) return route.fulfill({ contentType: 'application/javascript', body: QR_LIB });
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    if (opts.offline) await context.setOffline(true);
    await page.goto(INDEX_URL + (opts.query || ''));
    const ready = opts.offline ? '離線' : '已連線';
    await page.waitForFunction((text) => document.getElementById('cloud-sync-status')?.textContent.includes(text) || window.IS_PARENT_MODE, ready);
    await page.waitForTimeout(300);
    return page;
}

// 解鎖教師權限並切到某個分頁
async function unlockTeacher(page, tab) {
    await page.evaluate((t) => {
        startTeacherSession();
        if (t) switchTab(t, true);
    }, tab);
}

// 檢查看板上每個座號按鈕都在卡片內、數字沒有超出按鈕
async function seatLayoutProblems(page) {
    return page.evaluate(() => {
        let outside = 0;
        let overflow = 0;
        document.querySelectorAll('#view-dashboard > div').forEach((card) => {
            const c = card.getBoundingClientRect();
            card.querySelectorAll('.seat-btn').forEach((b) => {
                const r = b.getBoundingClientRect();
                if (r.right > c.right - 1 || r.bottom > c.bottom - 1 || r.left < c.left || r.top < c.top) outside++;
                if (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1) overflow++;
            });
        });
        return { outside, overflow };
    });
}

module.exports = { INDEX_URL, createCloud, openDevice, unlockTeacher, seatLayoutProblems };
