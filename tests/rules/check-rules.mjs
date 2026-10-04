// 用 Google 官方的 Firestore 模擬器檢查 firestore.rules：正常操作要能通過，過大或不合規的寫入要被擋下。
// 執行：cd tests/rules && npm ci && npm test（需要 Java）
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, FieldPath } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'homeworksystem-test',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 }
});
const A = 'artifacts/app/public/data/';
const db = env.authenticatedContext('teacher').firestore();
const anon = env.unauthenticatedContext().firestore();
const students = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: String(i + 1), parentCode: 'ABC' + String(i).padStart(3, '0') }));
const board = (n = 28) => ({
  sloganTitle: '未訂正完成，不能下課！', sloganSub: '請自律完成訂正', students: students(n), nextStudentId: n + 1,
  assignments: Array.from({ length: 15 }, (_, i) => '作業' + i), slots: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, assignment: '作業' + i })),
  teacherPin: '8888', statuses: { '作業0': { '3': false } }, lastUpdated: Date.now()
});
let pass = 0, fail = 0;
async function check(name, p) { try { await p; pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, e.message.slice(0, 120)); } }

// 正常使用
await check('建立 28 人看板', assertSucceeds(setDoc(doc(db, A + 'checkpoint_boards/lin601cs'), board())));
await check('建立 40 人看板', assertSucceeds(setDoc(doc(db, A + 'checkpoint_boards/max40ab'), board(40))));
await check('讀取看板', assertSucceeds(getDoc(doc(db, A + 'checkpoint_boards/lin601cs'))));
await check('逐格更新紅綠燈', assertSucceeds(updateDoc(doc(db, A + 'checkpoint_boards/lin601cs'), new FieldPath('statuses', '作業0', '5'), false, 'lastUpdated', Date.now())));
await check('整項作業全部完成', assertSucceeds(updateDoc(doc(db, A + 'checkpoint_boards/lin601cs'), new FieldPath('statuses', '作業1'), { '1': true, '2': true })));
await check('舊格式看板（轉換前）可寫入', assertSucceeds(setDoc(doc(db, A + 'checkpoint_boards/oldfmt1'), (({ statuses, ...rest }) => ({ ...rest, serializedStatuses: { '作業0': '{"3":false}' } }))(board()))));
await check('清空舊代碼（停用標記）', assertSucceeds(setDoc(doc(db, A + 'checkpoint_boards/max40ab'), { retired: true, retiredAt: Date.now() })));
await check('8 個作業框', assertSucceeds(setDoc(doc(db, A + 'checkpoint_boards/eight8x'), { ...board(), slots: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, assignment: 'x' })) })));
await check('寫入家長查詢摘要', assertSucceeds(setDoc(doc(db, A + 'parent_views/K7P2QX'), { seat: '5', items: [{ name: '國習', finished: false, onBoard: true }], updatedAt: Date.now() })));
await check('舊版含標語的摘要仍可覆寫', assertSucceeds(setDoc(doc(db, A + 'parent_views/K7P2QX9A'), { seat: '5', sloganTitle: 'x', sloganSub: 'y', items: [], updatedAt: 1 })));
await check('家長讀取自己的摘要', assertSucceeds(getDoc(doc(db, A + 'parent_views/K7P2QX'))));
await check('刪除家長查詢摘要', assertSucceeds(deleteDoc(doc(db, A + 'parent_views/K7P2QX'))));
await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'artifacts/app/users/teacher/checkpoint_data/main_board'), { students: [] }));
await check('讀取自己的舊版資料', assertSucceeds(getDoc(doc(db, 'artifacts/app/users/teacher/checkpoint_data/main_board'))));

// 應該被擋下
await check('未登入不能讀看板', assertFails(getDoc(doc(anon, A + 'checkpoint_boards/lin601cs'))));
await check('不能列出所有班級', assertFails(getDocs(collection(db, A + 'checkpoint_boards'))));
await check('不能列出所有查詢碼', assertFails(getDocs(collection(db, A + 'parent_views'))));
await check('41 人被擋', assertFails(setDoc(doc(db, A + 'checkpoint_boards/big41xx'), board(41))));
await check('51 項作業被擋', assertFails(setDoc(doc(db, A + 'checkpoint_boards/big51xx'), { ...board(), assignments: Array.from({ length: 51 }, (_, i) => 'a' + i) })));
await check('9 個作業框被擋', assertFails(setDoc(doc(db, A + 'checkpoint_boards/nine9xx'), { ...board(), slots: Array.from({ length: 9 }, () => ({ id: 1, assignment: 'x' })) })));
await check('超長標語被擋', assertFails(setDoc(doc(db, A + 'checkpoint_boards/long1xx'), { ...board(), sloganSub: 'x'.repeat(201) })));
await check('塞入大量額外欄位被擋', assertFails(setDoc(doc(db, A + 'checkpoint_boards/junk1xx'), Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['f' + i, 'x'])))));
await check('逐格更新也不能把學生塞到 41 人', assertFails(updateDoc(doc(db, A + 'checkpoint_boards/lin601cs'), 'students', students(41))));
await check('不合規的班級代碼被擋', assertFails(setDoc(doc(db, A + 'checkpoint_boards/bad code'), board())));
await check('摘要放超過 50 項被擋', assertFails(setDoc(doc(db, A + 'parent_views/ZZZZZZ'), { seat: '1', items: Array.from({ length: 51 }, () => ({})), updatedAt: 1 })));
await check('不合規的查詢碼被擋', assertFails(setDoc(doc(db, A + 'parent_views/abc'), { seat: '1', items: [] })));
await check('不能寫入舊版個人資料', assertFails(setDoc(doc(db, 'artifacts/app/users/teacher/checkpoint_data/main_board'), { x: 1 })));
await check('不能讀別人的舊版資料', assertFails(getDoc(doc(env.authenticatedContext('other').firestore(), 'artifacts/app/users/teacher/checkpoint_data/main_board'))));
await check('其他路徑一律禁止', assertFails(setDoc(doc(db, 'random/doc'), { a: 1 })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
