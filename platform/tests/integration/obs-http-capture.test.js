// التقاط أخطاء الطلبات — سلوكاً حقيقياً لا فحصَ مصدر.
//
// السطر يُكتب بنداء نظامٍ متزامن على المجرى الثاني، فلا يُعترض داخل العملية نفسها. فتُشغَّل
// عمليةٌ ابنة وتُقرأ مجاريها كما يقرؤها المستضيف تماماً — وهو الفحص الوحيد الذي يُثبت ما
// سيراه المُشغّل فعلاً.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'sanad-obs-'));

// يُرجع {out, err} بعد تشغيل سيناريو يبني معالج الأخطاء ويمرّر عليه ما نريد.
function run(scenario) {
  const file = join(dir, `case-${Math.abs(scenario.length)}-${Date.now()}.mjs`);
  writeFileSync(file, `
import { errorHandler, badRequest, forbidden } from ${JSON.stringify(ROOT + 'src/core/http/errors.js')};
import { runInScope } from ${JSON.stringify(ROOT + 'src/core/obs/reqctx.js')};
const handler = errorHandler();
const res = { statusCode: 0, status(c) { this.statusCode = c; return this; },
  type() { return this; }, json(o) { this.body = o; return this; }, send(s) { this.body = s; return this; } };
const req = { method: 'GET', originalUrl: '/app/project/prj_AbC123xyz?x=1',
  ctx: { user: { username: 'ريان', role_id: 'sector_lead' } },
  accepts: () => 'json', get: () => 'application/json' };
${scenario}
`);
  let out = '', err = '';
  try {
    out = execFileSync(process.execPath, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { out = String(e.stdout || ''); err = String(e.stderr || ''); }
  return { out, err: err || '' };
}
// المجرى الثاني يُقرأ من الناتج المدمج: execFileSync ينجح فنقرأ stderr من الخيار أدناه.
function runBoth(scenario) {
  const file = join(dir, `both-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, `
import { errorHandler, badRequest, forbidden } from ${JSON.stringify(ROOT + 'src/core/http/errors.js')};
import { runInScope } from ${JSON.stringify(ROOT + 'src/core/obs/reqctx.js')};
const handler = errorHandler();
const res = { statusCode: 0, status(c) { this.statusCode = c; return this; },
  type() { return this; }, json(o) { this.body = o; return this; }, send(s) { this.body = s; return this; } };
const req = { method: 'GET', originalUrl: '/app/project/prj_AbC123xyz?x=1',
  ctx: { user: { username: 'ريان', role_id: 'sector_lead' } },
  accepts: () => 'json', get: () => 'application/json' };
${scenario}
`);
  return execFileSync(process.execPath, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    + execFileSync('sh', ['-c', `node ${JSON.stringify(file)} 2>&1 1>/dev/null`], { encoding: 'utf8' });
}

test('عطبٌ حقيقي يكتب سطراً يحمل المسار المقنَّع وصاحبه ورمز الطلب', () => {
  const all = runBoth(`
    const e = new TypeError('انفجار في العرض');
    runInScope({ id: 'req_TEST123', kind: 'http', path: '/app/project/:id', user: 'ريان', role: 'sector_lead' },
      () => handler(e, req, res, () => {}));
  `);
  const line = all.split('\n').find((l) => l.includes('"event":"http_error"'));
  assert.ok(line, 'لم يُكتب سطرُ عطب أصلاً');
  const o = JSON.parse(line);
  assert.equal(o.level, 'error');
  assert.equal(o.status, 500);
  assert.equal(o.path, '/app/project/:id', 'لم يُقنَّع المسار — عطبٌ واحد يصير عطباً لكل صف');
  assert.ok(!line.includes('?x=1'), 'تسرّب نصّ الاستعلام إلى السجل');
  assert.equal(o.user, 'ريان', 'لا يُعرف من أصابه العطب');
  assert.equal(o.req_id, 'req_TEST123', 'لا رمز طلبٍ يربط السطر بالحادثة');
  assert.equal(o.err_kind, 'TypeError');
  assert.ok(String(o.stack).includes('انفجار في العرض'), 'ضاع أثر الاستدعاء');
});

test('و«طلب غير صالح» المقصود لا يُكتب — منتَجٌ يعمل لا عطب', () => {
  const all = runBoth(`
    handler(badRequest('حجم المهمة نسبة من 1 إلى 100'), req, res, () => {});
    handler(forbidden('صلاحيتك لا تسمح'), req, res, () => {});
    process.stdout.write('DONE\\n');
  `);
  assert.ok(!all.includes('"event":"http_error"'), 'التُقط ردٌّ مقصود كأنه عطب');
  assert.ok(all.includes('DONE'), 'لم يصل السيناريو إلى نهايته');
});

test('وعطبٌ حقيقي زُيِّن برقمٍ دون 500 يُلتقط — التمييز بالنوع لا بالرقم', () => {
  const all = runBoth(`
    const e = new TypeError('عطب زُيِّن'); e.status = 400;
    handler(e, req, res, () => {});
  `);
  const line = all.split('\n').find((l) => l.includes('"event":"http_error"'));
  assert.ok(line, 'أُسقط عطبٌ حقيقي لأن رقمه دون 500');
  assert.equal(JSON.parse(line).status, 400);
});

test('والاستجابة لم تتغيّر: الرسالة العربية الثابتة ولا تفصيل يغادر', () => {
  const { out } = run(`
    const e = new Error('تفصيل داخلي حسّاس');
    handler(e, req, res, () => {});
    process.stdout.write('BODY:' + JSON.stringify(res.body) + '|CODE:' + res.statusCode + '\\n');
  `);
  const line = out.split('\n').find((l) => l.startsWith('BODY:'));
  assert.ok(line, 'لم تُبنَ استجابة');
  assert.ok(line.includes('CODE:500'));
  assert.ok(!line.includes('تفصيل داخلي حسّاس'), 'تسرّب تفصيل 500 إلى المستخدم');
  assert.ok(line.includes('حدث خطأ غير متوقع'), 'تغيّرت الرسالة الثابتة');
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
