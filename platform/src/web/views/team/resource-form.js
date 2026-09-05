// ── S09 — نموذج المورد (إنشاء/تعديل) — قالبٌ خامل واحد تضمّنه شاشتان ─────────────────────
//
// «الأنواع: موظف داخلي، مستشار خارجي، مورد شريك. الحقول المتغيرة تتبع النوع… إنشاء حساب
//  الدخول خيار مستقل؛ عند إيقافه لا تطلب بريد دخول إلزامياً… التعديل يحمّل المورد الموجود
//  ويحفظ معرفه» — الموجّه §11/S09.
//
// القالب `<template id="tm-resource-form">` لا يُعرض حتى يستنسخه عميل الصفحة
// (public/pages/team-resource-form.js) عند «إضافة مورد» (S02/S01) أو «تعديل الملف» (S04) —
// فلا يُكرَّر النموذج في شاشتين ولا يُحمَّل مع كل صفحة. الملف عرضٌ صرف: لا قاعدة ولا صلاحية؛
// القوائم (القطاعات، الإدارات بمديريها) تصله جاهزةً من الصفحة (resources.js: resourceFormOptions)
// مقصوصةً بنطاق القارئ، والخادم هو من يتحقق ويحفظ (createResource/updateResource).
import { esc, icon } from './_shell.js';
import { G } from '../../i18n/glossary.js';

// مرآة RESOURCE_TYPE_AR في modules/team/access.js (داخلي/خارجي/شريك) — لا يستورد الملف الخدمة
// كي يبقى خفيفاً؛ واختبار team-ui-resources يضمن تطابق التسميات.
export const RESOURCE_TYPE_CARDS = Object.freeze([
  { key: 'internal', label: 'داخلي', hint: 'موظف على كشف الشركة', icon: 'users' },
  { key: 'external', label: 'خارجي', hint: 'مستشار متعاقد لفترة', icon: 'portfolio' },
  { key: 'partner', label: 'شريك', hint: 'مورد من جهة شريكة', icon: 'team' },
]);

export const RESOURCE_FORM_CSS = `
  #tm-rf-host [hidden],.tm-rf [hidden]{display:none!important}
  .tm-rf{z-index:130}
  .tm-rf .db{display:flex;flex-direction:column;gap:.7rem}
  .tm-rf-title{font-size:var(--fs-title);font-weight:800;color:var(--ink2)}
  .tm-rf-sub{font-size:var(--fs-meta);color:var(--muted);margin-top:.15rem}
  .tm-rf-types{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;border:none;margin:0;padding:0;min-width:0}
  .tm-rf-type{position:relative;display:flex;align-items:center;gap:.5rem;border:1px solid var(--line);border-radius:12px;padding:.6rem .7rem;cursor:pointer;background:var(--surface);min-width:0}
  .tm-rf-type.on,.tm-rf-type:has(input:checked){border-color:var(--brand2);background:#f5f0fb;box-shadow:0 0 0 2px rgba(131,71,152,.15)}
  .tm-rf-type:has(input:focus-visible){outline:2px solid var(--brand);outline-offset:2px}
  .tm-rf-type input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
  .tm-rf-type svg{width:18px;height:18px;color:var(--brand2);flex:none}
  .tm-rf-type b{display:block;font-size:var(--fs-body);color:var(--ink2)}
  .tm-rf-type small{display:block;font-size:var(--fs-micro);color:var(--muted)}
  .tm-rf .field{margin-bottom:.6rem;min-width:0}
  .tm-rf .field small{display:block;font-size:var(--fs-micro);color:var(--muted);margin-top:.2rem}
  .tm-rf .field .input,.tm-rf .field select,.tm-rf .field textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;font-size:var(--fs-ui);font-family:inherit;background:#fff;color:var(--ink2)}
  .tm-rf .field .input:focus,.tm-rf .field select:focus,.tm-rf .field textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,74,153,.14)}
  .tm-rf .field .input[aria-invalid="true"],.tm-rf .field select[aria-invalid="true"]{border-color:var(--red)}
  .tm-rf-ro{border:1px dashed var(--line);border-radius:10px;padding:.5rem .7rem;font-size:var(--fs-ui);color:var(--ink2);background:var(--bg)}
  .tm-rf-switch{display:flex;align-items:center;gap:.6rem;cursor:pointer;font-size:var(--fs-body);font-weight:700;color:var(--ink2);position:relative}
  .tm-rf-switch input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
  .tm-rf-switch .sw{width:38px;height:22px;border-radius:999px;background:#cbd5e1;position:relative;flex:none;transition:background .15s}
  .tm-rf-switch .sw::after{content:'';position:absolute;top:3px;inset-inline-start:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
  .tm-rf-switch input:checked+.sw{background:var(--brand)}
  .tm-rf-switch input:checked+.sw::after{transform:translateX(-16px)}
  .tm-rf-switch input:focus-visible+.sw{outline:2px solid var(--brand);outline-offset:2px}
  .tm-rf-foot{display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;width:100%}
  .tm-rf-foot .acts{display:flex;gap:.5rem}
  .tm-rf .btn[disabled]{opacity:.6;cursor:progress}
  .tm-rf .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .tm-rf ul.tm-rf-warn-list{margin:.3rem 0 0;padding-inline-start:1.2rem}
  @media (max-width:640px){.tm-rf-types{grid-template-columns:1fr}}
`;

/**
 * قالب S09. يعيد `<style>` + `<template id="tm-resource-form">` (الأنماط خارج القالب كي تسري
 * فور استنساخه). العميل يقرأ وضع الفتح (إضافة/تعديل) من الزر لا من هنا؛ `mode` يضبط العنوان
 * الافتراضي فقط.
 * @param {{ mode?: 'create'|'edit', sectors?: {id,name_ar}[], departments?: {id,name_ar,sector_id,manager_name?}[],
 *           managers?: {id,name_ar,department_id?}[], canCreateAccount?: boolean }} p
 */
export function resourceFormTemplate({ mode = 'create', sectors = [], departments = [], managers = [], canCreateAccount = false } = {}) {
  const isEdit = mode === 'edit';
  const titleCreate = G.addResource;
  const titleEdit = 'تعديل بيانات المورد';
  const typeCards = RESOURCE_TYPE_CARDS.map((t, i) => `<label class="tm-rf-type${i === 0 ? ' on' : ''}">
        <input type="radio" name="resource_type" value="${t.key}"${i === 0 ? ' checked' : ''}>${icon(t.icon)}<span style="min-width:0"><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></span></label>`).join('');
  const sectorOpts = (sectors || []).map((s) => `<option value="${esc(s.id)}">${esc(s.name_ar)}</option>`).join('');
  const deptOpts = (departments || []).map((d) => `<option value="${esc(d.id)}" data-sector="${esc(d.sector_id || '')}" data-manager="${esc(d.manager_name || '')}">${esc(d.name_ar)}</option>`).join('');
  // المدير المسؤول: القاعدة القائمة في المنصة أن مدير إدارة المورد هو من يعتمد تسكينه
  // (org/confirm.js managerOfEmployee) — فيُعرض مشتقاً من الإدارة المختارة. وإن مرّرت الصفحة
  // قائمة مديرين صريحة عُرضت اختياراً اختيارياً بدلاً منه.
  const managerField = (managers || []).length
    ? `<div class="field"><label for="rf-manager">المدير المسؤول</label>
        <select id="rf-manager" name="line_manager_id"><option value="">مدير الإدارة المختارة (تلقائي)</option>${managers.map((m) => `<option value="${esc(m.id)}" data-dept="${esc(m.department_id || '')}">${esc(m.name_ar)}</option>`).join('')}</select>
        <small>يُترك تلقائياً ليكون مدير الإدارة هو المعتمِد</small></div>`
    : `<div class="field"><label>المدير المسؤول</label>
        <div class="tm-rf-ro" id="rf-manager-ro" data-empty="يُحدَّد من الإدارة المختارة" aria-live="polite">يُحدَّد من الإدارة المختارة</div>
        <small>مدير الإدارة يعتمد التسكين على هذا المورد</small></div>`;
  const accountBlock = canCreateAccount
    ? `<div id="rf-account-switch">
          <label class="tm-rf-switch"><input type="checkbox" id="rf-create-account" name="create_account"><span class="sw" aria-hidden="true"></span><span>إنشاء حساب دخول</span></label>
          <small class="tm-note" style="margin-top:.3rem">يمكن حفظ المورد دون حساب — تصله المهام والإشعارات بعد إنشاء الحساب وربطه.</small>
          <div id="rf-account-fields" hidden style="margin-top:.7rem">
            <div class="field"><label class="req" for="rf-email">بريد العمل</label><input class="input" type="email" id="rf-email" name="email" dir="ltr" autocomplete="off" placeholder="name@company.com"></div>
            <div class="tm-info">يُنشأ حساب دخول على هذا البريد بالدور الأساسي للموظف، ويُفعَّل ويُدعى من شاشة «المستخدمون والصلاحيات» — لا تُرسل دعوة تلقائياً.</div>
          </div>
        </div>`
    : `<div id="rf-account-switch" class="tm-note">يُحفظ المورد بلا حساب دخول، ويُنشأ حسابه ويُربط لاحقاً من تبويب «حسابات الدخول» — لا دعوة تُرسل من هنا.</div>`;

  return `<style>${RESOURCE_FORM_CSS}</style>
<template id="tm-resource-form">
<div class="tm-scrim open" data-action="rf-close" aria-hidden="true"></div>
<aside class="tm-drawer tm-rf" role="dialog" aria-modal="true" aria-labelledby="tm-rf-title" data-mode="${esc(mode)}" data-title-create="${esc(titleCreate)}" data-title-edit="${esc(titleEdit)}">
  <form class="tm-form" id="tm-rf-form" novalidate autocomplete="off" style="display:contents">
    <div class="dh">
      <div style="min-width:0;flex:1">
        <div class="tm-rf-title" id="tm-rf-title">${esc(isEdit ? titleEdit : titleCreate)}</div>
        <div class="tm-rf-sub">البيانات الأساسية أولاً، ويمكن استكمال القدرات والملفات لاحقاً من ملف المورد.</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="rf-close" aria-label="إغلاق النموذج">✕</button>
    </div>
    <div class="db">
      <div id="tm-rf-msg" aria-live="polite"></div>
      <fieldset class="tm-rf-types" id="tm-rf-types"><legend class="sr">نوع المورد</legend>${typeCards}</fieldset>

      <div class="tm-sec">
        <div class="sh">بيانات المورد</div>
        <div class="row">
          <div class="field"><label class="req" for="rf-name">الاسم الكامل</label><input class="input" id="rf-name" name="name_ar" required maxlength="120"></div>
          <div class="field"><label for="rf-job">المسمى</label><input class="input" id="rf-job" name="job_title" maxlength="120" placeholder="مثل: محلل بيانات"></div>
        </div>
        <div class="row">
          <div class="field"><label class="req" for="rf-sector">القطاع الأساسي</label>
            <select id="rf-sector" name="sector_id" required><option value="">اختر القطاع</option>${sectorOpts}</select></div>
          <div class="field"><label for="rf-dept">الإدارة الأساسية</label>
            <select id="rf-dept" name="department_id"><option value="">اختر القطاع أولاً</option>${deptOpts}</select></div>
        </div>
        ${managerField}
      </div>

      <div class="tm-sec">
        <div class="sh">الارتباط والطاقة</div>
        <div class="row">
          <div class="field"><label class="req" for="rf-hire">بداية الارتباط</label><input class="input tnum" type="date" id="rf-hire" name="hire_date" required></div>
          <div class="field"><label for="rf-end">نهاية الارتباط</label><input class="input tnum" type="date" id="rf-end" name="end_date"><small>اتركه فارغاً للارتباط المفتوح</small></div>
          <div class="field"><label class="req" for="rf-cap">الطاقة الأساسية</label><input class="input tnum" type="number" id="rf-cap" name="capacity_pct" min="10" max="150" step="5" value="100" required><small>100 = دوام كامل</small></div>
        </div>
        <div class="row tm-rf-vendor" hidden>
          <div class="field"><label class="req" for="rf-vendor">الجهة المتعاقدة</label><input class="input" id="rf-vendor" name="vendor_name" maxlength="160" placeholder="اسم الشركة أو الجهة"></div>
          <div class="field"><label for="rf-ref">مرجع الارتباط</label><input class="input" id="rf-ref" name="engagement_ref" maxlength="80" dir="auto"><small>رقم العقد أو أمر الشراء إن وُجد</small></div>
        </div>
        <div class="field"><label for="rf-note">ملاحظة</label><textarea id="rf-note" name="note" rows="2" maxlength="500" placeholder="سبب الطاقة الجزئية أو أي سياق مفيد"></textarea></div>
      </div>

      <div class="tm-sec" id="rf-account-sec">
        <div class="sh">حساب الدخول</div>
        ${accountBlock}
        <div id="rf-account-linked" class="tm-ok" hidden>لهذا المورد حساب دخول مربوط — تُدار صلاحياته من «المستخدمون والصلاحيات».</div>
      </div>
    </div>
    <div class="df">
      <div class="tm-rf-foot">
        <span class="tm-note">الحقول بعلامة <span style="color:var(--red)">*</span> مطلوبة</span>
        <div class="acts"><button type="button" class="btn" data-action="rf-close">إلغاء</button><button type="submit" class="btn btn-primary" id="rf-save">${esc(isEdit ? 'حفظ التعديلات' : 'حفظ المورد')}</button></div>
      </div>
    </div>
  </form>
</aside>
</template>`;
}
