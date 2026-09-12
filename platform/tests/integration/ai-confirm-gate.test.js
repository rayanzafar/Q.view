// ── حارسُ التأكيد: لا يكتب مساعدٌ خارجي في سند حتى يضغط صاحبُ الحساب في بطاقته ────────────
// ما تحرسه:
//   ١) نداءُ أداة التنفيذ من مساعدٍ خارجي **لا يكتب شيئاً** — يعود بحالةٍ مبنيّة «بانتظار التأكيد»
//      فيها معرّف الطلب وتفصيله، لا بنص خطأ.
//   ٢) الطلبُ يظهر لصاحبه في «طلباتي» بحاله، ولصاحبه وحده.
//   ٣) الضغطة من البطاقة (أداتا التأكيد/الرفض) هي التي تكتب أو تُغلق — وأداتا البطاقة لا تُنادَيان
//      إلا عبر طريق المساعد، ولا تظهران في سطح سند الداخلي.
//   ٤) إعادةُ النداء لا تلتفّ على الحارس، والمزلاج نفسه يردّ الطلب المنتظِر أيّاً كان الطريق.
//   ٥) القاعدةُ تُقرأ من الأداة لا من قائمة أسماء: كلُّ أداة كتابةٍ تشترط رمز معاينة محروسةٌ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-confirm-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { runTool, registerTools, listTools } = await import('../../src/modules/ai/team-tools.js');
const { CRM_TOOLS } = await import('../../src/modules/ai/crm-tools.js');
const { TASK_TOOLS } = await import('../../src/modules/ai/tasks-tools.js');
const { WORKFLOW_TOOLS } = await import('../../src/modules/ai/workflow-tools.js');
const { CONFIRM_TOOLS } = await import('../../src/modules/ai/confirm-tools.js');
registerTools(CRM_TOOLS); registerTools(TASK_TOOLS); registerTools(WORKFLOW_TOOLS); registerTools(CONFIRM_TOOLS);
const { confirmChange } = await import('../../src/modules/ai/confirmations.js');

const T = '2026-03-01T00:00:00Z';
const LEAD = { id: 'u_lead', username: 'u_lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const OTHER = { id: 'u_other', username: 'u_other', name_ar: 'زميل آخر', role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
// السياقان: واحدٌ من نافذة مساعدٍ خارجي (يحمل `mcpClient`)، وواحدٌ من داخل سند (لا يحمله).
const viaAssistant = (u) => ({ user: u, ip: '127.0.0.1', mcpClient: { id: 'cl_1', name_ar: 'مساعد التجربة' } });
const inSanad = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  for (const u of [LEAD, OTHER]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, is_won: 0, is_lost: 0, sort_order: 1, created_at: T });
  await insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', default_win_pct: 40, is_won: 0, is_lost: 0, sort_order: 2, created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'منصة البيانات', client_id: 'C1', sector_id: 'SOL',
    owner_user_id: LEAD.id, stage_id: 'LEAD', win_pct: 10, value_halalas: 1000000_00, year: 2026, stage_changed_at: T, created_at: T, created_by: LEAD.id });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const previewMove = async (to = 'PROPOSAL') =>
  (await runTool(viaAssistant(LEAD), 'sanad_preview_stage_change', { opportunityId: 'O1', toStage: to })).previewToken;
const stageOf = async () => (await get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1'])).stage_id;
const myChanges = async (u, state) => (await runTool(viaAssistant(u), 'sanad_list_my_changes', state ? { state } : {})).changes;

let held;
test('نداءُ التنفيذ من مساعدٍ خارجي لا يكتب — يعود بحالةٍ مبنيّة لا بنص خطأ', async () => {
  const token = await previewMove();
  held = await runTool(viaAssistant(LEAD), 'sanad_move_opportunity_stage', { previewToken: token });
  assert.equal(held.executed, false);
  assert.equal(held.awaiting_confirmation, true);
  assert.equal(held.already_pending, false);
  assert.equal(held.change_id, token, 'معرّف الطلب هو رمز المعاينة نفسه');
  assert.ok(held.expires_at, 'ومهلته معلنة');
  assert.match(held.note_ar, /لم يُنفَّذ شيء بعد/);
  const fields = held.display.map((d) => d.field_ar);
  assert.ok(fields.includes('المرحلة') && fields.includes('احتمال الفوز'), 'قبل/بعد في الحالة نفسها لترسمه البطاقة: ' + fields.join(' · '));
  assert.equal(await stageOf(), 'LEAD', 'المرحلة لم تتحرّك — وهذا هو المقصود');
});

test('«طلباتي» تعرض الطلب بحاله لصاحبه وحده', async () => {
  const mine = await myChanges(LEAD);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].change_id, held.change_id);
  assert.equal(mine[0].state, 'awaiting');
  assert.equal(mine[0].state_ar, 'بانتظار تأكيدك');
  assert.equal(mine[0].asked_by_ar, 'مساعد التجربة', 'من طلبه مكتوبٌ في الطلب');
  assert.deepEqual(await myChanges(OTHER), [], 'طلبُ شخصٍ لا يراه غيره');
});

test('إعادةُ النداء لا تلتفّ على الحارس — ولا يؤكّده أحدٌ غير صاحبه', async () => {
  const again = await runTool(viaAssistant(LEAD), 'sanad_move_opportunity_stage', { previewToken: held.change_id });
  assert.equal(again.executed, false);
  assert.equal(again.already_pending, true, 'الطلب نفسه ما يزال ينتظر — لا طلبٌ ثانٍ');
  await assert.rejects(() => runTool(viaAssistant(OTHER), 'sanad_confirm_change', { changeId: held.change_id }),
    (e) => { assert.match(e.message, /لا أجد هذا الطلب/); return true; });
  assert.equal(await stageOf(), 'LEAD');
});

test('أداتا البطاقة لا تُنادَيان إلا عبر طريق المساعد، ولا تظهران في سطح سند الداخلي', async () => {
  await assert.rejects(() => runTool(inSanad(LEAD), 'sanad_confirm_change', { changeId: held.change_id }),
    (e) => { assert.equal(e.status, 403); assert.match(e.message, /بطاقة التأكيد/); return true; });
  const web = listTools(LEAD).map((t) => t.name);
  assert.ok(!web.includes('sanad_confirm_change') && !web.includes('sanad_reject_change'), 'مخفيتان عن سطح سند');
  const mcp = listTools(LEAD, { surface: 'mcp' });
  assert.ok(mcp.find((t) => t.name === 'sanad_confirm_change')?.app_only === true, 'ومعلَنتان لمضيف المساعد كأداتي واجهة');
  assert.equal(await stageOf(), 'LEAD');
});

test('ضغطةُ «نفّذ» من البطاقة هي التي تكتب فعلاً', async () => {
  const out = await runTool(viaAssistant(LEAD), 'sanad_confirm_change', { changeId: held.change_id });
  assert.equal(out.executed, true);
  assert.match(out.message_ar, /نُفِّذ/);
  assert.equal(await stageOf(), 'PROPOSAL', 'الكتابة وقعت بالضغطة لا بنداء أداة التنفيذ');
  assert.deepEqual(await myChanges(LEAD, 'awaiting'), [], 'وخرج من المنتظِر');
  assert.equal((await myChanges(LEAD))[0].state, 'applied', 'وصار «نُفِّذ» في طلباتي');
  const audit = await get("SELECT action, detail_json FROM audit_log WHERE resource = 'ai_change' ORDER BY at DESC LIMIT 1");
  assert.equal(audit.action, 'confirm');
  assert.match(String(audit.detail_json), /بطاقة التأكيد/, 'سطرُ تدقيقٍ يقول من أين جاء القرار');
});

test('ضغطةُ «ارفض» تُغلق الطلب بلا كتابة، والرمزُ يموت معها', async () => {
  const token = await previewMove('LEAD');
  const h = await runTool(viaAssistant(LEAD), 'sanad_move_opportunity_stage', { previewToken: token });
  assert.equal(h.awaiting_confirmation, true);

  const r = await runTool(viaAssistant(LEAD), 'sanad_reject_change', { changeId: token });
  assert.equal(r.rejected, true);
  assert.equal(await stageOf(), 'PROPOSAL', 'لم يُكتب شيء');
  assert.equal((await myChanges(LEAD)).find((x) => x.change_id === token).state, 'rejected');
  // والرمزُ المرفوض لا يُحيا بنداءٍ جديد — لا من نافذة المساعد ولا من داخل سند.
  await assert.rejects(() => runTool(viaAssistant(LEAD), 'sanad_move_opportunity_stage', { previewToken: token }),
    (e) => { assert.match(e.message, /رفض صاحبُ الحساب/); return true; });
  await assert.rejects(() => confirmChange(inSanad(LEAD), token),
    (e) => { assert.match(e.message, /مرفوض من قبل/); return true; });
  assert.equal(await stageOf(), 'PROPOSAL');
});

test('القاعدةُ عامّة: كلُّ أداة كتابةٍ تشترط رمز معاينة محروسةٌ بالتأكيد', async () => {
  const tools = listTools(LEAD, { surface: 'mcp' }).filter((t) => t.kind === 'write' && (t.input?.required || []).includes('previewToken'));
  assert.ok(tools.length >= 5, 'العيّنة معتبرة: ' + tools.length);
  for (const t of tools) {
    // لا معاينة صالحة هنا؛ يكفي أن الحارس يسبق الأداة فيردّ برسالته هو لا برسالة الأداة.
    await assert.rejects(() => runTool(viaAssistant(LEAD), t.name, { previewToken: 'aiprev_لا_وجود_له' }),
      (e) => { assert.match(e.message, /معاينة|لم يُنفَّذ|انتهت/, `${t.name}: ${e.message}`); return true; });
  }
});

test('الإضافةُ التي لا تغيّر حال سجل تمرّ بلا وقوف — القاعدة مرسومة لا عامّة', async () => {
  const { DEV_CENTER_TOOLS } = await import('../../src/modules/products/tools.js');
  const byName = Object.fromEntries(DEV_CENTER_TOOLS.map((t) => [t.name, t]));
  for (const name of ['sanad_dc_add_comment', 'sanad_dc_upload_image']) {
    assert.equal(byName[name].kind, 'write');
    assert.ok(!(byName[name].input?.required || []).includes('previewToken'), `${name} خارج الحراسة عمداً`);
  }
});
