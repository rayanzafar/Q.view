// «مركز التطوير» — الشاشة التي يعمل عليها فريق المنتج: قائمة المنتجات التي أنتمي إليها،
// ثم شاشة المنتج الواحد بثلاثة تبويبات على شاشةٍ واحدة (العناصر · التقارير · الإعدادات).
//
// القاعدتان اللتان تحكمان هذه الصفحة:
//   ١) العضوية في المنتج — لا دورٌ على مستوى الشركة. من ليس عضواً لا يرى المنتج أصلاً
//      (الخدمة ترمي «غير موجود» فلا يُستدلّ على وجوده)، ومدير النظام يرى الكل.
//   ٢) الشاشة ترسم ما تعطيه الخدمة فقط: كل قراءةٍ هنا عبر وحدة المنتجات، وكل كتابةٍ من
//      المتصفح تمرّ بمسارات الخدمة (pages/dev-center.js) — لا كتابة في طبقة العرض.
//
// عقد الاستهلاك مع وحدة المنتجات (src/modules/products): هذه الشاشة تقرأ منها هذه الدوال
// وحدها — listMyProducts / getProduct / listItems / itemStats / listMembers / listTenants /
// listLinks / listVersions. لا شيء غيرها، ولا كتابةَ واحدة.
import { layout, card, pill } from '../layout.js';
import { esc, statMini } from './_shared.js';
import { icon } from '../icons.js';
import { G } from '../i18n/glossary.js';
import { all } from '../../core/db/index.js';
import { config } from '../../core/config.js';
import { ROLE_LABELS } from '../../core/rbac/matrix.js';
import {
  getProduct, listMyProducts, listMembers, listTenants, listLinks, listVersions,
} from '../../modules/products/products.js';
import { listItems, itemStats } from '../../modules/products/items.js';

const PAGE_SCRIPT = ['/static/pages/dev-center.js'];
const TABS = ['items', 'reports', 'settings'];
const LIST_LIMIT = 200;

// ── قيم مخزَّنة تُستعمل مفاتيحَ ترشيح فقط؛ اسمها العربي يأتي من المعجم دائماً ───────────
const STATUS_KEYS = ['NEW', 'TRIAGED', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'RESOLVED', 'NEEDS_INFO', 'DECLINED', 'DUPLICATE'];
const TYPE_KEYS = ['bug', 'suggestion'];
const URGENCY_KEYS = ['blocks', 'delays', 'improve'];
const PRIORITY_KEYS = ['low', 'medium', 'high', 'critical'];
const SOURCE_KEYS = ['sanad', 'link', 'manual', 'agent'];
const IDENTITY_KEYS = ['anonymous_only', 'optional', 'required'];
const STATUS_TONE = {
  NEW: 'blue', TRIAGED: 'slate', AWAITING_APPROVAL: 'amber', APPROVED: 'green',
  IN_PROGRESS: 'blue', RESOLVED: 'green', NEEDS_INFO: 'amber', DECLINED: 'red', DUPLICATE: 'slate',
};
const URGENCY_TONE = { blocks: 'red', delays: 'amber', improve: 'slate' };

const statusLabel = (v) => G.itemStatusAr[String(v || '')] || G.notSet;
const typeLabel = (v) => G.itemTypeAr[String(v || '')] || G.notSet;
const urgencyLabel = (v) => G.itemUrgencyAr[String(v || '')] || G.notSet;
const priorityLabel = (v) => G.itemPriorityAr[String(v || '')] || G.notSet;
// دورُ صاحب الحساب على المنتج: عضويةٌ في فريقه، أو مدير النظام الذي يمرّ فوق الجميع بحكم
// منحه الشامل — و«غير محدد» كانت تُقال له وهو أوسعهم صلاحيةً (بلاغُ الجودة KI).
const roleLabel = (v) => (String(v || '') === 'admin'
  ? ROLE_LABELS.admin.ar
  : G.productRoleAr[String(v || '')] || G.notSet);
const kindLabel = (v) => G.productKindAr[String(v || '')] || G.notSet;
const identityLabel = (v) => G.identityModeAr[String(v || '')] || G.notSet;
const sourceLabel = (v) => G.itemSourceAr[String(v || '')] || G.notSet;

// الكلماتُ العربية للقيم المخزَّنة تُسلَّم للمتصفّح من المعجم نفسه — فلا تُكتب نسخةٌ ثانية منها
// في ملفّ الصفحة، ولا يظهر رمزٌ خام في أي نموذجٍ يُركَّب عند النقر. وتُكتب في **الشاشتين**:
// قائمةُ المنتجات فيها نموذج «منتج جديد»، وكان يعرض `external`/`internal` خامّين بلا هذا المقطع.
const labelsScript = () => {
  const json = JSON.stringify({
    status: G.itemStatusAr, type: G.itemTypeAr, urgency: G.itemUrgencyAr,
    size: G.itemSizeAr, priority: G.itemPriorityAr, source: G.itemSourceAr, role: G.productRoleAr,
    kind: G.productKindAr, identity: G.identityModeAr,
  }).replace(/</g, '\\u003c');
  return `<script type="application/json" id="dc-labels">${json}</script>`;
};

const statusPill = (v) => pill(esc(statusLabel(v)), STATUS_TONE[String(v || '')] || 'slate');
const urgencyPill = (v) => pill(esc(urgencyLabel(v)), URGENCY_TONE[String(v || '')] || 'slate');
const num = (v) => `<span class="tnum">${esc(String(v == null ? 0 : v))}</span>`;

// عمر العنصر بالكلام لا برقمٍ عارٍ: «اليوم» ثم «منذ يومين» ثم «منذ ٩ أيام».
function ageLabel(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return G.notSet;
  const d = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (d === 0) return G.today;
  if (d === 1) return G.sinceOneDay;
  if (d === 2) return G.sinceTwoDays;
  if (d <= 10) return `${G.sincePrefix} ${d} ${G.daysPlural}`;
  return `${G.sincePrefix} ${d} ${G.daySingularCounted}`;
}

// أسماء القطاعات تُقرأ مرةً واحدة للصفحة كلها: الصفوف تحمل معرّف القطاع لا اسمه.
async function sectorNames() {
  const rows = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  return new Map(rows.map((r) => [r.id, r.name_ar]));
}
// حسابات المنصة النشطة — اسمٌ ومعرّف لا غير — لتُملأ منها قائمة «من أبلغ» في التسجيل نيابةً.
async function platformPeople() {
  const rows = await all(
    'SELECT id, name_ar, username FROM app_user WHERE active = 1 AND deleted_at IS NULL ORDER BY name_ar',
  );
  return rows.map((u) => ({ id: u.id, name: u.name_ar || u.username || '' })).filter((u) => u.name);
}

// اسمُ من أبلغ كما يُعرض: ما سجّلته الخدمة، وإلا فلا نخترع اسماً — «غير محدد» صريحة.
const reporterName = (r) => r.reporter_name || G.notSet;

const CSS = `<style>
.dc [hidden]{display:none!important}
.dc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:.9rem}
.dc-card{display:block;padding:0;overflow:hidden;color:inherit}
.dc-stripe{height:5px;background:var(--brand-grad)}
.dc-card-in{padding:1rem 1.1rem}
.dc-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem}
.dc-card-top h2{font-size:var(--fs-title);line-height:1.5;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dc-card p{margin:.45rem 0 0;font-size:var(--fs-body);color:var(--muted);line-height:1.8}
.dc-counts{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:.85rem;border-top:1px solid var(--line);padding-top:.7rem}
.dc-counts b{display:block;font-size:var(--fs-num-sm);font-weight:800;color:var(--ink2)}
.dc-counts span{font-size:var(--fs-micro);color:var(--muted);font-weight:700}
.dc-band{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem;margin-bottom:.9rem}
.dc-band .att{display:flex;align-items:center;gap:.7rem;padding:.85rem 1rem;border:1px solid var(--line);border-radius:12px;background:#fff;width:100%;text-align:right;color:inherit}
.dc-band .att b{font-size:var(--fs-num-sm);font-weight:800;color:var(--ink2)}
.dc-band .att span{font-size:var(--fs-body);color:var(--muted);font-weight:700}
.dc-band .att svg{width:18px;height:18px;flex:none;color:var(--brand)}
.dc-band a.att{text-decoration:none;cursor:pointer}
.dc-band a.att:hover{border-color:var(--brand)}
.dc-band .att:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.dc-hd{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-top:.2rem}
.dc-hd h2{font-size:18px;line-height:1.4}
.dc-tabs{display:flex;gap:.35rem;flex-wrap:wrap;margin:.9rem 0}
.dc-tabs a{font-size:12px;font-weight:700;color:var(--muted);padding:.4rem .8rem;border-radius:9px;background:#f1f5f9}
.dc-tabs a.on{background:var(--brand);color:#fff}
.dc-tabs a:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.dc-filters{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-bottom:.6rem}
.dc-filters .chip{font-size:11.5px;font-weight:700;padding:.3rem .65rem;border-radius:99px;background:#f1f5f9;color:var(--muted)}
.dc-filters .chip.on{background:var(--brand);color:#fff}
.dc-filters .chip:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.dc-filters form{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
.dc-filters .input{min-height:36px;font-size:12.5px}
.dc-tbl{width:100%;border-collapse:collapse;font-size:var(--fs-body)}
.dc-tbl th{text-align:right;font-size:var(--fs-micro);color:var(--muted);font-weight:800;padding:.5rem .6rem;border-bottom:1px solid var(--line);white-space:nowrap}
.dc-tbl td{padding:.55rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
.dc-tbl tr.row{cursor:pointer}
.dc-tbl tr.row:hover{background:#f8fafc}
.dc-tbl tr.row:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
.dc-key{font-weight:800;color:var(--brand)}
.dc-ttl{max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.dc-sec{margin-top:1rem;padding-top:.85rem;border-top:1px solid var(--line)}
.dc-sec h3{font-size:13.5px;font-weight:800;color:var(--ink2);margin:0 0 .55rem}
.dc-rows{display:grid;gap:.4rem}
.dc-row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;font-size:var(--fs-body);padding:.5rem .65rem;border:1px solid var(--line);border-radius:10px;background:#fff}
.dc-row .g{flex:1;min-width:0}
.dc-row .m{font-size:var(--fs-micro);color:var(--muted);font-weight:700}
.dc-link{font-family:inherit;font-size:12px;color:var(--muted);direction:ltr;text-align:left;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dc-empty{padding:2.2rem 1rem;text-align:center}
.dc-empty svg{width:34px;height:34px;color:var(--faint)}
.dc-empty .t{font-size:14.5px;font-weight:800;color:var(--ink2);margin-top:.5rem}
.dc-empty .s{font-size:12.5px;color:var(--muted);margin-top:.35rem;line-height:1.9}
.modal-card label.f{display:block;font-size:11.5px;font-weight:800;color:var(--ink2);margin:0 0 .25rem}
@media(max-width:720px){.dc-tbl th.h-opt,.dc-tbl td.c-opt{display:none}}
</style>`;

const emptyState = (ic, t, s, extra = '') => `<div class="dc-empty">${icon(ic)}<div class="t">${esc(t)}</div><div class="s">${esc(s)}</div>${extra}</div>`;

// ── نماذجُ الإعدادات تُرسَم في الخادم وتُستنسخ في المتصفّح ──────────────────────────────
// كانت الجهةُ تُنشأ بسؤالٍ واحدٍ حرّ (`window.prompt`) فيبقى عميلُها ومشروعُها فارغين أبداً —
// و`project_id` هو ما تقرأه مزامنةُ المهام لتربط مهمة البند بمشروع الجهة. والحقولُ هنا لا في
// ملفّ المتصفّح كي تُقرأ نصوصُها من المعجم ويحرسها فاحصُ المصطلحات كبقية نصوص الشاشة.
const fieldRow = (id2, label, control, hint = '') => `<div><label class="f" for="${id2}">${esc(label)}</label>${control}
  ${hint ? `<div style="font-size:11.5px;color:var(--muted);margin-top:.25rem;line-height:1.8">${esc(hint)}</div>` : ''}</div>`;

const tenantTpl = () => `<template id="dc-tpl-tenant">
  ${fieldRow('dc-tn-name', 'اسم الجهة', '<input class="input" id="dc-tn-name" maxlength="120">')}
  ${fieldRow('dc-tn-client', 'العميل', '<select class="input" id="dc-tn-client"><option value="">بلا عميل — اسمٌ حرّ</option></select>',
    'اختيار العميل يربط بلاغات هذه الجهة بملفّه، ويترك النصّ الحرّ لمن لا ملفَّ له بعد.')}
  ${fieldRow('dc-tn-project', 'المشروع', '<select class="input" id="dc-tn-project"><option value="">بلا مشروع</option></select>',
    'مهامُ بلاغات هذه الجهة تُفتح على هذا المشروع — واتركه فارغاً إن لم يكن لها مشروعٌ قائم.')}
  <div><label class="f" for="dc-tn-internal"><input type="checkbox" id="dc-tn-internal"> ${esc(G.internalUse)}</label></div>
</template>`;

const langOpts = (cur = 'ar') => `<option value="ar"${cur === 'en' ? '' : ' selected'}>العربية</option>`
  + `<option value="en"${cur === 'en' ? ' selected' : ''}>الإنجليزية</option>`;

const linkTpl = () => `<template id="dc-tpl-link">
  ${fieldRow('dc-lk-mode', 'كيف يعرّف صاحب البلاغ بنفسه',
    `<select class="input" id="dc-lk-mode">${IDENTITY_KEYS.map((k) => `<option value="${esc(k)}"${k === 'optional' ? ' selected' : ''}>${esc(identityLabel(k))}</option>`).join('')}</select>`)}
  ${fieldRow('dc-lk-lang', 'لغة الصفحة الافتراضية', `<select class="input" id="dc-lk-lang">${langOpts('ar')}</select>`)}
  ${fieldRow('dc-lk-intro-ar', 'تمهيدٌ عربي يقرؤه الزائر', '<textarea class="input" id="dc-lk-intro-ar" rows="2" maxlength="1000"></textarea>')}
  ${fieldRow('dc-lk-intro-en', 'تمهيدٌ إنجليزي يقرؤه الزائر', '<textarea class="input" id="dc-lk-intro-en" rows="2" maxlength="1000"></textarea>')}
  ${fieldRow('dc-lk-expires', 'تاريخ انتهاء الرابط', '<input class="input" id="dc-lk-expires" type="date">',
    'بعد هذا التاريخ لا يُستقبل من الرابط بلاغ — واتركه فارغاً ليبقى مفتوحاً.')}
</template>`;

// ═══════════════════════════════════════════════════════════════════════
// ١) قائمة المنتجات
// ═══════════════════════════════════════════════════════════════════════
export async function devCenterPage(user) {
  const isAdmin = user.role_id === 'admin';
  const rows = await listMyProducts(user);
  // «بحاجة لتوضيح» ليست في عدّادات المنتج (وهي حالةٌ تنتظر صاحب البلاغ لا الفريق) — تُقرأ
  // بقراءةٍ واحدة لكل منتج، والمنتجات قليلة بطبيعتها فلا استعلامَ لكل حالةٍ لكل منتج.
  const needsInfo = await Promise.all(rows.map((p) => listItems(user, p.id, { status: 'NEEDS_INFO', limit: 500 })));
  const att = {
    awaiting: rows.reduce((n, p) => n + Number(p.counts?.awaiting || 0), 0),
    needsInfo: needsInfo.reduce((n, list) => n + list.length, 0),
  };

  // العدّاد يفتح المنتج المعنيّ حين يكون منتجاً واحداً بعينه؛ فإن تعدّدت المنتجات صاحبةُ
  // العدد فالرقم خبرٌ لا زر، وبطاقاتُ المنتجات أسفله تفصّله لكل منتجٍ على حدة — خيرٌ من
  // زرٍّ يُنقر فلا يفتح شيئاً.
  const needsInfoBy = new Map(rows.map((p, i) => [p.id, needsInfo[i].length]));
  const soleOwner = (countOf) => {
    const hits = rows.filter((p) => countOf(p) > 0);
    return hits.length === 1 ? hits[0].id : null;
  };
  const attBox = (target, status, ic, n, label) => {
    const inner = `${icon(ic)}<div><b class="tnum">${esc(String(n))}</b><span> ${esc(label)}</span></div>`;
    return target
      ? `<a class="att" href="/app/dev-center/${encodeURIComponent(target)}?status=${status}">${inner}</a>`
      : `<div class="att">${inner}</div>`;
  };
  const band = `<div class="dc-band">
    ${attBox(soleOwner((p) => Number(p.counts?.awaiting || 0)), 'AWAITING_APPROVAL', 'approvals', att.awaiting, G.awaitingYourApproval)}
    ${attBox(soleOwner((p) => needsInfoBy.get(p.id) || 0), 'NEEDS_INFO', 'bell', att.needsInfo, G.itemNeedsInfo)}
  </div>`;

  const newBtn = isAdmin
    ? `<button type="button" class="btn btn-primary btn-sm" data-action="dc-new-product">${icon('plus')} ${esc(G.newProduct)}</button>`
    : '';

  if (!rows.length) {
    const body = `${CSS}<div class="dc">${card(emptyState('list', G.noProductsYet,
    isAdmin ? G.noProductsAdminHint : G.noProductsMemberHint, newBtn))}${labelsScript()}</div>`;
    return layout({ user, active: 'dev-center', title: G.devCenter, subtitle: G.devCenterSubtitle, body, scripts: PAGE_SCRIPT });
  }

  const cards = rows.map((p) => `<a class="card dc-card" href="/app/dev-center/${encodeURIComponent(p.id)}">
    <div class="dc-stripe" style="background:${esc(p.brand_color || 'var(--brand-grad)')}"></div>
    <div class="dc-card-in">
      <div class="dc-card-top"><h2>${esc(p.name_ar || G.notSet)}</h2>${pill(esc(kindLabel(p.kind)), p.kind === 'internal' ? 'violet' : 'blue')}</div>
      <p>${esc(p.description || G.noDescription)}</p>
      <div style="margin-top:.5rem;font-size:var(--fs-micro);color:var(--muted);font-weight:700">${esc(G.myRoleHere)}: ${esc(roleLabel(p.my_role))}</div>
      <div class="dc-counts">
        <div><b>${num(p.counts?.open)}</b><span>${esc(G.itemsOpen)}</span></div>
        <div><b>${num(p.counts?.awaiting)}</b><span>${esc(G.awaitingApprovalShort)}</span></div>
        <div><b>${num(p.counts?.all)}</b><span>${esc(G.itemsTotal)}</span></div>
      </div>
    </div></a>`).join('');

  const body = `${CSS}<div class="dc">
    ${band}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;margin-bottom:.7rem">
      <div style="font-size:12.5px;color:var(--muted);font-weight:700">${esc(G.devCenterLead)}</div>${newBtn}</div>
    <div class="dc-grid">${cards}</div>${labelsScript()}</div>`;
  return layout({ user, active: 'dev-center', title: G.devCenter, subtitle: G.devCenterSubtitle, body, scripts: PAGE_SCRIPT });
}

// ═══════════════════════════════════════════════════════════════════════
// ٢) شاشة المنتج: العناصر · التقارير · الإعدادات
// ═══════════════════════════════════════════════════════════════════════
export async function devCenterProductPage(user, productId, opts = {}) {
  const product = await getProduct(user, productId);           // ترمي «غير موجود» لغير العضو
  const role = product.my_role;
  const mayManage = role === 'manager' || role === 'admin';
  const showTenants = product.kind !== 'internal';
  const tab = TABS.includes(opts.tab) ? opts.tab : 'items';

  // أسماءُ المرشِّحات هي أسماءُ حقول الخدمة نفسها (`tenant_id`/`sector_id`/`version_id`) — فما
  // في العنوان يمرّ إلى `listItems` كما هو بلا ترجمةِ أسماءٍ في المنتصف.
  const [tenantList, versionList] = await Promise.all([
    showTenants ? listTenants(user, product.id) : Promise.resolve([]),
    listVersions(user, product.id),
  ]);
  const oneOf = (list, v) => (list.includes(String(v || '')) ? String(v) : '');
  const cur = {
    status: STATUS_KEYS.includes(opts.status) ? opts.status : '',
    type: TYPE_KEYS.includes(opts.type) ? opts.type : '',
    priority: PRIORITY_KEYS.includes(opts.priority) ? opts.priority : '',
    urgency: URGENCY_KEYS.includes(opts.urgency) ? opts.urgency : '',
    source: SOURCE_KEYS.includes(opts.source) ? opts.source : '',
    tenant_id: oneOf(tenantList.map((t) => t.id), opts.tenant_id),
    version_id: oneOf(versionList.map((v) => v.id), opts.version_id),
    sector_id: String(opts.sector_id || '').trim().slice(0, 64),
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from || '')) ? String(opts.from) : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to || '')) ? String(opts.to) : '',
    q: String(opts.q || '').trim().slice(0, 80),
  };
  const qs = (over = {}) => {
    const m = { ...cur, ...over };
    const parts = Object.keys(m).filter((k) => m[k]).map((k) => `${k}=${encodeURIComponent(m[k])}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };
  // تبويبٌ يُنقر لا يُسقط ما على الشاشة: المرشِّحات كلها تعبر معه — وإلا كان زرُّ الطباعة في
  // تبويب التقارير يطبع «كل ما وصل» بينما القارئ ينظر إلى اختيارٍ ضيّق (بلاغُ الجودة KI).
  const tabHref = (t) => `/app/dev-center/${encodeURIComponent(product.id)}${qs({ tab: t === 'items' ? '' : t })}`;

  const header = card(`<div style="padding:1rem 1.15rem">
    <div style="font-size:11px;color:var(--muted);font-weight:700"><a href="/app/dev-center" style="color:var(--brand)">${esc(G.devCenter)}</a></div>
    <div class="dc-hd"><h2>${esc(product.name_ar || G.notSet)}</h2>${pill(esc(kindLabel(product.kind)), product.kind === 'internal' ? 'violet' : 'blue')}
      ${pill(esc(roleLabel(role)), 'slate')}</div>
    ${product.description ? `<div style="margin-top:.4rem;font-size:var(--fs-body);color:var(--muted);line-height:1.8">${esc(product.description)}</div>` : ''}
    <!-- لا زرَّ «أبلغ» هنا: زرُّ الترويسة موجودٌ في كل شاشة ومعناه واحدٌ لا يتغيّر — بلاغٌ عن
         سند نفسها. ولو كُرِّر داخل شاشة منتجٍ آخر لفُهم أنه يسجّل في ذلك المنتج، وهو لا يفعل.
         والبابُ إلى هذا المنتج هو «سجّل عن غيرك» وحده. -->
    <div style="margin-top:.8rem;display:flex;gap:.45rem;flex-wrap:wrap">
      <button type="button" class="btn btn-primary btn-sm" data-action="dc-manual-add">${icon('plus')} ${esc(G.addOnBehalf)}</button>
    </div>
  </div>`);

  const tabs = `<div class="dc-tabs" role="tablist">
    <a role="tab" aria-selected="${tab === 'items'}" class="${tab === 'items' ? 'on' : ''}" href="${esc(tabHref('items'))}">${esc(G.items)}</a>
    <a role="tab" aria-selected="${tab === 'reports'}" class="${tab === 'reports' ? 'on' : ''}" href="${esc(tabHref('reports'))}">${esc(G.reportsTab)}</a>
    ${mayManage ? `<a role="tab" aria-selected="${tab === 'settings'}" class="${tab === 'settings' ? 'on' : ''}" href="${esc(tabHref('settings'))}">${esc(G.settings)}</a>` : ''}
  </div>`;

  const sectors = await sectorNames();
  let panel = '';
  if (tab === 'settings' && mayManage) panel = await settingsPanel(user, product, showTenants, versionList);
  // المطوِّر الذي يبلغ `?tab=settings` كان يُردّ إلى «العناصر» بلا كلمة، فيظنّ الرابط معطوباً.
  // الرسالة تقول له لماذا — وهو يعرف المنتج أصلاً فلا يُكشف بها شيء.
  else if (tab === 'settings') {
    panel = card(emptyState('users', 'الإعدادات لمديري المنتج',
      'فريقُ المنتج وجهاتُه وروابطُه وإصداراته يضبطها مدير المنتج ومدير النظام — واطلبها منهما متى احتجتها.',
      `<div style="margin-top:.7rem"><a class="btn btn-sm" href="${esc(tabHref('items'))}">${esc(G.items)}</a></div>`));
  } else if (tab === 'reports') panel = await reportsPanel(user, product, cur, qs, sectors, tenantList, versionList);
  else panel = await itemsPanel(user, product, cur, qs, sectors);

  // القطاعات تُسلَّم للمتصفّح قائمةً يُختار منها: من يسجّل عن غيره يختار قطاعاً موجوداً
  // بالاسم، ولا يكتب نصاً حرّاً تردّه الخدمة.
  const sectorsJson = JSON.stringify([...sectors.entries()].map(([id, name]) => ({ id, name })))
    .replace(/</g, '\\u003c');
  // وكذلك الأشخاص: من أبلغ يُختار من حسابات المنصة متى كان له حساب — فيُنسب البلاغ إلى صاحبه
  // ويصله بريدُ كل خطوة — ويُكتب اسمُه حرّاً متى لم يكن له حساب. أسماءٌ ومعرّفاتٌ لا غير.
  const peopleJson = JSON.stringify(await platformPeople()).replace(/</g, '\\u003c');
  const body = `${CSS}<div class="dc" data-product="${esc(product.id)}" data-role="${esc(role || '')}">${header}${tabs}${panel}
    ${labelsScript()}
    <script type="application/json" id="dc-sectors">${sectorsJson}</script>
    <script type="application/json" id="dc-users">${peopleJson}</script></div>`;
  return layout({ user, active: 'dev-center', title: product.name_ar || G.devCenter, subtitle: G.devCenterSubtitle, body, scripts: PAGE_SCRIPT });
}

// ── تبويب العناصر ──────────────────────────────────────────────────────
async function itemsPanel(user, product, cur, qs, sectors) {
  const rows = await listItems(user, product.id, { ...cur, limit: LIST_LIMIT });
  const chip = (key, label, val) => `<a class="chip ${cur[key] === val ? 'on' : ''}" href="${esc(qs({ [key]: cur[key] === val ? '' : val }))}">${esc(label)}</a>`;

  const filters = `<div class="dc-filters">
    ${chip('status', G.all, '')}
    ${STATUS_KEYS.map((s) => chip('status', statusLabel(s), s)).join('')}
  </div>
  <div class="dc-filters">
    ${TYPE_KEYS.map((t) => chip('type', typeLabel(t), t)).join('')}
    ${URGENCY_KEYS.map((u) => chip('urgency', urgencyLabel(u), u)).join('')}
    <form method="get" action="">
      ${['status', 'type', 'priority', 'urgency', 'source', 'tenant_id', 'version_id', 'sector_id']
    .map((k) => (cur[k] ? `<input type="hidden" name="${esc(k)}" value="${esc(cur[k])}">` : '')).join('')}
      <input class="input" id="dc-from" type="date" name="from" value="${esc(cur.from)}" aria-label="${esc(G.fromDate)}">
      <input class="input" id="dc-to" type="date" name="to" value="${esc(cur.to)}" aria-label="${esc(G.toDate)}">
      <input class="input" id="dc-q" type="search" name="q" value="${esc(cur.q)}" maxlength="80" placeholder="${esc(G.searchInItems)}" aria-label="${esc(G.searchInItems)}">
      <button type="submit" class="btn btn-sm">${esc(G.apply)}</button>
      <a class="btn btn-ghost btn-sm" href="?">${esc(G.clearFilters)}</a>
    </form>
  </div>`;

  if (!rows.length) {
    return card(`${filters}${emptyState('filter', G.noItemsHere, G.noItemsHint)}`);
  }

  const body = rows.map((r) => `<tr class="row" tabindex="0" role="button" data-action="dc-open-item" data-item="${esc(r.id)}"
      aria-label="${esc(`${r.item_key || ''} ${r.title || ''}`.trim())}">
    <td class="dc-key tnum">${esc(r.item_key || '')}</td>
    <td>${esc(typeLabel(r.type))}</td>
    <td><span class="dc-ttl">${esc(r.title || G.noTitle)}</span></td>
    <td class="c-opt">${esc(r.tenant_name || G.internalUse)}</td>
    <td class="c-opt">${esc(reporterName(r))}${sectors.get(r.sector_id) ? `<div class="m" style="font-size:var(--fs-micro);color:var(--muted)">${esc(sectors.get(r.sector_id))}</div>` : ''}</td>
    <td>${urgencyPill(r.urgency)}</td>
    <td class="c-opt">${esc(priorityLabel(r.priority))}</td>
    <td>${statusPill(r.status)}</td>
    <td class="c-opt">${esc(ageLabel(r.created_at))}</td>
  </tr>`).join('');

  const table = `<div style="overflow-x:auto"><table class="dc-tbl">
    <thead><tr>
      <th>${esc(G.itemNo)}</th><th>${esc(G.itemType)}</th><th>${esc(G.itemTitle)}</th>
      <th class="h-opt">${esc(G.tenant)}</th><th class="h-opt">${esc(G.reporterAndSector)}</th>
      <th>${esc(G.urgency)}</th><th class="h-opt">${esc(G.priority)}</th>
      <th>${esc(G.statusWord)}</th><th class="h-opt">${esc(G.ageWord)}</th>
    </tr></thead><tbody>${body}</tbody></table></div>
    ${rows.length >= LIST_LIMIT ? `<div style="margin-top:.6rem;font-size:12px;color:var(--muted)">${esc(G.listTruncated)}</div>` : ''}`;

  return card(`${filters}${table}`);
}

// ── تبويب التقارير ─────────────────────────────────────────────────────
// المرشِّحاتُ هنا هي نفسُها التي فوق جدول العناصر، بنفس الشارات ونفس المدى الزمني — فما يُطبع
// وما يُصدَّر هو ما على الشاشة حرفاً بحرف، ولا يُحرَّر عنوانٌ يدوياً ليصل تقريرٌ مصفّى.
async function reportsPanel(user, product, cur, qs, sectors, tenantList, versionList) {
  const s = await itemStats(user, product.id, cur);
  const query = qs();                       // بلا `tab` — صفحةُ الطباعة والتصدير لا يعرفانه
  const printHref = `/app/dev-center/${encodeURIComponent(product.id)}/report${query}`;
  const excelHref = `/api/products/${encodeURIComponent(product.id)}/items/export.xlsx${query}`;
  const rqs = (over = {}) => qs({ tab: 'reports', ...over });
  const chip = (key, label, val) => `<a class="chip ${cur[key] === val ? 'on' : ''}" href="${esc(rqs({ [key]: cur[key] === val ? '' : val }))}">${esc(label)}</a>`;
  const hidden = (k) => (cur[k] ? `<input type="hidden" name="${esc(k)}" value="${esc(cur[k])}">` : '');

  const filters = `<div class="dc-filters">
    ${chip('status', G.all, '')}
    ${STATUS_KEYS.map((k) => chip('status', statusLabel(k), k)).join('')}
  </div>
  <div class="dc-filters">
    ${TYPE_KEYS.map((t) => chip('type', typeLabel(t), t)).join('')}
    ${URGENCY_KEYS.map((u) => chip('urgency', urgencyLabel(u), u)).join('')}
    ${PRIORITY_KEYS.map((p) => chip('priority', priorityLabel(p), p)).join('')}
    ${SOURCE_KEYS.map((k) => chip('source', sourceLabel(k), k)).join('')}
  </div>
  ${tenantList.length ? `<div class="dc-filters">${tenantList.map((t) => chip('tenant_id', t.name || G.notSet, t.id)).join('')}</div>` : ''}
  ${versionList.length ? `<div class="dc-filters">${versionList.map((v) => chip('version_id', v.label || G.notSet, v.id)).join('')}</div>` : ''}
  <div class="dc-filters">
    ${[...sectors.entries()].map(([id2, name]) => chip('sector_id', name, id2)).join('')}
    <form method="get" action="">
      <input type="hidden" name="tab" value="reports">
      ${['status', 'type', 'priority', 'urgency', 'source', 'tenant_id', 'version_id', 'sector_id'].map(hidden).join('')}
      <input class="input" id="dc-from" type="date" name="from" value="${esc(cur.from)}" aria-label="${esc(G.fromDate)}">
      <input class="input" id="dc-to" type="date" name="to" value="${esc(cur.to)}" aria-label="${esc(G.toDate)}">
      <input class="input" id="dc-q" type="search" name="q" value="${esc(cur.q)}" maxlength="80" placeholder="${esc(G.searchInItems)}" aria-label="${esc(G.searchInItems)}">
      <button type="submit" class="btn btn-sm">${esc(G.apply)}</button>
      <a class="btn btn-ghost btn-sm" href="?tab=reports">${esc(G.clearFilters)}</a>
    </form>
  </div>`;

  const stats = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem">
    ${statMini(G.itemsTotal, String(s.total || 0))}
    ${statMini(G.itemsOpen, String(s.open || 0))}
    ${statMini(G.awaitingApprovalShort, String(s.byStatus.AWAITING_APPROVAL || 0))}
    ${statMini(G.itemResolvedShort, String(s.resolved || 0))}
    ${statMini(G.avgDaysToResolve, s.avg_days_to_resolve == null ? G.notSet : String(s.avg_days_to_resolve))}
  </div>`;
  const byStatus = STATUS_KEYS.map((k) => `<div class="dc-row"><span class="g">${esc(statusLabel(k))}</span><b class="tnum">${esc(String(s.byStatus[k] || 0))}</b></div>`).join('');
  return card(`<div style="padding:.2rem 0">
    ${filters}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem">
      <div style="font-size:12.5px;color:var(--muted);font-weight:700">${esc(G.reportLead)}</div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        <a class="btn btn-primary btn-sm" href="${esc(printHref)}">${icon('printer') || ''} ${esc(G.openPrintable)}</a>
        <a class="btn btn-sm" href="${esc(excelHref)}">${icon('download')} ${esc('حمّل الجدول')}</a>
      </div>
    </div>
    ${stats}
    <div class="dc-sec"><h3>${esc(G.byStatus)}</h3><div class="dc-rows">${byStatus}</div></div>
  </div>`);
}

// ── تبويب الإعدادات ────────────────────────────────────────────────────
async function settingsPanel(user, product, showTenants, versionList) {
  const members = await listMembers(user, product.id);
  const versions = versionList || await listVersions(user, product.id);
  // من يُضاف إلى الفريق يُختار من قائمة الأشخاص لا يُكتب اسمُ دخوله: الاسم المكتوب يخطئ،
  // والاختيار لا يخطئ. القائمة تُقرأ هنا لأن مديرَ المنتج وحده يرى هذا التبويب.
  const inTeam = new Set(members.map((m) => m.user_id));
  const people = (await all(
    'SELECT id, name_ar, username FROM app_user WHERE active = 1 AND deleted_at IS NULL ORDER BY name_ar',
  )).filter((u) => !inTeam.has(u.id)).map((u) => ({ id: u.id, name: u.name_ar || u.username || '' }));
  const peopleJson = JSON.stringify(people).replace(/</g, '\\u003c');
  const memberRows = members.length
    ? members.map((m) => `<div class="dc-row"><span class="g">${esc(m.name_ar || m.username || G.notSet)}</span>
        <span class="m">${esc(roleLabel(m.role))}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="dc-member-remove" data-member="${esc(m.user_id)}">${esc(G.remove)}</button></div>`).join('')
    : `<div class="m">${esc(G.noMembersYet)}</div>`;

  let tenantsSec = '';
  if (showTenants) {
    const [tenants, links] = await Promise.all([listTenants(user, product.id), listLinks(user, product.id)]);
    const byTenant = new Map();
    for (const l of links) {
      if (!byTenant.has(l.tenant_id)) byTenant.set(l.tenant_id, []);
      byTenant.get(l.tenant_id).push(l);
    }
    const linkUrl = (l) => `${config.platformUrl}/p/${l.token}`;
    const tRows = tenants.length ? tenants.map((t) => {
      const ls = (byTenant.get(t.id) || []).map((l) => `<div class="dc-row" style="background:#f8fafc">
        <span class="g"><span class="dc-link">${esc(linkUrl(l))}</span>
          <div class="m">${esc(identityLabel(l.identity_mode))} · ${esc(G.visits)} ${num(l.visits)} · ${esc(G.submissions)} ${num(l.submissions)}${
  l.expires_on ? ` · ${esc('ينتهي')} <span class="tnum">${esc(l.expires_on)}</span>` : ''}</div></span>
        ${Number(l.enabled) ? '' : pill(esc(G.linkDisabled), 'slate')}
        <button type="button" class="btn btn-sm" data-action="dc-copy-link" data-link="${esc(linkUrl(l))}">${esc(G.copyLink)}</button>
        <button type="button" class="btn btn-sm" data-action="dc-link-edit" data-link-id="${esc(l.id)}"
          data-mode="${esc(l.identity_mode || '')}" data-lang="${esc(l.default_lang || '')}"
          data-intro-ar="${esc(l.intro_ar || '')}" data-intro-en="${esc(l.intro_en || '')}"
          data-expires="${esc(l.expires_on || '')}">${esc('عدِّل')}</button>
        <button type="button" class="btn btn-sm" data-action="dc-link-toggle" data-link-id="${esc(l.id)}"
          data-on="${Number(l.enabled) ? '1' : '0'}">${esc(Number(l.enabled) ? 'أوقِف' : 'فعِّل')}</button>
        <button type="button" class="btn btn-sm" data-action="dc-link-rotate" data-link-id="${esc(l.id)}">${esc('أعد التوليد')}</button></div>`).join('');
      return `<div class="dc-sec" style="border-top:0;padding-top:0;margin-top:.6rem">
        <div class="dc-row"><span class="g">${esc(t.name || G.notSet)}</span>
          <span class="m">${esc(Number(t.internal) ? G.internalUse : G.externalTenant)}</span>
          <button type="button" class="btn btn-sm" data-action="dc-link-new" data-tenant="${esc(t.id)}">${esc(G.newLink)}</button></div>
        ${ls || `<div class="m" style="padding:.3rem .65rem">${esc(G.noLinksYet)}</div>`}</div>`;
    }).join('') : `<div class="m">${esc(G.noTenantsYet)}</div>`;
    tenantsSec = `<div class="dc-sec"><h3>${esc(G.tenants)} · ${esc(G.publicLinks)}</h3>
      <div style="margin-bottom:.5rem"><button type="button" class="btn btn-sm" data-action="dc-tenant-new">${icon('plus')} ${esc(G.newTenant)}</button></div>
      ${tRows}${tenantTpl()}${linkTpl()}</div>`;
  }

  const versionRows = versions.length
    ? versions.map((v) => `<div class="dc-row"><span class="g">${esc(v.label || G.notSet)}</span>
        <span class="m">${esc(v.released_on || G.notReleasedYet)}</span></div>`).join('')
    : `<div class="m">${esc(G.noVersionsYet)}</div>`;

  return card(`<div style="padding:.2rem 0">
    <script type="application/json" id="dc-people">${peopleJson}</script>
    <div class="dc-sec" style="border-top:0;padding-top:0;margin-top:0"><h3>${esc(G.productTeam)}</h3>
      <div style="margin-bottom:.5rem"><button type="button" class="btn btn-sm" data-action="dc-member-add">${icon('plus')} ${esc(G.addMember)}</button></div>
      <div class="dc-rows">${memberRows}</div></div>
    ${tenantsSec}
    <div class="dc-sec"><h3>${esc(G.versions)}</h3>
      <div style="margin-bottom:.5rem"><button type="button" class="btn btn-sm" data-action="dc-version-new">${icon('plus')} ${esc(G.newVersion)}</button></div>
      <div class="dc-rows">${versionRows}</div></div>
    <div class="dc-sec"><h3>${esc(G.branding)}</h3>
      ${fieldRow('dc-pr-name', 'اسم المنتج', `<input class="input" id="dc-pr-name" maxlength="120" value="${esc(product.name_ar || '')}">`)}
      ${fieldRow('dc-pr-name-en', 'اسمه بالإنجليزية', `<input class="input" id="dc-pr-name-en" maxlength="120" value="${esc(product.name_en || '')}">`,
    'يظهر في صفحة الاستقبال حين يفتحها الزائر بالإنجليزية — وبدونه يقرأ اسماً عربياً في صفحةٍ إنجليزية.')}
      ${fieldRow('dc-pr-desc', 'وصفٌ مختصر', `<textarea class="input" id="dc-pr-desc" rows="2" maxlength="2000">${esc(product.description || '')}</textarea>`)}
      <div class="dc-row" style="margin-top:.5rem"><span class="g">${esc(G.brandColor)}</span>
        <input class="input" type="color" id="dc-brand-color" value="${esc(product.brand_color || '#244A99')}" aria-label="${esc(G.brandColor)}" style="width:64px;padding:2px">
      </div>
      <div class="dc-row" style="margin-top:.4rem"><span class="g">${esc('شعار المنتج')}</span>
        <input class="input" type="file" id="dc-logo-file" accept="image/*" aria-label="${esc('شعار المنتج')}" style="max-width:220px">
        <button type="button" class="btn btn-sm" data-action="dc-logo-save">${esc('ارفع الشعار')}</button></div>
      <div style="margin-top:.6rem"><button type="button" class="btn btn-primary btn-sm" data-action="dc-product-save">${esc(G.save)}</button></div>
      <div class="m" style="margin-top:.4rem">${esc(G.brandingHint)}</div></div>
  </div>`);
}
