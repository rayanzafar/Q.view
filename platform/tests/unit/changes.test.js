// وحدة: changesSince — «ما تغيّر» يعيد سجلات حقيقية مؤرّخة فقط، داخل النافذة، داخل القطاع،
// ومع إسقاط الأنواع المالية لمن لا يملك قراءتها. قاعدة مصغّرة محكومة بالكامل (بلا ساعة حائط).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-chg-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { changesSince, sinceForWindow } = await import('../../src/core/reports/changes.js');

const T = '2026-01-10T08:00:00.000Z';
const SINCE = '2026-07-01';       // النافذة تحت الاختبار
const IN = '2026-07-05T10:00:00.000Z';   // داخل النافذة
const OUT = '2026-06-20T10:00:00.000Z';  // قبلها

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, is_won: 1, is_lost: 0 });
  await insert('stage', { id: 'LOST', name_ar: 'مفقودة', default_win_pct: 0, sort_order: 6, is_won: 0, is_lost: 1 });
  await insert('client', { id: 'C1', name_ar: 'عميل أ', created_at: T });
  await insert('client', { id: 'C2', name_ar: 'عميل ب', created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'فرصة قطاع أ', sector_id: 'S1', client_id: 'C1', stage_id: 'WON', value_halalas: 5_000_000, year: 2026, created_at: T });
  await insert('opportunity', { id: 'O2', title_ar: 'فرصة قطاع ب', sector_id: 'S2', client_id: 'C2', stage_id: 'LEAD', value_halalas: 3_000_000, year: 2026, created_at: T });
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', client_id: 'C1', status: 'IN_PROGRESS', created_at: T });

  // حركات مراحل: داخل النافذة (فوز)، قبلها، وفي قطاع آخر
  await insert('opportunity_stage_history', { id: 'H-in', opportunity_id: 'O1', from_stage_id: 'LEAD', to_stage_id: 'WON', changed_at: IN });
  await insert('opportunity_stage_history', { id: 'H-old', opportunity_id: 'O1', from_stage_id: 'LEAD', to_stage_id: 'LOST', changed_at: OUT });
  await insert('opportunity_stage_history', { id: 'H-other', opportunity_id: 'O2', from_stage_id: null, to_stage_id: 'LEAD', changed_at: IN });

  // فواتير: صادرة داخل النافذة (قطاع مباشر)، بلا قطاع لكن مشروعها في S1 (مسار COALESCE)،
  // مسودة داخل النافذة (تُستبعد)، قديمة، وقطاع آخر
  await insert('invoice', { id: 'I-in', code: 'INV-1', sector_id: 'S1', client_id: 'C1', amount_halalas: 1_000_000, status: 'ISSUED', issue_date: '2026-07-03', created_at: T });
  await insert('invoice', { id: 'I-proj', code: 'INV-2', sector_id: null, project_id: 'P1', amount_halalas: 700_000, status: 'ISSUED', issue_date: '2026-07-04', created_at: T });
  await insert('invoice', { id: 'I-draft', code: 'INV-3', sector_id: 'S1', amount_halalas: 400_000, status: 'DRAFT', issue_date: '2026-07-05', created_at: T });
  await insert('invoice', { id: 'I-old', code: 'INV-4', sector_id: 'S1', amount_halalas: 900_000, status: 'ISSUED', issue_date: '2026-06-01', created_at: T });
  await insert('invoice', { id: 'I-s2', code: 'INV-5', sector_id: 'S2', amount_halalas: 800_000, status: 'ISSUED', issue_date: '2026-07-03', created_at: T });

  // تحصيل: داخل النافذة على فاتورة S1، وواحد قديم
  await insert('collection', { id: 'K-in', invoice_id: 'I-old', amount_halalas: 500_000, collected_at: '2026-07-06', created_at: T });
  await insert('collection', { id: 'K-old', invoice_id: 'I-old', amount_halalas: 100_000, collected_at: '2026-06-10', created_at: T });

  // تواصل: بقطاع صريح S1، وبلا قطاع لعميل له بصمة في S1، وبقطاع آخر صريح
  await insert('crm_activity', { id: 'A-sec', kind: 'call', at: IN, sector_id: 'S1', client_id: 'C1', title: 'مكالمة متابعة', source: 'app', created_at: T });
  await insert('crm_activity', { id: 'A-fp', kind: 'meeting', at: IN, sector_id: null, client_id: 'C1', title: 'اجتماع تمهيدي', source: 'app', created_at: T });
  await insert('crm_activity', { id: 'A-s2', kind: 'note', at: IN, sector_id: 'S2', client_id: 'C2', title: 'ملاحظة قطاع ب', source: 'app', created_at: T });
  await insert('crm_activity', { id: 'A-old', kind: 'call', at: OUT, sector_id: 'S1', client_id: 'C1', title: 'مكالمة قديمة', source: 'app', created_at: T });

  // سجل النظام: إنشاء داخل النافذة (فرصة S1)، إنشاء قطاع آخر، وتعديل (يُستبعد لأن action≠create)
  await insert('audit_log', { id: 'AU-in', at: IN, username: 'demo.bd', action: 'create', resource: 'opportunity', resource_id: 'O1', sector_id: 'S1' });
  await insert('audit_log', { id: 'AU-s2', at: IN, username: 'demo.bd', action: 'create', resource: 'opportunity', resource_id: 'O2', sector_id: 'S2' });
  await insert('audit_log', { id: 'AU-upd', at: IN, username: 'demo.bd', action: 'update', resource: 'opportunity', resource_id: 'O1', sector_id: 'S1' });
  await insert('audit_log', { id: 'AU-old', at: OUT, username: 'demo.bd', action: 'create', resource: 'project', resource_id: 'P1', sector_id: 'S1' });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const LEAD = { id: 'u-lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' };
const VIEWER = { id: 'u-view', role_id: 'viewer', sector_id: 'S1', scope: 'sector' };

test('sinceForWindow: نوافذ ثابتة بتوقيت عالمي — يوم/أسبوع/شهر/ربع، والافتراضي أسبوع', () => {
  const today = new Date('2026-07-21T13:45:00Z');
  assert.equal(sinceForWindow('day', today), '2026-07-20');
  assert.equal(sinceForWindow('week', today), '2026-07-14');
  assert.equal(sinceForWindow('month', today), '2026-06-21');
  assert.equal(sinceForWindow('quarter', today), '2026-04-21');
  assert.equal(sinceForWindow('غير معروف', today), '2026-07-14');
});

test('changesSince: سجلات حقيقية مؤرّخة فقط، داخل النافذة، بلا تسرب بين القطاعات', async () => {
  const r = await changesSince(LEAD, 'S1', SINCE);
  assert.deepEqual(r.counts, { stage: 1, invoice: 2, collection: 1, activity: 2, created: 1 });
  assert.equal(r.items.length, 7);
  // كل عنصر يحمل تاريخاً حقيقياً ≥ بداية النافذة (لا اختلاق ولا تسرب قديم)
  for (const it of r.items) assert.ok(String(it.at).slice(0, 10) >= SINCE, `عنصر قبل النافذة: ${it.kind} ${it.at}`);
  // مرتّب تنازلياً بالتاريخ
  const ats = r.items.map((i) => String(i.at));
  assert.deepEqual(ats, [...ats].sort().reverse());
  // حركة الفوز معلّمة، وبقيمة الفرصة ورابط تفصيلها
  const won = r.items.find((i) => i.kind === 'stage');
  assert.equal(won.won, true);
  assert.ok(won.title.includes('فوز بفرصة'));
  assert.equal(won.amount_halalas, 5_000_000);
  assert.equal(won.href, '/app/opportunity/O1');
  // مسار COALESCE: فاتورة بلا قطاع لكن مشروعها في S1 حاضرة، والمسودة والقطاع الآخر غائبان
  // الرمز حقلٌ مستقل منذ إصلاح ظهور وسم <bdi> حرفياً على الشاشة — العنوان نصّ عربي خالص.
  const invCodes = r.items.filter((i) => i.kind === 'invoice').map((i) => i.code || '');
  assert.ok(invCodes.some((t) => t.includes('INV-2')), 'فاتورة المشروع (COALESCE) مفقودة');
  assert.ok(!invCodes.some((t) => t.includes('INV-3') || t.includes('INV-5')), 'مسودة أو فاتورة قطاع آخر تسرّبت');
  // التواصل: قطاع صريح + بصمة العميل، دون نشاط القطاع الآخر
  const acts = r.items.filter((i) => i.kind === 'activity').map((i) => i.title);
  assert.deepEqual(acts.sort(), ['اجتماع تمهيدي', 'مكالمة متابعة']);
  // سجل النظام: إنشاء S1 فقط، بعنوان مورده واسمه وعلامة المصدر
  const created = r.items.find((i) => i.kind === 'created');
  assert.ok(created.title.includes('فرصة جديدة') && created.title.includes('فرصة قطاع أ'));
  assert.ok(created.sub.includes('من سجل النظام'));
});

test('changesSince: يحترم since — نافذة تشمل السجلات الأقدم تُظهرها', async () => {
  const r = await changesSince(LEAD, 'S1', '2026-06-01');
  assert.deepEqual(r.counts, { stage: 2, invoice: 3, collection: 2, activity: 3, created: 2 });
});

test('changesSince: القطاع الآخر يرى سجلاته هو فقط', async () => {
  const ceo = { id: 'u-ceo', role_id: 'ceo_office', scope: 'company' };
  const r = await changesSince(ceo, 'S2', SINCE);
  assert.deepEqual(r.counts, { stage: 1, invoice: 1, collection: 0, activity: 1, created: 1 });
  assert.ok(r.items.every((i) => !i.title.includes('قطاع أ') && !String(i.code || '').includes('INV-1') && !i.title.includes('INV-1')));
});

test('changesSince: الأنواع المالية (فواتير/تحصيل) صفر لمن لا يقرأ الفواتير', async () => {
  const r = await changesSince(VIEWER, 'S1', SINCE);
  assert.equal(r.counts.invoice, 0);
  assert.equal(r.counts.collection, 0);
  assert.ok(r.items.every((i) => i.kind !== 'invoice' && i.kind !== 'collection'));
  // ويرى بقية الأنواع المسموحة له
  assert.equal(r.counts.stage, 1);
  assert.equal(r.counts.activity, 2);
});
