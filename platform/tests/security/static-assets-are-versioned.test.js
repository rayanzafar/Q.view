// «ولا أقدر أسوي حفظ» — بلسان المالك، والزرّ معروضٌ على شاشته والخدمة خلفه تردّ ٢٠٠.
//
// السبب لم يكن في الصلاحية ولا في الخدمة: ملفّات الشيفرة تُخدَّم بـ`max-age=3600` وبلا رقم
// نسخةٍ في العنوان (`src/server.js`). فبعد كل نشر تصل الصفحةُ جديدةً — لأنها تُبنى في كل طلب —
// ويصل ملفّ الشيفرة **قديماً من ذاكرة المتصفّح**، ساعةً كاملة. فيرى المستخدم زرّاً لا معالج
// له: يضغط فلا يحدث شيء، ولا رسالةَ خطأ تقول لماذا.
//
// وهذا لا يخصّ ميزةً بعينها: كل زرّ جديد في كل صفحة يمرّ بالفخّ نفسه بعد كل نشر. فالحارس
// بنيويّ: أي وسم شيفرةٍ أو نمطٍ يخرج من `layout` بلا بصمة يسقط هنا.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-asset-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

test('كل ملفّ شيفرةٍ أو نمطٍ في الصفحة يحمل بصمةَ نسخته', async (t) => {
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  const { layout } = await import('../../src/web/layout.js');
  const user = { id: 'u', username: 'u', name_ar: 'مستخدم', role_id: 'admin', scope: 'company' };
  const html = await layout({ user, active: 'home', title: 'ص', body: '<div></div>',
    scripts: ['/static/pages/opps.js', '/static/pages/project-governance.js'] });

  const refs = [...html.matchAll(/(?:src|href)="(\/static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  assert.ok(refs.length === 0,
    'عناوين بلا بصمة — يبقى المتصفّح على شيفرةٍ قديمة ساعةً بعد كل نشر، فيضغط المستخدم الزرّ '
    + 'ولا يحدث شيء:\n' + refs.join('\n'));

  // والبصمة موجودة فعلاً على ملفّات الصفحة، لا على بعضها.
  for (const p of ['/static/app.js', '/static/styles.css', '/static/pages/opps.js']) {
    assert.match(html, new RegExp(p.replace(/[/.]/g, '\\$&') + '\\?v='), `${p} بلا بصمة`);
  }
  rmSync(dir, { recursive: true, force: true });
});

// والوسم لا يكسر شيئاً: عنوانٌ غير ساكن أو ملفٌّ غير موجود يمرّ كما هو.
test('والوسم تحسينٌ لا شرط — لا يكسر عنواناً لا يعرفه', async () => {
  const { asset } = await import('../../src/web/assets.js');
  assert.equal(asset('/app/home'), '/app/home');
  assert.equal(asset('/static/لا-يوجد.js'), '/static/لا-يوجد.js');
  assert.equal(asset('/static/app.js?x=1'), '/static/app.js?x=1');
  assert.match(asset('/static/app.js'), /^\/static\/app\.js\?v=[a-z0-9]+$/);
});
