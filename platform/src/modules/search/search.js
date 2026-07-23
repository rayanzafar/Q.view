// البحث الشامل («لوحة الأوامر» Ctrl/Cmd+K) — يعيد استخدام دوال العرض المُصرَّحة لكل نطاق
// (listOpportunities/listProjects/listClients/staffingRoster) فيرث نطاقها الآمن حرفياً؛ لا منطق
// تفويض جديد هنا. تُستبعد فئة كاملة إن كان المستخدم لا يملك حتى صلاحية فتح صفحتها — نفس شروط
// PAGE_ACCESS في web/nav.js حرفياً (مكرَّرة هنا عمداً: web/nav.js يستورد من core لا العكس، فلا
// يجوز لملف modules/ استيراد من web/ دون قلب اتجاه الطبقات؛ أي تعديل هناك يُطبَّق هنا أيضاً).
import { all } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { listOpportunities } from '../crm/opportunities.js';
import { listProjects } from '../pmo/projects.js';
import { listClients } from '../clients/clients.js';
import { staffingRoster } from '../org/org.js';
import { fmtSar } from '../../core/util/ids.js';

const PAGE_ACCESS = {
  opportunities: (u) => can(u, 'read', 'opportunity'),
  projects: (u) => can(u, 'read', 'project'),
  clients: (u) => can(u, 'read', 'client') || u.scope === 'company',
  team: (u) => can(u, 'read', 'employee'),
};

const CAP = 6;
const norm = (s) => String(s || '').toLowerCase();

async function clientNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const rows = await all(`SELECT id, name_ar FROM client WHERE id IN (${uniq.map(() => '?').join(',')})`, uniq);
  return Object.fromEntries(rows.map((r) => [r.id, r.name_ar]));
}

const STATUS_AR = { IN_PROGRESS: 'قيد التنفيذ', COMPLETED: 'مكتمل', PLANNED: 'مُخطَّط', ON_HOLD: 'متوقّف مؤقتًا', CANCELLED: 'ملغى', NOT_STARTED: 'لم يبدأ' };

export async function globalSearch(user, qRaw) {
  const q = norm(qRaw).trim();
  if (q.length < 2) return [];
  const results = [];

  if (PAGE_ACCESS.opportunities(user)) {
    const matched = (await listOpportunities(user, {})).filter((o) => norm(o.title_ar).includes(q)).slice(0, CAP);
    const cn = await clientNames(matched.map((o) => o.client_id));
    for (const o of matched) results.push({
      category: 'opportunity', label: 'فرصة', id: o.id, title: o.title_ar,
      subtitle: [cn[o.client_id], fmtSar(o.value_halalas)].filter(Boolean).join(' · '),
      href: `/app/opportunity/${o.id}`,
    });
  }
  if (PAGE_ACCESS.projects(user)) {
    const matched = (await listProjects(user, {})).filter((p) => norm(p.name_ar).includes(q)).slice(0, CAP);
    const cn = await clientNames(matched.map((p) => p.client_id));
    for (const p of matched) results.push({
      category: 'project', label: 'مشروع', id: p.id, title: p.name_ar,
      subtitle: [cn[p.client_id], STATUS_AR[p.status] || p.status].filter(Boolean).join(' · '),
      href: `/app/project/${p.id}`,
    });
  }
  if (PAGE_ACCESS.clients(user)) {
    const matched = await listClients(user, { query: q });
    for (const c of matched.slice(0, CAP)) results.push({
      category: 'client', label: 'عميل', id: c.id, title: c.name_ar,
      subtitle: [c.type, c.relationship].filter(Boolean).join(' · '),
      href: `/app/client/${c.id}`,
    });
  }
  if (PAGE_ACCESS.team(user)) {
    const { roster } = await staffingRoster(user, {});
    const matched = roster.filter((e) => norm(e.name_ar).includes(q) || norm(e.job_title).includes(q)).slice(0, CAP);
    for (const e of matched) results.push({
      category: 'employee', label: 'موظف', id: e.id, title: e.name_ar,
      subtitle: e.job_title || '', href: `/app/team?highlight=${e.id}`,
    });
  }
  return results;
}
