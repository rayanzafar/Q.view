#!/usr/bin/env node
// PreToolUse hook. Guards two tool families:
//  - Edit|Write: block edits to deployed (immutable) migrations and to secret/data files.
//  - Bash: block committing secrets/snapshots, deploying from a lane worktree, and reckless deletes.
// Exit 2 => tool call is DENIED and stderr is shown to Claude.
import { existsSync } from 'node:fs';
const input = await new Promise((res) => { let b = ''; process.stdin.on('data', (c) => b += c); process.stdin.on('end', () => res(b)); });
let j = {};
try { j = JSON.parse(input || '{}'); } catch { /* ignore */ }
const tool = j.tool_name || '';
const deny = (msg) => { process.stderr.write(msg); process.exit(2); };

if (tool === 'Edit' || tool === 'Write') {
  const f = j.tool_input?.file_path || '';
  // أي هجرة مرقّمة **موجودة** غير قابلة للتعديل (لا 001–004 وحدها): وجودُ الملف هو العلامة،
  // فتعديلُ القائم يُمنَع وإنشاءُ ملفٍ جديد برقمٍ تالٍ يمرّ (لا يوجد بعد).
  if (/migrations\/\d{3}_[^/]+\.sql$/.test(f) && existsSync(f) && !process.env.SANAD_ALLOW_MIGRATION_EDIT)
    deny(`ممنوع: ${f} هجرة منشورة وغير قابلة للتعديل. أنشئ ملف هجرة جديداً برقم تالٍ. (للتجاوز الواعي: SANAD_ALLOW_MIGRATION_EDIT=1)`);
  if (/seed\/.*\.(snapshot|demo)\.json$/.test(f) || /(^|\/)\.env($|\.)/.test(f) || /data\/backups\//.test(f))
    deny(`ممنوع: ${f} ملف بيانات حساس/سري — لا يُعدَّل ولا يُلتزم عبر الأدوات.`);
}

if (tool === 'Bash') {
  const cmd = j.tool_input?.command || '';
  const cwd = j.cwd || process.cwd();
  const release = process.env.SANAD_RELEASE === '1';
  // النشر والوصول للبيئة الحيّة فعلٌ مقصود لا عرَضيّ: جلسة الاختبار الاستكشافي لا تصل إليهما.
  // railway **مستدعىً برنامجاً** (في موضع أمرٍ: بدايةً أو بعد فاصلٍ صَدَفيّ، مع إمكان إسناد
  // متغيّرات بيئةٍ قبله) يمسّ المشروع الحيّ — فيُمنَع ما لم تكن جلسةَ إطلاقٍ صريحة (SANAD_RELEASE=1).
  // القيدُ على الموضع لا على ذكر الكلمة: رسالةُ إيداعٍ تذكر «railway» ليست استدعاءً.
  if (/(?:^|[;&|(\n]|&&|\|\|)\s*(?:[A-Za-z_]\w*=\S*\s+)*railway\b/.test(cmd) && !release)
    deny('ممنوع في جلسة غير-إطلاق: استدعاء railway يمسّ البيئة الحيّة (نشراً أو قراءةَ أسرارٍ وسجلّات).\n'
      + 'الاختبار الاستكشافي يعمل على نسخة محلية قابلة للرمي (scripts/qa-up.mjs). للإطلاق الواعي: export SANAD_RELEASE=1.');
  // الوصول الشبكيّ إلى نطاق staging الحيّ (بمخطّط http/https) فعلُ إطلاقٍ كذلك. اشتراطُ المخطّط
  // يمنع الإيجابيةَ الكاذبة حين يُذكر النطاق نصّاً في رسالة إيداعٍ أو تعليق.
  if (/https?:\/\/[^\s'"]*(?:staging\.os\.evcsol\.com|sanad-staging-production\.up\.railway\.app)/.test(cmd) && !release)
    deny('ممنوع في جلسة غير-إطلاق: هذا الأمر يتّصل بالنشرة الحيّة (staging.os.evcsol.com).\n'
      + 'اختبر على النسخة المحلية القابلة للرمي. للتحقّق الحيّ الواعي: export SANAD_RELEASE=1.');
  // deploying from a parallel-lane worktree would ship unmerged code
  if (/\brailway\s+up\b/.test(cmd) && /\/wt-[^/]+/.test(cwd + ' ' + cmd))
    deny('ممنوع: النشر (railway up) يتم فقط من مسار التكامل platform/ — ليس من worktree حارة موازية.');
  // committing sensitive files
  if (/\bgit\s+(add|commit)\b/.test(cmd)) {
    const bad = cmd.match(/seed\/[^\s]*\.(snapshot|demo)\.json|(^|\s)\.env(\s|$)|data\/backups\//);
    if (bad) deny(`ممنوع: الأمر يضيف/يلتزم ملفاً حساساً (${bad[0].trim()}). هذه الملفات تبقى خارج git دائماً.`);
  }
  // destructive deletes outside safe zones
  if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/.test(cmd) && !/scratchpad|node_modules|\/tmp\//.test(cmd))
    deny('ممنوع: rm -rf خارج scratchpad/node_modules/tmp — احذف بدقة أو انقل بدلاً من الحذف.');
  // never touch the legacy production Railway project
  if (/honest-spirit/.test(cmd) && /(delete|remove|redeploy|variable|up\b)/.test(cmd))
    deny('ممنوع: مشروع المنصة القديمة honest-spirit للقراءة فقط (نسخة احتياطية حية).');
}
process.exit(0);
