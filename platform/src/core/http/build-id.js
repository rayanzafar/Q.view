// معرّف النشرة — كيف يعرف خطُّ النشر أنّ الحاوية التي تجيبه هي الجديدة لا القديمة؟
//
// عند التبديل بين نشرتين تبقى الحاوية القديمة تجيب ثوانيَ أو دقائق بعد أن تعلن الجديدة
// جاهزيتها؛ و/ready كان يقول {ready:true} من كلتيهما، فانطلق المسحُ الحي على القديمة ورأى
// صفحةً «لا وجود لها» فأنذر كذباً (نشرة v5.58، 2026-08-28). الحلّ: يكتب deploy.mjs ملفَّ
// `.build-id` قبل الرفع (لا يُلتزَم في git، ويُشحَن مع الصورة)، ويقرأه الخادم مرةً عند الإقلاع
// ويعلنه في /ready، وينتظر خطُّ النشر المعرّفَ الذي كتبه هو لا مجرّدَ «جاهز».
//
// ما في المعرّف: أول اثني عشر حرفاً من التزام git وطابعٌ زمني — لا سرّ فيه ولا مضيف ولا اسم
// قاعدة (مبدأ /ready نفسه: لا تفصيل يغادر لمتصل غير موثَّق).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const BUILD_ID_FILE = '.build-id';

/** يقرأ معرّف النشرة من جذر المشروع؛ null حين لا ملف (تشغيل محلي أو رفعٌ من خارج الخطّ). */
export function readBuildId(root) {
  try {
    const raw = readFileSync(join(root, BUILD_ID_FILE), 'utf8').trim();
    return /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : null;
  } catch { return null; }
}

// ── الطريق الثاني: وسم النشرة من معرّف Railway ──────────────────────────────────────────
// في نشرة v5.74 (2026-09-05) لم يصل ملف `.build-id` إلى الحاوية (طرفية Railway 5.41 تُهمل ما في
// `.gitignore` عند الرفع رغم `.railwayignore`)، فأعلن /ready «جاهز» بلا معرّف وانتظر الخطُّ سبع دقائق
// ثم أنذر — والنشرة كانت قد نجحت فعلاً. لا يُعتمد على ملفٍ يُشحن: Railway تحقن معرّف النشرة نفسه
// في البيئة (`RAILWAY_DEPLOYMENT_ID`)، والخطّ يلتقط المعرّف ذاته من مخرجات الرفع — فيُقارَن **وسمٌ**
// مشتقّ منه (اقتطاع من بصمته، لا المعرّف الخام: لا تفصيل داخلي يغادر لمتصل غير موثَّق).
export function deploymentTagOf(deploymentId) {
  const id = String(deploymentId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return 'dep-' + createHash('sha256').update(id.toLowerCase()).digest('hex').slice(0, 12);
}
/** وسم النشرة الحالية من بيئة التشغيل؛ null خارج Railway. */
export const deploymentTag = (env = process.env) => deploymentTagOf(env.RAILWAY_DEPLOYMENT_ID);

/** ما يُعلنه /ready: ملف `.build-id` إن شُحن، وإلا وسم النشرة من البيئة، وإلا null (تشغيل محلي). */
export const announcedBuildId = (root, env = process.env) => readBuildId(root) || deploymentTag(env);
