#!/usr/bin/env node
// محو البيانات التجريبية — يُمحى ما سُجِّل لا غير.
//
//   node --experimental-sqlite scripts/purge-demo.mjs                    # يعرض الدفعات ومقاديرها
//   node --experimental-sqlite scripts/purge-demo.mjs <الدفعة> --dry-run # كشفٌ بما سيُمحى
//   node --experimental-sqlite scripts/purge-demo.mjs <الدفعة> --yes     # التنفيذ
//
// لا يُمحى شيء بلا ‎--yes: أمرٌ يمسح بيانات بمجرّد كتابته يُنفَّذ يوماً بالخطأ. والكشف أولاً
// دائماً — تُقرأ الأعداد بعينٍ بشرية («٤٢ مهمة و٧ فرص») قبل أن يُقال «نعم».
//
// والضمانة البنيوية: المحو يقرأ سجلّ `demo_record` ولا يبحث في الجداول عن أنماط أسماء. صفٌّ
// حقيقي لم يُسجَّل لا يمكن أن يبلغه هذا الأمر مهما تشابهت الأسماء.
import { close } from '../src/core/db/index.js';
import { listBatches, previewPurge, purgeBatch } from '../src/core/demo/registry.js';

const argv = process.argv.slice(2);
const batch = argv.find((a) => !a.startsWith('--'));
const yes = argv.includes('--yes');
const dry = argv.includes('--dry-run');

if (!batch) {
  const batches = await listBatches();
  if (!batches.length) {
    console.log('لا بيانات تجريبية مسجَّلة في هذه القاعدة.');
  } else {
    console.log('الدفعات المسجَّلة:\n');
    for (const b of batches) {
      const detail = b.tables.map((t) => `${t.n} ${t.label}`).join(' · ') || 'لا شيء حيّ';
      console.log(`  ${b.batch}`);
      console.log(`    حيّ: ${b.alive} من ${b.total} صفاً — ${detail}\n`);
    }
    console.log('للكشف قبل المحو:  node --experimental-sqlite scripts/purge-demo.mjs "<الدفعة>" --dry-run');
    console.log('للتنفيذ:          node --experimental-sqlite scripts/purge-demo.mjs "<الدفعة>" --yes');
  }
  await close();
  process.exit(0);
}

const pv = await previewPurge(batch);
if (!pv.total) {
  console.log(`لا صفوف حيّة في دفعة «${batch}» — لا شيء ليُمحى.`);
  await close();
  process.exit(0);
}
console.log(`دفعة «${batch}» — سيُمحى ${pv.total} صفاً:`);
for (const it of pv.items) console.log(`   · ${it.n} ${it.label}`);

if (dry || !yes) {
  console.log(dry ? '\n(كشف فقط — لم يُمحَ شيء.)' : '\nلم يُمحَ شيء. أضِف ‎--yes للتنفيذ.');
  await close();
  process.exit(0);
}

const res = await purgeBatch(batch);
console.log(`\n✓ مُحي ${res.purged} صفاً.`);
if (res.failed.length) {
  console.log(`✗ تعذّر محو ${res.failed.length} — يبقى مسجَّلاً لإعادة المحاولة بعد معالجة السبب:`);
  for (const f of res.failed.slice(0, 10)) console.log(`   · ${f.label || f.rowId}: ${f.reason}`);
}
await close();
process.exit(res.failed.length ? 1 : 0);
