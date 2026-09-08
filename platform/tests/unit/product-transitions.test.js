// جدولُ انتقالات «مركز التطوير» — كلُّ حافةٍ مسموحة تُجرَّب فتنجح، وكلُّ حافةٍ ممنوعة
// تُجرَّب فتُردّ. الاختبار يُبنى من الجدول نفسه (`TRANSITIONS`) لا من قائمةٍ منسوخة بجانبه:
// حافةٌ تُضاف إلى الجدول تدخل الاختبار في اللحظة نفسها، وحافةٌ تُنزع تُغطّى مرفوضةً.
//
// وأربعةُ حقولٍ مطلوبةٍ تُختبر وحدها لأن غيابها يُفرغ الحالة من معناها: سببُ الرفض، ووسمُ
// إصدار الحل، وأصلُ البلاغ المكرر، وسؤالُ التوضيح — ومعها أن «بحاجة لتوضيح» تحفظ ما كانت
// عليه فتعود إليه لا إلى «جديد».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prdtrans-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, items, intake, products;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company' };
const DEV = { id: 'u_dev', username: 'dev', name_ar: 'مطوِّر', role_id: 'employee', scope: 'own', sector_id: 'SOL' };
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
let PRODUCT, VERSION, ORIGINAL;

const statusOf = (id) => db.get('SELECT * FROM product_item WHERE id = ?', [id]);

// ما يلزم كلَّ حالةٍ من حقولٍ كي تُقبل — والبقيةُ بلا شروط.
const optsFor = (to) => (
  to === 'DECLINED' ? { reason: 'تكرارٌ لسلوكٍ مقصود' }
    : to === 'RESOLVED' ? { version_id: VERSION }
      : to === 'DUPLICATE' ? { duplicate_of_id: ORIGINAL }
        : to === 'NEEDS_INFO' ? { question: 'في أي شاشة حدث هذا' }
          : {});

async function freshItem(status = 'NEW') {
  const it = await intake.createManual(ctx(ADMIN), PRODUCT, {
    type: 'bug', title: 'شاشةٌ لا تفتح', description: 'وصفٌ كافٍ', sector_id: 'SOL',
    where_text: 'شاشة المهام', reporter_name: 'موظفٌ ما', urgency: 'delays',
  });
  if (status !== 'NEW') {
    await db.update('product_item', it.id, { status, status_before_info: null, decline_reason: null, duplicate_of_id: null, resolved_version_id: null });
  }
  return it.id;
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  items = await import('../../src/modules/products/items.js');
  intake = await import('../../src/modules/products/intake.js');
  products = await import('../../src/modules/products/products.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', email: 'admin@evc.sa', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_dev', username: 'dev', name_ar: 'مطوِّر', email: 'dev@evc.sa', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });

  const p = await products.createProduct(ctx(ADMIN), {
    key: 'sanad', name_ar: 'سند', kind: 'internal', item_prefix: 'SND', manager_user_id: 'u_admin',
  });
  PRODUCT = p.id;
  await products.addMember(ctx(ADMIN), PRODUCT, { user_id: 'u_dev', role: 'developer' });
  const v = await products.createVersion(ctx(ADMIN), PRODUCT, { label: 'v5.83', released_on: '2026-09-10' });
  VERSION = v.id;
  ORIGINAL = await freshItem('NEW');
});

after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('كل حافةٍ مسموحة في الجدول تُقبل، وكل ما سواها يُردّ', async () => {
  const ALL = Object.keys(items.TRANSITIONS);
  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;                       // الكتابة بالقيمة نفسها لا انتقال
      const itemId = await freshItem(from);
      const legal = items.TRANSITIONS[from].includes(to);
      if (legal) {
        const out = await items.setStatus(ctx(ADMIN), itemId, to, optsFor(to));
        assert.equal(out.status, to, `يجب أن تُقبل ${from} ← ${to}`);
      } else {
        await assert.rejects(
          () => items.setStatus(ctx(ADMIN), itemId, to, optsFor(to)),
          (e) => e.status === 400,
          `يجب أن تُردّ ${from} ← ${to}`);
        assert.equal((await statusOf(itemId)).status, from, `الحال لا تتغيّر عند الردّ ${from} ← ${to}`);
      }
    }
  }
});

test('حالةٌ غير معروفة تُردّ ولا تُكتب', async () => {
  const itemId = await freshItem('NEW');
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'ARCHIVED'), (e) => e.status === 400);
  assert.equal((await statusOf(itemId)).status, 'NEW');
});

test('الرفض بلا سبب يُردّ — والسبب يُحفظ حين يُكتب', async () => {
  const itemId = await freshItem('TRIAGED');
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'DECLINED'), (e) => e.status === 400);
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'DECLINED', { reason: '   ' }), (e) => e.status === 400);
  await items.setStatus(ctx(ADMIN), itemId, 'DECLINED', { reason: 'خارج نطاق المنتج' });
  const row = await statusOf(itemId);
  assert.equal(row.status, 'DECLINED');
  assert.equal(row.decline_reason, 'خارج نطاق المنتج');
  assert.ok(row.declined_at);
});

test('«تم الحل» تطلب وسم إصدارٍ من إصدارات هذا المنتج وحده', async () => {
  const itemId = await freshItem('APPROVED');
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'RESOLVED'), (e) => e.status === 400);
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'RESOLVED', { version_id: 'pvr_nope' }), (e) => e.status === 400);
  await items.setStatus(ctx(ADMIN), itemId, 'RESOLVED', { version_id: VERSION });
  const row = await statusOf(itemId);
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.resolved_version_id, VERSION);
  assert.ok(row.resolved_at);
});

test('«مكرر» تطلب أصلاً قائماً من المنتج نفسه، ولا يكون البند مكرراً عن نفسه', async () => {
  const itemId = await freshItem('NEW');
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'DUPLICATE'), (e) => e.status === 400);
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'DUPLICATE', { duplicate_of_id: itemId }), (e) => e.status === 400);
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'DUPLICATE', { duplicate_of_id: 'pit_nope' }), (e) => e.status === 400);
  await items.setStatus(ctx(ADMIN), itemId, 'DUPLICATE', { duplicate_of_id: ORIGINAL });
  assert.equal((await statusOf(itemId)).duplicate_of_id, ORIGINAL);
});

test('«بحاجة لتوضيح» تطلب سؤالاً وتحفظ ما كانت عليه فتعود إليه', async () => {
  const itemId = await freshItem('TRIAGED');
  await assert.rejects(() => items.setStatus(ctx(ADMIN), itemId, 'NEEDS_INFO'), (e) => e.status === 400);
  await items.setStatus(ctx(ADMIN), itemId, 'NEEDS_INFO', { question: 'في أي شاشة حدث هذا' });
  const asked = await statusOf(itemId);
  assert.equal(asked.status, 'NEEDS_INFO');
  assert.equal(asked.status_before_info, 'TRIAGED');
  // والسؤالُ يُكتب تعليقاً يقرؤه صاحب البلاغ لا تعليقاً داخلياً
  const comments = await db.all('SELECT * FROM product_item_comment WHERE item_id = ?', [itemId]);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].visibility, 'reporter');
  await items.setStatus(ctx(ADMIN), itemId, 'TRIAGED');
  const back = await statusOf(itemId);
  assert.equal(back.status, 'TRIAGED');
  assert.equal(back.status_before_info, null);
});

test('الاعتماد والرفض لمديري المنتج — والمطوِّر يُردّ بغير «غير موجود»', async () => {
  const itemId = await freshItem('AWAITING_APPROVAL');
  await assert.rejects(
    () => items.setStatus(ctx(DEV), itemId, 'APPROVED'),
    (e) => e.status === 403 && e.message === 'هذا القرار لمديري المنتج');
  await assert.rejects(
    () => items.setStatus(ctx(DEV), itemId, 'DECLINED', { reason: 'لا' }),
    (e) => e.status === 403);
  // وما دون القرارين يملكه المطوِّر
  await items.setStatus(ctx(DEV), itemId, 'NEEDS_INFO', { question: 'وضِّح' });
  assert.equal((await statusOf(itemId)).status, 'NEEDS_INFO');
});

test('من ليس في فريق المنتج لا يرى البند أصلاً — «غير موجود» لا «ممنوع»', async () => {
  await db.insert('app_user', { id: 'u_out', username: 'out', name_ar: 'من خارج الفريق', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  const stranger = { id: 'u_out', username: 'out', name_ar: 'من خارج الفريق', role_id: 'employee', scope: 'own', sector_id: 'SOL' };
  const itemId = await freshItem('NEW');
  await assert.rejects(() => items.getItem(stranger, itemId), (e) => e.status === 404);
  await assert.rejects(() => items.setStatus(ctx(stranger), itemId, 'TRIAGED'), (e) => e.status === 404);
});
