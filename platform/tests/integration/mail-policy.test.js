// سياسة بريد الاعتمادات — لمدير النظام وحده، بحدودها، بأثر تدقيقٍ واحد، وبأثرٍ فوري
// على الكنسة. وشاشة البريد تعرض البطاقة لمدير النظام وتخفيها عن مكتب الرئيس.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mailpol-'));
process.env.SANAD_DB = join(dir, 'p.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { resetSettings, settingValue, refreshSettings } = await import('../../src/core/settings/index.js');
const { setApprovalMailPolicy, loadApprovalMailRules, approvalMailDecision, DEFAULT_RULES } = await import('../../src/modules/workflow/approval-notify.js');
const { mailPage } = await import('../../src/web/views/mail.js');

const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
const CEO = { id: 'u_ceo', username: 'ceo', role_id: 'ceo_office', scope: 'company' };
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });

before(async () => {
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ceo', username: 'ceo', role_id: 'ceo_office', scope: 'company', active: 1, created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('قاعدةٌ بلا صفِّ إعدادٍ واحد تعمل بالافتراض: تذكيرٌ موقوف وتهدئةٌ صفرية', async () => {
  resetSettings();
  const r = await loadApprovalMailRules();
  assert.equal(r.reminderEnabled, false);
  assert.equal(r.newCooldownMs, 0);
  assert.equal(r.reminderIntervalMs, 24 * 3600000);
});

test('مدير النظام يكتب السياسة وتُقرأ فوراً — وأثرُ تدقيقٍ واحد يحمل القديم والجديد', async () => {
  const auditBefore = (await db.all("SELECT * FROM audit_log WHERE resource = 'app_setting'")).length;
  const out = await setApprovalMailPolicy(ctx(ADMIN), { reminder_enabled: '1', reminder_hours: 4, cooldown_minutes: 45 });
  assert.deepEqual(out, { reminder_enabled: true, reminder_hours: 4, cooldown_minutes: 45 });

  const r = await loadApprovalMailRules();
  assert.equal(r.reminderEnabled, true);
  assert.equal(r.reminderIntervalMs, 4 * 3600000);
  assert.equal(r.newCooldownMs, 45 * 60000);

  const rows = await db.all("SELECT * FROM audit_log WHERE resource = 'app_setting'");
  assert.equal(rows.length, auditBefore + 1, 'أثرُ تدقيقٍ واحد لا ثلاثة');
  assert.ok(String(rows[rows.length - 1].detail_json || '').includes('45'), 'التفصيل بلا القيمة الجديدة');

  // والسياسة المقروءة تحكم القرار فعلاً: تهدئة ٤٥ دقيقة تُمسك جديداً بعد ٤٠ دقيقة وتطلقه بعد ٥٠.
  const held = approvalMailDecision(new Date('2026-08-12T06:40:00Z'),
    { last_sent_at: '2026-08-12T06:00:00Z' }, [{ notified_at: null }], r);
  assert.equal(held.action, 'none');
  const freed = approvalMailDecision(new Date('2026-08-12T06:50:00Z'),
    { last_sent_at: '2026-08-12T06:00:00Z' }, [{ notified_at: null }], r);
  assert.equal(freed.action, 'send');
});

test('غير مدير النظام يُردّ — حتى مكتب الرئيس الذي يفتح الشاشة اطّلاعاً', async () => {
  await assert.rejects(() => setApprovalMailPolicy(ctx(CEO), { reminder_enabled: '0', reminder_hours: 24, cooldown_minutes: 0 }),
    /مدير النظام وحده/);
});

test('الحدود تُحرس برسالةٍ تسمّيها: ساعاتٌ من 1 إلى 168 ودقائق من 0 إلى 1440', async () => {
  for (const bad of [{ reminder_hours: 0 }, { reminder_hours: 169 }, { reminder_hours: 'كثير' }]) {
    await assert.rejects(() => setApprovalMailPolicy(ctx(ADMIN), { reminder_enabled: '0', reminder_hours: 24, cooldown_minutes: 0, ...bad }),
      /من 1 إلى 168/);
  }
  for (const bad of [{ cooldown_minutes: -1 }, { cooldown_minutes: 1441 }]) {
    await assert.rejects(() => setApprovalMailPolicy(ctx(ADMIN), { reminder_enabled: '0', reminder_hours: 24, cooldown_minutes: 0, ...bad }),
      /من 0 إلى 1440/);
  }
});

test('وقيمةٌ معطوبة في القاعدة تقع على افتراضها بصمت — لا تكسر الكنسة', async () => {
  await db.run("UPDATE app_setting SET value = 'خراب' WHERE key = 'approval_reminder_hours'");
  await refreshSettings({ force: true });
  const r = await loadApprovalMailRules();
  assert.equal(r.reminderIntervalMs, 24 * 3600000, 'القيمة المعطوبة لم تقع على الافتراض');
  assert.equal(settingValue('approval_reminder_hours'), 'خراب');
});

test('شاشة البريد: البطاقة لمدير النظام بقيمها — وغائبةٌ تماماً عن مكتب الرئيس', async () => {
  await setApprovalMailPolicy(ctx(ADMIN), { reminder_enabled: '1', reminder_hours: 6, cooldown_minutes: 30 });
  const adminHtml = await mailPage(ADMIN);
  assert.ok(adminHtml.includes('سياسة بريد الاعتمادات'), 'البطاقة غائبة عن مدير النظام');
  assert.ok(adminHtml.includes('value="6"'), 'فاصل التذكير المحفوظ لا يُعرض');
  assert.ok(adminHtml.includes('value="30"'), 'التهدئة المحفوظة لا تُعرض');
  assert.ok(adminHtml.includes('data-action="save-mail-policy"'), 'زر الحفظ غائب');

  const ceoHtml = await mailPage(CEO);
  assert.ok(!ceoHtml.includes('سياسة بريد الاعتمادات'), 'بطاقة القرار ظهرت لمن لا يملك القرار');
});
