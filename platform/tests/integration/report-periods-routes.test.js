// مسارات تقرير الفترة — ما يفتحه المتصفح فعلاً.
// ثلاثة ثوابت تُحرَس هنا:
//   ١) **العرض قراءة والإصدار كتابة.** الطباعة لا تكتب نسخة، و«الإصدار» يكتبها ويترك أثراً.
//   ٢) **لا نصّ تقني في وجه المستخدم.** مسارات المتصفح تردّ صفحة عربية عند المنع أو الخطأ،
//      لا هيكل بيانات خاماً — والصفحة نفسها هي ما يقرؤه من ضغط زراً في الشاشة.
//   ٣) الصلاحية تُنفَّذ في الخدمة، فيرثها المسار بلا فحص ثانٍ يمكن أن ينحرف عنها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-period-routes-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, all, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();

const T = '2026-01-01T00:00:00Z';
const U = (id, role, sector, scope) => ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role,
  sector_id: sector, scope, projectIds: new Set(), teamIds: new Set(), department_id: null });
const admin = U('u_admin', 'admin', null, 'company');
const leadCon = U('u_lead_con', 'sector_lead', 'CONSULTING', 'sector');

let server = null, port = 0, CURRENT = admin;
const call = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type') || '', text };
};

before(async () => {
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  for (const u of [admin, leadCon]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });
  await insert('project', { id: 'P1', name_ar: 'مشروع المدن', sector_id: 'SOLUTIONS', owner_user_id: 'u_admin',
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 20, created_at: T });

  const express = (await import('express')).default;
  const { reportsRouter } = await import('../../src/modules/reports.routes.js');
  const { errorHandler } = await import('../../src/core/http/errors.js');
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { req.ctx = { user: CURRENT, ip: '127.0.0.1' }; next(); });
  app.use('/api', reportsRouter);
  app.use(errorHandler());
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await close();
  rmSync(dir, { recursive: true, force: true });
});

const Q = 'period=week&anchor=2026-07-22&lens=sector&targetId=SOLUTIONS';

test('التقرير كبيانات: الأقسام الثمانية واسم الفترة العربي', async () => {
  CURRENT = admin;
  const r = await call('GET', `/reports/period?${Q}`);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.text);
  assert.equal(body.sections.length, 8);
  assert.equal(body.period.label_ar, 'أسبوع 19–25 يوليو 2026');
  assert.equal(body.lens, 'sector');
});

test('قوائم الاختيار تعطي أنواع الفترات وفتراتها الجاهزة والعدسات المتاحة', async () => {
  CURRENT = admin;
  const r = await call('GET', '/reports/period/options');
  const body = JSON.parse(r.text);
  assert.deepEqual(body.periods.map((p) => p.key), ['week', 'month', 'quarter']);
  assert.ok(body.periods.every((p) => p.choices.length >= 8 && p.choices[0].current));
  assert.equal(body.lenses.length, 6);
  assert.ok(body.options.sectors.some((s) => s.id === 'SOLUTIONS'));
});

test('الطباعة تعرض المستند ولا تكتب نسخة', async () => {
  CURRENT = admin;
  const before = (await get('SELECT COUNT(*) n FROM report_snapshot')).n;
  const r = await call('GET', `/reports/period/print?${Q}`);
  assert.equal(r.status, 200);
  assert.ok(r.type.includes('text/html'));
  assert.ok(r.text.includes('أسبوع 19–25 يوليو 2026'));
  assert.equal((await get('SELECT COUNT(*) n FROM report_snapshot')).n, before, 'العرض قراءة لا كتابة');
});

test('الإصدار يعيد المستند ويكتب نسخة واحدة بأثر تدقيق', async () => {
  CURRENT = admin;
  const before = (await get('SELECT COUNT(*) n FROM report_snapshot')).n;
  const r = await call('POST', '/reports/period/issue', { period: 'week', anchor: '2026-07-22', lens: 'sector', targetId: 'SOLUTIONS' });
  assert.equal(r.status, 200);
  assert.ok(r.type.includes('text/html'));
  assert.ok(r.text.includes('قطاع الحلول'));
  assert.equal((await get('SELECT COUNT(*) n FROM report_snapshot')).n, before + 1);
  const row = await get('SELECT * FROM report_snapshot ORDER BY created_at DESC LIMIT 1');
  assert.equal(row.scope_ref, 'sector#SOLUTIONS#week#2026-07-19');
  const aud = await all(`SELECT * FROM audit_log WHERE resource = 'report' AND resource_id = ?`, [row.id]);
  assert.equal(aud.length, 1);
});

test('النسخة المحفوظة تُفتح من رابطها، وتظهر في قائمة نسخ الجهة', async () => {
  CURRENT = admin;
  const list = JSON.parse((await call('GET', `/reports/period/snapshots?${Q}`)).text);
  assert.ok(list.snapshots.length >= 1);
  const one = await call('GET', `/reports/period/snapshot/${list.snapshots[0].id}`);
  assert.equal(one.status, 200);
  assert.ok(one.type.includes('text/html'));
  assert.ok(one.text.includes('أسبوع 19–25 يوليو 2026'));
});

test('المنع على مسار المتصفح يردّ صفحة عربية لا نصاً تقنياً', async () => {
  CURRENT = leadCon;
  const r = await call('GET', '/reports/period/print?period=week&anchor=2026-07-22&lens=sector&targetId=SOLUTIONS');
  assert.equal(r.status, 403);
  assert.ok(r.type.includes('text/html'));
  assert.ok(r.text.includes('تعذّر إصدار التقرير'));
  assert.ok(/نطاقك/.test(r.text));
  for (const bad of ['forbidden', 'Error:', 'undefined', 'null']) assert.ok(!r.text.includes(bad), `تسريب: ${bad}`);
});

test('المنع على الإصدار لا يكتب نسخة', async () => {
  CURRENT = leadCon;
  const before = (await get('SELECT COUNT(*) n FROM report_snapshot')).n;
  const r = await call('POST', '/reports/period/issue', { period: 'week', anchor: '2026-07-22', lens: 'company' });
  assert.equal(r.status, 403);
  assert.equal((await get('SELECT COUNT(*) n FROM report_snapshot')).n, before);
});

test('النسخة المحفوظة لا تُفتح لمن لا يملك عدستها', async () => {
  CURRENT = admin;
  const saved = JSON.parse((await call('POST', '/reports/period/issue?format=json',
    { period: 'month', anchor: '2026-07-15', lens: 'company' })).text);
  CURRENT = leadCon;
  const r = await call('GET', `/reports/period/snapshot/${saved.id}`);
  assert.equal(r.status, 403);
  assert.ok(r.text.includes('تعذّر إصدار التقرير'));
});

test('المقارنة تعود برسالة صريحة حين لا توجد نسخة للفترة السابقة', async () => {
  CURRENT = admin;
  const r = await call('GET', '/reports/period/compare?period=quarter&anchor=2025-02-10&lens=sector&targetId=SOLUTIONS');
  const body = JSON.parse(r.text);
  assert.equal(body.available, false);
  assert.ok(/لا نسخة محفوظة/.test(body.message_ar));
});
