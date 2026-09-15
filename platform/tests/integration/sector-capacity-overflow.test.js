// ── انحدار تسرّب الأسماء (ملاحظة المالك 2026-08-24): قوائم «متاحون للعمل» و«يحتاجون إعادة
// توزيع» جزءٌ من بطاقة الطاقة لا ما بعدها ────────────────────────────────────────────────
// العلّة كانت سقف .card.h-d{max-height:460px} على بطاقةٍ جسمُها cbody-top بلا قاعدة تمرير:
// على فريقٍ حقيقي (١٧+ شخصاً بمحورٍ مزدحم وسطرَي تلميح) يتجاوز المحتوى السقف فتُرسم الأسماء
// خارج حدود البطاقة فوق القسم التالي. الحارسان: لا صنف h-d في الصفحة أصلاً، والأسماء كلها
// بين رأس القوائم وتذييل البطاقة («لوحة التسكين الكاملة») أي داخل عنصر البطاقة بنيوياً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-capovf-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear(); // فريق «هذا الشهر» يحتاج السنة الجارية
const NOW_M = new Date().getUTCMonth() + 1;
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1,
    target_revenue_halalas: 100_000_000, created_at: T });
  await insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company',
    sector_id: 'SOL', active: 1, created_at: T });
  await insert('client', { id: 'CL', name_ar: 'جهة', created_at: T });
  await insert('project', { id: 'P1', name_ar: 'مشروع', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-01-10`, client_id: 'CL', created_at: T });
  // عشرون موظفاً — يفعّلون الوضع المزدحم (dense) الذي فجّر السقف على البيانات الحقيقية:
  // واحد فوق الطاقة، اثنان مُسكَّنان، والبقية بلا تسكين (قائمة «متاحون للعمل» الطويلة)
  for (let i = 1; i <= 20; i++) {
    await insert('employee', { id: `E${i}`, name_ar: `موظف الاختبار رقم ${i}`, sector_id: 'SOL',
      active: 1, job_title: 'استشاري', created_at: T });
  }
  await insert('allocation', { id: 'A-over', employee_id: 'E1', person_name_ar: 'موظف الاختبار رقم 1',
    sector_id: 'SOL', project_id: 'P1', project_name: 'مشروع', year: YEAR,
    monthly_json: JSON.stringify({ [NOW_M]: 1.3 }), created_at: T });
  await insert('allocation', { id: 'A-mid1', employee_id: 'E2', person_name_ar: 'موظف الاختبار رقم 2',
    sector_id: 'SOL', project_id: 'P1', project_name: 'مشروع', year: YEAR,
    monthly_json: JSON.stringify({ [NOW_M]: 0.8 }), created_at: T });
  await insert('allocation', { id: 'A-mid2', employee_id: 'E3', person_name_ar: 'موظف الاختبار رقم 3',
    sector_id: 'SOL', project_id: 'P1', project_name: 'مشروع', year: YEAR,
    monthly_json: JSON.stringify({ [NOW_M]: 0.5 }), created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('لا سقف h-d في الصفحة، والأسماء كلها داخل بطاقة الطاقة بنيوياً', async () => {
  const html = await sectorPage(ADMIN, { year: String(YEAR) });
  assert.ok(!/class="card[^"]*\bh-d\b/.test(html), 'صنف السقف h-d اختفى من البطاقات');
  assert.ok(!html.includes('.card.h-d'), 'ولا قاعدة CSS له');

  const listsStart = html.indexOf('متاحون للعمل');
  const cardFoot = html.indexOf('لوحة التسكين الكاملة');
  assert.ok(listsStart > -1 && cardFoot > listsStart, 'القوائم قبل تذييل البطاقة');
  // القائمتان تعرضان أعلى خمسة في كل فئة (تصميمٌ مقصود — والبقية في نافذة التفصيل):
  // ما يُعرض منها كله داخل [رأس القوائم، تذييل البطاقة] — أي داخل عنصر البطاقة بنيوياً
  const seg = html.slice(listsStart, cardFoot);
  const shownNames = [...seg.matchAll(/موظف الاختبار رقم \d+/g)].map((m) => m[0]);
  assert.ok(shownNames.length >= 6, `خمسة متاحين + المتجاوز على الأقل داخل البطاقة (وُجد ${shownNames.length})`);
  // والمتجاوز في قائمته داخل الحدود نفسها
  assert.ok(html.slice(html.indexOf('يحتاجون إعادة توزيع'), cardFoot).includes('موظف الاختبار رقم 1'));
  // لا صفّ قائمةٍ حي بعد تذييل البطاقة (قوالب dd الخاملة أسفل الصفحة خارج الحكم)
  const live = html.slice(0, html.indexOf('<template'));
  assert.ok(live.lastIndexOf('cap-li-btn') < cardFoot, 'لا صفوف أشخاص حية بعد تذييل البطاقة');
  // والقسم التالي (٩) يبدأ بعد التذييل — أي لا محتوى بطاقةٍ يُرسم في أرض القسم التالي
  const nextSection = html.indexOf('نظرة الفترة القادمة');
  assert.ok(nextSection > cardFoot, 'القسم التالي بعد تذييل البطاقة');
});
