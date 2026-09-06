// حواجز الكتابة في المساعد: **الخدمة هي الباب، والمعاينة قفلٌ يُفتح مرة واحدة**.
//
// العطل الأصلي: كان تطبيق تغيير المساعد يكتب في جدول الفرص مباشرةً، فيتخطّى `moveStage` وكل
// قواعدها — سبب التراجع عن الفوز، ورفض التراجع إن نشأ عن الفوز مشروع، وترشيح المحذوف ناعماً،
// ورفض المرحلة المجهولة. وكانت المعاينة في ذاكرة العملية بلا انتهاء ولا مزلاج ولا أثر لمن أكّد.
// هذا الملف يحرس البابين معاً: قواعد الخدمة تُورَث حرفياً، والمعاينة تنتهي وتُستعمل مرة واحدة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ai-writes-'));
process.env.SANAD_DB = join(dir, 't.db');
delete process.env.AI_ENGINE;
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { proposePreview } = await import('../../src/core/ai/assistant.js');
const { applyChange } = await import('../../src/modules/ai/apply.js');
const store = await import('../../src/core/ai/store.js');

const T = '2026-07-01T00:00:00Z';
const USERS = {
  lead: { id: 'u_lead', username: 'lead', role_id: 'sector_lead', scope: 'sector', sector_id: 'S1' },
  bd: { id: 'u_bd', username: 'bd', role_id: 'bd_manager', scope: 'own', sector_id: 'S1' },
  other: { id: 'u_other', username: 'other', role_id: 'sector_lead', scope: 'sector', sector_id: 'S2' },
  emp: { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own', sector_id: 'S1' },
  ext: { id: 'u_ext', username: 'ext', role_id: 'external', scope: 'own', sector_id: null },
};
for (const u of Object.values(USERS)) { u.projectIds = new Set(); u.teamIds = new Set(); }
const ctx = (u) => ({ user: u, ip: '10.0.0.9' });

before(async () => {
  for (const u of Object.values(USERS)) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.username, role_id: u.role_id,
      scope: u.scope, sector_id: u.sector_id, active: 1, created_at: T });
  }
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع أول', active: 1, sort_order: 1, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ثانٍ', active: 1, sort_order: 2, created_at: T });
  for (const [id, ar, pct, ord, won, lost] of [['LEAD', 'ترشيح', 10, 1, 0, 0], ['QUALIFIED', 'مؤهلة', 25, 2, 0, 0],
    ['WON', 'مكسوبة', 100, 3, 1, 0], ['LOST', 'مفقودة', 0, 4, 0, 1]]) {
    await db.insert('stage', { id, name_ar: ar, default_win_pct: pct, sort_order: ord, is_won: won, is_lost: lost });
  }
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة قابلة للنقل', sector_id: 'S1', owner_user_id: 'u_bd',
    stage_id: 'LEAD', value_halalas: 500000, created_at: T });
  await db.insert('opportunity', { id: 'O_WON_PRJ', title_ar: 'فرصة مكسوبة أنتجت مشروعاً', sector_id: 'S1',
    owner_user_id: 'u_bd', stage_id: 'WON', value_halalas: 900000, created_at: T });
  await db.insert('opportunity', { id: 'O_DEL', title_ar: 'فرصة محذوفة', sector_id: 'S1', owner_user_id: 'u_bd',
    stage_id: 'LEAD', value_halalas: 100, created_at: T, deleted_at: T });
  await db.insert('project', { id: 'PRJ_FROM_WIN', name_ar: 'مشروع من فوز', sector_id: 'S1',
    source_opp_id: 'O_WON_PRJ', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  // مخرَجٌ على المشروع = عملٌ قائم. بدونه صار المشروع بذرةً تُطوى مع التراجع (وهو سلوكٌ مقصود
  // بعد أن صار كل فوزٍ يُولّد مشروعاً)، فيفقد هذا الفحص ما بُني ليحرسه.
  await db.insert('deliverable', { id: 'DLV_WIN', project_id: 'PRJ_FROM_WIN', name_ar: 'مخرَج',
    status: 'DRAFT', sector_id: 'S1', created_at: T });
  await db.insert('task', { id: 'TSK1', title: 'مهمة الموظف', sector_id: 'S1', assignee_user_id: 'u_emp',
    status: 'TODO', priority: 'P2', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const preview = (u, type, fields) => proposePreview(ctx(u), { type, fields });

// ── قواعد الخدمة تُورَث حرفياً ────────────────────────────────────────────────
test('التراجع عن فوزٍ أنتج مشروعاً مردود برسالة الخدمة نفسها — لا مسار موازٍ', async () => {
  const linkedBefore = await db.get('SELECT * FROM project WHERE source_opp_id = ?', ['O_WON_PRJ']);
  const p = await preview(USERS.lead, 'opp_stage', { oppId: 'O_WON_PRJ', stage: 'LEAD', note: 'سبب مكتوب' });
  await assert.rejects(() => applyChange(ctx(USERS.lead), p.applyToken),
    (e) => e.status === 400 && /مرتبطة بمشروع[\s\S]*لم يُحذف أي سجل/.test(e.message));
  assert.equal((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['O_WON_PRJ'])).stage_id, 'WON');
  assert.deepEqual(await db.get('SELECT * FROM project WHERE source_opp_id = ?', ['O_WON_PRJ']), linkedBefore);
});

test('المرحلة المجهولة تُرَدّ وقت المعاينة — لا تُكتب في الصف كما وصلت', async () => {
  await assert.rejects(() => preview(USERS.lead, 'opp_stage', { oppId: 'O1', stage: 'NOT_A_STAGE' }),
    (e) => e.status === 400 && /مرحلة غير معروفة/.test(e.message));
  await assert.rejects(() => preview(USERS.lead, 'opp_stage', { oppId: 'O1', stage: '' }),
    (e) => e.status === 400);
});

test('الفرصة المحذوفة ناعماً غير موجودة للمساعد', async () => {
  await assert.rejects(() => preview(USERS.lead, 'opp_stage', { oppId: 'O_DEL', stage: 'WON' }),
    (e) => e.status === 404);
});

test('النقل الناجح يمرّ بالخدمة: نسبة الفوز وسجل المراحل والتدقيق كلها تُكتب', async () => {
  const p = await preview(USERS.bd, 'opp_stage', { oppId: 'O1', stage: 'QUALIFIED' });
  const out = await applyChange(ctx(USERS.bd), p.applyToken);
  assert.equal(out.applied, true);
  const opp = await db.get('SELECT stage_id, win_pct FROM opportunity WHERE id = ?', ['O1']);
  assert.equal(opp.stage_id, 'QUALIFIED');
  assert.equal(Number(opp.win_pct), 25, 'نسبة الفوز من تعريف المرحلة — وهي مما كان يتخطّاه المسار الموازي');
  const hist = await db.get('SELECT to_stage_id FROM opportunity_stage_history WHERE opportunity_id = ?', ['O1']);
  assert.equal(hist.to_stage_id, 'QUALIFIED');
  const audits = await db.all("SELECT action, resource, detail_json FROM audit_log WHERE resource_id = 'O1'");
  assert.ok(audits.length >= 2, 'سطر من الخدمة وسطر يقول إن المصدر المساعد');
  assert.ok(audits.some((a) => /"via":"ai"/.test(a.detail_json || '')));
});

// ── حدود النطاق على الكتابة ───────────────────────────────────────────────────
test('لا معاينة لفرصة خارج النطاق، ولا لمن لا يملك منح التعديل', async () => {
  await assert.rejects(() => preview(USERS.other, 'opp_stage', { oppId: 'O1', stage: 'WON' }),
    (e) => e.status === 403);
  await assert.rejects(() => preview(USERS.emp, 'opp_stage', { oppId: 'O1', stage: 'WON' }),
    (e) => e.status === 403);
});

test('حساب البوابة الخارجية لا يُنشئ مهمة ولا يعاين إنشاءها', async () => {
  await assert.rejects(() => preview(USERS.ext, 'task_create', { title: 'مهمة من حساب خارجي' }),
    (e) => e.status === 403 && /مدير النظام/.test(e.message));
});

test('المهمة المُنشأة بالمساعد تُسنَد إلى صاحبها هو، ولا تُدفع إلى قائمة غيره', async () => {
  const p = await preview(USERS.emp, 'task_create', { title: 'مهمة صنعها المساعد', priority: 'P1' });
  const out = await applyChange(ctx(USERS.emp), p.applyToken);
  const row = await db.get('SELECT * FROM task WHERE id = ?', [out.resourceId]);
  assert.equal(row.assignee_user_id, USERS.emp.id, 'المُسنَد إليه هو صاحب الطلب دائماً');
  assert.equal(row.sector_id, 'S1', 'والقطاع مثبَّت على قطاعه');
});

test('مهمة شخص آخر لا تُعايَن ولا تُغيَّر حالتها', async () => {
  await assert.rejects(() => preview(USERS.ext, 'task_status', { taskId: 'TSK1', status: 'DONE' }),
    (e) => e.status === 403);
});

// ── دورة حياة المعاينة ────────────────────────────────────────────────────────
test('المزلاج: المعاينة تُستعمل مرة واحدة بالضبط', async () => {
  const p = await preview(USERS.emp, 'task_create', { title: 'مهمة المزلاج' });
  const first = await store.claimPreview(USERS.emp, p.applyToken);
  assert.equal(first.ok, true);
  const second = await store.claimPreview(USERS.emp, p.applyToken);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'applied');
  await assert.rejects(() => applyChange(ctx(USERS.emp), p.applyToken), (e) => /طُبِّقت من قبل/.test(e.message));
});

test('معاينة غيرك لا تُفتح ولا تُقرأ ولو عرفت رمزها', async () => {
  const p = await preview(USERS.emp, 'task_create', { title: 'مهمة خاصة' });
  assert.equal((await store.claimPreview(USERS.lead, p.applyToken)).reason, 'missing');
  assert.equal(await store.readPreview(USERS.lead, p.applyToken), null);
  await assert.rejects(() => applyChange(ctx(USERS.lead), p.applyToken), (e) => /لا أجد هذه المعاينة/.test(e.message));
  assert.equal(Number((await db.get('SELECT applied FROM ai_activity_log WHERE id = ?', [p.applyToken])).applied), 0,
    'ومحاولة الغريب لا تحرق معاينة صاحبها');
});

test('المعاينة المنتهية لا تُطبَّق، والرسالة تقول لماذا وماذا يفعل', async () => {
  const p = await preview(USERS.emp, 'task_create', { title: 'مهمة منتهية الصلاحية' });
  await db.run('UPDATE ai_activity_log SET expires_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', p.applyToken]);
  await assert.rejects(() => applyChange(ctx(USERS.emp), p.applyToken),
    (e) => e.status === 400 && /انتهت صلاحية المعاينة/.test(e.message) && /اطلبها من جديد/.test(e.message));
});

test('رمز مختلق أو فارغ: رفض واضح بلا انهيار', async () => {
  await assert.rejects(() => applyChange(ctx(USERS.emp), 'aiprev_madeup'), (e) => e.status === 400);
  await assert.rejects(() => applyChange(ctx(USERS.emp), null), (e) => e.status === 400 && /اطلب المعاينة أولاً/.test(e.message));
});

test('كل معاينة تُكتب في السجل بصاحبها ومهلتها، ومن أكّدها يُكتب عند التطبيق', async () => {
  const p = await preview(USERS.emp, 'task_create', { title: 'مهمة للسجل' });
  const before = await db.get('SELECT user_id, expires_at, applied, approved_by, outcome FROM ai_activity_log WHERE id = ?', [p.applyToken]);
  assert.equal(before.user_id, USERS.emp.id);
  assert.ok(before.expires_at > new Date().toISOString(), 'مهلة مستقبلية');
  assert.equal(Number(before.applied), 0);
  assert.equal(before.approved_by, null);
  await applyChange(ctx(USERS.emp), p.applyToken);
  const after2 = await db.get('SELECT applied, applied_at, approved_by, outcome FROM ai_activity_log WHERE id = ?', [p.applyToken]);
  assert.equal(Number(after2.applied), 1);
  assert.equal(after2.approved_by, USERS.emp.id);
  assert.ok(after2.applied_at);
  assert.equal(after2.outcome, 'applied');
});
