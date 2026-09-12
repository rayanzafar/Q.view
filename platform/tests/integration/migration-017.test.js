// ترحيلة ٠١٧ على بياناتٍ كما هي في الإنتاج — استرجاعُ ما محته الفوترة.
//
// الترحيلة تمسّ صفوفاً حقيقية: كل مخرَج صدر به مستخلص فقدَ حالةَ عمله لأن `INVOICED` كُتبت
// فوقها، وكل محصَّل فقدها مرتين. فلا يكفي أن تُضاف الأعمدة — يجب أن **تُستعاد الحقيقة** من
// القرائن الباقية (ختم القبول المحفوظ، وشرطُ أن المخرَج لا يُفوتر إلا بعد تسليمه).
// هذا الملف يبني قاعدةً بمخطط ما قبل الترحيلة، يملؤها بالحالات الست، ثم يشغّل الترحيلة
// ويتحقّق من كل صف. وهو الفحص الوحيد الذي يمنع ترحيلةً تمشي بلا خطأ وتفقد معنى البيانات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-m17-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = resolve(ROOT, 'migrations');
const db = await import('../../src/core/db/index.js');
const TS = '2026-03-01T00:00:00Z';
const LATER = '2026-05-05T00:00:00Z';

before(async () => {
  // ١) المخطط حتى ٠١٦ فقط — أي الحال الذي تجده الترحيلة على الخادم.
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < '017');
  for (const f of files) {
    await db.exec(readFileSync(join(MIG, f), 'utf8'));
    await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, TS]);
  }
  await db.insert('sector', { id: 'MS', name_ar: 'قطاع', kind: 'delivery', active: 1, created_at: TS });
  await db.insert('project', { id: 'MP', name_ar: 'مشروع الترحيل', sector_id: 'MS', status: 'IN_PROGRESS', created_at: TS });
  // ٢) الحالات الست كما تُخزَّن اليوم — مع الطور القديم: خانةٌ واحدة تحمل العمل والمال معاً.
  const d = (id, status, extra = {}) => db.insert('deliverable',
    { id, project_id: 'MP', name_ar: id, amount_halalas: 1000, status, sector_id: 'MS', created_at: TS, ...extra });
  await d('D_PENDING', 'PENDING');
  await d('D_DELIVERED', 'DELIVERED', { delivered_at: TS });
  await d('D_ACCEPTED', 'ACCEPTED', { delivered_at: TS, accepted_at: TS });
  await d('D_REJECTED', 'REJECTED');
  // المفوتر الذي كان **مقبولاً** قبل فوترته: ختمُ القبول باقٍ وهو القرينة التي تُستعاد منها.
  await d('D_INV_WAS_ACCEPTED', 'INVOICED', { delivered_at: TS, accepted_at: TS, updated_at: LATER });
  // والمفوتر الذي فُوتر بعد تسليمه بلا قبول: لا ختم قبول، فيعود «مُسلَّماً» لا «معتمَداً».
  await d('D_INV_WAS_DELIVERED', 'INVOICED', { delivered_at: TS, updated_at: LATER });
  // والمحصَّل: فقد حالته مرتين، وتاريخ تسليمه نفسه ضاع في هذا الصف.
  await d('D_PAID', 'PAID', { updated_at: LATER });
  // ٣) مراحل مخزَّنة كأرقام على المخرجات — ما كان موجوداً قبل أن تصير المرحلة كياناً.
  await d('D_PH_A', 'PENDING', { phase: 1, phase_name_ar: 'التشخيص' });
  await d('D_PH_B', 'DELIVERED', { phase: 1, phase_name_ar: 'التشخيص', delivered_at: TS });
  await d('D_PH_C', 'PENDING', { phase: 2, phase_name_ar: 'التنفيذ' });

  // ٤) الترحيلة تُشغَّل كما تُشغَّل على الخادم — بالسكربت نفسه لا بتنفيذ يدوي.
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const row = (id) => db.get('SELECT * FROM deliverable WHERE id = ?', [id]);

test('الترحيلة طُبِّقت وسُجِّلت مرة واحدة', async () => {
  const applied = await db.all("SELECT version FROM schema_migration WHERE version LIKE '017%'");
  assert.equal(applied.length, 1);
});

test('«قيد الإعداد» صارت «مسودة» — والحالات البشرية الباقية كما هي', async () => {
  assert.equal((await row('D_PENDING')).status, 'DRAFT');
  assert.equal((await row('D_DELIVERED')).status, 'DELIVERED');
  assert.equal((await row('D_ACCEPTED')).status, 'ACCEPTED');
  assert.equal((await row('D_REJECTED')).status, 'REJECTED');
});

test('لا ختم مالياً على ما لم يُفوتر — الصفوف البشرية تخرج نظيفة', async () => {
  for (const id of ['D_PENDING', 'D_DELIVERED', 'D_ACCEPTED', 'D_REJECTED']) {
    const r = await row(id);
    assert.equal(r.invoiced_at, null, id);
    assert.equal(r.collected_at, null, id);
  }
});

test('المفوتر يستعيد حالته من ختم القبول — لا يبقى مطموساً ولا يُرقّى بلا سند', async () => {
  const acc = await row('D_INV_WAS_ACCEPTED');
  assert.equal(acc.status, 'ACCEPTED', 'قُبل قبل فوترته فيعود معتمَداً');
  assert.ok(acc.invoiced_at, 'وختم الفوترة نزل مكانه');
  assert.equal(acc.collected_at, null, 'ولم يُحصَّل');

  const del = await row('D_INV_WAS_DELIVERED');
  assert.equal(del.status, 'DELIVERED', 'بلا ختم قبول لا يُرقّى إلى معتمَد — الترقية الصامتة كذبة أخرى');
  assert.ok(del.invoiced_at);
});

test('المحصَّل: ختمان اثنان، وحالةُ عملٍ مستعادة، وتاريخُ تسليمٍ لا يبقى فارغاً', async () => {
  const r = await row('D_PAID');
  assert.equal(r.status, 'DELIVERED', 'المخرَج لا يُفوتر إلا بعد تسليمه — فالمحصَّل مُسلَّمٌ يقيناً');
  assert.ok(r.invoiced_at, 'وقد فُوتر');
  assert.ok(r.collected_at, 'وحُصِّل');
  assert.ok(r.delivered_at, 'وتاريخ تسليمه استُنتج من ختم فوترته بدل أن يبقى فارغاً');
});

test('لا قيمة قديمة باقية: «مُفوتر» و«مدفوع» لم تعودا حالتين في الجدول كله', async () => {
  const stale = await db.all("SELECT id FROM deliverable WHERE status IN ('INVOICED','PAID','PENDING')");
  assert.equal(stale.length, 0, 'بقاء واحدة يعني صفاً يُقرأ بحالة لا يعرفها المنتج');
});

test('المراحل بُنيت من الأرقام المخزَّنة — بلا فقد صف ولا تكرار', async () => {
  const phases = await db.all('SELECT * FROM project_phase WHERE project_id = ? ORDER BY order_no', ['MP']);
  assert.equal(phases.length, 2, 'مرحلتان اثنتان لا ثلاث — الرقم المكرَّر مرحلة واحدة');
  assert.equal(phases[0].name_ar, 'التشخيص');
  assert.equal(phases[1].name_ar, 'التنفيذ');
  const a = await row('D_PH_A'); const bb = await row('D_PH_B'); const c = await row('D_PH_C');
  assert.equal(a.phase_id, phases[0].id);
  assert.equal(bb.phase_id, phases[0].id, 'مخرجان في نفس المرحلة يشيران إلى نفس الصف');
  assert.equal(c.phase_id, phases[1].id);
  // ومن لا مرحلة له يبقى بلا مرحلة — لا تُخترع له واحدة.
  assert.equal((await row('D_PENDING')).phase_id, null);
});

test('الوزن يبقى فارغاً — الاشتقاق عند القراءة لا خانةٌ جامدة تشيخ', async () => {
  const any = await db.get('SELECT COUNT(*) n FROM deliverable WHERE weight IS NOT NULL');
  assert.equal(Number(any.n), 0);
});

test('طاقة الموظف تبدأ فارغة وتعني مئة — لا تُملأ الصفوف القائمة برقم مخترع', async () => {
  const { capacityOf, DEFAULT_CAPACITY_PCT } = await import('../../src/modules/pmo/capacity.js');
  assert.equal(capacityOf({ capacity_pct: null }), DEFAULT_CAPACITY_PCT);
  assert.equal(capacityOf({ capacity_pct: 50 }), 50);
  assert.equal(capacityOf({}), 100);
});
