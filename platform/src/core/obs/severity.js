// رتبةُ من أصابه العطب، والفصلُ البنيوي بين ما يُنبَّه عليه وما لا يُنبَّه.
import { ROLE_LABELS } from '../rbac/matrix.js';

// «نسمع بالعطب قبل أن يشتكي صاحبه» — طلبُ قائد المنتج حرفياً. الرتبة تُستعمل ترتيباً
// وعتبةً أخفض، لا مرشِّحاً وحيداً: عطبٌ أصاب خمسين موظفاً أهمُّ من عطبٍ أصاب قائداً واحداً.
//
// ومدير النظام **واحدٌ لا ثلاثة** عمداً: حسابه حسابُ المطوّر والمُختبِر، فرفعُه يجعل كل
// عطبٍ صنعناه بأيدينا يبدو حادثةً تنفيذية.
const RANK = {
  ceo_office: 3,
  sector_lead: 2, department_manager: 2, bd_head: 2,
  line_manager: 1, admin: 1,
};
export const seniorityRank = (roleId) => RANK[String(roleId || '')] || 0;
export const RANKED_ROLES = Object.keys(RANK);

// ── الفصل الذي يمنع الحلقة ──
// حلقةُ المالك: عطبٌ في البريد ⇒ رسالةُ تنبيه ⇒ البريد يُخفق ⇒ عطبٌ آخر ⇒ رسالةٌ أخرى…
// تُقطع **عند الالتقاط لا عند الإرسال**: ما ينشأ في البريد أو في محرّك التقارير أو في
// وحدة المراقبة نفسها يُوسم غير قابلٍ للتنبيه، ويحمل الصفُّ الوسمَ، ويشترطه استعلامُ
// التنبيه. فالقطع شرطٌ في الاستعلام لا يستطيع المُرسِل تجاوزه — لا مهلةٌ تُضبَط فتُنسى.
//
// وهي تبقى **ظاهرةً كاملةً في الشاشة**: الصفحة لا ترشّح بهذا الوسم إطلاقاً. لا يُخفى شيء
// عن الإنسان؛ إنما يُقطع زنادُ البريد وحده. وأعطابُ البريد محفوظةٌ أصلاً في طابوره وسجلّه
// وظاهرةٌ في مركز البريد، فلا شيء يضيع.
const MUTE_PATHS = ['src/core/mail/', 'src/core/reports/engine.js', 'src/core/obs/'];
const MUTE_JOBS = ['processQueue', 'sweepApprovalMail', 'errorDigest'];

export function isDigestable({ kind, job, source, stack } = {}) {
  if (kind === 'job' && MUTE_JOBS.includes(String(job || ''))) return 0;
  const hay = `${source || ''}\n${stack || ''}`;
  for (const p of MUTE_PATHS) if (hay.includes(p)) return 0;
  return 1;
}

// اسمُ الدور عربياً للعرض — من مصدر الأدوار نفسه لا من نسخةٍ ثانية.
export const roleLabelAr = (roleId) => ROLE_LABELS[String(roleId || '')]?.ar || null;
