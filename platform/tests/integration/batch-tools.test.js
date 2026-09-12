// ── الدفعة الواحدة: عدة تغييرات بمعاينةٍ واحدة ورمزٍ واحد وضغطةٍ واحدة ──────────────────────
// ما تحرسه:
//   ١) المعاينة تنادي معاينةَ كل عملية بأداتها، وتعرض صفوفها مرقَّمة تحت رمزٍ واحد، وتمدّ مهلة الفروع.
//   ٢) التنفيذ كله أو لا شيء: فشلُ عمليةٍ (سجلٌّ تحرّك بعد المعاينة) يُرجع ما قبلها ويسمّيها.
//   ٣) الردود قبل الحفظ: أقل من عمليتين، دفعة داخل دفعة، أداة غير مقبولة، سجلٌّ في عمليتين،
//      وعمليةٌ لا يملكها صاحبها تُسقط الدفعة قبل أن تُحفظ مظلّة.
//   ٤) ومن نافذة المساعد تقف الدفعة لبطاقةٍ واحدة، وضغطةٌ واحدة تنفّذها كلها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-batch-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, all, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { runTool, registerTools } = await import('../../src/modules/ai/team-tools.js');
const { TASK_TOOLS } = await import('../../src/modules/ai/tasks-tools.js');
const { CRM_TOOLS } = await import('../../src/modules/ai/crm-tools.js');
const { CONFIRM_TOOLS } = await import('../../src/modules/ai/confirm-tools.js');
const { BATCH_TOOLS } = await import('../../src/modules/ai/batch-tools.js');
const { updateTask } = await import('../../src/modules/pmo/tasks.js');
registerTools(TASK_TOOLS); registerTools(CRM_TOOLS); registerTools(CONFIRM_TOOLS); registerTools(BATCH_TOOLS);

const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString();
const T = daysAgo(1);
const LEAD = { id: 'u_lead', username: 'u_lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const OTHER = { id: 'u_other', username: 'u_other', name_ar: 'موظف', role_id: 'employee', sector_id: 'SOL', scope: 'own', projectIds: new Set(), teamIds: new Set() };
const ctx = { user: LEAD, ip: '127.0.0.1' };
const asOther = { user: OTHER, ip: '127.0.0.1' };
const viaAssistant = { user: LEAD, ip: '127.0.0.1', mcpClient: { id: 'cl_1', name_ar: 'مساعد التجربة' } };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  for (const u of [LEAD, OTHER]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, is_won: 0, is_lost: 0, sort_order: 1, created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'فرصة الدفعة', client_id: 'C1', sector_id: 'SOL', owner_user_id: LEAD.id,
    stage_id: 'LEAD', win_pct: 10, value_halalas: 100000, year: 2026, stage_changed_at: T, created_at: T, created_by: LEAD.id });
  const task = (id, extra = {}) => insert('task', { id, title: 'مهمة ' + id, assignee_user_id: LEAD.id, created_by: LEAD.id, sector_id: 'SOL',
    status: 'TODO', priority: 'P2', work_kind: 'internal', approved_by: LEAD.id, created_at: T, ...extra });
  await task('t1'); await task('t2'); await task('t3');
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const ops3 = () => [
  { tool: 'sanad_preview_task_update', input: { taskId: 't1', nextStep: 'أ' } },
  { tool: 'sanad_preview_task_update', input: { taskId: 't2', nextStep: 'ب' } },
  { tool: 'sanad_preview_opportunity_update', input: { opportunityId: 'O1', nextAction: 'زيارة' } },
];

test('معاينةٌ واحدة لثلاث عمليات: صفوفٌ مرقَّمة، ورموزٌ فرعية ممدودة، ثم تنفيذٌ يكتبها كلها', async () => {
  const pv = await runTool(ctx, 'sanad_preview_batch', { operations: ops3() });
  assert.equal(pv.count, 3);
  assert.deepEqual(pv.operations.map((o) => o.n), [1, 2, 3]);
  assert.ok(pv.display.some((d) => d.field_ar.startsWith('١.')) && pv.display.some((d) => d.field_ar.startsWith('٣ · ')), 'الصفوف لا تحمل رقم عمليتها');
  assert.match(pv.summary, /دفعة من 3 تغييرات/);
  // المعاينات الفرعية مُدّت مهلتها إلى ما بعد ربع الساعة
  for (const o of pv.operations) {
    const row = await get('SELECT expires_at, outcome FROM ai_activity_log WHERE id = ?', [o.token]);
    assert.equal(row.outcome, 'preview');
    assert.ok(new Date(row.expires_at).getTime() > Date.now() + 30 * 60000, 'مهلة الفرع لم تُمدّ');
  }
  const out = await runTool(ctx, 'sanad_apply_batch', { previewToken: pv.previewToken });
  assert.equal(out.applied, true); assert.equal(out.count, 3);
  assert.deepEqual(out.results.map((r) => [r.n, r.applied]), [[1, true], [2, true], [3, true]]);
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', ['t1'])).next_step, 'أ');
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', ['t2'])).next_step, 'ب');
  assert.equal((await get('SELECT next_action FROM opportunity WHERE id = ?', ['O1'])).next_action, 'زيارة');
  await assert.rejects(() => runTool(ctx, 'sanad_apply_batch', { previewToken: pv.previewToken }), /طُبِّقت من قبل/, 'رمز الدفعة يُستهلك مرةً واحدة');
});

test('كلٌّ أو لا شيء: سجلٌّ تحرّك بعد المعاينة يُسقط الدفعة ويُرجع ما قبله ويسمّي العملية', async () => {
  const pv = await runTool(ctx, 'sanad_preview_batch', { operations: [
    { tool: 'sanad_preview_task_update', input: { taskId: 't1', nextStep: 'x' } },
    { tool: 'sanad_preview_task_update', input: { taskId: 't2', nextStep: 'y' } },
  ] });
  await updateTask(ctx, 't2', { next_step: 'تحرّكت من الشاشة' });          // بصمة الثانية تبطل
  await assert.rejects(() => runTool(ctx, 'sanad_apply_batch', { previewToken: pv.previewToken }), /العملية ٢/);
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', ['t1'])).next_step, 'أ', 'الأولى كُتبت رغم سقوط الدفعة');
  const umbrella = await get('SELECT applied, outcome FROM ai_activity_log WHERE id = ?', [pv.previewToken]);
  assert.equal(Number(umbrella.applied), 0, 'المظلّة احترقت بلا كتابة');
});

test('الردود قبل الحفظ: العدد، والتداخل، والأداة، والسجل المكرَّر، والصلاحية', async () => {
  const before = Number((await get("SELECT COUNT(*) n FROM ai_activity_log WHERE intent = 'sanad_preview_batch' AND preview_json IS NOT NULL")).n);
  await assert.rejects(() => runTool(ctx, 'sanad_preview_batch', { operations: [ops3()[0]] }), /عمليتان فأكثر/);
  await assert.rejects(() => runTool(ctx, 'sanad_preview_batch', { operations: [ops3()[0], { tool: 'sanad_preview_batch', input: {} }] }), /داخل دفعة/);
  await assert.rejects(() => runTool(ctx, 'sanad_preview_batch', { operations: [ops3()[0], { tool: 'sanad_list_tasks', input: {} }] }), /ليست أداةَ معاينة/);
  await assert.rejects(() => runTool(ctx, 'sanad_preview_batch', { operations: [
    { tool: 'sanad_preview_task_update', input: { taskId: 't3', nextStep: 'أ' } },
    { tool: 'sanad_preview_task_update', input: { taskId: 't3', nextStep: 'ب' } },
  ] }), /السجل نفسه في العمليتين ١ و٢/);
  // عمليةٌ لا يملكها صاحب الطلب تُردّ بردّ أداتها هي — ولا تُحفظ مظلّة
  await assert.rejects(() => runTool(asOther, 'sanad_preview_batch', { operations: [
    { tool: 'sanad_preview_task_update', input: { taskId: 't1', nextStep: 'أ' } },
    { tool: 'sanad_preview_task_update', input: { taskId: 't2', nextStep: 'ب' } },
  ] }), (e) => { assert.equal(e.status, 404); return true; });
  const afterN = Number((await get("SELECT COUNT(*) n FROM ai_activity_log WHERE intent = 'sanad_preview_batch' AND preview_json IS NOT NULL")).n);
  assert.equal(afterN, before, 'حُفظت مظلّةٌ لدفعةٍ مردودة');
});

test('ومن نافذة المساعد: بطاقةٌ واحدة، وضغطةٌ واحدة تنفّذ العمليات كلها', async () => {
  const pv = await runTool(viaAssistant, 'sanad_preview_batch', { operations: [
    { tool: 'sanad_preview_task_update', input: { taskId: 't1', nextStep: 'من البطاقة' } },
    { tool: 'sanad_preview_task_update', input: { taskId: 't3', nextStep: 'من البطاقة أيضاً' } },
  ] });
  const held = await runTool(viaAssistant, 'sanad_apply_batch', { previewToken: pv.previewToken });
  assert.equal(held.awaiting_confirmation, true);
  assert.ok((held.display || []).some((d) => d.field_ar.startsWith('٢ · ')), 'البطاقة لا تعرض صفوف العملية الثانية');
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', ['t1'])).next_step, 'أ', 'كُتب قبل الضغطة');
  const done = await runTool(viaAssistant, 'sanad_confirm_change', { changeId: held.change_id });
  assert.equal(done.executed, true);
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', ['t1'])).next_step, 'من البطاقة');
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', ['t3'])).next_step, 'من البطاقة أيضاً');
  assert.equal((await all("SELECT id FROM audit_log WHERE resource = 'ai_batch'")).length, 2, 'أثرُ الدفعة لا يُكتب');
});
