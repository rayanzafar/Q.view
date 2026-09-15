// ── أدوات السجلّ من المحادثة: الحذف الناعم، والنواقص، والتعبئة دفعةً ────────────────────────
// ما تحرسه:
//   ١) حذفُ مهمةٍ تجريبية يمرّ بمحرّك الحذف: معاينة تسمّي ما يُطوى، ثم حذفٌ ناعم يُستعاد.
//   ٢) الفرصة تطلب سبباً، والموانع (ساعات عمل مسجَّلة) تردّ الحذف بجملتها قبل أي كتابة.
//   ٣) النواقص تُعدّ بتعريفات الشاشة: بلا قيمة، بلا خطوة تالية، متوقفة، ومهام بلا خطوة تالية.
//   ٤) التعبئة دفعةً: معاينة واحدة بقبل/بعد لكل سجل، وما لا يتغيّر يُسقط، والتنفيذ كله أو لا شيء.
//   ٥) ومن نافذة المساعد تقف كلُّ كتابةٍ منها لبطاقة التأكيد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-records-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { runTool, registerTools } = await import('../../src/modules/ai/team-tools.js');
const { RECORD_TOOLS } = await import('../../src/modules/ai/records-tools.js');
const { CONFIRM_TOOLS } = await import('../../src/modules/ai/confirm-tools.js');
registerTools(RECORD_TOOLS); registerTools(CONFIRM_TOOLS);

// الأداة تحكم بتاريخ الرياض الحقيقي كما تفعل لوحة الفرص، فالتواريخ هنا نسبيةٌ إلى اليوم:
// حديثةٌ (يومان) تحت عتبة الترشيح، وقديمةٌ (مئة يوم) فوقها.
const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString();
const T = daysAgo(2);
const OLD = daysAgo(100);
const LEAD = { id: 'u_lead', username: 'u_lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const ctx = { user: LEAD, ip: '127.0.0.1' };
const viaAssistant = { user: LEAD, ip: '127.0.0.1', mcpClient: { id: 'cl_1', name_ar: 'مساعد التجربة' } };
// موظفٌ نطاقُه «خاصتي» في القطاع نفسه: يرى مهامه هو، ولا يملك حذف فرصةٍ ولا تعديلها
const OTHER = { id: 'u_other', username: 'u_other', name_ar: 'موظف', role_id: 'employee', sector_id: 'SOL', scope: 'own', projectIds: new Set(), teamIds: new Set() };
const asOther = { user: OTHER, ip: '127.0.0.1' };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  await insert('app_user', { id: LEAD.id, username: LEAD.username, name_ar: LEAD.name_ar, role_id: LEAD.role_id, sector_id: 'SOL', scope: 'sector', active: 1, created_at: T });
  await insert('app_user', { id: OTHER.id, username: OTHER.username, name_ar: OTHER.name_ar, role_id: OTHER.role_id, sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, is_won: 0, is_lost: 0, sort_order: 1, created_at: T });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, is_won: 1, is_lost: 0, sort_order: 9, created_at: T });
  const opp = (id, extra) => insert('opportunity', { id, title_ar: 'فرصة ' + id, client_id: 'C1', sector_id: 'SOL', owner_user_id: LEAD.id,
    stage_id: 'LEAD', win_pct: 10, value_halalas: 0, year: 2026, stage_changed_at: T, created_at: T, created_by: LEAD.id, ...extra });
  await opp('O_noval');                                                     // بلا قيمة، بلا خطوة، حديثة
  await opp('O_stale', { value_halalas: 500000_00, next_action: 'اتصال', stage_changed_at: OLD, created_at: OLD }); // متوقفة
  await opp('O_full', { value_halalas: 900000_00, next_action: 'عرض' });
  await opp('O_won', { stage_id: 'WON', value_halalas: 0 });                // مغلقة — لا تُعدّ
  await opp('O_del', { value_halalas: 100_00, next_action: 'x' });         // للحذف
  await opp('O_blocked', { value_halalas: 100_00, next_action: 'x' });     // عليها ساعات مسجَّلة
  await insert('time_entry', { id: 'te1', opportunity_id: 'O_blocked', user_id: LEAD.id, work_kind: 'opportunity', hours: 2, entry_date: '2026-02-01', billable: 1, created_at: T });
  const task = (id, extra) => insert('task', { id, title: 'مهمة ' + id, assignee_user_id: LEAD.id, created_by: LEAD.id, sector_id: 'SOL',
    status: 'TODO', priority: 'P2', work_kind: 'internal', approved_by: LEAD.id, created_at: T, ...extra });
  await task('t_nostep');
  await task('t_step', { next_step: 'راجع' });
  await task('t_del', { title: 'd' });
  await task('t_other', { title: 'مهمة الموظف', assignee_user_id: OTHER.id, created_by: OTHER.id });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('حذفُ مهمةٍ تجريبية: معاينة تسمّي السجل، ثم حذفٌ ناعم يُستعاد', async () => {
  const pv = await runTool(ctx, 'sanad_preview_delete', { kind: 'task', id: 't_del' });
  assert.match(pv.summary, /حذف المهمة «d»/);
  assert.ok(pv.display.some((d) => /قابلاً للاستعادة/.test(d.after_ar)));
  const out = await runTool(ctx, 'sanad_delete_record', { previewToken: pv.previewToken });
  assert.equal(out.applied, true);
  assert.ok((await get('SELECT deleted_at FROM task WHERE id = ?', ['t_del'])).deleted_at, 'ناعمٌ لا محو');
  await assert.rejects(() => runTool(ctx, 'sanad_preview_delete', { kind: 'task', id: 't_del' }), /محذوفة سابقاً/);
});

test('الفرصة تطلب سبباً، والموانع تردّ الحذف بجملتها قبل أي كتابة', async () => {
  await assert.rejects(() => runTool(ctx, 'sanad_preview_delete', { kind: 'opportunity', id: 'O_del' }), /يطلب سبباً/);
  await assert.rejects(() => runTool(ctx, 'sanad_preview_delete', { kind: 'opportunity', id: 'O_blocked', reason: 'تكرار' }),
    (e) => { assert.match(e.message, /ساعة عمل مسجَّلة/); return true; });
  assert.equal((await get('SELECT deleted_at FROM opportunity WHERE id = ?', ['O_blocked'])).deleted_at, null);
  const pv = await runTool(ctx, 'sanad_preview_delete', { kind: 'opportunity', id: 'O_del', reason: 'أُدخلت بالخطأ' });
  assert.match(pv.summary, /السبب: أُدخلت بالخطأ/);
  await assert.rejects(() => runTool(ctx, 'sanad_preview_delete', { kind: 'project', id: 'x' }), /نوع السجل/);
});

test('النواقص تُعدّ بتعريفات الشاشة، والمغلق لا يُعدّ', async () => {
  const g = await runTool(ctx, 'sanad_list_data_gaps', {});
  assert.deepEqual(g.gaps.opportunities_no_value.rows.map((r) => r.id).sort(), ['O_noval'], 'بلا قيمة — والمكسوبة خارج العدّ');
  assert.ok(g.gaps.opportunities_no_next_action.rows.map((r) => r.id).includes('O_noval'));
  assert.deepEqual(g.gaps.opportunities_stalled.rows.map((r) => r.id), ['O_stale'], 'تجاوزت عتبة الترشيح');
  assert.deepEqual(g.gaps.tasks_no_next_step.rows.map((r) => r.id).sort(), ['t_nostep']);
  assert.equal(g.counts.opportunities_no_value, 1);
  assert.equal(g.gaps.opportunities_no_value.rows[0].value_sar, null, 'الغائب يُقال غائباً لا صفراً');
  const one = await runTool(ctx, 'sanad_list_data_gaps', { kind: 'tasks_no_next_step' });
  assert.deepEqual(Object.keys(one.gaps), ['tasks_no_next_step']);
});

test('التعبئة دفعةً: قبل/بعد لكل سجل، وما لا يتغيّر يُسقط، والتنفيذ كله أو لا شيء', async () => {
  const pv = await runTool(ctx, 'sanad_preview_bulk_update', {
    kind: 'opportunity', field: 'valueSar',
    items: [{ id: 'O_noval', value: 250000 }, { id: 'O_full', value: 900000 }],   // الثانية بقيمتها نفسها
  });
  assert.equal(pv.count, 1); assert.equal(pv.skipped_unchanged, 1);
  assert.match(pv.changes[0].field_ar, /القيمة — «فرصة O_noval»/);
  assert.equal(pv.changes[0].before_ar, 'غير مُسجَّلة');
  assert.equal(pv.changes[0].after_ar, '250000 ريال');
  const out = await runTool(ctx, 'sanad_apply_bulk_update', { previewToken: pv.previewToken });
  assert.equal(out.count, 1);
  assert.equal((await get('SELECT value_halalas FROM opportunity WHERE id = ?', ['O_noval'])).value_halalas, 250000_00);

  const pt = await runTool(ctx, 'sanad_preview_bulk_update', { kind: 'task', field: 'nextStep', items: [{ id: 't_nostep', value: 'اتصل بالجهة' }] });
  await runTool(ctx, 'sanad_apply_bulk_update', { previewToken: pt.previewToken });
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', ['t_nostep'])).next_step, 'اتصل بالجهة');
  assert.equal((await runTool(ctx, 'sanad_list_data_gaps', { kind: 'tasks_no_next_step' })).counts.tasks_no_next_step, 0, 'وسُدّ النقص');

  await assert.rejects(() => runTool(ctx, 'sanad_preview_bulk_update', { kind: 'opportunity', field: 'nextStep', items: [{ id: 'O_full', value: 'x' }] }), /الحقل/);
  await assert.rejects(() => runTool(ctx, 'sanad_preview_bulk_update', { kind: 'task', field: 'nextStep', items: [{ id: 't_step', value: 'a' }, { id: 't_step', value: 'b' }] }), /مكرَّر/);
});

test('ومن نافذة المساعد تقف كلُّ كتابةٍ منها لبطاقة التأكيد', async () => {
  const pv = await runTool(viaAssistant, 'sanad_preview_bulk_update', { kind: 'opportunity', field: 'nextAction', items: [{ id: 'O_noval', value: 'زيارة' }] });
  const held = await runTool(viaAssistant, 'sanad_apply_bulk_update', { previewToken: pv.previewToken });
  assert.equal(held.awaiting_confirmation, true);
  assert.equal((await get('SELECT next_action FROM opportunity WHERE id = ?', ['O_noval'])).next_action, null);
  const done = await runTool(viaAssistant, 'sanad_confirm_change', { changeId: held.change_id });
  assert.equal(done.executed, true);
  assert.equal((await get('SELECT next_action FROM opportunity WHERE id = ?', ['O_noval'])).next_action, 'زيارة');
  const pd = await runTool(viaAssistant, 'sanad_preview_delete', { kind: 'opportunity', id: 'O_del', reason: 'تكرار' });
  const hd = await runTool(viaAssistant, 'sanad_delete_record', { previewToken: pd.previewToken });
  assert.equal(hd.awaiting_confirmation, true);
  assert.equal((await get('SELECT deleted_at FROM opportunity WHERE id = ?', ['O_del'])).deleted_at, null, 'لم يُحذف بنداء الأداة');
});

test('المعاينة لا تقرأ لمن لا يملك: لا اسم ولا قيمة في الردّ قبل الصلاحية', async () => {
  // موظفٌ نطاقُه «خاصتي» يطلب معاينة حذف فرصة القطاع: يُردّ بلا اسمها ولا ما يُطوى معها
  await assert.rejects(() => runTool(asOther, 'sanad_preview_delete', { kind: 'opportunity', id: 'O_full', reason: 'x' }),
    (e) => { assert.equal(e.status, 403); assert.doesNotMatch(e.message, /فرصة O_full/); return true; });
  // ولا تعبئة دفعةً على فرصةٍ لا يملك تعديلها: لا «قبل» يُقرأ ولا عنوان
  await assert.rejects(() => runTool(asOther, 'sanad_preview_bulk_update', { kind: 'opportunity', field: 'valueSar', items: [{ id: 'O_full', value: 1 }] }),
    (e) => { assert.equal(e.status, 403); assert.doesNotMatch(e.message, /900000|فرصة O_full/); return true; });
  // ومهمةُ غيره «غير موجودة» له — لا «خارج نطاقك»
  await assert.rejects(() => runTool(asOther, 'sanad_preview_bulk_update', { kind: 'task', field: 'nextStep', items: [{ id: 't_step', value: 'a' }] }),
    (e) => { assert.equal(e.status, 404); assert.doesNotMatch(e.message, /مهمة t_step/); return true; });
  await assert.rejects(() => runTool(asOther, 'sanad_preview_delete', { kind: 'task', id: 't_step' }), (e) => { assert.equal(e.status, 403); return true; });
  // أما مهمته هو فيحذفها ويعبّئها: الملكية تفتح الباب كما على الشاشة
  const pv = await runTool(asOther, 'sanad_preview_delete', { kind: 'task', id: 't_other' });
  assert.match(pv.summary, /حذف المهمة «مهمة الموظف»/);
  const pb = await runTool(asOther, 'sanad_preview_bulk_update', { kind: 'task', field: 'nextStep', items: [{ id: 't_other', value: 'أنجزها' }] });
  assert.equal(pb.count, 1);
  const g = await runTool(asOther, 'sanad_list_data_gaps', { kind: 'tasks_no_next_step' });
  assert.deepEqual(g.gaps.tasks_no_next_step.rows.map((r) => r.id), ['t_other'], 'نواقصه هو وحدها');
});
