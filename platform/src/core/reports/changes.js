// «ما تغيّر منذ …» — تغذية مركز القيادة القطاعي بسجلات حقيقية مؤرّخة فقط (لا طوابع زمنية مُختلقة):
//   حركات مراحل الفرص، فواتير صادرة، تحصيلات، تواصل مع العملاء، وسجلات إنشاء من سجل النظام.
// الحارس: الصفحة تتحقق من أحقية الوصول للقطاع قبل الاستدعاء؛ هنا نمنع أي تسرب عبر القطاعات
// داخل الاستعلامات نفسها، ونُسقط كل نوع لا يملك المستخدم قراءة مورده (فاتورة/تحصيل/عميل…).
import { all, get } from '../db/index.js';
import { can } from '../rbac/index.js';
import { scopeFilter } from '../rbac/scope.js';

// حساب بداية النافذة (UTC، محمول): day=أمس، week=7 أيام، month=30، quarter=91.
export const WINDOW_DAYS = { day: 1, week: 7, month: 30, quarter: 91 };
export function sinceForWindow(win, today = new Date()) {
  const days = WINDOW_DAYS[win] || WINDOW_DAYS.week;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(t - days * 86400000).toISOString().slice(0, 10);
}

const CREATED_LABEL = { opportunity: 'فرصة جديدة', project: 'مشروع جديد', contract: 'عقد جديد', client: 'عميل جديد' };
const CREATED_HREF = {
  opportunity: (id) => `/app/opportunity/${id}`, project: (id) => `/app/project/${id}`,
  contract: (id) => `/app/contract/${id}`, client: (id) => `/app/client/${id}`,
};
// سجل إنشاء بلا معرّف (نادر) → صفحة القائمة الأم بدل رابط مكسور
const CREATED_LIST = { opportunity: '/app/opportunities', project: '/app/projects', contract: '/app/finance', client: '/app/clients' };

// أسماء السجلات المُنشأة (من سجل النظام) — جلب دفعة واحدة لكل مورد، بلا اختلاق عند الغياب.
async function createdNames(resource, ids) {
  if (!ids.length) return {};
  const ph = ids.map(() => '?').join(',');
  const col = resource === 'opportunity' ? 'title_ar' : resource === 'contract' ? 'code' : 'name_ar';
  const rows = await all(`SELECT id, ${col} nm FROM ${resource} WHERE id IN (${ph})`, ids);
  return Object.fromEntries(rows.map((r) => [r.id, r.nm]));
}

export async function changesSince(user, sectorId, sinceIsoDate) {
  const since = String(sinceIsoDate).slice(0, 10);
  const items = [];
  const counts = { stage: 0, invoice: 0, collection: 0, activity: 0, created: 0 };

  // ── 1) حركات مراحل الفرص (opportunity_stage_history.changed_at) ──
  // الحركة تحمل عنوان الفرصة وقيمتها وعميلها — تفاصيل صفقةٍ قبل ترسيتها، لا رقماً مجمَّعاً.
  // فتُقصّ على نطاق **قائمة الفرص نفسه** (نفس خيارات listOpportunities حرفاً، مؤهَّلةً بـ`o.`):
  // BD يرى حركات فرصه هو، ومدير الإدارة إداراته المسؤولة والمشارِكة، وقائد القطاع قطاعه.
  // البوابة العارية can(user,'read','opportunity') كانت وحدها هنا فتفتح حركات القطاع كله
  // لكل من يملك المنح مهما ضاق نطاقه.
  if (can(user, 'read', 'opportunity')) {
    const f = scopeFilter(user, 'opportunity', 'read',
      { sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id', projectCol: 'o.id',
        grantCol: 'o.department_id', memberCol: 'o.id', deptCol: 'o.department_id' });
    const base = `FROM opportunity_stage_history h JOIN opportunity o ON o.id = h.opportunity_id`;
    const cond = `WHERE o.sector_id = ? AND o.deleted_at IS NULL AND h.changed_at >= ? AND ${f.clause}`;
    const params = [sectorId, since, ...f.params];
    counts.stage = (await get(`SELECT COUNT(*) n ${base} ${cond}`, params))?.n || 0;
    const rows = await all(`SELECT h.changed_at at, o.id opp_id, o.title_ar, o.value_halalas,
         sf.name_ar from_name, st.name_ar to_name, COALESCE(st.is_won,0) is_won, COALESCE(st.is_lost,0) is_lost,
         c.name_ar client
       ${base}
       LEFT JOIN stage sf ON sf.id = h.from_stage_id
       LEFT JOIN stage st ON st.id = h.to_stage_id
       LEFT JOIN client c ON c.id = o.client_id
       ${cond} ORDER BY h.changed_at DESC LIMIT 40`, params);
    for (const r of rows) {
      const won = Number(r.is_won) === 1, lost = Number(r.is_lost) === 1;
      items.push({
        kind: 'stage', at: r.at, won, lost,
        title: won ? `فوز بفرصة «${r.title_ar}»` : lost ? `خسارة فرصة «${r.title_ar}»`
          : `«${r.title_ar}» انتقلت إلى ${r.to_name || 'مرحلة أخرى'}`,
        sub: [r.client, r.from_name ? `من ${r.from_name}` : null].filter(Boolean).join(' · '),
        amount_halalas: r.value_halalas || null,
        href: `/app/opportunity/${r.opp_id}`,
      });
    }
  }

  // ── 2) فواتير صادرة (invoice.issue_date؛ القطاع من الفاتورة أو مشروعها) ──
  if (can(user, 'read', 'invoice')) {
    const base = `FROM invoice i LEFT JOIN project p ON p.id = i.project_id`;
    const cond = `WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL
         AND i.status NOT IN ('DRAFT','CANCELLED')
         AND i.issue_date IS NOT NULL AND substr(i.issue_date,1,10) >= ?`;
    counts.invoice = (await get(`SELECT COUNT(*) n ${base} ${cond}`, [sectorId, since]))?.n || 0;
    const rows = await all(`SELECT i.code, i.amount_halalas, substr(i.issue_date,1,10) at,
         c.name_ar client, p.name_ar project
       ${base} LEFT JOIN client c ON c.id = i.client_id
       ${cond} ORDER BY i.issue_date DESC LIMIT 40`, [sectorId, since]);
    for (const r of rows) {
      // الرمز حقلٌ مستقل لا وسمٌ في النص: الشاشة تهرّب العنوان كله، فوسمٌ داخله يظهر حرفياً
      // «<bdi>…</bdi>» أمام القارئ — والشاشة هي من يغلّف الرمز بعزل الاتجاه بعد التهريب.
      items.push({
        kind: 'invoice', at: r.at,
        title: 'صدرت فاتورة', code: r.code || null,
        sub: r.client || r.project || '',
        amount_halalas: r.amount_halalas || 0, href: '/app/finance',
      });
    }

    // ── 3) تحصيلات (collection.collected_at عبر فاتورتها → القطاع) ──
    const cbase = `FROM collection col JOIN invoice i ON i.id = col.invoice_id
       LEFT JOIN project p ON p.id = i.project_id`;
    const ccond = `WHERE COALESCE(i.sector_id, p.sector_id) = ? AND i.deleted_at IS NULL
         AND col.collected_at IS NOT NULL AND substr(col.collected_at,1,10) >= ?`;
    counts.collection = (await get(`SELECT COUNT(*) n ${cbase} ${ccond}`, [sectorId, since]))?.n || 0;
    const crows = await all(`SELECT col.amount_halalas, substr(col.collected_at,1,10) at, i.code, c.name_ar client
       ${cbase} LEFT JOIN client c ON c.id = i.client_id
       ${ccond} ORDER BY col.collected_at DESC LIMIT 40`, [sectorId, since]);
    for (const r of crows) {
      items.push({
        kind: 'collection', at: r.at, title: 'تحصيل دفعة', code: r.code || null,
        sub: r.client || '',
        amount_halalas: r.amount_halalas || 0, href: '/app/finance',
      });
    }
  }

  // ── 4) تواصل العملاء (crm_activity.at) — قطاع النشاط، أو عميل له بصمة في هذا القطاع ──
  if (can(user, 'read', 'client') || can(user, 'read', 'opportunity')) {
    const base = `FROM crm_activity a`;
    const cond = `WHERE a.deleted_at IS NULL AND a.at >= ?
         AND (a.sector_id = ? OR (a.sector_id IS NULL AND a.client_id IS NOT NULL AND (
              EXISTS(SELECT 1 FROM opportunity o WHERE o.client_id = a.client_id AND o.sector_id = ? AND o.deleted_at IS NULL)
           OR EXISTS(SELECT 1 FROM project pr WHERE pr.client_id = a.client_id AND pr.sector_id = ? AND pr.deleted_at IS NULL))))`;
    const params = [since, sectorId, sectorId, sectorId];
    counts.activity = (await get(`SELECT COUNT(*) n ${base} ${cond}`, params))?.n || 0;
    const rows = await all(`SELECT a.at, a.title, a.client_id, COALESCE(a.actor_name, u.name_ar, u.username) actor, c.name_ar client
       ${base}
       LEFT JOIN app_user u ON u.id = a.actor_user_id
       LEFT JOIN client c ON c.id = a.client_id
       ${cond} ORDER BY a.at DESC LIMIT 40`, params);
    for (const r of rows) {
      items.push({
        kind: 'activity', at: r.at, title: r.title,
        sub: [r.client, r.actor].filter(Boolean).join(' · '),
        href: r.client_id ? `/app/client/${r.client_id}` : '/app/clients',
      });
    }
  }

  // ── 5) سجلات إنشاء من سجل النظام (audit_log.at، action='create') — «من سجل النظام» ──
  const readableRes = Object.keys(CREATED_LABEL).filter((r) => can(user, 'read', r));
  if (readableRes.length) {
    // بند «فرصة جديدة» يحمل عنوان الفرصة ورابط صفحتها — تفاصيل صفقةٍ قبل ترسيتها، فيُقصّ على
    // نطاق **قائمة الفرص نفسه** (نفس حقيقة حركات المراحل في القسم ١ أعلاه): البند الذي لا
    // يفتحه القارئ **يسقط** ولا يُعاد تسميته — ما لا يُفتح لا يُعرض، وسجلٌّ بلا معرّف يُتحقّق
    // منه يسقط معه (فشل مغلق). بقية الموارد (مشروع/عقد/عميل) على بوابتها كما كانت.
    const resParts = [];
    const resParams = [];
    const others = readableRes.filter((r) => r !== 'opportunity');
    if (others.length) {
      resParts.push(`a.resource IN (${others.map(() => '?').join(',')})`);
      resParams.push(...others);
    }
    if (readableRes.includes('opportunity')) {
      const f = scopeFilter(user, 'opportunity', 'read',
        { sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id', projectCol: 'o.id',
          grantCol: 'o.department_id', memberCol: 'o.id', deptCol: 'o.department_id' });
      if (f.clause === '1=1') {
        resParts.push(`a.resource = 'opportunity'`);
      } else {
        resParts.push(`(a.resource = 'opportunity' AND EXISTS (
          SELECT 1 FROM opportunity o WHERE o.id = a.resource_id AND ${f.clause}))`);
        resParams.push(...f.params);
      }
    }
    const base = `FROM audit_log a`;
    const cond = `WHERE a.action = 'create' AND (${resParts.join(' OR ')}) AND a.sector_id = ? AND a.at >= ?`;
    const params = [...resParams, sectorId, since];
    counts.created = (await get(`SELECT COUNT(*) n ${base} ${cond}`, params))?.n || 0;
    const rows = await all(`SELECT a.at, a.resource, a.resource_id, COALESCE(u.name_ar, a.username) username ${base.replace('FROM audit_log a', 'FROM audit_log a LEFT JOIN app_user u ON u.username = a.username')} ${cond}
       ORDER BY a.at DESC LIMIT 40`, params);
    const byRes = {};
    for (const r of rows) (byRes[r.resource] ||= []).push(r.resource_id);
    const names = {};
    for (const [res, ids] of Object.entries(byRes)) names[res] = await createdNames(res, ids.filter(Boolean));
    for (const r of rows) {
      const nm = names[r.resource]?.[r.resource_id];
      items.push({
        kind: 'created', at: r.at,
        title: `${CREATED_LABEL[r.resource]}${nm ? `: ${nm}` : ''}`,
        sub: `من سجل النظام${r.username ? ` · ${r.username}` : ''}`,
        href: r.resource_id ? CREATED_HREF[r.resource](r.resource_id) : CREATED_LIST[r.resource],
      });
    }
  }

  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { items: items.slice(0, 40), counts };
}
