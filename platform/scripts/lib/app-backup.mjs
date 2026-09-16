#!/usr/bin/env node
// النسخة الاحتياطية المنطقية عبر مسار التطبيق — مستخرَجةٌ من خطّ النشر (scripts/deploy.mjs)
// كي تُؤخذ **خارج النشر** أيضاً: قبل أي عملية بيانات على بيئة التجربة، حين يتعذّر pg_dump
// (منفذ القاعدة غير مبلوغ من بيئة التطوير — الوكيل يمرّر HTTPS وحده).
//
// ما تفعله: تسجيل دخول مدير النظام (نموذج الويب بحارس CSRF) → العدادات من /api/backup/counts
// → التنزيل من /api/backup/dump إلى data/backups (خارج git) → **المطابقة على مستويين**:
//   (١) كل جدول في الملف يحمل عدد صفوفه المعلَن وقت الأخذ ويجب أن يساوي ما وصل فعلاً (اكتمال البث)؛
//   (٢) عدادات الخادم قبل التنزيل تساوي ما في الملف — إلا سجل التدقيق، فهو يُلحَق فقط، وطلبا
//       العدادات والنسخة نفساهما يكتبان فيه سطراً لكلٍّ منهما، فيُقبل نموّه بهذا القدر لا أكثر.
// الصيغة نفسها التي تنتجها src/core/backup/dump.js وتستهلكها scripts/restore-dump.mjs.
// الأسرار تُقرأ وقت التشغيل من متغيّرات خدمة التطبيق ولا تُطبع.
//
// الاستعمال المستقل (إجراء إطلاق — يمسّ عنوان بيئة التجربة):
//   SANAD_RELEASE=1 node scripts/lib/app-backup.mjs --out=data/backups [--label=pre-workbook]
// يطبع المسار والحجم وعدد الجداول وعدد الأسطر، ويخرج بغير صفر عند أي إخفاق مطابقة.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
export const STAGING_URL = 'https://staging.os.evcsol.com';
// سجل التدقيق يُلحَق فقط: طلبا العدادات والنسخة يكتبان فيه، فيُقبل نموّه بهذا القدر لا أكثر.
const APPEND_ONLY_SLACK = { audit_log: 4 };

const capture = (cmd, argv, cwd = ROOT) =>
  spawnSync(cmd, argv, { cwd, stdio: 'pipe', encoding: 'utf8', env: process.env });

/** أول ١٢ حرفاً من التزام git الحالي — وسمُ اسم الملف. `nogit` حين لا شجرة. */
export function headShaShort(cwd = ROOT) {
  return (capture('git', ['rev-parse', '--short=12', 'HEAD'], cwd).stdout || '').trim() || 'nogit';
}

/**
 * متغيّرات خدمة التطبيق (حسابُ مدير النظام ورمزُ النسخة) — تُقرأ وقت التشغيل ولا تُطبع.
 * تُستعمل في موضعين: النسخة الاحتياطية، والمسحُ الحيّ بحسابٍ حقيقي — نسخةٌ واحدة من منطق
 * القراءة كي لا تفترق نسختان. تُقرأ بمعرّف الخدمة أولاً (المعرّفات لا تكذب) ثم باسمها.
 */
let _stagingVars;
export function readStagingVars({ appServiceId = process.env.SANAD_APP_SERVICE || '', serviceName = 'sanad-staging', cwd = ROOT } = {}) {
  if (_stagingVars !== undefined) return _stagingVars;
  const parse = (r) => { try { return JSON.parse(r.stdout || '{}'); } catch { return {}; } };
  let vars = appServiceId ? parse(capture('railway', ['variables', '--service', appServiceId, '--json'], cwd)) : {};
  if (!vars.SANAD_ADMIN_PASS || !vars.SANAD_BACKUP_TOKEN) {
    vars = parse(capture('railway', ['variables', '--service', serviceName, '--json'], cwd));
  }
  _stagingVars = vars;
  return vars;
}

/**
 * المطابقة على مستويين على محتوى الملف المكتوب — دالةٌ صافية قابلة للاختبار.
 * يعيد { ok, problem, seen, declared, tables, rows, lines }؛ `problem` نصُّ الخطأ كما يُطبع.
 */
export function verifyBackup(buf, counts = {}) {
  const lines = buf.toString('utf8').split('\n').filter(Boolean);
  const out = { ok: false, problem: null, seen: {}, declared: {}, tables: 0, rows: 0, lines: lines.length };
  let head = {};
  try { head = JSON.parse(lines[0] || '{}'); } catch { head = {}; }
  if (head._meta !== 'sanad-backup') { out.problem = 'النسخة بلا ترويسة سند'; return out; }
  const seen = out.seen; const declared = out.declared; let cur = null;
  for (const l of lines.slice(1)) {
    if (l.startsWith('{"_table":')) { const m = JSON.parse(l); cur = m._table; seen[cur] = 0; declared[cur] = Number(m._rows) || 0; continue; }
    if (cur) seen[cur]++;
  }
  out.tables = Object.keys(seen).length;
  out.rows = Object.values(seen).reduce((a, b) => a + b, 0);
  const cut = Object.keys(declared).filter((t) => seen[t] !== declared[t]);
  if (cut.length) { out.problem = `النسخة ناقصة — صفوف أقل من المعلَن في: ${cut.slice(0, 8).join('، ')}`; return out; }
  const mism = Object.keys(counts).filter((t) => {
    const got = seen[t] ?? -1; const slack = APPEND_ONLY_SLACK[t] || 0;
    return got < counts[t] || got > counts[t] + slack;
  });
  if (mism.length) { out.problem = `عدادات النسخة لا تطابق الخادم: ${mism.slice(0, 8).join('، ')}`; return out; }
  out.ok = true;
  return out;
}

/** اسم ملف النسخة: app-[الوسم-]الطابع.ndjson — الوسمُ الافتراضي التزامُ git. */
export function backupFileName({ label = '', tag = '', at = new Date() } = {}) {
  const safe = String(label).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const stamp = at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `app-${[safe, tag].filter(Boolean).join('-')}-${stamp}.ndjson`;
}

/**
 * النسخة المنطقية عبر مسار التطبيق. يعيد مسار الملف أو null (ويطبع سبب الإخفاق بالعربية).
 * baseUrl: عنوان البيئة · user/pass: حساب مدير النظام · token: رمز /api/backup
 * cookie: جلسةٌ جاهزة (نصُّ ترويسة Cookie) تُغني عن تسجيل الدخول · outDir: مجلد الكتابة
 * label: وسمٌ يُضاف إلى اسم الملف · tag: بديلُ التزام git في الاسم · log: مصرف الرسائل.
 */
export async function appLevelBackup({
  baseUrl = STAGING_URL,
  user = 'sysadmin',
  pass = '',
  token = '',
  cookie = '',
  outDir = join(ROOT, 'data/backups'),
  label = '',
  tag = null,
  log = console.log,
} = {}) {
  if ((!pass && !cookie) || !token) { log('✗ متغيّرا مدير النظام ورمز النسخة غير متاحين من الخدمة'); return null; }
  const jar = new Map();
  const cookieHeader = () => (cookie || [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  const absorb = (r) => { for (const l of r.headers.getSetCookie?.() || []) { const [k, v] = l.split(';')[0].split('='); if (k && v) jar.set(k.trim(), v.trim()); } };
  try {
    if (!cookie) {
      const seed = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(20000) }); absorb(seed); await seed.text();
      const login = await fetch(`${baseUrl}/auth/login-web`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
        body: new URLSearchParams({ username: user || 'sysadmin', password: pass, _csrf: jar.get('sanad_csrf') || '' }) });
      absorb(login); await login.text();
      if (!jar.get('sanad_sid')) { log('✗ تعذّر تسجيل دخول مدير النظام لأخذ النسخة'); return null; }
    }
    const H = { cookie: cookieHeader(), 'x-backup-token': token };
    const cr = await fetch(`${baseUrl}/api/backup/counts`, { headers: H, signal: AbortSignal.timeout(60000) });
    if (!cr.ok) { log(`✗ عدادات النسخة: HTTP ${cr.status}`); return null; }
    const counts = (await cr.json()).counts || {};
    const dr = await fetch(`${baseUrl}/api/backup/dump`, { headers: H, signal: AbortSignal.timeout(600000) });
    if (!dr.ok) { log(`✗ تنزيل النسخة: HTTP ${dr.status}`); return null; }
    const buf = Buffer.from(await dr.arrayBuffer());
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const file = join(outDir, backupFileName({ label, tag: tag ?? headShaShort() }));
    writeFileSync(file, buf);
    const v = verifyBackup(buf, counts);
    if (!v.ok) { log(`✗ ${v.problem}`); return null; }
    log(`✓ backup: app-level ${file} (${buf.length} bytes، ${v.tables} جدولاً، ${v.rows} صفاً — العدادات مطابقة)`);
    return file;
  } catch (e) { log(`✗ النسخة المنطقية: ${e?.message || e}`); return null; }
}

// ── مدخل الطرفية ──────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name, dflt = '') => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    return hit === undefined ? dflt : (hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true');
  };
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`الاستعمال: SANAD_RELEASE=1 node scripts/lib/app-backup.mjs --out=data/backups [--label=<وسم>] [--url=<عنوان>] [--service=<معرّف الخدمة>]
  يأخذ نسخة منطقية عبر مسار التطبيق ويتحقق منها بمستويين. يخرج ١ عند أي إخفاق.`);
    process.exit(0);
  }
  const baseUrl = (flag('url', STAGING_URL) || STAGING_URL).replace(/\/+$/, '');
  const outDir = resolve(ROOT, flag('out', 'data/backups'));
  const label = flag('label', '');
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(baseUrl);
  // بلوغُ عنوان بيئة التجربة إجراءُ إطلاق — البوابة نفسها التي يفرضها خطّ النشر.
  if (!local && process.env.SANAD_RELEASE !== '1') {
    console.error(`✗ أخذ النسخة من ${baseUrl} إجراءُ إطلاقٍ واعٍ: SANAD_RELEASE=1 مطلوب — لم يُنفَّذ أي طلب`);
    process.exit(2);
  }
  const env = process.env;
  let user = env.SANAD_ADMIN_USER || '';
  let pass = env.SANAD_ADMIN_PASS || '';
  let token = env.SANAD_BACKUP_TOKEN || '';
  if (!pass || !token) {
    const vars = readStagingVars({ appServiceId: flag('service', env.SANAD_APP_SERVICE || '') });
    user = user || vars.SANAD_ADMIN_USER || '';
    pass = pass || vars.SANAD_ADMIN_PASS || '';
    token = token || vars.SANAD_BACKUP_TOKEN || '';
  }
  if (!pass || !token) {
    console.error('✗ متغيّرا مدير النظام ورمز النسخة غير متاحين — مرّرهما بيئةً (SANAD_ADMIN_PASS / SANAD_BACKUP_TOKEN) أو أتح طرفية railway');
    process.exit(1);
  }
  const file = await appLevelBackup({ baseUrl, user: user || 'sysadmin', pass, token, outDir, label });
  if (!file) { console.error('✗ النسخة لم تكتمل أو لم تُطابق — لا تعتمدها'); process.exit(1); }
  const { statSync, readFileSync } = await import('node:fs');
  const buf = readFileSync(file);
  const v = verifyBackup(buf);
  console.log(`المسار: ${file}
الحجم: ${statSync(file).size} بايت
الجداول: ${v.tables}
الأسطر: ${v.lines}`);
  process.exit(v.ok ? 0 : 1);
}
