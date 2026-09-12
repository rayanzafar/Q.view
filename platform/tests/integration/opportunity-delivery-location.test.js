// «في الفرص، إذا كانت مؤهلة أو ليدز، برضو حطّ مكان نكتب فيه موقع تسليمها» — بلسان المالك.
//
// وأخصّ ما يُفحص هنا ليس وجود الحقل بل **سلوكه على الحدود**، لأن هذا النوع من الحقول يُضاف
// فيبدو عاملاً ثم ينكشف بعد شهر:
//   • يُكتب ويُقرأ في المرحلتين اللتين ذُكرتا بالاسم — وفي غيرهما أيضاً (حقلٌ يختفي بتغيّر
//     المرحلة يُخفي ما كُتب فيه بعد أن اتُّخذ عليه قرار).
//   • **يُمسَح فعلاً**: الفراغ يُخزَّن فراغاً لا نصّاً فارغاً، وإلا صار «لم يُحدَّد» شكلين
//     مختلفين في القاعدة يُقرآن على شاشتين بشكلين.
//   • **لا يُمَسّ إن لم يُرسَل**: تعديلُ المبلغ وحده لا يجوز أن يمحو موقعاً كتبه غيرك.
//   • يُقصّ عند حدّه بدل أن يُرفَض الحفظ كله.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-loc-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
const CTX = { user: ADMIN, ip: '1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  P = await import('../../src/web/pages.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('stage', { id: 'QUALIFIED', name_ar: 'مؤهلة', is_won: 0, is_lost: 0, sort_order: 2 });
  await db.insert('stage', { id: 'WON', name_ar: 'فائزة', is_won: 1, is_lost: 0, sort_order: 9 });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const mk = (over = {}) => opps.createOpportunity(CTX, { title_ar: 'فرصة', sector_id: 'SOL', value_sar: 1000, ...over });

test('الموقع يُكتب مع الفرصة من أول لحظة — في «ليدز» كما في «مؤهلة»', async () => {
  const lead = await mk({ stage_id: 'LEAD', delivery_location: 'منصة اعتماد' });
  assert.equal(lead.delivery_location, 'منصة اعتماد');
  const qual = await mk({ stage_id: 'QUALIFIED', delivery_location: 'الرياض — مقرّ الجهة' });
  assert.equal(qual.delivery_location, 'الرياض — مقرّ الجهة');
});

test('ويُعدَّل بعد الإنشاء — فمن استوردت فرصه قبل الحقل يكتبه اليوم', async () => {
  const o = await mk({ stage_id: 'LEAD' });
  assert.equal(o.delivery_location, null, 'قيمةٌ افتراضية كُتبت نيابةً عن أحد');
  const after = await opps.updateOpportunity(CTX, o.id, { delivery_location: '  جدة — عن بُعد جزئياً  ' });
  assert.equal(after.delivery_location, 'جدة — عن بُعد جزئياً', 'الفراغ الطرفي لم يُنظَّف');
});

test('والمسح مسحٌ حقيقي — «لم يُحدَّد» شكلٌ واحد في القاعدة لا شكلان', async () => {
  const o = await mk({ delivery_location: 'الدمام' });
  await opps.updateOpportunity(CTX, o.id, { delivery_location: '   ' });
  const row = await db.get('SELECT delivery_location FROM opportunity WHERE id = ?', [o.id]);
  assert.equal(row.delivery_location, null, 'نصٌّ فارغ خُزِّن بدل الفراغ');
});

test('ولا يُمَسّ حين لا يُرسَل — تعديل المبلغ لا يمحو موقعاً كتبه غيرك', async () => {
  const o = await mk({ delivery_location: 'مكة المكرمة' });
  const after = await opps.updateOpportunity(CTX, o.id, { value_sar: 5000 });
  assert.equal(after.delivery_location, 'مكة المكرمة', 'حقلٌ لم يُرسَل أصلاً وقد مُحي');
});

test('ويُقصّ عند حدّه بدل أن يسقط الحفظ كله', async () => {
  const o = await mk({ delivery_location: 'م'.repeat(400) });
  assert.equal(o.delivery_location.length, opps.DELIVERY_LOCATION_MAX);
});

test('ويبقى بعد حسم الفرصة — الموقع سؤالُ تنفيذٍ لا سؤال مرحلة', async () => {
  const o = await mk({ stage_id: 'LEAD', delivery_location: 'أبها' });
  await opps.moveStage(CTX, o.id, 'WON');   // المسار الحقيقي لتغيير المرحلة، لا حقلٌ في التعديل
  const row = await db.get('SELECT stage_id, delivery_location FROM opportunity WHERE id = ?', [o.id]);
  assert.equal(row.stage_id, 'WON', 'المرحلة لم تتغيّر أصلاً — الفحص لا يقيس شيئاً');
  assert.equal(row.delivery_location, 'أبها');
});

test('وصفحة الفرصة فيها خانةٌ تُكتب وسطرٌ يُقرأ', async () => {
  const o = await mk({ delivery_location: 'منصة اعتماد' });
  const html = await P.opportunityDetailPage(ADMIN, o.id, {});
  assert.ok(html.includes('موقع التسليم'), 'لا خانة لموقع التسليم');
  assert.ok(html.includes('oc-location'), 'الخانة تُعرض ولا تُكتب — لا حقل إدخال');
  assert.ok(html.includes('منصة اعتماد'), 'ما كُتب لا يظهر');
});

test('وفرصةٌ بلا موقع تقول «لم يُحدَّد» لا فراغاً يُقرأ عطلاً', async () => {
  const o = await mk({});
  const html = await P.opportunityDetailPage(ADMIN, o.id, {});
  assert.ok(html.includes('لم يُحدَّد'), 'الفراغ يُعرض بلا تفسير');
  assert.ok(!/undefined|null|NaN/.test(html.split('موقع التسليم')[1].slice(0, 200)), 'تسرَّب فراغ تقني');
});
