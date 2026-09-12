// السياق المحيط بالطلب — المعرّف، وتقنيع المسار، وحارس الانضمام.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maskPath, runInScope, runInJobScope, currentScope } from '../../src/core/obs/reqctx.js';

test('المسار يُقنَّع: عطبٌ واحد لا يصير مئتَي عطبٍ بعدد الصفوف التي أصابها', () => {
  assert.equal(maskPath('/app/project/prj_AbC123xyz'), '/app/project/:id');
  assert.equal(maskPath('/app/person/42'), '/app/person/:id');
  assert.equal(maskPath('/api/opportunities/opp_Zz9_-abc/detail'), '/api/opportunities/:id/detail');
  assert.equal(maskPath('/app/tasks'), '/app/tasks', 'قُنِّع ما ليس معرّفاً');
});

// نصُّ الاستعلام يحمل أسماء عملاء في البحث، ورمزَ دخولٍ في مسار التحقّق. لا يُخزَّن أبداً.
test('ونصّ الاستعلام يُقصّ ولا يُحفظ', () => {
  assert.equal(maskPath('/api/search?q=وزارة النقل'), '/api/search');
  assert.equal(maskPath('/login?e=1'), '/login');
});

test('حارس الانضمام: نطاقٌ داخل نطاقٍ لا يفتح معرّفاً ثانياً', () => {
  // لولاه لانقسم معرّف الطلب في منتصفه فصار سطران لعطبٍ واحد.
  runInScope({ id: 'req_outer', kind: 'http' }, () => {
    assert.equal(currentScope().id, 'req_outer');
    runInJobScope('someJob', () => {
      assert.equal(currentScope().id, 'req_outer', 'فُتح نطاقٌ ثانٍ داخل نطاقٍ قائم');
    });
  });
});

test('ونطاقُ مهمّةٍ خارج أي طلب يحمل اسمها — الفارق بين «فشل استعلام» و«فشل كنس الجلسات»', () => {
  runInJobScope('purgeExpiredSessions', () => {
    const s = currentScope();
    assert.equal(s.kind, 'job');
    assert.equal(s.job, 'purgeExpiredSessions');
    assert.match(s.id, /^job_/);
  });
});

test('وخارج أي نطاق لا يوجد سياق — بلا معرّفٍ مخترَع', () => {
  assert.equal(currentScope(), undefined);
});

test('المعرّف يُولَّد ولا يُقرأ من ترويسةٍ واردة — الثقة بها بابُ حقنٍ بلا مقابل', () => {
  const src = readFileSync(new URL('../../src/core/obs/reqctx.js', import.meta.url), 'utf8');
  assert.ok(!/req\.get\(['"]x-request-id|req\.headers\[['"]x-request-id/i.test(src),
    'صار المعرّف يُقرأ من المتصفّح — يُحقن في السجل ما يشاء');
  assert.match(src, /id\('req'\)/, 'لا يُولَّد بمولّد المنصة');
});
