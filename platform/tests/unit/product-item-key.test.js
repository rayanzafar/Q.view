// مفتاحُ البند: تسلسلٌ داخل منتجه وصياغةٌ تُقرأ («SND-042»).
//
// وثلاثةُ أشياء تُثبَت هنا لأن كسرَ أيٍّ منها لا يظهر إلا بعد أن يُطبع المفتاح في بريدٍ خرج
// من المنصة وفي رأس مهمةٍ يعمل عليها أحدهم:
//   ① الصياغة: ثلاثُ خاناتٍ بأصفارٍ سابقة، وما تجاوزها يُكتب كما هو بلا قصّ.
//   ② التسلسل: يبدأ من واحدٍ ويزيد واحداً، ولكل منتجٍ عدّادُه المستقلّ.
//   ③ التزاحم: طلباتٌ تُطلق معاً على المنتج نفسه لا تأخذ الرقم نفسه ولا تترك ثغرةً في
//      الفهرس الفريد — الحجزُ مشروطٌ بما قُرئ ويُعاد عند السبق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prdkey-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, items, intake, products;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company' };
const ctx = () => ({ user: ADMIN, ip: '1.1.1.1' });
let SANAD, OTHER;

const addItem = (productId, title) => intake.createManual(ctx(), productId, {
  type: 'bug', title, description: 'وصف', where_text: 'شاشة', sector_id: 'SOL', reporter_name: 'موظف',
});

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  items = await import('../../src/modules/products/items.js');
  intake = await import('../../src/modules/products/intake.js');
  products = await import('../../src/modules/products/products.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  SANAD = (await products.createProduct(ctx(), { key: 'sanad', name_ar: 'سند', kind: 'internal', item_prefix: 'SND' })).id;
  OTHER = (await products.createProduct(ctx(), { key: 'mudun', name_ar: 'مدن', kind: 'external', item_prefix: 'MDN' })).id;
});

after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الصياغة: ثلاث خانات بأصفار سابقة، وما تجاوزها كما هو', () => {
  assert.equal(items.itemKeyOf('SND', 1), 'SND-001');
  assert.equal(items.itemKeyOf('SND', 42), 'SND-042');
  assert.equal(items.itemKeyOf('SND', 999), 'SND-999');
  assert.equal(items.itemKeyOf('SND', 1000), 'SND-1000');
  assert.equal(items.itemKeyOf('MDN', 7), 'MDN-007');
});

test('التسلسل يبدأ من واحد ويزيد واحداً، ولكل منتجٍ عدّادُه', async () => {
  const a = await addItem(SANAD, 'أول بلاغ');
  const b = await addItem(SANAD, 'ثاني بلاغ');
  assert.equal(a.item_no, 1);
  assert.equal(a.item_key, 'SND-001');
  assert.equal(b.item_no, 2);
  assert.equal(b.item_key, 'SND-002');
  // عدّادُ المنتج الآخر مستقلٌّ تماماً — يبدأ من واحدٍ رغم أنّ سنداً بلغ اثنين
  const c = await addItem(OTHER, 'بلاغ في منتجٍ آخر');
  assert.equal(c.item_no, 1);
  assert.equal(c.item_key, 'MDN-001');
  const seq = await db.get('SELECT item_seq FROM product WHERE id = ?', [SANAD]);
  assert.equal(Number(seq.item_seq), 2);
});

test('الحجز داخل معاملةٍ واحدة يُعطي أرقاماً متتابعة لا مكرَّرة', async () => {
  const got = await db.tx(async () => {
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await items.allocateItemNo(OTHER));
    return out;
  });
  const nos = got.map((g) => g.item_no);
  assert.deepEqual(nos, [2, 3, 4, 5, 6]);
  assert.deepEqual(got.map((g) => g.item_key), ['MDN-002', 'MDN-003', 'MDN-004', 'MDN-005', 'MDN-006']);
  assert.equal(new Set(nos).size, nos.length);
});

test('طلباتٌ تنطلق معاً على المنتج نفسه لا تتزاحم على رقمٍ واحد', async () => {
  const before = Number((await db.get('SELECT item_seq FROM product WHERE id = ?', [SANAD])).item_seq);
  const created = await Promise.all(
    Array.from({ length: 8 }, (_, i) => addItem(SANAD, `بلاغٌ متزامن ${i + 1}`)));
  const nos = created.map((r) => r.item_no).sort((a, b) => a - b);
  assert.equal(new Set(nos).size, 8, 'لا رقم يتكرّر');
  assert.deepEqual(nos, Array.from({ length: 8 }, (_, i) => before + i + 1), 'ولا ثغرة في التسلسل');
  const keys = new Set(created.map((r) => r.item_key));
  assert.equal(keys.size, 8);
  // والفهرس الفريد يشهد: صفوفٌ بعدد ما كُتب، وأرقامٌ فريدة داخل المنتج
  const rows = await db.all('SELECT item_no FROM product_item WHERE product_id = ?', [SANAD]);
  assert.equal(new Set(rows.map((r) => Number(r.item_no))).size, rows.length);
});
