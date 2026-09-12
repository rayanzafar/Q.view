// ترحيلة ٠٣٠ على بياناتٍ كما هي قبلها — استدراكُ «من اعتمد» لِما اعتُمد بين ٠٢٨ و٠٣٠.
//
// النموذج هو `migration-019.test.js`: تُبنى قاعدةٌ بمخطط ما قبل الترحيلة، تُملأ بصفوفٍ من كل
// صنف، ثم يُشغَّل `scripts/migrate.js` **الحقيقي** كما يُشغَّل على الخادم، ويُتحقَّق من كل صف.
//
// والأصناف مقصودة: مهمةٌ اعتُمدت (تُملأ)، ومهمةٌ اعتُمدت مرتين عبر طلبين (يُؤخذ الأحدث)،
// ومهمةٌ لم تحتج اعتماداً قط (تبقى فارغة)، ومهمةٌ رُدَّت فحُذفت ناعماً (لا تُمَسّ)،
// ومهمةٌ ما تزال معلَّقة (تبقى معلَّقة بلا معتمِد).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-m30-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = resolve(ROOT, 'migrations');
const db = await import('../../src/core/db/index.js');
const TS = '2026-08-01T00:00:00Z';
const T_OLD = '2026-08-02T09:00:00Z';
const T_NEW = '2026-08-03T11:00:00Z';

before(async () => {
  // ١) المخطط حتى ٠٢٩ فقط — أي الحال الذي تجده الترحيلة على الخادم.
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < '030');
  for (const f of files) {
    await db.exec(readFileSync(join(MIG, f), 'utf8'));
    await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, TS]);
  }
  await db.insert('sector', { id: 'MS', name_ar: 'قطاع', kind: 'delivery', active: 1, created_at: TS });
  await db.insert('role', { id: 'employee', name_ar: 'موظف', name_en: 'Employee', is_system: 1, created_at: TS });
  for (const [id, name] of [['u_m30_emp', 'موظف'], ['u_m30_mgr', 'المدير الأول'], ['u_m30_new', 'المدير الأحدث']]) {
    await db.insert('app_user', { id, username: id, name_ar: name, role_id: 'employee', scope: 'own', active: 1, created_at: TS });
  }
  await db.insert('workflow_definition', { id: 'wf_m30', key: 'task_approval', name_ar: 'اعتماد مهمة',
    target_resource: 'task', active: 1, created_at: TS });

  const task = (id, extra = {}) => db.insert('task', { id, title: 'مهمة ' + id, work_kind: 'internal',
    sector_id: 'MS', assignee_user_id: 'u_m30_emp', priority: 'P2', status: 'TODO',
    created_at: TS, created_by: 'u_m30_emp', ...extra });
  const request = (id, taskId, status) => db.insert('approval_request', { id, workflow_id: 'wf_m30',
    resource: 'task', resource_id: taskId, requested_by: 'u_m30_emp', sector_id: 'MS',
    current_step: 1, status, created_at: TS, closed_at: status === 'PENDING' ? null : T_OLD });
  const action = (id, reqId, act, actor, at) => db.insert('approval_action', { id, request_id: reqId,
    step_order: 1, actor_user_id: actor, action: act, acted_at: at });

  // اعتُمدت مرة واحدة — الحال الغالب.
  await task('t_ok');
  await request('ar_ok', 't_ok', 'APPROVED');
  await action('aa_ok', 'ar_ok', 'approve', 'u_m30_mgr', T_OLD);

  // اعتُمدت عبر طلبين (أُنشئت، اعتُمدت، ثم أُعيد رفعها واعتُمدت ثانيةً) — يُؤخذ الأحدث.
  await task('t_twice');
  await request('ar_tw1', 't_twice', 'APPROVED');
  await action('aa_tw1', 'ar_tw1', 'approve', 'u_m30_mgr', T_OLD);
  await request('ar_tw2', 't_twice', 'APPROVED');
  await action('aa_tw2', 'ar_tw2', 'approve', 'u_m30_new', T_NEW);

  // لم تحتج اعتماداً قط — عموداها يبقيان فارغين، وهذا معناهما الصحيح.
  await task('t_plain');

  // رُدَّت فحُذفت ناعماً — خارج الاستدراك تماماً.
  await task('t_rejected', { deleted_at: T_OLD });
  await request('ar_rej', 't_rejected', 'REJECTED');
  await action('aa_rej', 'ar_rej', 'reject', 'u_m30_mgr', T_OLD);

  // ما تزال معلَّقة — لا معتمِد لها بعد، وحالُها لا يتغيّر بالترحيلة.
  await task('t_pending', { approval_state: 'PENDING' });
  await request('ar_pen', 't_pending', 'PENDING');

  // ٢) الترحيلة الحقيقية كما تجري على الخادم.
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')],
    { env: process.env, stdio: 'ignore' });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const row = (id) => db.get('SELECT * FROM task WHERE id = ?', [id]);

test('المعتمَدة تُستدرَك: من اعتمدها ومتى، من سجلّ الاعتمادات نفسه', async () => {
  const t = await row('t_ok');
  assert.equal(t.approved_by, 'u_m30_mgr');
  assert.equal(t.approved_at, T_OLD);
});

test('والمعتمَدة مرتين يُؤخذ أحدثُ اعتمادٍ لها لا أقدمُه', async () => {
  const t = await row('t_twice');
  assert.equal(t.approved_by, 'u_m30_new');
  assert.equal(t.approved_at, T_NEW);
});

test('وما لم يحتج اعتماداً يبقى فارغاً — لا معتمِد لِما لم يُعتمَد', async () => {
  const t = await row('t_plain');
  assert.equal(t.approved_by, null);
  assert.equal(t.approved_at, null);
});

test('والمردودة والمعلَّقة لا تُمسّان', async () => {
  const rej = await row('t_rejected');
  assert.equal(rej.approved_by, null);
  assert.ok(rej.deleted_at, 'زال حذف المردودة');
  const pen = await row('t_pending');
  assert.equal(pen.approved_by, null);
  assert.equal(pen.approval_state, 'PENDING', 'زال انتظار المعلَّقة بالترحيلة');
});
