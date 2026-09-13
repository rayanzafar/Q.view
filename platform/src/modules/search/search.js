// البحث الشامل («لوحة الأوامر» Ctrl/Cmd+K) — يعيد استخدام دوال العرض المُصرَّحة لكل نطاق
// (listOpportunities/listProjects/listClients/staffingRoster) فيرث نطاقها الآمن حرفياً؛ لا منطق
// تفويض جديد هنا. تُستبعد فئة كاملة إن كان المستخدم لا يملك حتى صلاحية فتح صفحتها — بالشروط
// نفسها التي يفتح بها الحارس الصفحة، مقروءةً من مصدرها الواحد في core لا منسوخةً هنا: النسخة
// كانت تتطلب تعديلاً موازياً عند كل تغيير، وأول سهو فيها يُظهر في البحث ما لا تفتحه الصفحة.
//
// والمطابقة عربيةٌ متسامحة (core/i18n/arabic.js): همزةٌ أو تاءٌ مربوطة أو ألفٌ مقصورة أو تشكيلٌ
// أو رقمٌ هندي لا يُخفي سجلاً، والكلمات تُطابَق كلُّها بأي ترتيب، وخطأٌ واحد في الكلمة الطويلة
// يُغتفر — والأدقّ يتقدّم: المطابقة التامة ثم البادئة ثم الاحتواء ثم التقريب.
import { all } from '../../core/db/index.js';
import { PAGE_ACCESS } from '../../core/policy/pages.js';
import { listOpportunities } from '../crm/opportunities.js';
import { listProjects } from '../pmo/projects.js';
import { listClients } from '../clients/clients.js';
import { staffingRoster } from '../org/org.js';
import { fmtSar } from '../../core/util/ids.js';
import { bestScore, searchTokens } from '../../core/i18n/arabic.js';

const CAP = 6;

async function clientNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const rows = await all(`SELECT id, name_ar FROM client WHERE id IN (${uniq.map(() => '?').join(',')})`, uniq);
  return Object.fromEntries(rows.map((r) => [r.id, r.name_ar]));
}

const STATUS_AR = { IN_PROGRESS: 'قيد التنفيذ', COMPLETED: 'مكتمل', PLANNED: 'مُخطَّط', ON_HOLD: 'متوقّف مؤقتًا', CANCELLED: 'ملغى', NOT_STARTED: 'لم يبدأ' };

// أفضل CAP صفوفٍ بدرجتها: من طابق أدقّ يتقدّم، ومع التساوي يبقى ترتيب الخدمة (الأحدث/الأبجدي).
function topMatches(rows, q, fieldsOf) {
  return rows
    .map((r, i) => ({ r, i, s: bestScore(fieldsOf(r), q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, CAP)
    .map((x) => x.r);
}

export async function globalSearch(user, qRaw) {
  const q = String(qRaw || '').trim();
  if (q.length < 2 || !searchTokens(q).length) return [];
  const results = [];

  if (PAGE_ACCESS.opportunities(user)) {
    // العنوان ورقم المنافسة (الترحيلة 048): من يبحث برقم كراسة الشروط يجد فرصته
    const matched = topMatches(await listOpportunities(user, {}), q, (o) => [o.title_ar, o.tender_no]);
    const cn = await clientNames(matched.map((o) => o.client_id));
    for (const o of matched) results.push({
      category: 'opportunity', label: 'فرصة', id: o.id, title: o.title_ar,
      subtitle: [cn[o.client_id], fmtSar(o.value_halalas)].filter(Boolean).join(' · '),
      href: `/app/opportunity/${o.id}`,
    });
  }
  if (PAGE_ACCESS.projects(user)) {
    const matched = topMatches(await listProjects(user, {}), q, (p) => [p.name_ar]);
    const cn = await clientNames(matched.map((p) => p.client_id));
    for (const p of matched) results.push({
      category: 'project', label: 'مشروع', id: p.id, title: p.name_ar,
      subtitle: [cn[p.client_id], STATUS_AR[p.status] || p.status].filter(Boolean).join(' · '),
      href: `/app/project/${p.id}`,
    });
  }
  if (PAGE_ACCESS.clients(user)) {
    // خدمة الجهات تطابق بتطبيعها هي (سجلٌّ مبنيٌّ على محاربة التكرار)؛ وما يفوتها يُلتقط هنا
    // بالمطابقة نفسها على القائمة كلها — فلا تختلف نتيجة البحث باختلاف الباب.
    const byService = await listClients(user, { query: q });
    const matched = byService.length >= CAP ? byService.slice(0, CAP)
      : topMatches(await listClients(user, {}), q, (c) => [c.name_ar, c.name_en]);
    for (const c of matched.slice(0, CAP)) results.push({
      category: 'client', label: 'عميل', id: c.id, title: c.name_ar,
      subtitle: [c.type, c.relationship].filter(Boolean).join(' · '),
      href: `/app/client/${c.id}`,
    });
  }
  if (PAGE_ACCESS.team(user)) {
    const { roster } = await staffingRoster(user, {});
    const matched = topMatches(roster, q, (e) => [e.name_ar, e.job_title]);
    for (const e of matched) results.push({
      category: 'employee', label: 'موظف', id: e.id, title: e.name_ar,
      subtitle: e.job_title || '', href: `/app/team?highlight=${e.id}`,
    });
  }
  return results;
}
