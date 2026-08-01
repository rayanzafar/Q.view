// خريطة أسماء طلبات الاعتماد — كل زوج (جدول، عمود) يُفحص على المخطط نفسه.
//
// «القرارات المطلوبة» تعرض للمالك ما ينتظر توقيعه، وهويّة السجل هي كل قيمة السطر: «مصروف»
// وحدها لا تُقرَأ، و«مصروف: تعاقد باطني» قرار. وكانت الخريطة تسمّي عمودين لا وجود لهما
// (`expense.title` و`proposal.title_ar`) فيرفع الاستعلام خطأً يبتلعه `catch` — عطلٌ **صامت
// بالتصميم**: لا سجلّ، ولا اختبار أحمر، ولا شيء على الشاشة سوى غياب لا يُميَّز عن «بلا اسم».
//
// فالفحص هنا لا يُثبّت الخريطة الحالية بل يُثبّت **صدقها**: يشتقّ الأعمدة من قاعدة مُرحَّلة
// فعلاً ويسأل كل عمود «هل أنت موجود؟». من يضيف مورداً للاعتماد غداً يُمسَك هنا، لا على شاشة
// المالك بعد أسبوعين.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-approval-names-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')],
  { env: process.env, stdio: 'ignore' });

const { all, insert, close } = await import('../../src/core/db/index.js');
const { approvalTargetNames, _approvalNameCols } = await import('../../src/core/reports/periods.js');

const T = '2026-01-01T00:00:00Z';
const { cols, noName, fallback } = _approvalNameCols();
// الموارد التي تصل فعلاً من `approval_request.resource` — مصدرها نصّ عربيّ في نفس الوحدة.
const RESOURCES = ['opportunity', 'proposal', 'expense', 'deliverable', 'timesheet', 'invoice', 'project', 'contract'];

after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('كل عمود اسم في الخريطة موجود فعلاً في جدوله', async () => {
  const missing = [];
  for (const res of RESOURCES) {
    if (noName.has(res)) continue;                 // معلَن أنه بلا اسم — يُفحص في اختباره أدناه
    const col = cols[res] || fallback;
    try {
      await all(`SELECT ${col} FROM ${res} WHERE 1 = 0`);
    } catch (e) {
      missing.push(`${res}.${col} — ${e.message}`);
    }
  }
  assert.deepEqual(missing, [],
    `أعمدة أسماء لا وجود لها؛ ستُبتلع أخطاؤها ويظهر السجل بلا هوية:\n${missing.join('\n')}`);
});

test('كل مورد بلا اسم معلَن صراحةً — لا مُكتشَف عند فشل الاستعلام', async () => {
  for (const res of noName) {
    let tableExists = true;
    try { await all(`SELECT 1 FROM ${res} WHERE 1 = 0`); } catch { tableExists = false; }
    assert.equal(tableExists, false,
      `«${res}» معلَن أنه بلا جدول أسماء وجدولُه موجود — إما يُسمّى أو يُحذف من قائمة الاستثناء`);
  }
});

test('المصروف يُقرأ بنوعه والعرض بنوعه — لا سطر بلا هوية', async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'رصد', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('expense', { id: 'exp_1', sector_id: 'S1', type: 'تعاقد باطني',
    amount_halalas: 500000, status: 'SUBMITTED', created_at: T });
  await insert('opportunity', { id: 'opp_1', title_ar: 'منصة المدن الذكية', sector_id: 'S1',
    stage_id: 'LEAD', year: 2026, created_at: T });
  await insert('proposal', { id: 'prp_1', opportunity_id: 'opp_1', version: 1, kind: 'فني',
    status: 'DRAFT', created_at: T });

  const names = await approvalTargetNames([
    { resource: 'expense', resource_id: 'exp_1' },
    { resource: 'proposal', resource_id: 'prp_1' },
    { resource: 'opportunity', resource_id: 'opp_1' },
  ]);
  assert.equal(names.expense.exp_1, 'تعاقد باطني', 'المصروف كان يظهر بلا هوية إطلاقاً');
  assert.equal(names.proposal.prp_1, 'فني', 'والعرض كذلك');
  assert.equal(names.opportunity.opp_1, 'منصة المدن الذكية', 'وما كان يعمل بقي يعمل');
});

test('سجل الوقت يبقى بلا اسم — بهدوء ومن غير خطأ مبتلَع', async () => {
  const names = await approvalTargetNames([{ resource: 'timesheet', resource_id: 'ts_1' }]);
  assert.deepEqual(names.timesheet, {}, 'بلا اسم مخترَع');
});

test('مورد مجهول لا يفتح باباً على جدول من مدخلات', async () => {
  const names = await approvalTargetNames([
    { resource: 'expense; DROP TABLE expense', resource_id: 'x' },
    { resource: 'Employee', resource_id: 'y' },
  ]);
  assert.equal(names['expense; DROP TABLE expense'], undefined, 'اسم جدول من نصّ حرّ مرفوض');
  assert.equal(names.Employee, undefined, 'والحروف الكبيرة خارج النمط المسموح');
  const still = await all("SELECT id FROM expense WHERE id = 'exp_1'");
  assert.equal(still.length, 1, 'والجدول سليم');
});
