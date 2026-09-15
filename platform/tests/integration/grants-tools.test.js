// ── صلاحيات الأشخاص من المحادثة (ADR-0025) ────────────────────────────────────────────────
// ما تحرسه:
//   ١) المعاينة بالاسم: «تطوير الأعمال لسجى على الحلول» تُحسَم وتُعرض صفاً صفاً، والتنفيذ برمزها يكتب.
//   ٢) الاسم الذي يطابق هدفين لا يُخمَّن، والاسم الغائب يُقال، والهدف الناقص يُطلب.
//   ٣) الكشف يعرض حِزمه ومعرّفاتها وما يستطيع المنادي منحه — ومن لا يبلغ المستوى يُردّ قبل الحفظ.
//   ٤) الرفع بمعاينةٍ ثم تنفيذ، بحزمته.
//   ٥) ومن نافذة المساعد تقف الكتابة لبطاقة التأكيد، والضغطة تكتب.
//   ٦) الزوجان مصرَّحان في الدفعة الواحدة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-grant-tools-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const db = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { resolveUser } = await import('../../src/core/http/context.js');
const { runTool, registerTools, listTools } = await import('../../src/modules/ai/team-tools.js');
const { GRANT_TOOLS } = await import('../../src/modules/ai/grants-tools.js');
const { CONFIRM_TOOLS } = await import('../../src/modules/ai/confirm-tools.js');
const { BATCH_TOOLS, BATCH_PAIRS } = await import('../../src/modules/ai/batch-tools.js');
registerTools(GRANT_TOOLS); registerTools(CONFIRM_TOOLS); registerTools(BATCH_TOOLS);

const T = new Date().toISOString();
const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid, extra = {}) => ({ user: await sess(uid), ip: '1', ...extra });
const CLIENT = { id: 'cl_1', name_ar: 'مساعد التجربة' };
const previewsSaved = async (intent) => Number((await db.get('SELECT COUNT(*) n FROM ai_activity_log WHERE intent = ? AND preview_json IS NOT NULL', [intent])).n);

before(async () => {
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  const mkUser = (id, role, scope) => db.insert('app_user', { id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: 'SOL', scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'company');
  await mkUser('u_lead', 'sector_lead', 'sector');
  await mkUser('u_dm', 'department_manager', 'own');
  await mkUser('u_saja', 'consultant', 'own');
  await db.insert('department', { id: 'D_INNOV', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_DIG', sector_id: 'SOL', name_ar: 'إدارة الابتكار الرقمي', active: 1, created_at: T });
  for (const [eid, uid, dept] of [['e_dm', 'u_dm', 'D_INNOV'], ['e_saja', 'u_saja', 'D_INNOV']]) {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: uid === 'u_saja' ? 'سجى العتيبي' : 'مدير الابتكار', sector_id: 'SOL', department_id: dept, job_title: 'استشاري', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: eid });
  }
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('معاينةٌ بالاسم ثم تنفيذٌ برمزها: «تطوير الأعمال» لسجى على قطاع الحلول كله', async () => {
  const lead = await ctxOf('u_lead');
  const pv = await runTool(lead, 'sanad_preview_grant', { personId: 'e_saja', bundle: 'bd', level: 'sector', target: 'الحلول', note: 'تطوير أعمال القطاع' });
  assert.ok(pv.previewToken, 'لا رمز معاينة');
  assert.match(pv.summary, /تطوير الأعمال.*سجى العتيبي.*قطاع الحلول كله/);
  const fields = pv.display.map((d) => d.field_ar);
  for (const f of ['الشخص', 'الصلاحية', 'على', 'تشمل', 'الأثر', 'حتى', 'السبب']) assert.ok(fields.includes(f), `صفّ «${f}» غائب عن المعاينة`);
  assert.equal((await sess('u_saja')).departmentGrants.length, 0, 'المعاينة كتبت');
  const out = await runTool(lead, 'sanad_apply_grant', { previewToken: pv.previewToken });
  assert.equal(out.applied, true); assert.equal(out.grant.created, 3); assert.equal(out.grant.level, 'sector');
  const saja = await sess('u_saja');
  assert.equal(saja.departmentGrants.filter((g) => g.level === 'sector' && g.sector_id === 'SOL' && g.resource === 'opportunity').length, 3, 'الحزمة لم تُحمَّل مع طلبها التالي');
  await assert.rejects(() => runTool(lead, 'sanad_apply_grant', { previewToken: pv.previewToken }), /طُبِّقت من قبل/);
});

test('الاسم يُحسَم أو يُردّ: هدفان بالاسم نفسه لا يُخمَّنان، والغائب يُقال، والناقص يُطلب', async () => {
  const lead = await ctxOf('u_lead');
  const base = { personId: 'u_saja', bundle: 'opp_read', level: 'department' };
  // «ابتكار» جزءٌ من اسمين ⟵ لا يُخمَّن؛ و«الابتكار» اسمُ إحداهما تاماً (بعد كلمة «إدارة») ⟵ تُحسَم
  await assert.rejects(() => runTool(lead, 'sanad_preview_grant', { ...base, target: 'ابتكار' }), /أكثر من إدارة.*إدارة الابتكار.*إدارة الابتكار الرقمي/);
  await assert.rejects(() => runTool(lead, 'sanad_preview_grant', { ...base, target: 'إدارة الطاقة' }), /لا إدارة باسم/);
  await assert.rejects(() => runTool(lead, 'sanad_preview_grant', { ...base }), /حدّد إدارة/);
  const exact = await runTool(lead, 'sanad_preview_grant', { ...base, target: 'إدارة الابتكار' });
  assert.ok(exact.display.some((d) => d.field_ar === 'على' && d.after_ar.startsWith('إدارة الابتكار (')), 'المطابقة التامة لم تُحسم');
  const loose = await runTool(lead, 'sanad_preview_grant', { ...base, target: 'الابتكار' });
  assert.ok(loose.display.some((d) => d.field_ar === 'على' && d.after_ar.startsWith('إدارة الابتكار (')), 'الاسم التام بلا كلمة «إدارة» لم يُحسم');
  const byId = await runTool(lead, 'sanad_preview_grant', { ...base, target: 'D_DIG' });
  assert.ok(byId.display.some((d) => d.field_ar === 'على' && d.after_ar.startsWith('إدارة الابتكار الرقمي')), 'المعرّف لا يُحسم');
});

test('الكشف: حِزمه بمعرّفاتها وحكم رفعها، وما يستطيع المنادي منحه — ومن لا يبلغ المستوى يُردّ قبل الحفظ', async () => {
  const lead = await ctxOf('u_lead');
  const k = await runTool(lead, 'sanad_list_grants', { personId: 'u_saja' });
  assert.equal(k.person.name, 'سجى العتيبي');
  assert.equal(k.grants.length, 1); assert.equal(k.grants[0].bundle, 'bd'); assert.equal(k.grants[0].revocable, true);
  assert.ok(k.grants[0].grant_id, 'الحزمة بلا معرّف');
  assert.ok(k.grantable_by_you.some((b) => b.bundle === 'bd' && b.targets.some((t) => t.level === 'sector')), 'قائد القطاع لا يرى أنه يمنح على القطاع');
  const own = await runTool(await ctxOf('u_saja'), 'sanad_list_grants', { personId: 'u_saja' });
  assert.equal(own.grants.length, 1); assert.deepEqual(own.grantable_by_you, [], 'صاحب الحساب يُعرض له منحُ نفسه');

  const before = await previewsSaved('sanad_preview_grant');
  const dm = await ctxOf('u_dm');
  await assert.rejects(() => runTool(dm, 'sanad_preview_grant', { personId: 'u_saja', bundle: 'bd', level: 'sector', target: 'الحلول' }), /لا تملك منح/);
  assert.equal(await previewsSaved('sanad_preview_grant'), before, 'حُفظت معاينةٌ لمنحٍ مردود');
  assert.ok(listTools(dm.user).some((t) => t.name === 'sanad_preview_grant'), 'مدير الإدارة لا يرى أداة المنح وهو يمنح إدارته');
  assert.ok(!listTools((await ctxOf('u_saja')).user).some((t) => t.name === 'sanad_preview_grant'), 'من لا يمنح شيئاً يرى أداة المنح');
});

test('الرفع: معاينة بالحزمة ثم تنفيذ برمزها — وتسقط من الطلب التالي', async () => {
  const lead = await ctxOf('u_lead');
  const pv = await runTool(lead, 'sanad_preview_revoke_grant', { personId: 'e_saja', bundle: 'bd' });
  assert.match(pv.summary, /رفع «تطوير الأعمال» عن سجى العتيبي على قطاع الحلول كله/);
  assert.ok(pv.display.some((d) => d.field_ar === 'الصلاحية' && d.after_ar === 'مرفوعة'));
  const out = await runTool(lead, 'sanad_revoke_grant', { previewToken: pv.previewToken });
  assert.equal(out.applied, true); assert.equal(out.revoked.rows, 3);
  assert.equal((await sess('u_saja')).departmentGrants.length, 0, 'الرفع لم يسقط من الطلب التالي');
  await assert.rejects(() => runTool(lead, 'sanad_preview_revoke_grant', { personId: 'u_saja', bundle: 'bd' }), /لا صلاحية «تطوير الأعمال»/);
});

test('ومن نافذة المساعد: التنفيذ يقف لبطاقة التأكيد، والضغطة وحدها تكتب', async () => {
  const via = await ctxOf('u_lead', { mcpClient: CLIENT });
  const pv = await runTool(via, 'sanad_preview_grant', { personId: 'u_saja', bundle: 'opp_read', level: 'department', target: 'إدارة الابتكار', expiresOn: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
  const held = await runTool(via, 'sanad_apply_grant', { previewToken: pv.previewToken });
  assert.equal(held.awaiting_confirmation, true); assert.equal(held.executed, false);
  assert.ok((held.display || []).some((d) => d.field_ar === 'حتى'), 'البطاقة لا تعرض المدة');
  assert.equal((await sess('u_saja')).departmentGrants.length, 0, 'كُتب قبل الضغطة');
  const done = await runTool(via, 'sanad_confirm_change', { changeId: held.change_id });
  assert.equal(done.executed, true);
  const g = (await sess('u_saja')).departmentGrants;
  assert.equal(g.length, 1); assert.equal(g[0].level, 'department'); assert.equal(g[0].department_id, 'D_INNOV');
  assert.ok(g[0].expires_at, 'المدة لم تُكتب');
});

test('قدراتٌ مختارة من المحادثة: اطّلاع وتعديل على المشاريع بلا إضافة — والكشف يعدّ القدرات واحدةً واحدة', async () => {
  const lead = await ctxOf('u_lead');
  const pv = await runTool(lead, 'sanad_preview_grant', { personId: 'u_saja', capabilities: ['project:read', 'project:update'], level: 'sector', target: 'الحلول' });
  assert.match(pv.summary, /المشاريع: اطّلاع · تعديل.*قطاع الحلول كله/);
  const out = await runTool(lead, 'sanad_apply_grant', { previewToken: pv.previewToken });
  assert.equal(out.applied, true); assert.equal(out.grant.bundle, 'custom'); assert.equal(out.grant.created, 2);
  const g = (await sess('u_saja')).departmentGrants.filter((x) => x.resource === 'project');
  assert.deepEqual(g.map((x) => x.action).sort(), ['read', 'update']);
  await assert.rejects(() => runTool(lead, 'sanad_preview_grant', { personId: 'u_saja', level: 'sector', target: 'الحلول' }), /حدّد ما يُمنَح/);
  await assert.rejects(() => runTool(lead, 'sanad_preview_grant', { personId: 'u_saja', capabilities: ['event:create', 'opportunity:read'], level: 'sector', target: 'الحلول' }), /لا تملك منح|لا هدف مشترك|الشركة/);
  const k = await runTool(lead, 'sanad_list_grants', { personId: 'u_saja' });
  assert.ok(k.capabilities_by_you.some((c) => c.capability === 'project:update' && c.targets.some((t) => t.level === 'sector')), 'الكشف لا يعدّ القدرات');
  assert.ok(k.grants.some((x) => x.label === 'المشاريع: اطّلاع · تعديل'), 'المجموعة الحرّة بلا اسمها المشتقّ');
});

test('الزوجان مصرَّحان في الدفعة الواحدة', () => {
  assert.equal(BATCH_PAIRS.sanad_preview_grant, 'sanad_apply_grant');
  assert.equal(BATCH_PAIRS.sanad_preview_revoke_grant, 'sanad_revoke_grant');
  assert.ok(BATCH_TOOLS.length === 2);
});
