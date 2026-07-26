// صفحة الهيكل التنظيمي — عرض شجري قابل للطيّ: الشركة ← القطاع ← الإدارة ← الوحدة ← الموظفون.
// يحلّ محل شبكة البطاقات السابقة التي كانت تُظهر مستويين فقط بلا روابط تبعية ولا مسؤول لكل مستوى.
// الطيّ عبر <details> الأصلية: يعمل بلا جافاسكربت، ومتاح بلوحة المفاتيح، ويبقى سليماً لو فشل السكربت.
import { all, get } from '../../core/db/index.js';
import { orgTree } from '../../modules/org/org.js';
import { layout, card, pill } from '../layout.js';
import { can } from '../../core/rbac/index.js';
import { esc } from './_shared.js';

// نفس شرط الخدمة حرفياً (canManageSectorOrg): من يملك هيكل هذا القطاع يرى أدواته، وغيره يرى
// الشجرة للقراءة فقط. الإخفاء تجميل — الخدمة هي التي تمنع فعلاً.
const mayEdit = (user, sectorId) => user.role_id === 'admin' || can(user, 'admin', 'department', { sector_id: sectorId });

// أسماء المسؤولين تُجلب باستعلام مجمّع واحد (لا استعلام لكل عقدة) — نفس نمط بقية الصفحات.
async function managerNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await all(
    `SELECT id, name_ar, username FROM app_user WHERE deleted_at IS NULL AND id IN (${uniq.map(() => '?').join(',')})`,
    uniq
  );
  return new Map(rows.map((r) => [r.id, r.name_ar || r.username]));
}

const leadLine = (name) => name
  ? `<span class="ot-lead">${esc(name)}</span>`
  : '<span class="ot-lead ot-none">بلا مسؤول معيَّن</span>';

const countChip = (n, word) => `<span class="ot-count tnum">${n}</span> <span class="ot-word">${word}</span>`;

export async function orgTreePage(user) {
  const tree = await orgTree(user);
  const mgrIds = [];
  for (const s of tree) {
    mgrIds.push(s.lead_user_id);
    for (const d of s.departments || []) {
      mgrIds.push(d.manager_user_id);
      for (const u of d.units || []) mgrIds.push(u.manager_user_id);
    }
  }
  const names = await managerNames(mgrIds);

  // إشارات جودة بيانات حقيقية: من هو خارج أي إدارة، وكم قطاعاً بلا إدارات أصلاً.
  const unassigned = (await get('SELECT COUNT(*) n FROM employee WHERE deleted_at IS NULL AND (department_id IS NULL OR department_id = \'\')')).n;
  const totalEmployees = (await get('SELECT COUNT(*) n FROM employee WHERE deleted_at IS NULL')).n;
  const flatSectors = tree.filter((s) => !(s.departments || []).length).length;

  const unitNode = (u) => `<li class="ot-li">
    <div class="ot-node ot-unit">
      <div class="ot-main"><span class="ot-kind">وحدة</span><span class="ot-name">${esc(u.name_ar)}</span></div>
      <div class="ot-meta">${leadLine(names.get(u.manager_user_id))}</div>
    </div>
  </li>`;

  const deptNode = (d, editable, sectors) => {
    const units = d.units || [];
    const unitAdd = editable ? `<li class="ot-li"><div class="ot-add">
      <input class="ot-in" id="u-${d.id}" placeholder="اسم وحدة جديدة…" aria-label="اسم وحدة جديدة">
      <button class="ot-btn" data-action="unit-add" data-dep="${d.id}">إضافة وحدة</button>
    </div></li>` : '';
    const inner = (units.length || editable)
      ? `<ul class="ot-ul">${units.map(unitNode).join('')}${unitAdd}</ul>`
      : '<div class="ot-empty">لا وحدات داخل هذه الإدارة</div>';
    const actions = editable ? `<div class="ot-acts">
      <button class="ot-act" data-action="dep-rename" data-id="${d.id}" data-name="${esc(d.name_ar)}">إعادة تسمية</button>
      <select class="ot-act ot-sel" data-action-change="dep-move" data-id="${d.id}" aria-label="نقل الإدارة إلى قطاع آخر">
        <option value="">نقل إلى…</option>
        ${sectors.filter((x) => x.id !== d.sector_id).map((x) => `<option value="${esc(x.id)}">${esc(x.name_ar)}</option>`).join('')}
      </select>
      <button class="ot-act ot-danger" data-action="dep-del" data-id="${d.id}" data-name="${esc(d.name_ar)}">حذف</button>
    </div>` : '';
    return `<li class="ot-li">
      <details class="ot-det" open>
        <summary class="ot-node ot-dept">
          <div class="ot-main"><span class="ot-kind">إدارة</span><span class="ot-name">${esc(d.name_ar)}</span></div>
          <div class="ot-meta">${leadLine(names.get(d.manager_user_id))} · ${countChip(d.employees, d.employees === 1 ? 'موظف' : 'موظفاً')}${actions}</div>
        </summary>
        ${inner}
      </details>
    </li>`;
  };

  const sectorList = tree.map((s) => ({ id: s.id, name_ar: s.name_ar }));
  const sectorNode = (s) => {
    const deps = s.departments || [];
    const editable = mayEdit(user, s.id);
    const depAdd = editable ? `<li class="ot-li"><div class="ot-add">
      <input class="ot-in" id="d-${s.id}" placeholder="اسم إدارة جديدة…" aria-label="اسم إدارة جديدة">
      <button class="ot-btn" data-action="dep-add" data-sector="${esc(s.id)}">إضافة إدارة</button>
    </div></li>` : '';
    const inner = (deps.length || editable)
      ? `<ul class="ot-ul">${deps.map((d) => deptNode(d, editable, sectorList)).join('')}${depAdd}</ul>`
      : `<div class="ot-empty">لا إدارات تحت هذا القطاع</div>`;
    return `<li class="ot-li">
      <details class="ot-det" open>
        <summary class="ot-node ot-sector">
          <div class="ot-main">
            <span class="ot-dot" style="background:${esc(s.color || '#244A99')}"></span>
            <span class="ot-kind">قطاع</span><span class="ot-name">${esc(s.name_ar)}</span>
            ${s.is_placeholder ? pill('قالب', 'amber') : ''}
          </div>
          <div class="ot-meta">${leadLine(names.get(s.lead_user_id))} · ${countChip(s.employees, s.employees === 1 ? 'موظف' : 'موظفاً')} · ${countChip(deps.length, deps.length === 1 ? 'إدارة' : 'إدارات')}</div>
        </summary>
        ${inner}
      </details>
    </li>`;
  };

  const health = [
    unassigned > 0
      ? `<div class="ot-flag ot-warn">${countChip(unassigned, unassigned === 1 ? 'موظف' : 'موظفاً')} خارج أي إدارة — لا يظهرون تحت أي فرع في الشجرة</div>`
      : '',
    flatSectors > 0
      ? `<div class="ot-flag ot-warn">${countChip(flatSectors, flatSectors === 1 ? 'قطاع' : 'قطاعات')} بلا إدارات — الطبقة الوسطى غير ممثَّلة بعد</div>`
      : '',
    (!unassigned && !flatSectors)
      ? '<div class="ot-flag ot-ok">كل الموظفين مربوطون بإدارة، وكل قطاع له إداراته</div>'
      : '',
  ].join('');

  const body = `
    <style>
      .ot-wrap{font-size:13px}
      .ot-ul{list-style:none;margin:0;padding:0 1.4rem 0 0;position:relative}
      /* العمود الفقري للشجرة على يمين الفرع — اتجاه القراءة العربي */
      .ot-ul::before{content:"";position:absolute;top:0;bottom:.9rem;right:.55rem;width:1px;background:var(--line)}
      .ot-li{position:relative;padding:.3rem 0}
      .ot-li::before{content:"";position:absolute;top:1.15rem;right:.55rem;width:.75rem;height:1px;background:var(--line)}
      .ot-det>summary{list-style:none;cursor:pointer}
      .ot-det>summary::-webkit-details-marker{display:none}
      .ot-det>summary::before{content:"▾";position:absolute;right:-1.05rem;top:.75rem;font-size:10px;color:var(--muted);transition:transform .15s}
      .ot-det:not([open])>summary::before{transform:rotate(90deg)}
      .ot-node{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;justify-content:space-between;
        background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:.5rem .75rem;position:relative}
      .ot-node:hover{border-color:#c9d3e8}
      .ot-det>summary:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:10px}
      .ot-main{display:flex;align-items:center;gap:.5rem;min-width:0}
      .ot-name{font-weight:800;color:var(--ink2)}
      .ot-kind{font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--muted);
        background:var(--bg);border-radius:5px;padding:.1rem .35rem;flex:none}
      .ot-dot{width:10px;height:10px;border-radius:3px;flex:none}
      .ot-meta{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
      .ot-lead{color:var(--ink2);font-weight:700}
      .ot-lead.ot-none{color:var(--faint);font-weight:400}
      .ot-count{font-weight:800;color:var(--ink2)}
      .ot-word{color:var(--muted)}
      .ot-sector{border-inline-start:3px solid var(--brand)}
      .ot-dept{border-inline-start:3px solid var(--brand2)}
      .ot-unit{background:var(--bg)}
      .ot-empty{font-size:11.5px;color:var(--faint);padding:.35rem 1.4rem .2rem 0}
      .ot-acts{display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;margin-inline-start:.3rem}
      .ot-act{font-size:10.5px;font-family:inherit;color:var(--muted);background:var(--bg);
        border:1px solid var(--line);border-radius:6px;padding:.15rem .45rem;cursor:pointer}
      .ot-act:hover{border-color:#c9d3e8;color:var(--ink2)}
      .ot-act.ot-danger:hover{border-color:var(--red);color:var(--red)}
      .ot-sel{padding:.15rem .3rem}
      .ot-add{display:flex;gap:.35rem;align-items:center;padding:.15rem 0}
      .ot-in{flex:1;min-width:0;max-width:320px;font-family:inherit;font-size:12px;
        border:1px dashed var(--line-strong,#c4cddb);border-radius:8px;padding:.35rem .6rem;background:transparent;color:var(--ink2)}
      .ot-in:focus{outline:none;border-color:var(--brand);border-style:solid}
      .ot-btn{font-size:11.5px;font-family:inherit;color:#fff;border:none;border-radius:8px;
        padding:.35rem .7rem;cursor:pointer;background:var(--brand-grad)}
      .ot-flag{font-size:12px;border-radius:9px;padding:.5rem .75rem;margin-bottom:.4rem}
      .ot-warn{background:#fef3c7;color:#92400e}
      .ot-ok{background:#dcfce7;color:#166534}
      .ot-root{display:flex;align-items:center;gap:.55rem;font-weight:800;font-size:14.5px;
        background:var(--brand-grad);color:#fff;border-radius:10px;padding:.6rem .9rem;margin-bottom:.2rem}
      @media(max-width:640px){.ot-node{gap:.3rem}.ot-meta{width:100%}}
    </style>
    <div class="ot-wrap">
      ${health}
      ${card(`<div style="padding:1rem">
        <div class="ot-root">
          <span>رؤية الخبراء الاستشارية</span>
          <span style="font-weight:400;font-size:11.5px;opacity:.85">${countChip(totalEmployees, totalEmployees === 1 ? 'موظف' : 'موظفاً')} · ${countChip(tree.length, tree.length === 1 ? 'قطاع' : 'قطاعات')}</span>
        </div>
        <ul class="ot-ul">${tree.map(sectorNode).join('') || '<div class="ot-empty">لا قطاعات بعد</div>'}</ul>
      </div>`)}
    </div>`;

  return layout({
    user, active: 'org', title: 'الهيكل التنظيمي',
    subtitle: 'الشركة ← القطاع ← الإدارة ← الوحدة ← الموظف — انقر أي فرع لطيّه',
    body, scripts: ['/static/pages/org-tree.js'],
  });
}
