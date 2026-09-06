#!/usr/bin/env node
// خطُّ النشر الواحد إلى staging — الطريق الوحيد المسموح به للنشر (قاعدة ما بعد حادثة
// 2026-08-11: نشرُ صورة التطبيق وقع على خدمة قاعدة البيانات لأن حالَ ربط الطرفية كان يشير
// إليها، ثم أزال أمرُ الإزالة نشرةَ القاعدة النشطة فسقطت البيئة ~25 دقيقة).
//
// المبادئ الصلبة:
//   • الهدف يُسمّى بمعرّفه الفريد لا باسمه: اسمُ المشروع يساوي اسمَ خدمة التطبيق
//     («sanad-staging») فتكذب فحوص الأسماء — والمعرّفات لا تكذب.
//   • حالُ الربط (‎~/.railway/config.json) لا يُوثَق به أبداً — يُقرأ للتحذير فقط،
//     وكلُّ نداءٍ يمرّر الخدمة صراحةً.
//   • لا `down` ولا `redeploy` هنا ولا في أي جلسة (الخطّاف يمنعهما): التراجع من لوحة
//     Railway (Deployments ▸ السابقة ▸ Redeploy) أو بتحديث متغيّرٍ (يعيد النشر من مصدر
//     الخدمة لا من آخر لقطة).
//   • نسخة احتياطية قبل كل نشر — لا عند الترحيلات وحدها.
//
// الاستعمال: SANAD_RELEASE=1 npm run deploy [-- --skip-gates --allow-dirty --no-sweep]
// الدليل الكامل: docs/guides/DEPLOY-PIPELINE.md
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { deploymentTagOf } from '../src/core/http/build-id.js';

const PROJECT_ID = '892124c7-a66e-4ac7-bd7d-e4827b3e5f40';   // sanad-staging (المشروع)
const ENV_ID = 'd654abc4-b261-476b-a11a-b1df477a55b9';       // production (بيئة staging الوحيدة)
const APP_SERVICE_ID = '6981eaef-29c1-40b1-8aca-8c606dfd44e3';      // خدمة التطبيق sanad-staging
const POSTGRES_SERVICE_ID = '46db5bda-3de4-4189-8677-cb973769c241'; // قاعدة البيانات — لا تُنشر عليها أبداً
const STAGING_URL = 'https://staging.os.evcsol.com';
const SEEDED_ROLES = 'demo.deptmgr,demo.linemgr,demo.bdhead,demo.ops,demo.procurement,demo.approver,demo.external'; // KI-028

const args = new Set(process.argv.slice(2));
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const log = (m) => console.log(`\n▶ ${m}`);
const fail = (m) => {
  console.error(`\n✗ ${m}`);
  console.error(`\nمسارات التراجع (لا تستعمل down/redeploy أبداً):
  • لوحة Railway: الخدمة sanad-staging ▸ Deployments ▸ النشرة السابقة الخضراء ▸ Redeploy
  • أو أعد النشر من مصدر الخدمة بتحديث متغيّر (railway variables --set …) — يعيد البناء من
    مصدر الخدمة لا من آخر لقطة
  • البيانات: docs/guides/ROLLBACK.md + النسخة في data/backups/ + أرشيف PITR`);
  process.exit(1);
};
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', env: process.env, ...opts });
  return r;
};

// ── ١) الشروط المسبقة ─────────────────────────────────────────────────────────
log('١/٧ الشروط المسبقة');
if (process.env.SANAD_RELEASE !== '1') fail('النشر جلسةُ إطلاقٍ واعية: SANAD_RELEASE=1 مطلوب');
// Reject before any subprocess: a release without a verified backup is never allowed.
if (args.has('--no-backup')) fail('لا يمكن تجاوز النسخة الاحتياطية؛ كل إصدار يتطلب نسخة ناجحة قبل النشر');
// No preview implementation exists here. Never silently treat this flag as a real release.
if (args.has('--dry-run')) fail('المعاينة غير متاحة في أمر النشر؛ لم يُنفّذ أي إجراء');
if (!existsSync(join(ROOT, 'railway.json')) || !existsSync(join(ROOT, 'scripts/boot.sh'))) {
  fail(`يجب التشغيل من platform/ — المسار الحالي: ${ROOT}`);
}
const dirty = run('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
if (dirty && !args.has('--allow-dirty')) {
  fail(`شجرة git ليست نظيفة (يُنشر الملتزَم لا المسودّة):\n${dirty.split('\n').slice(0, 8).join('\n')}\nللتجاوز الواعي: --allow-dirty`);
}
if (dirty) console.log('⚠ متابعةٌ بشجرةٍ غير نظيفة (بطلبك الصريح) — ما لم يُلتزم سيُنشر أيضاً');

// حالُ الربط يُقرأ للتحذير فقط — النشر نفسه لا يعتمد عليه أبداً.
try {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.railway', 'config.json'), 'utf8'));
  const link = cfg?.projects?.[ROOT];
  if (link && link.project !== PROJECT_ID) fail(`الطرفية مربوطة بمشروعٍ آخر (${link.project}) — أعد الربط بمشروع sanad-staging`);
  if (link && link.service === POSTGRES_SERVICE_ID) {
    console.log('⚠⚠ الطرفية مربوطة حالياً بخدمة قاعدة البيانات — هذا بالضبط ما أسقط البيئة في حادثة 2026-08-11.');
    console.log('   النشرُ هنا آمن (الخدمة تُمرَّر بمعرّفها صراحةً)، لكن أعد الربط بخدمة التطبيق بعد الانتهاء.');
  }
} catch { console.log('ℹ لا حالَ ربطٍ مقروء — لا بأس: كل نداءٍ يمرّر الخدمة صراحةً'); }

// ── ٢) البوابات ───────────────────────────────────────────────────────────────
if (args.has('--skip-gates')) {
  console.log('⚠ تخطّي البوابات (بطلبك الصريح) — يُقبل فقط لإعادة نشرِ شجرةٍ سبق التحقق منها');
} else {
  log('٢/٧ البوابات: المعجم والوثائق ثم الحزمة كاملة');
  for (const [name, argv] of [
    ['المعجم', ['scripts/check-glossary.mjs']],
    ['الوثائق', ['scripts/check-docs.mjs']],
  ]) {
    if (run('node', argv).status !== 0) fail(`بوابة ${name} حمراء — أصلح ثم أعد`);
  }
  if (run('npm', ['test', '--silent']).status !== 0) fail('الاختبارات حمراء — لا نشر على أحمر');
}

// ── ٣) النسخة الاحتياطية (قبل كل نشر — لا عند الترحيلات وحدها) ─────────────────
{
  log('٣/٧ نسخة احتياطية من قاعدة staging');
  // pg_dump: من المسار، أو PG_BIN، أو استخراجُ pg18 في scratchpad جلسةٍ سابقة.
  let pgBin = '';
  if (run('sh', ['-c', 'command -v pg_dump'], { capture: true }).status !== 0) {
    const cand = [process.env.PG_BIN, ...(() => {
      try {
        return readdirSync('/tmp').filter((d) => d.startsWith('claude-')).flatMap((d) => {
          const base = `/tmp/${d}`;
          try {
            return readdirSync(base, { recursive: false }).flatMap((p) => {
              const g = `${base}/${p}`;
              try { return readdirSync(g).filter((x) => x === 'scratchpad').map(() => `${g}/scratchpad/pg18/extract/usr/lib/postgresql/18/bin`); } catch { return []; }
            });
          } catch { return []; }
        });
      } catch { return []; }
    })()].filter(Boolean).filter((p) => existsSync(join(p, 'pg_dump')));
    if (!cand.length) fail('pg_dump غير متاح — ثبّته أو مرّر PG_BIN=<مجلد ثنائيات postgres>');
    pgBin = cand[0];
    console.log(`ℹ pg_dump من: ${pgBin}`);
  }
  // مكتبة libpq بجوار ثنائيات pg (‎.../usr/lib/x86_64-linux-gnu حين تُستخرَج حزمة pg18)،
  // أو يمرّرها المشغّل بـ PG_LIB. بلا LD_LIBRARY_PATH يفشل pg_dump المُستخرَج بـ libpq.so.5.
  const libDir = process.env.PG_LIB
    || (pgBin ? resolve(pgBin, '../../../x86_64-linux-gnu') : '');
  const inner = `${pgBin ? `PATH="${pgBin}:$PATH" ` : ''}${libDir && existsSync(libDir) ? `LD_LIBRARY_PATH="${libDir}" ` : ''}DATABASE_URL="$DATABASE_PUBLIC_URL" sh scripts/pg-backup.sh`;
  // الخدمة تُسمّى صراحةً في نداء الحقن — بلا الاعتماد على حال الربط. (حقنُ بيئةٍ لا نشرٌ.)
  const bk = run('railway', ['run', '--service', 'Postgres', '--', 'sh', '-c', inner], { capture: true });
  const out = (bk.stdout || '') + (bk.stderr || '');
  let backupFile = null;
  if (bk.status !== 0 || !/✓ backup:/.test(out)) {
    // بعض إصدارات الطرفية لا تدعم service على run — جرّب على حال الربط الحالي إن كان القاعدة.
    const bk2 = run('railway', ['run', 'sh', '-c', inner], { capture: true });
    const out2 = (bk2.stdout || '') + (bk2.stderr || '');
    if (bk2.status !== 0 || !/✓ backup:/.test(out2)) {
      // الطريق الثاني — نسخة **حقيقية** لا تخطٍّ: منفذ القاعدة (العام والداخلي) غير مبلوغ من بيئة
      // التطوير (الوكيل يمرّر HTTPS وحده)، فيأخذ الخطُّ النسخة المنطقية من داخل التطبيق نفسه عبر
      // `/api/backup/dump` (جلسة مدير نظام + رمز النسخة من متغيّرات الخدمة)، ويتحقق من العدادات
      // جدولاً جدولاً مقابل `/api/backup/counts`. وسيلة الاستعادة: scripts/restore-dump.mjs (مختبرة).
      console.log('ℹ pg_dump لم يبلغ القاعدة — الطريق الثاني: النسخة المنطقية عبر مسار التطبيق');
      backupFile = await appLevelBackup();
      if (!backupFile) fail(`النسخة الاحتياطية فشلت:\n${out}\n${out2}`);
    } else console.log(out2.trim().split('\n').pop());
  } else {
    console.log(out.trim().split('\n').pop());
  }
  // جرد الترحيلات على البيئة (KI-111): ما طُبّق فعلاً من نسختها مقابل المستودع، وأي معلَّقةٍ تحمل
  // تعديل بيانات تُعلَن هنا قبل الرفع — الإقلاع يطبّق المعلَّق كله، فالمراجعة تسبقه لا تلحقه.
  if (backupFile) {
    try {
      const { inventoryFromDump, formatInventory } = await import('./migration-inventory.mjs');
      const inv = await inventoryFromDump(backupFile, join(ROOT, 'migrations'));
      console.log(formatInventory(inv));
      if (Object.keys(inv.dml).length && !args.has('--accept-pending-dml')) {
        fail('ترحيلة معلَّقة تحمل تعديل بيانات — راجعها سجلاً سجلاً ثم أعد النشر بـ --accept-pending-dml (قرار واعٍ مسجَّل في مخرجات النشر)');
      }
    } catch (e) { if (String(e?.message || '').includes('تعديل بيانات')) throw e; console.log(`⚠ تعذّر جرد الترحيلات من النسخة: ${e?.message || e}`); }
  } else {
    console.log('ℹ الجرد من نسخة pg_dump غير مدعوم هنا — راجع schema_migration يدوياً قبل الرفع (KI-111)');
  }
}

/**
 * النسخة المنطقية عبر مسار التطبيق: تسجيل دخول مدير النظام (نموذج الويب بحارس CSRF)، ثم العدادات،
 * ثم التنزيل سطراً سطراً إلى data/backups (خارج git)، ثم مطابقة العدادات. يعيد مسار الملف أو null.
 * الأسرار تُقرأ وقت التشغيل من متغيّرات خدمة التطبيق ولا تُطبع.
 */
async function appLevelBackup() {
  const vr = run('railway', ['variables', '--service', APP_SERVICE_ID, '--json'], { capture: true });
  let vars = {};
  try { vars = JSON.parse(vr.stdout || '{}'); } catch { vars = {}; }
  if (!vars.SANAD_ADMIN_PASS || !vars.SANAD_BACKUP_TOKEN) {
    const vr2 = run('railway', ['variables', '--service', 'sanad-staging', '--json'], { capture: true });
    try { vars = JSON.parse(vr2.stdout || '{}'); } catch { vars = {}; }
  }
  if (!vars.SANAD_ADMIN_PASS || !vars.SANAD_BACKUP_TOKEN) { console.log('✗ متغيّرا مدير النظام ورمز النسخة غير متاحين من الخدمة'); return null; }
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (r) => { for (const l of r.headers.getSetCookie?.() || []) { const [k, v] = l.split(';')[0].split('='); if (k && v) jar.set(k.trim(), v.trim()); } };
  try {
    const seed = await fetch(`${STAGING_URL}/login`, { signal: AbortSignal.timeout(20000) }); absorb(seed); await seed.text();
    const login = await fetch(`${STAGING_URL}/auth/login-web`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
      body: new URLSearchParams({ username: vars.SANAD_ADMIN_USER || 'sysadmin', password: vars.SANAD_ADMIN_PASS, _csrf: jar.get('sanad_csrf') || '' }) });
    absorb(login); await login.text();
    if (!jar.get('sanad_sid')) { console.log('✗ تعذّر تسجيل دخول مدير النظام لأخذ النسخة'); return null; }
    const H = { cookie: cookieHeader(), 'x-backup-token': vars.SANAD_BACKUP_TOKEN };
    const cr = await fetch(`${STAGING_URL}/api/backup/counts`, { headers: H, signal: AbortSignal.timeout(60000) });
    if (!cr.ok) { console.log(`✗ عدادات النسخة: HTTP ${cr.status}`); return null; }
    const counts = (await cr.json()).counts || {};
    const dr = await fetch(`${STAGING_URL}/api/backup/dump`, { headers: H, signal: AbortSignal.timeout(600000) });
    if (!dr.ok) { console.log(`✗ تنزيل النسخة: HTTP ${dr.status}`); return null; }
    const buf = Buffer.from(await dr.arrayBuffer());
    const dir = join(ROOT, 'data/backups');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, `app-${headShaShort()}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}.ndjson`);
    writeFileSync(file, buf);
    // المطابقة: الترويسة، ثم عدد صفوف كل جدول في الملف مقابل عدادات الخادم قبل التنزيل
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const head = JSON.parse(lines[0] || '{}');
    if (head._meta !== 'sanad-backup') { console.log('✗ النسخة بلا ترويسة سند'); return null; }
    const seen = {}; let cur = null;
    for (const l of lines.slice(1)) {
      if (l.startsWith('{"_table":')) { cur = JSON.parse(l)._table; seen[cur] = 0; continue; }
      if (cur) seen[cur]++;
    }
    const mism = Object.keys(counts).filter((t) => (seen[t] ?? -1) !== counts[t]);
    if (mism.length) { console.log(`✗ عدادات النسخة لا تطابق الخادم: ${mism.slice(0, 8).join('، ')}`); return null; }
    const rows = Object.values(seen).reduce((a, b) => a + b, 0);
    console.log(`✓ backup: app-level ${file} (${buf.length} bytes، ${Object.keys(seen).length} جدولاً، ${rows} صفاً — العدادات مطابقة)`);
    return file;
  } catch (e) { console.log(`✗ النسخة المنطقية: ${e?.message || e}`); return null; }
}
function headShaShort() { return (run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true }).stdout || '').trim() || 'nogit'; }

// ── ٤) النشر — الخدمة بمعرّفها الفريد، لا بالاسم ولا بحال الربط ────────────────
log(`٤/٧ النشر إلى خدمة التطبيق ${APP_SERVICE_ID}`);
// معرّف هذه النشرة: التزام git + طابع زمني، في ملفٍ مُهمَل من git ومشحونٍ مع الصورة. الخادم
// يعلنه في /ready، وبه تُميَّز الحاوية الجديدة من القديمة التي تبقى تجيب أثناء التبديل
// (المسحُ الحي انطلق مرةً على القديمة فأنذر كذباً — انظر src/core/http/build-id.js).
const headSha = (run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true }).stdout || '').trim() || 'nogit';
const BUILD_ID = `${headSha}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
writeFileSync(join(ROOT, '.build-id'), BUILD_ID + '\n');
console.log(`ℹ معرّف النشرة المكتوب: ${BUILD_ID}`);
const up = run('railway', ['up', '--detach', '--service', APP_SERVICE_ID, '--environment', ENV_ID], { capture: true });
const upOut = (up.stdout || '') + (up.stderr || '');
console.log(upOut.trim());
if (up.status !== 0) fail('railway up فشل');
const depId = (upOut.match(/id=([0-9a-f-]{36})/) || [])[1] || null;
console.log(depId ? `ℹ معرّف النشرة: ${depId}` : 'ℹ لم يُلتقط معرّف النشرة من المخرجات');

// ── ٥) انتظار الجاهزية ────────────────────────────────────────────────────────
// «جاهز» وحدها لا تكفي: الحاوية القديمة تقولها أيضاً. نطلب المعرّف الذي كتبناه للتوّ — أو وسمَ
// النشرة المشتقّ من معرّف Railway الذي التقطناه من مخرجات الرفع (الطريق الثاني حين لا يصل
// ملف `.build-id` إلى الحاوية — نشرة v5.74: الطرفية 5.41 تُهمل ما في .gitignore عند الرفع).
const DEP_TAG = deploymentTagOf(depId);
const accepted = [BUILD_ID, DEP_TAG].filter(Boolean);
log(`٥/٧ انتظار /ready بالمعرّف ${BUILD_ID}${DEP_TAG ? ` أو الوسم ${DEP_TAG}` : ''} (حتى ٧ دقائق)`);
let ready = false; let sawOld = false; let seenBuild = null;
const deadline = Date.now() + 7 * 60000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10000));
  try {
    const res = await fetch(`${STAGING_URL}/ready`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const j = await res.json();
      if (j.ready === true && accepted.includes(j.build)) { ready = true; seenBuild = j.build; break; }
      if (j.ready === true) sawOld = true; // القديمة ما زالت تجيب — ننتظر التبديل
    }
  } catch { /* لم تجهز بعد */ }
  process.stdout.write(sawOld ? '·' : '.');
}
console.log('');
if (!ready) fail(`/ready لم تُعلن المعرّف ${BUILD_ID}${DEP_TAG ? ` ولا الوسم ${DEP_TAG}` : ''} خلال المهلة — افحص سجلّات الإقلاع (الترحيلة الفاشلة توقف الإقلاع عمداً)، وإن كانت النشرة قد نجحت فأعد المسح يدوياً: node scripts/sweep.mjs ${STAGING_URL}`);
console.log(`✓ البيئة جاهزة بالنشرة ${seenBuild}${seenBuild === DEP_TAG ? ' (وسم النشرة — ملف .build-id لم يُشحن)' : ''}`);

// ── ٦) سجلّات الإقلاع: الترحيلات طُبّقت ولا أخطاء ─────────────────────────────
log('٦/٧ فحص سجلّات الإقلاع');
const logs = run('railway', ['logs', '--service', APP_SERVICE_ID], { capture: true });
const logTxt = (logs.stdout || '') + (logs.stderr || '');
if (logs.status === 0 && logTxt) {
  if (/فشلت الترحيلة/.test(logTxt)) fail('سجل الإقلاع يذكر ترحيلة فاشلة');
  const mig = logTxt.match(/applied migration [^\n]+/g);
  console.log(mig ? mig.slice(-5).join('\n') : 'ℹ لا سطور ترحيلة في آخر السجل (لا ترحيلات جديدة أو السجل مقصوص)');
} else {
  console.log('ℹ تعذّرت قراءة السجلّات من الطرفية — افحصها من لوحة Railway أو عبر أدوات MCP');
}

// ── ٧) المسح الحي (الأدوار المبذورة السبعة — KI-028) ─────────────────────────
if (args.has('--no-sweep')) {
  console.log('⚠ تخطّي المسح الحي بطلبك الصريح');
} else {
  log('٧/٧ المسح الحي');
  const sw = run('node', ['scripts/sweep.mjs', STAGING_URL, `--roles=${SEEDED_ROLES}`]);
  if (sw.status !== 0) fail('المسح الحي رصد انحرافاً — راجع مخرجاته أعلاه');
}

console.log(`\n✓ النشر اكتمل وتحقّق. الخطوات التالية اليدوية:
  • أدلة الشاشات: node scripts/evidence.mjs ${STAGING_URL}
  • علِّم إصدارات CHANGELOG بأنها منشورة، والتزم وادفع
  • إن كانت الطرفية مربوطة بغير خدمة التطبيق فأعد ربطها الآن`);
