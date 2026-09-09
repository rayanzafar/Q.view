// ── أدوات الفرص والمشاريع والاعتمادات والعملاء ───────────────────────────────────────────────
// ما تحرسه (المعايير التي اتُّفق عليها لكل أداة جديدة):
//   ١) الغلاف واحد: لحظة ونطاق ووحدات وروابط وجزئية صادقة.
//   ٢) تحريك المرحلة يعرض **ثلاثة** صفوف قبل/بعد — المرحلة واحتمال الفوز والقيمة المرجّحة.
//   ٣) التنفيذ برمز المعاينة وحده، ولمرة واحدة، ويبطل بتحرّك السجل.
//   ٤) الرفض بلا سبب مكتوب مرفوض، والفقدان بلا سبب مرفوض.
//   ٥) المال في المشاريع وحدها ولمن يقرؤه — ورقمان منفصلان لا مجموع.
//   ٦) «غير مُسجَّل» ≠ صفر في المال والنسب والتواريخ.
//   ٧) سجلٌّ خارج النطاق يُردّ بجملة عربية تقول من يملكه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mcp-domain-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, run, get, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { runTool, listTools, registerTools } = await import('../../src/modules/ai/team-tools.js');
const { CRM_TOOLS } = await import('../../src/modules/ai/crm-tools.js');
const { PMO_TOOLS } = await import('../../src/modules/ai/pmo-tools.js');
const { WORKFLOW_TOOLS } = await import('../../src/modules/ai/workflow-tools.js');
registerTools(CRM_TOOLS); registerTools(PMO_TOOLS); registerTools(WORKFLOW_TOOLS);

const T = '2026-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear();
const LEAD = { id: 'u_lead', username: 'u_lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const OTHER_OWNER = { id: 'u_oth', username: 'u_oth', name_ar: 'مالك قطاع آخر', role_id: 'sector_lead', sector_id: 'OTH', scope: 'sector' };
const EMP = { id: 'u_emp', username: 'u_emp', name_ar: 'موظف', role_id: 'employee', sector_id: 'SOL', scope: 'own', projectIds: new Set(), teamIds: new Set() };
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'OTH', name_ar: 'قطاع آخر', kind: 'delivery', active: 1, sort_order: 2, created_at: T });
  for (const u of [LEAD, EMP, OTHER_OWNER]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  for (const [id, ar, pct, won, lost, ord] of [
    ['LEAD', 'ترشيح', 10, 0, 0, 1], ['PROPOSAL', 'عرض مقدَّم', 40, 0, 0, 2],
    ['WON', 'مكسوبة', 100, 1, 0, 3], ['LOST', 'مفقودة', 0, 0, 1, 4],
  ]) await insert('stage', { id, name_ar: ar, default_win_pct: pct, is_won: won, is_lost: lost, sort_order: ord });

  await insert('opportunity', { id: 'O1', title_ar: 'فرصة التحول', client_id: 'C1', sector_id: 'SOL',
    owner_user_id: LEAD.id, stage_id: 'LEAD', win_pct: 10, value_halalas: 1_000_000_00,
    next_action: 'إرسال العرض', year: YEAR, stage_changed_at: T, created_at: T, created_by: LEAD.id });
  await insert('opportunity', { id: 'O_BARE', title_ar: 'فرصة بلا قيمة', client_id: 'C1', sector_id: 'SOL',
    owner_user_id: LEAD.id, stage_id: 'LEAD', win_pct: null, value_halalas: null,
    year: YEAR, stage_changed_at: T, created_at: T, created_by: LEAD.id });
  await insert('opportunity', { id: 'O_OTHER', title_ar: 'فرصة قطاع آخر', client_id: 'C1', sector_id: 'OTH',
    owner_user_id: OTHER_OWNER.id, stage_id: 'LEAD', win_pct: 10, value_halalas: 500_000_00,
    year: YEAR, stage_changed_at: T, created_at: T, created_by: OTHER_OWNER.id });

  await insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'مشروع التحول', sector_id: 'SOL', client_id: 'C1',
    status: 'IN_PROGRESS', rag: 'AMBER', progress_pct: 40, budget_halalas: 1_000_000_00,
    actual_spend_halalas: 700_000_00, contract_value_halalas: 2_300_000_00,
    owner_user_id: LEAD.id, pm_name: 'مدير المشروع', start_date: `${YEAR}-01-01`, end_date: `${YEAR}-12-31`, created_at: T });
  await insert('project', { id: 'P_BARE', code: 'PRJ-2', name_ar: 'مشروع بلا ميزانية', sector_id: 'SOL', client_id: 'C1',
    status: 'IN_PROGRESS', rag: 'GREEN', budget_halalas: 0, actual_spend_halalas: 0, contract_value_halalas: 0,
    owner_user_id: LEAD.id, created_at: T });
  await insert('milestone', { id: 'M1', project_id: 'P1', name_ar: 'المرحلة الأولى', due_date: `${YEAR}-03-01`, status: 'PENDING', created_at: T });
  await insert('revenue_line', { id: 'RL1', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 460_000_00, net_amount_halalas: 400_000_00, created_at: T });
  await insert('crm_activity', { id: 'A1', kind: 'meeting', at: `${YEAR}-02-01T09:00:00Z`, client_id: 'C1',
    sector_id: 'SOL', title: 'اجتماع افتتاحي', source: 'app', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const envelopeOk = (out, tool) => {
  assert.equal(out.tool, tool);
  assert.ok(out.as_of && out.today, 'اللحظة واليوم');
  assert.ok(/نطاق/.test(out.scope_ar), 'النطاق عربي');
  assert.ok(out.units && Object.keys(out.units).length, 'الوحدات معلَنة');
  assert.ok(Array.isArray(out.refs), 'روابط المصدر');
};

// ── الفرص ───────────────────────────────────────────────────────────────────────────────
test('لوحة الفرص: ترقيم كامل، ومجاميع المراحل، والقصّ النطاقي', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_list_opportunities', {});
  envelopeOk(out, 'sanad_list_opportunities');
  assert.ok(Number.isInteger(out.partial.total), 'العدد الكلي معلوم');
  assert.equal(out.partial.complete, true, 'الصفحة الأولى تسع الكل هنا');
  const ids = out.opportunities.map((o) => o.id);
  assert.ok(ids.includes('O1'), 'فرصة القطاع حاضرة');
  assert.ok(!ids.includes('O_OTHER'), 'فرصة قطاع آخر مقصوصة بالنطاق');
  const lead = out.board.find((b) => b.stage === 'LEAD');
  assert.ok(lead && lead.count >= 2, 'مجاميع المرحلة محسوبة');
});

test('«غير مُسجَّل» في الفرص: بلا قيمة وبلا احتمال ⟵ لا قيمة مرجّحة ولا صفر', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_list_opportunities', {});
  const bare = out.opportunities.find((o) => o.id === 'O_BARE');
  assert.equal(bare.value_sar.recorded, false);
  assert.equal(bare.value_sar.value, null);
  assert.equal(bare.weighted_sar.recorded, false, 'لا قيمة مرجّحة بطرفٍ ناقص');
  assert.equal(bare.next_action.recorded, false, 'بلا خطوة تالية');
  assert.equal(bare.expected_close.recorded, false, 'تاريخ الإغلاق غير مسجَّل في المنصة');
  const one = out.opportunities.find((o) => o.id === 'O1');
  assert.equal(one.weighted_sar.value, 100000, 'المرجّحة = مليون × ١٠٪');
});

test('تفاصيل فرصة: مصدر احتمال الفوز مذكور، والمهام والسجلّان', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_get_opportunity', { opportunityId: 'O1' });
  envelopeOk(out, 'sanad_get_opportunity');
  assert.match(out.opportunity.win_pct_source_ar, /افتراضي المرحلة/, 'المصدر مذكور');
  assert.ok(Array.isArray(out.stage_history) && Array.isArray(out.contact_log) && Array.isArray(out.linked_tasks));
  assert.equal(out.next_action.due.recorded, false, 'موعد الخطوة التالية غير مُسجَّل في المنصة');
});

test('تحريك المرحلة: ثلاثة صفوف قبل/بعد — والقيمة المرجّحة تتبع الاحتمال', async () => {
  const pv = await runTool(ctxOf(LEAD), 'sanad_preview_stage_change', { opportunityId: 'O1', toStage: 'PROPOSAL' });
  envelopeOk(pv, 'sanad_preview_stage_change');
  assert.equal(pv.changes.length, 3, 'ثلاثة أرقام تتغيّر معاً');
  const win = pv.changes.find((c) => c.field_ar === 'احتمال الفوز');
  assert.equal(win.before_ar, '10%'); assert.equal(win.after_ar, '40%');
  const w = pv.changes.find((c) => c.field_ar === 'القيمة المرجّحة');
  assert.match(w.before_ar, /100,000/); assert.match(w.after_ar, /400,000/);
  assert.equal((await get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1'])).stage_id, 'LEAD', 'المعاينة لم تكتب');
  const out = await runTool(ctxOf(LEAD), 'sanad_move_opportunity_stage', { previewToken: pv.previewToken });
  assert.equal(out.applied, true);
  const after = await get('SELECT stage_id, win_pct FROM opportunity WHERE id = ?', ['O1']);
  assert.equal(after.stage_id, 'PROPOSAL');
  assert.equal(Number(after.win_pct), 40, 'الاحتمال أُعيد ضبطه على افتراضي المرحلة');
});

test('الفقدان بلا سبب مكتوب مرفوض', async () => {
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_stage_change', { opportunityId: 'O_BARE', toStage: 'LOST' }),
    (e) => { assert.match(e.message, /سبب الفقدان/); return true; });
  const pv = await runTool(ctxOf(LEAD), 'sanad_preview_stage_change', { opportunityId: 'O_BARE', toStage: 'LOST', note: 'رست على منافس' });
  assert.ok(pv.previewToken, 'بالسبب تمرّ المعاينة');
});

test('رمز تحريك المرحلة يبطل إن تحرّكت الفرصة', async () => {
  const pv = await runTool(ctxOf(LEAD), 'sanad_preview_stage_change', { opportunityId: 'O1', toStage: 'LEAD', note: 'إعادة' });
  await run('UPDATE opportunity SET win_pct = ?, updated_at = ? WHERE id = ?', [55, new Date().toISOString(), 'O1']);
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_move_opportunity_stage', { previewToken: pv.previewToken }),
    (e) => { assert.match(e.message, /تغيّرت الفرصة بعد المعاينة/); return true; });
});

test('فرصة خارج النطاق تُردّ بجملة عربية', async () => {
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_get_opportunity', { opportunityId: 'O_OTHER' }),
    (e) => { assert.ok(/[؀-ۿ]/.test(e.message), 'الرسالة عربية'); return true; });
});

// ── تعديل حقول الفرصة ───────────────────────────────────────────────────────────────────
test('تعديل الفرصة: قبل/بعد لما يتغيّر وحده، والمرجّحة تظهر تابعةً لا مكتوبة', async () => {
  const pv = await runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update',
    { opportunityId: 'O_BARE', title: 'فرصة التحول الرقمي', valueSar: 200000, priority: 'P1' });
  envelopeOk(pv, 'sanad_preview_opportunity_update');
  const f = pv.changes.map((c) => c.field_ar);
  assert.deepEqual(f, ['العنوان', 'القيمة الإجمالية', 'القيمة المرجّحة', 'الأولوية'], 'الحقول المتغيّرة وحدها، والمرجّحة تابعةٌ للقيمة');
  const w = pv.changes.find((c) => c.field_ar === 'القيمة المرجّحة');
  assert.match(w.note_ar, /لا تُكتب مباشرةً/, 'المرجّحة معلَنٌ أنها حاصلُ ضربٍ لا حقلٌ يُكتب');
  assert.match(pv.not_touched_ar, /القطاع|الإدارة/, 'ما لا تمسّه الأداة مكتوبٌ لا مسكوتٌ عنه');
  // المعاينة لا تكتب
  assert.equal((await get('SELECT title_ar FROM opportunity WHERE id = ?', ['O_BARE'])).title_ar, 'فرصة بلا قيمة');

  const out = await runTool(ctxOf(LEAD), 'sanad_update_opportunity', { previewToken: pv.previewToken });
  assert.equal(out.applied, true);
  const row = await get('SELECT title_ar, value_halalas, priority FROM opportunity WHERE id = ?', ['O_BARE']);
  assert.equal(row.title_ar, 'فرصة التحول الرقمي');
  assert.equal(Number(row.value_halalas), 200000_00, 'القيمة بالهللات');
  assert.equal(row.priority, 'P1');
  // الرمز لمرة واحدة
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_update_opportunity', { previewToken: pv.previewToken }),
    (e) => { assert.ok(/[؀-ۿ]/.test(e.message)); return true; });
});

test('تعديلٌ لا يغيّر شيئاً يُردّ، ولا يُصنع له رمز', async () => {
  const row = await get('SELECT title_ar, value_halalas FROM opportunity WHERE id = ?', ['O1']);
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update',
    { opportunityId: 'O1', title: row.title_ar, valueSar: Number(row.value_halalas) / 100 }),
  (e) => { assert.match(e.message, /لا شيء يتغيّر/); return true; });
});

test('احتمال الفوز يدوياً يقول إنه يزول عند تحريك المرحلة', async () => {
  const pv = await runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update', { opportunityId: 'O1', winPct: 75 });
  const win = pv.changes.find((c) => c.field_ar === 'احتمال الفوز');
  assert.match(win.note_ar, /يزول عند أول تحريك/, 'العاقبة مقولة قبل الموافقة لا بعدها');
  assert.ok(pv.changes.some((c) => c.field_ar === 'القيمة المرجّحة'), 'والمرجّحة تتحرّك معه');
});

test('حقول الإسناد تُردّ صراحةً ولا تُهمَل بصمت — ولو صحبها حقلٌ شرعيّ', async () => {
  // الحالة الخطرة: حقلٌ يتغيّر فعلاً (العنوان) يصحبه إسنادٌ مهرَّب. لولا الردّ الصريح لمرّت
  // المعاينة بصفٍّ واحد للعنوان، فيؤكّدها صاحبها ظانّاً أنه نقل القطاع معه.
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update',
    { opportunityId: 'O1', title: 'عنوان جديد', sectorId: 'OTH', departmentId: 'D1', ownerUserId: EMP.id }),
  (e) => { assert.match(e.message, /تعديلُ قطاع الفرصة/); assert.match(e.message, /صفحة الفرصة/, 'يقول أين تُدار'); return true; });
  // والمرحلة تُردّ إلى معاينتها هي لا إلى الشاشة
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update', { opportunityId: 'O1', stage: 'WON' }),
    (e) => { assert.match(e.message, /sanad_preview_stage_change/); return true; });
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update',
    { opportunityId: 'O1', clientId: 'C1', clientName: 'جهة أخرى' }),
  (e) => { assert.match(e.message, /لا بالاثنين معاً/); return true; });
});

test('رمز التعديل يبطل إن تحرّكت الفرصة، وفرصةُ غيرك تُردّ', async () => {
  const pv = await runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update', { opportunityId: 'O1', notes: 'ملاحظة جديدة' });
  await run('UPDATE opportunity SET title_ar = ?, updated_at = ? WHERE id = ?', ['عنوان تحرّك', new Date().toISOString(), 'O1']);
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_update_opportunity', { previewToken: pv.previewToken }),
    (e) => { assert.match(e.message, /تغيّرت الفرصة بعد المعاينة/); return true; });
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_opportunity_update', { opportunityId: 'O_OTHER', title: 'محاولة' }),
    (e) => { assert.ok(/[؀-ۿ]/.test(e.message), 'الرسالة عربية'); return true; });
});

// ── المشاريع ────────────────────────────────────────────────────────────────────────────
test('قائمة المشاريع: الفجوة بين الصرف والإنجاز، والمعلَم القادم', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_list_projects', {});
  envelopeOk(out, 'sanad_list_projects');
  const p = out.projects.find((x) => x.id === 'P1');
  assert.equal(p.health_ar, 'في خطر');
  assert.equal(p.spend_pct.value, 70, 'نسبة الصرف ٧٠٪');
  assert.ok(p.next_milestone && p.next_milestone.title === 'المرحلة الأولى', 'المعلَم القادم');
  const bare = out.projects.find((x) => x.id === 'P_BARE');
  assert.equal(bare.spend_pct.recorded, false, 'بلا ميزانية لا نسبة صرف');
  assert.equal(bare.spend_pct.value, null, 'ولا تُصفَّر');
  assert.equal(bare.next_milestone.recorded, false, 'بلا معلَم قادم يُقال ذلك');
});

test('المال في المشاريع: رقمان منفصلان لا مجموع، ولمن يقرؤه', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_get_project', { projectId: 'P1' });
  envelopeOk(out, 'sanad_get_project');
  assert.equal(out.money.contract_value_sar.value, 2300000, 'قيمة العقد');
  assert.equal(out.money.recognized_revenue_sar.value, 460000, 'الإيراد المُثبت');
  assert.match(out.money.note_ar, /لا يُجمعان/, 'يُعلن أنهما لا يُجمعان');
  assert.ok(!('total' in out.money), 'لا مجموع بينهما');
});

test('من لا يقرأ المال لا يرى قيمة عقدٍ ولا إيراداً — ويُقال له لماذا', async () => {
  const out = await runTool(ctxOf(EMP), 'sanad_list_projects', {}).catch((e) => e);
  if (out instanceof Error) { assert.ok(/[؀-ۿ]/.test(out.message)); return; }
  assert.match(out.units.money_ar || '', /لا قيم مالية/, 'الوحدات تعلن الحجب');
  for (const p of out.projects) {
    assert.equal(p.spend_pct.recorded, false, 'لا نسبة صرف بلا بوابة مال');
    assert.match(p.spend_pct.ar, /بوابة قراءة المال/, 'والسبب مكتوب');
  }
});

test('معالم المشروع: المتأخر معلَّم، والارتباط بمستخلص معلَن', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_get_project_milestones', { projectId: 'P1' });
  envelopeOk(out, 'sanad_get_project_milestones');
  const m = out.milestones.find((x) => x.id === 'M1');
  assert.equal(m.delivered, false);
  assert.equal(m.has_progress_claim, false, 'لا مستخلص مبنيٌّ عليه');
});

// ── الاعتمادات ──────────────────────────────────────────────────────────────────────────
test('طابور الاعتمادات: غلافٌ وترقيم، وفارغٌ يبقى فارغاً لا صفراً كاذباً', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_list_approvals', {});
  envelopeOk(out, 'sanad_list_approvals');
  assert.ok(Array.isArray(out.approvals));
  assert.equal(out.partial.total, out.approvals.length);
  assert.match(out.scope_ar, /لا تعتمد طلبك/, 'فصل المهام معلن في النطاق');
});

test('الرفض بلا سبب مكتوب مرفوض', async () => {
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_approval_decision', { approvalId: 'x', decision: 'reject' }),
    (e) => { assert.match(e.message, /الرفض يلزمه سبب مكتوب/); return true; });
});

test('طلب اعتماد ليس لك يُردّ بجملة تقول من يملكه', async () => {
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_preview_approval_decision', { approvalId: 'ghost', decision: 'approve' }),
    (e) => { assert.match(e.message, /غير موجود|لا ينتظر قرارك/); return true; });
});

// ── العملاء ─────────────────────────────────────────────────────────────────────────────
test('ملف الجهة: حالة العلاقة بقاعدتها، والأيام منذ آخر تواصل', async () => {
  const out = await runTool(ctxOf(LEAD), 'sanad_get_client', { clientId: 'C1' });
  envelopeOk(out, 'sanad_get_client');
  assert.equal(out.client.name, 'وزارة الثقافة');
  assert.ok(['نشطة', 'فاترة', 'خاملة'].includes(out.relationship.state_ar), 'حالة العلاقة من القيم الثلاث');
  assert.match(out.relationship.basis_ar, /نشطة/, 'القاعدة مكتوبة');
  assert.ok(Array.isArray(out.open_opportunities) && Array.isArray(out.our_sectors));
});

test('دورة تسجيل التواصل: معاينة ثم تنفيذ بالرمز وحده', async () => {
  const pv = await runTool(ctxOf(LEAD), 'sanad_preview_contact_log', { clientId: 'C1', kind: 'call', title: 'مكالمة متابعة' });
  envelopeOk(pv, 'sanad_preview_contact_log');
  assert.equal(pv.will_be.kind_ar, 'اتصال');
  assert.match(pv.will_be.at_ar, /لا يقبل تأريخاً رجعياً/, 'صدقٌ في ما لا تدعمه المنصة');
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_log_contact', { previewToken: pv.previewToken, title: 'التفاف' }),
    (e) => { assert.match(e.message, /رمز المعاينة وحده/); return true; });
  const out = await runTool(ctxOf(LEAD), 'sanad_log_contact', { previewToken: pv.previewToken });
  assert.equal(out.applied, true);
  assert.equal(out.activity.kind_ar, 'اتصال');
  await assert.rejects(() => runTool(ctxOf(LEAD), 'sanad_log_contact', { previewToken: pv.previewToken }),
    (e) => { assert.match(e.message, /طُبِّقت من قبل/); return true; });
});

test('كل الأدوات الجديدة معروضة بوصفٍ عربي ومخطَّط مدخلات', () => {
  const listed = listTools(LEAD);
  const names = listed.map((t) => t.name);
  for (const n of ['sanad_list_opportunities', 'sanad_get_opportunity', 'sanad_preview_stage_change',
    'sanad_move_opportunity_stage', 'sanad_list_projects', 'sanad_get_project', 'sanad_get_project_milestones',
    'sanad_list_approvals', 'sanad_preview_approval_decision', 'sanad_decide_approval',
    'sanad_get_client', 'sanad_preview_contact_log', 'sanad_log_contact']) {
    assert.ok(names.includes(n), `${n} معروضة`);
    const t = listed.find((x) => x.name === n);
    assert.ok(/[؀-ۿ]/.test(t.description_ar) && t.description_ar.length > 60, `${n}: وصف عربي وافٍ`);
    assert.ok(/[؀-ۿ]/.test(t.output_ar), `${n}: وصف المخرَج عربي`);
    assert.equal(t.input.type, 'object', `${n}: مخطط مدخلات`);
    assert.equal(t.input.additionalProperties, false, `${n}: لا حقل زائد`);
  }
});
