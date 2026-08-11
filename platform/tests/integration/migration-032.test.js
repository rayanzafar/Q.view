// ترحيلة ٠٣٢ على بياناتٍ كما هي قبلها — ختمُ ما سبق ذكرُه في رسالة، حتى لا يُعاد إخطارُه
// لحظة النشر (وبتهدئةٍ صفرية: في أي ساعة). النموذج `migration-030.test.js` حرفياً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-m32-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = resolve(ROOT, 'migrations');
const db = await import('../../src/core/db/index.js');
const TS = '2026-08-01T00:00:00Z';

before(async () => {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < '032');
  for (const f of files) {
    await db.exec(readFileSync(join(MIG, f), 'utf8'));
    await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, TS]);
  }
  await db.insert('role', { id: 'employee', name_ar: 'موظف', name_en: 'Employee', is_system: 1, created_at: TS });
  for (const id of ['u_req', 'u_apr_mailed', 'u_apr_fresh']) {
    await db.insert('app_user', { id, username: id, role_id: 'employee', scope: 'own', active: 1, created_at: TS });
  }
  await db.insert('workflow_definition', { id: 'wf_m32', key: 'task_approval', name_ar: 'اعتماد مهمة',
    target_resource: 'task', active: 1, created_at: TS });

  const req = (id, assignee, createdAt, status = 'PENDING') => db.insert('approval_request', {
    id, workflow_id: 'wf_m32', resource: 'task', resource_id: 'tsk_' + id, requested_by: 'u_req',
    current_step: 1, status, assignee_user_id: assignee, created_at: createdAt });

  // معتمِدٌ سبق أن رُوسل 2026-08-02T10:00Z: ما أُنشئ قبلها كان مذكوراً في رسالته — يُختم؛
  // وما أُنشئ بعدها لم يُذكر — يبقى فارغاً فتلتقطه أول كنسة.
  await db.insert('approval_mail_state', { user_id: 'u_apr_mailed', last_sent_at: '2026-08-02T10:00:00Z',
    last_reminder_date: '2026-08-02', notified_count: 1, updated_at: TS });
  await req('ar_old', 'u_apr_mailed', '2026-08-02T09:00:00Z');
  await req('ar_new', 'u_apr_mailed', '2026-08-02T11:00:00Z');
  // ومُغلقٌ قديم لا يُمَسّ (خارج شرط المعلَّق).
  await req('ar_done', 'u_apr_mailed', '2026-08-01T09:00:00Z', 'APPROVED');
  // ومعتمِدٌ لم يُراسَل قط: كل معلَّقه يبقى بلا ختم.
  await req('ar_never', 'u_apr_fresh', '2026-08-02T09:00:00Z');

  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')],
    { env: process.env, stdio: 'ignore' });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const row = (id) => db.get('SELECT * FROM approval_request WHERE id = ?', [id]);

test('ما سبق ذكرُه في رسالةٍ يُختم بوقتها — وما لم يُذكر يبقى فارغاً لأول كنسة', async () => {
  assert.equal((await row('ar_old')).notified_at, '2026-08-02T10:00:00Z', 'المذكور سابقاً لم يُختم');
  assert.equal((await row('ar_new')).notified_at, null, 'ما وصل بعد آخر رسالة خُتم زوراً');
  assert.equal((await row('ar_never')).notified_at, null, 'معلَّقُ من لم يُراسَل قط خُتم');
});

test('والمُغلق لا يُمَسّ، وجدول الإعدادات وُلد فارغاً يعمل بالافتراض', async () => {
  assert.equal((await row('ar_done')).notified_at, null);
  assert.deepEqual(await db.all('SELECT * FROM app_setting'), [], 'جدول الإعدادات وُلد ببذرٍ لا حاجة له');
});
